/**
 * Scene-aware keyframe extraction for the AI agent, ported from
 * claude-real-video (crv, MIT)'s pipeline and adapted to run on a canvas
 * instead of ffmpeg. Instead of the agent guessing timestamps, the video is
 * scanned chronologically and only frames that actually differ survive:
 *
 * 1. Candidate sampling — a fixed step through the video (the browser can't
 *    afford ffmpeg's every-frame scene scores; the step doubles as crv's
 *    fps-floor).
 * 2. Global channel — % of changed cells on a 16x16 RGB signature vs a
 *    sliding window of the last kept frames. The window catches A-B-A
 *    alternation: a shot the model has already seen doesn't come back just
 *    because a different frame sat in between. RGB, not luma — equal-luma hue
 *    changes must not look identical.
 * 3. Local channel — screen recordings change in ways the global channel
 *    can't see (a typed word, a small UI update average out to ~0%
 *    globally). When the scene is otherwise static, a finer 96x96 signature
 *    is scored per grid cell against EVERY kept frame in the window; one
 *    strongly-changed cell keeps the frame. A cooldown stops sustained
 *    small motion (spinner, caret) from taking a frame every step.
 * 4. Density floor — at least one frame every few seconds regardless, so
 *    long static stretches stay represented.
 * 5. Uniform thinning — a max-frames cap applied after selection, so
 *    survivors stay spread across the whole video.
 *
 * The kept frames are packed into labelled contact sheets (makeContactSheets)
 * — consecutive frames side by side in one image follow motion far better
 * than scattered stills, and cut the image count ~9x.
 */

export const COARSE_SIZE = 16;
export const FINE_SIZE = 96;
export const FINE_GRID = 12;

/** % of coarse cells that must change for the global channel to keep a frame. */
export const GLOBAL_THRESHOLD_PCT = 8;
/** Per-channel tolerance before a coarse cell counts as changed. */
export const GLOBAL_TOLERANCE = 25;
/** Compare against this many previously kept frames (A-B-A dedup). */
export const DEDUP_WINDOW = 4;
/** Global motion (vs the previous candidate) must be under this % for the local channel to run. */
export const LOCAL_MOTION_CEIL_PCT = 3;
/** Per-channel tolerance for the local channel (soft-contrast drift dies, text survives). */
export const LOCAL_TOLERANCE = 60;
/** % of one fine-grid cell's pixels that must change for a local keep. */
export const LOCAL_GATE_PCT = 45;
/** Cooldown dynamics: each local keep raises the gate, decaying per candidate. */
const LOCAL_COOLDOWN_BUMP = 2.0;
const LOCAL_COOLDOWN_DECAY = 0.7;
/** Density floor: force a keep when this much time passed since the last one. */
export const DENSITY_FLOOR_MS = 5_000;

/** RGB triplets, row-major. coarse: 16x16, fine: 96x96. */
export interface FrameSignature {
	coarse: Uint8ClampedArray;
	fine: Uint8ClampedArray;
}

export type KeepReason = "first" | "scene" | "local" | "floor";

/** % of coarse cells whose max-channel difference exceeds the tolerance. */
export function pctDiff(
	a: Uint8ClampedArray,
	b: Uint8ClampedArray,
	tolerance = GLOBAL_TOLERANCE,
): number {
	const cells = Math.min(a.length, b.length) / 3;
	if (cells === 0) return 0;
	let changed = 0;
	for (let i = 0; i < cells * 3; i += 3) {
		const diff = Math.max(
			Math.abs(a[i] - b[i]),
			Math.abs(a[i + 1] - b[i + 1]),
			Math.abs(a[i + 2] - b[i + 2]),
		);
		if (diff > tolerance) changed++;
	}
	return (100 * changed) / cells;
}

/**
 * Local-change score: split the fine signature into FINE_GRID x FINE_GRID
 * cells and return the highest per-cell % of strongly-changed pixels. A thin
 * new text line lights up one cell near 100% while measuring ~0% globally.
 */
export function maxCellDiffPct(
	a: Uint8ClampedArray,
	b: Uint8ClampedArray,
	tolerance = LOCAL_TOLERANCE,
): number {
	const cellPx = FINE_SIZE / FINE_GRID;
	let maxPct = 0;
	for (let gy = 0; gy < FINE_GRID; gy++) {
		for (let gx = 0; gx < FINE_GRID; gx++) {
			let changed = 0;
			for (let y = gy * cellPx; y < (gy + 1) * cellPx; y++) {
				for (let x = gx * cellPx; x < (gx + 1) * cellPx; x++) {
					const i = (y * FINE_SIZE + x) * 3;
					const diff = Math.max(
						Math.abs(a[i] - b[i]),
						Math.abs(a[i + 1] - b[i + 1]),
						Math.abs(a[i + 2] - b[i + 2]),
					);
					if (diff > tolerance) changed++;
				}
			}
			const pct = (100 * changed) / (cellPx * cellPx);
			if (pct > maxPct) maxPct = pct;
		}
	}
	return maxPct;
}

export interface SelectorOptions {
	threshold?: number;
	window?: number;
	floorMs?: number;
	localGatePct?: number;
}

/**
 * Streaming keep/drop decisions over candidate frames in chronological order.
 * Pure state machine over signatures — the DOM capture loop feeds it, tests
 * drive it with synthetic arrays.
 */
export class KeyframeSelector {
	private readonly threshold: number;
	private readonly window: number;
	private readonly floorMs: number;
	private readonly localGatePct: number;
	private readonly recentCoarse: Uint8ClampedArray[] = [];
	private readonly recentFine: Uint8ClampedArray[] = [];
	private prevCoarse: Uint8ClampedArray | null = null;
	private lastKeptMs: number | null = null;
	private cooldown = 1.0;

	constructor(options: SelectorOptions = {}) {
		this.threshold = options.threshold ?? GLOBAL_THRESHOLD_PCT;
		this.window = options.window ?? DEDUP_WINDOW;
		this.floorMs = options.floorMs ?? DENSITY_FLOOR_MS;
		this.localGatePct = options.localGatePct ?? LOCAL_GATE_PCT;
	}

	consider(signature: FrameSignature, timeMs: number): KeepReason | null {
		let reason: KeepReason | null = null;

		if (this.recentCoarse.length === 0) {
			reason = "first";
		} else {
			// Global channel: the frame must differ from every kept frame in the
			// window, so the minimum distance is what must clear the threshold.
			let minDist = Number.POSITIVE_INFINITY;
			for (const kept of this.recentCoarse) {
				const dist = pctDiff(signature.coarse, kept);
				if (dist < minDist) minDist = dist;
			}
			if (minDist > this.threshold) {
				reason = "scene";
			} else {
				// Local channel: only when the scene is otherwise static —
				// mid-motion frames are the global channel's job.
				const motion = this.prevCoarse === null ? 100 : pctDiff(signature.coarse, this.prevCoarse);
				if (motion < LOCAL_MOTION_CEIL_PCT) {
					let minMaxCell = Number.POSITIVE_INFINITY;
					for (const kept of this.recentFine) {
						const score = maxCellDiffPct(signature.fine, kept);
						if (score < minMaxCell) minMaxCell = score;
					}
					if (minMaxCell > this.localGatePct * this.cooldown) {
						reason = "local";
						this.cooldown += LOCAL_COOLDOWN_BUMP;
					}
				}
				if (
					reason === null &&
					this.lastKeptMs !== null &&
					timeMs - this.lastKeptMs >= this.floorMs
				) {
					reason = "floor";
				}
			}
		}

		this.prevCoarse = signature.coarse;
		this.cooldown = Math.max(1.0, this.cooldown * LOCAL_COOLDOWN_DECAY);

		if (reason !== null) {
			this.lastKeptMs = timeMs;
			this.recentCoarse.push(signature.coarse);
			this.recentFine.push(signature.fine);
			if (this.recentCoarse.length > this.window) {
				this.recentCoarse.shift();
				this.recentFine.shift();
			}
		}
		return reason;
	}
}

/**
 * Thin a kept list down to `maxFrames`, keeping the survivors uniformly
 * spread (crv thins after dedup for the same reason — a head-biased cut
 * would blind the model to the tail of the video).
 */
export function thinUniformly<T>(items: T[], maxFrames: number): T[] {
	if (maxFrames <= 0 || items.length <= maxFrames) return items;
	const step = items.length / maxFrames;
	const keep = new Set<number>();
	for (let i = 0; i < maxFrames; i++) keep.add(Math.floor(i * step));
	return items.filter((_, index) => keep.has(index));
}

export function formatFrameTime(timeMs: number): string {
	const totalSeconds = timeMs / 1000;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds < 10 ? "0" : ""}${seconds.toFixed(1)}`;
}

// ---------------------------------------------------------------------------
// DOM capture (not covered by unit tests — exercised through the tool host)
// ---------------------------------------------------------------------------

const MAX_FRAME_WIDTH = 768;
const SEEK_TIMEOUT_MS = 4_000;
const MAX_CANDIDATES = 500;
const MIN_CANDIDATE_INTERVAL_MS = 250;

export interface ExtractedKeyframe {
	timeMs: number;
	reason: KeepReason;
	bitmap: ImageBitmap;
}

export interface ExtractKeyframesResult {
	frames: ExtractedKeyframe[];
	scannedCount: number;
	startMs: number;
	endMs: number;
}

function waitForEvent(target: EventTarget, event: string, timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`timed out waiting for ${event}`));
		}, timeoutMs);
		const onEvent = () => {
			cleanup();
			resolve();
		};
		const onError = () => {
			cleanup();
			reject(new Error("video failed to load"));
		};
		function cleanup() {
			clearTimeout(timer);
			target.removeEventListener(event, onEvent);
			target.removeEventListener("error", onError);
		}
		target.addEventListener(event, onEvent, { once: true });
		target.addEventListener("error", onError, { once: true });
	});
}

function signatureFrom(
	video: HTMLVideoElement,
	coarseCtx: CanvasRenderingContext2D,
	fineCtx: CanvasRenderingContext2D,
): FrameSignature {
	coarseCtx.drawImage(video, 0, 0, COARSE_SIZE, COARSE_SIZE);
	fineCtx.drawImage(video, 0, 0, FINE_SIZE, FINE_SIZE);
	const toRgb = (data: Uint8ClampedArray) => {
		const rgb = new Uint8ClampedArray((data.length / 4) * 3);
		for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
			rgb[j] = data[i];
			rgb[j + 1] = data[i + 1];
			rgb[j + 2] = data[i + 2];
		}
		return rgb;
	};
	return {
		coarse: toRgb(coarseCtx.getImageData(0, 0, COARSE_SIZE, COARSE_SIZE).data),
		fine: toRgb(fineCtx.getImageData(0, 0, FINE_SIZE, FINE_SIZE).data),
	};
}

/**
 * Scan the video chronologically and return scene-aware, deduplicated
 * keyframes as ImageBitmaps (caller owns closing them — makeContactSheets
 * does it). Uses a detached <video> so the visible player never scrubs.
 */
export async function extractKeyframes(
	videoUrl: string,
	options: { startMs?: number; endMs?: number; maxFrames?: number } = {},
): Promise<ExtractKeyframesResult> {
	const video = document.createElement("video");
	video.muted = true;
	video.preload = "auto";
	video.src = videoUrl;

	try {
		if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
			await waitForEvent(video, "loadedmetadata", SEEK_TIMEOUT_MS);
		}
		const durationMs = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
		const startMs = Math.max(0, Math.min(options.startMs ?? 0, durationMs));
		const endMs = Math.max(startMs, Math.min(options.endMs ?? durationMs, durationMs));
		const spanMs = Math.max(0, endMs - startMs);
		const intervalMs = Math.max(MIN_CANDIDATE_INTERVAL_MS, spanMs / MAX_CANDIDATES);

		const makeCtx = (size: number) => {
			const canvas = document.createElement("canvas");
			canvas.width = size;
			canvas.height = size;
			// willReadFrequently keeps repeated getImageData off the GPU path.
			const ctx = canvas.getContext("2d", { willReadFrequently: true });
			if (!ctx) throw new Error("2d canvas unavailable");
			return ctx;
		};
		const coarseCtx = makeCtx(COARSE_SIZE);
		const fineCtx = makeCtx(FINE_SIZE);

		const width = Math.min(MAX_FRAME_WIDTH, video.videoWidth || MAX_FRAME_WIDTH);
		const height = Math.round(width * ((video.videoHeight || 9) / (video.videoWidth || 16)));
		const frameCanvas = document.createElement("canvas");
		frameCanvas.width = width;
		frameCanvas.height = height;
		const frameCtx = frameCanvas.getContext("2d");
		if (!frameCtx) throw new Error("2d canvas unavailable");

		const selector = new KeyframeSelector();
		const kept: ExtractedKeyframe[] = [];
		let scannedCount = 0;

		for (let t = startMs; t <= Math.max(startMs, endMs - 50); t += intervalMs) {
			video.currentTime = t / 1000;
			await waitForEvent(video, "seeked", SEEK_TIMEOUT_MS);
			scannedCount++;
			const reason = selector.consider(signatureFrom(video, coarseCtx, fineCtx), t);
			if (reason !== null) {
				frameCtx.drawImage(video, 0, 0, width, height);
				kept.push({
					timeMs: Math.round(t),
					reason,
					bitmap: await createImageBitmap(frameCanvas),
				});
			}
		}

		const maxFrames = options.maxFrames ?? 27;
		const thinned = thinUniformly(kept, maxFrames);
		for (const frame of kept) {
			if (!thinned.includes(frame)) frame.bitmap.close();
		}
		return { frames: thinned, scannedCount, startMs, endMs };
	} finally {
		video.removeAttribute("src");
		video.load();
	}
}

// ---------------------------------------------------------------------------
// Contact sheets
// ---------------------------------------------------------------------------

const SHEET_COLS = 3;
const SHEET_ROWS = 3;
const SHEET_CELL_WIDTH = 480;
const SHEET_LABEL_HEIGHT = 22;
const SHEET_JPEG_QUALITY = 0.8;

export interface ContactSheet {
	data: string;
	mimeType: string;
	/** Chronological cells on this sheet: label shown in the image + timestamp. */
	cells: Array<{ label: string; timeMs: number }>;
}

/**
 * Tile keyframes, in order, into 3x3 contact sheets. Every cell carries a
 * "#n m:ss.s" label bar so the model can cite the exact source timestamp of
 * anything it sees. Closes the consumed bitmaps.
 */
export function makeContactSheets(frames: ExtractedKeyframe[]): ContactSheet[] {
	if (frames.length === 0) return [];
	const perSheet = SHEET_COLS * SHEET_ROWS;
	const aspect = frames[0].bitmap.height / Math.max(1, frames[0].bitmap.width);
	const cellW = SHEET_CELL_WIDTH;
	const cellH = Math.round(cellW * aspect) + SHEET_LABEL_HEIGHT;

	const sheets: ContactSheet[] = [];
	for (let offset = 0; offset < frames.length; offset += perSheet) {
		const batch = frames.slice(offset, offset + perSheet);
		const rows = Math.ceil(batch.length / SHEET_COLS);
		const canvas = document.createElement("canvas");
		canvas.width = SHEET_COLS * cellW;
		canvas.height = rows * cellH;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("2d canvas unavailable");
		ctx.fillStyle = "#000";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.font = "13px ui-monospace, monospace";
		ctx.textBaseline = "middle";

		const cells: ContactSheet["cells"] = [];
		batch.forEach((frame, i) => {
			const x = (i % SHEET_COLS) * cellW;
			const y = Math.floor(i / SHEET_COLS) * cellH;
			const label = `#${offset + i + 1} ${formatFrameTime(frame.timeMs)}`;
			ctx.fillStyle = "#fff";
			ctx.fillText(label, x + 6, y + SHEET_LABEL_HEIGHT / 2);
			ctx.drawImage(frame.bitmap, x, y + SHEET_LABEL_HEIGHT, cellW, cellH - SHEET_LABEL_HEIGHT);
			frame.bitmap.close();
			cells.push({ label: `#${offset + i + 1}`, timeMs: frame.timeMs });
		});

		const dataUrl = canvas.toDataURL("image/jpeg", SHEET_JPEG_QUALITY);
		sheets.push({
			data: dataUrl.slice(dataUrl.indexOf(",") + 1),
			mimeType: "image/jpeg",
			cells,
		});
	}
	return sheets;
}
