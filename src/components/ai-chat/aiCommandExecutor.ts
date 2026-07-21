import type { EditorState } from "@/hooks/useEditorHistory";
import {
	AI_CAPTION_POSITION,
	AI_CAPTION_SIZE,
	AI_CAPTION_STYLE,
} from "@/lib/captioning/annotationsFromCaptions";
import {
	type AnnotationRegion,
	type AnnotationTextAnimation,
	type AnnotationTextStyle,
	type CaptionMotion,
	type CursorTelemetryPoint,
	clampFocusToDepth,
	clampPlaybackSpeed,
	DEFAULT_ZOOM_DEPTH,
	type EffectRegion,
	MAX_CAPTION_BOX_PADDING_EM,
	MAX_CAPTION_BOX_RADIUS_PX,
	MAX_EFFECT_BLUR_PX,
	MAX_SPEED_RAMP_MS,
	MAX_ZOOM_SCALE,
	MIN_ZOOM_SCALE,
	type SpeedRegion,
	type TrimRegion,
	type VideoEffectType,
	ZOOM_DEPTH_SCALES,
	type ZoomDepth,
	type ZoomRegion,
} from "../video-editor/types";

/**
 * Pure executor for AI edit commands. Given the current EditorState and a
 * command from the chat agent, returns the Partial<EditorState> to apply via
 * pushState (one call = one undo checkpoint) plus the JSON payload sent back
 * to the model and a short summary for the tool chip. All input is untrusted
 * model output — every value is validated and clamped here, mirroring the
 * rules in projectPersistence.normalizeProjectEditor.
 */

export interface AiCommandContext {
	durationMs: number;
	aspectRatio: string;
	cursorTelemetry: CursorTelemetryPoint[];
	allocZoomId: () => string;
	allocTrimId: () => string;
	allocSpeedId: () => string;
	allocEffectId: () => string;
	allocAnnotationId: () => string;
	allocAnnotationZIndex: () => number;
}

export interface AiCommandResult {
	/** null for read-only commands — nothing to push. */
	partial: Partial<EditorState> | null;
	ok: boolean;
	content: string;
	summary?: string;
}

const MIN_SPAN_MS = 200;
const CLICK_TYPES = new Set(["click", "double-click", "right-click", "middle-click"]);
const MAX_CLICK_EVENTS = 200;

function fail(message: string): AiCommandResult {
	return { partial: null, ok: false, content: JSON.stringify({ error: message }) };
}

function formatMs(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function clampSpan(
	startMs: unknown,
	endMs: unknown,
	durationMs: number,
): { startMs: number; endMs: number } | null {
	if (typeof startMs !== "number" || typeof endMs !== "number") return null;
	if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
	const start = Math.max(0, Math.min(Math.round(startMs), durationMs));
	const end = Math.max(0, Math.min(Math.round(endMs), durationMs));
	if (end - start < MIN_SPAN_MS) return null;
	return { startMs: start, endMs: end };
}

function overlaps(a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) {
	return a.startMs < b.endMs && b.startMs < a.endMs;
}

function clampDepth(depth: unknown): ZoomDepth {
	if (typeof depth !== "number" || !Number.isFinite(depth)) return DEFAULT_ZOOM_DEPTH;
	return Math.max(1, Math.min(6, Math.round(depth))) as ZoomDepth;
}

function clampScale(scale: unknown): number | undefined {
	if (typeof scale !== "number" || !Number.isFinite(scale)) return undefined;
	return Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, scale));
}

function clampCoord(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return Math.max(0, Math.min(1, value));
}

/** A speed ramp duration (ms): positive, capped, and never longer than its region. */
function clampRamp(value: unknown, spanMs: number): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
	return Math.min(Math.round(value), MAX_SPEED_RAMP_MS, spanMs);
}

const EFFECT_TYPES = new Set<VideoEffectType>(["fadeIn", "fadeOut", "blur", "dim"]);
function isEffectType(value: unknown): value is VideoEffectType {
	return typeof value === "string" && EFFECT_TYPES.has(value as VideoEffectType);
}

/** blur intensity is px (0..MAX); dim is opacity (0..1); fades carry no intensity. */
function clampEffectIntensity(type: VideoEffectType, value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	if (type === "blur") return Math.max(0, Math.min(MAX_EFFECT_BLUR_PX, value));
	if (type === "dim") return Math.max(0, Math.min(1, value));
	return undefined; // fadeIn/fadeOut ignore intensity
}

/** Vertical placement presets for captions; x stays centered at the caption width. */
const CAPTION_POSITION_PRESETS: Record<string, { x: number; y: number }> = {
	bottom: { ...AI_CAPTION_POSITION },
	middle: { x: AI_CAPTION_POSITION.x, y: (100 - AI_CAPTION_SIZE.height) / 2 },
	top: { x: AI_CAPTION_POSITION.x, y: 4 },
};

const TEXT_ANIMATIONS = new Set<AnnotationTextAnimation>([
	"none",
	"fade",
	"rise",
	"pop",
	"slide-left",
	"typewriter",
	"pulse",
]);

function sanitizeExitAnimation(value: unknown): AnnotationTextAnimation | undefined {
	return TEXT_ANIMATIONS.has(value as AnnotationTextAnimation)
		? (value as AnnotationTextAnimation)
		: undefined;
}

/** Validate agent-provided caption motion (A→B travel/resize), clamped to the frame + timeline. */
function sanitizeMotion(raw: unknown, durationMs: number): CaptionMotion | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const input = raw as Record<string, unknown>;
	const motion: CaptionMotion = {};

	// Semantic anchor beats raw coordinates — no y-axis guessing for the agent.
	const anchor = CAPTION_POSITION_PRESETS[input.toAnchor as string];
	const pos = input.toPosition as { x?: unknown; y?: unknown } | undefined;
	if (anchor) {
		motion.toPosition = { ...anchor };
	} else if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
		motion.toPosition = {
			x: Math.max(0, Math.min(100, pos.x)),
			y: Math.max(0, Math.min(100, pos.y)),
		};
	}
	const size = input.toSize as { width?: unknown; height?: unknown } | undefined;
	if (size && typeof size.width === "number" && typeof size.height === "number") {
		motion.toSize = {
			width: Math.max(1, Math.min(100, size.width)),
			height: Math.max(1, Math.min(100, size.height)),
		};
	}
	if (typeof input.toFontSize === "number" && Number.isFinite(input.toFontSize)) {
		motion.toFontSize = Math.max(16, Math.min(192, Math.round(input.toFontSize)));
	}
	if (typeof input.startMs === "number" && Number.isFinite(input.startMs)) {
		motion.startMs = Math.max(0, Math.min(Math.round(input.startMs), durationMs));
	}
	if (typeof input.endMs === "number" && Number.isFinite(input.endMs)) {
		motion.endMs = Math.max(0, Math.min(Math.round(input.endMs), durationMs));
	}
	return motion.toPosition || motion.toSize || motion.toFontSize !== undefined ? motion : undefined;
}

function isSafeCssColor(value: string): boolean {
	return (
		value === "transparent" ||
		/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ||
		/^(rgb|rgba|hsl|hsla|oklch|oklab)\([^)]{1,40}\)$/i.test(value)
	);
}

interface CaptionStyleInput {
	color?: unknown;
	backgroundColor?: unknown;
	fontSize?: unknown;
	fontWeight?: unknown;
	fontFamily?: unknown;
	fontStyle?: unknown;
	textAlign?: unknown;
	textAnimation?: unknown;
	position?: unknown;
	boxPaddingX?: unknown;
	boxPaddingY?: unknown;
	boxRadius?: unknown;
	boxShadow?: unknown;
}

/** Letters/digits (any script), spaces, hyphens, commas — enough for real font
    stacks ("Arial Black", "Georgia, serif") while blocking CSS injection. */
function isSafeFontFamily(value: string): boolean {
	return /^[\p{L}\p{N} ,_-]{1,60}$/u.test(value);
}

interface SanitizedCaptionStyle {
	style: Partial<AnnotationTextStyle>;
	position?: { x: number; y: number };
	applied: string[];
	rejected: string[];
}

/** Validate/clamp agent-provided caption design fields (untrusted model output). */
function sanitizeCaptionStyle(raw: unknown): SanitizedCaptionStyle {
	const input = (raw ?? {}) as CaptionStyleInput;
	const style: Partial<AnnotationTextStyle> = {};
	const applied: string[] = [];
	const rejected: string[] = [];

	const color = (key: "color" | "backgroundColor") => {
		const value = input[key];
		if (value === undefined) return;
		if (typeof value === "string" && isSafeCssColor(value.trim())) {
			style[key] = value.trim();
			applied.push(key);
		} else rejected.push(`${key} must be #hex, rgb()/rgba(), hsl()/hsla(), or 'transparent'`);
	};
	color("color");
	color("backgroundColor");

	if (input.fontSize !== undefined) {
		if (typeof input.fontSize === "number" && Number.isFinite(input.fontSize)) {
			style.fontSize = Math.max(16, Math.min(192, Math.round(input.fontSize)));
			applied.push("fontSize");
		} else rejected.push("fontSize must be a number 16-192");
	}
	const oneOf = <K extends "fontWeight" | "fontStyle" | "textAlign">(
		key: K,
		allowed: ReadonlyArray<AnnotationTextStyle[K]>,
	) => {
		const value = input[key];
		if (value === undefined) return;
		if (allowed.includes(value as AnnotationTextStyle[K])) {
			style[key] = value as AnnotationTextStyle[K];
			applied.push(key);
		} else rejected.push(`${key} must be one of ${allowed.join(" | ")}`);
	};
	if (input.fontWeight !== undefined) {
		if (input.fontWeight === "normal" || input.fontWeight === "bold") {
			style.fontWeight = input.fontWeight;
			applied.push("fontWeight");
		} else if (typeof input.fontWeight === "number" && Number.isFinite(input.fontWeight)) {
			style.fontWeight = Math.max(100, Math.min(900, Math.round(input.fontWeight)));
			applied.push("fontWeight");
		} else rejected.push("fontWeight must be normal | bold | number 100-900");
	}
	if (input.fontFamily !== undefined) {
		if (typeof input.fontFamily === "string" && isSafeFontFamily(input.fontFamily.trim())) {
			style.fontFamily = input.fontFamily.trim();
			applied.push("fontFamily");
		} else rejected.push("fontFamily must be a plain font name (letters/digits/spaces/commas)");
	}
	oneOf("fontStyle", ["normal", "italic"]);
	oneOf("textAlign", ["left", "center", "right"]);

	const boxNumber = (
		key: "boxPaddingX" | "boxPaddingY" | "boxRadius" | "boxShadow",
		min: number,
		max: number,
		round: boolean,
	) => {
		const value = input[key];
		if (value === undefined) return;
		if (typeof value === "number" && Number.isFinite(value)) {
			const clamped = Math.max(min, Math.min(max, value));
			style[key] = round ? Math.round(clamped) : clamped;
			applied.push(key);
		} else rejected.push(`${key} must be a number ${min}-${max}`);
	};
	boxNumber("boxPaddingX", 0, MAX_CAPTION_BOX_PADDING_EM, false);
	boxNumber("boxPaddingY", 0, MAX_CAPTION_BOX_PADDING_EM, false);
	boxNumber("boxRadius", 0, MAX_CAPTION_BOX_RADIUS_PX, true);
	boxNumber("boxShadow", 0, 1, false);

	if (input.textAnimation !== undefined) {
		if (TEXT_ANIMATIONS.has(input.textAnimation as AnnotationTextAnimation)) {
			style.textAnimation = input.textAnimation as AnnotationTextAnimation;
			applied.push("textAnimation");
		} else rejected.push(`textAnimation must be one of ${[...TEXT_ANIMATIONS].join(" | ")}`);
	}

	let position: { x: number; y: number } | undefined;
	if (input.position !== undefined) {
		const preset = CAPTION_POSITION_PRESETS[input.position as string];
		if (preset) {
			position = { ...preset };
			applied.push("position");
		} else rejected.push("position must be bottom | middle | top");
	}

	return { style, position, applied, rejected };
}

interface ZoomInput {
	startMs?: unknown;
	endMs?: unknown;
	depth?: unknown;
	customScale?: unknown;
	cx?: unknown;
	cy?: unknown;
}

function buildZoomFromInput(
	input: ZoomInput,
	ctx: AiCommandContext,
): { region: ZoomRegion } | { error: string } {
	const span = clampSpan(input.startMs, input.endMs, ctx.durationMs);
	if (!span) {
		return { error: `invalid span ${JSON.stringify({ start: input.startMs, end: input.endMs })}` };
	}
	const depth = clampDepth(input.depth);
	const customScale = clampScale(input.customScale) ?? ZOOM_DEPTH_SCALES[depth];
	const cx = clampCoord(input.cx);
	const cy = clampCoord(input.cy);
	const hasFocus = cx !== undefined && cy !== undefined;
	const canFollowCursor = ctx.cursorTelemetry.length > 0;
	return {
		region: {
			id: ctx.allocZoomId(),
			...span,
			depth,
			customScale,
			focus: clampFocusToDepth(hasFocus ? { cx, cy } : { cx: 0.5, cy: 0.5 }, depth),
			focusMode: hasFocus ? "manual" : canFollowCursor ? "auto" : "manual",
			source: "manual",
		},
	};
}

export function executeAiCommand(
	name: string,
	rawInput: unknown,
	state: EditorState,
	ctx: AiCommandContext,
): AiCommandResult {
	const input = (rawInput ?? {}) as Record<string, unknown>;

	switch (name) {
		case "get_project_context": {
			// Current caption design (captions are styled uniformly in practice) —
			// lets the agent restyle relative to what's on screen instead of blind.
			const styleSample = state.annotationRegions.find((region) => region.type === "text");
			return {
				partial: null,
				ok: true,
				content: JSON.stringify({
					durationMs: ctx.durationMs,
					aspectRatio: ctx.aspectRatio,
					hasCursorTelemetry: ctx.cursorTelemetry.length > 0,
					autoZoomEnabled: state.autoZoomEnabled,
					zoomRegions: state.zoomRegions.map((z) => ({
						id: z.id,
						startMs: z.startMs,
						endMs: z.endMs,
						depth: z.depth,
						customScale: z.customScale,
						focus: z.focus,
						focusMode: z.focusMode ?? "manual",
						source: z.source ?? "manual",
					})),
					trimRegions: state.trimRegions,
					speedRegions: state.speedRegions,
					effectRegions: state.effectRegions,
					captions: state.annotationRegions
						.filter((region) => region.type === "text")
						.map((region) => ({
							id: region.id,
							startMs: region.startMs,
							endMs: region.endMs,
							text: (region.content ?? "").slice(0, 80),
							isCaption: region.annotationSource === "auto-caption",
						})),
					captionStyle: styleSample
						? {
								color: styleSample.style.color,
								backgroundColor: styleSample.style.backgroundColor,
								fontSize: styleSample.style.fontSize,
								fontWeight: styleSample.style.fontWeight,
								textAnimation: styleSample.style.textAnimation ?? "none",
								positionY: styleSample.position.y,
							}
						: undefined,
				}),
			};
		}

		case "get_click_events": {
			const startMs = typeof input.startMs === "number" ? input.startMs : 0;
			const endMs = typeof input.endMs === "number" ? input.endMs : Number.POSITIVE_INFINITY;
			const clicks = ctx.cursorTelemetry
				.filter(
					(point) =>
						point.interactionType !== undefined &&
						CLICK_TYPES.has(point.interactionType) &&
						point.timeMs >= startMs &&
						point.timeMs <= endMs,
				)
				.slice(0, MAX_CLICK_EVENTS)
				.map((point) => ({
					timeMs: Math.round(point.timeMs),
					cx: point.cx,
					cy: point.cy,
					type: point.interactionType,
				}));
			return { partial: null, ok: true, content: JSON.stringify({ clicks }) };
		}

		case "add_zooms": {
			if (!Array.isArray(input.zooms) || input.zooms.length === 0) {
				return fail("zooms must be a non-empty array");
			}
			const created: ZoomRegion[] = [];
			const skipped: string[] = [];
			for (const entry of input.zooms as ZoomInput[]) {
				const built = buildZoomFromInput(entry, ctx);
				if ("error" in built) {
					skipped.push(built.error);
					continue;
				}
				const conflict = [...state.zoomRegions, ...created].find((existing) =>
					overlaps(existing, built.region),
				);
				if (conflict) {
					skipped.push(
						`span ${built.region.startMs}-${built.region.endMs}ms overlaps existing zoom ${conflict.id}`,
					);
					continue;
				}
				created.push(built.region);
			}
			if (created.length === 0) {
				return fail(`no zooms created: ${skipped.join("; ")}`);
			}
			return {
				partial: { zoomRegions: [...state.zoomRegions, ...created] },
				ok: true,
				content: JSON.stringify({
					created: created.map((z) => ({ id: z.id, startMs: z.startMs, endMs: z.endMs })),
					skipped,
				}),
				summary:
					created.length === 1
						? `${formatMs(created[0].startMs)}–${formatMs(created[0].endMs)}`
						: `${created.length}×`,
			};
		}

		case "update_zoom": {
			const id = input.id;
			if (typeof id !== "string") return fail("id is required");
			const existing = state.zoomRegions.find((z) => z.id === id);
			if (!existing) return fail(`zoom ${id} not found`);

			const span = clampSpan(
				input.startMs ?? existing.startMs,
				input.endMs ?? existing.endMs,
				ctx.durationMs,
			);
			if (!span) return fail("resulting span is invalid");
			const conflict = state.zoomRegions.find((other) => other.id !== id && overlaps(other, span));
			if (conflict) return fail(`updated span overlaps zoom ${conflict.id}`);

			const depth = input.depth !== undefined ? clampDepth(input.depth) : existing.depth;
			const customScale =
				input.customScale !== undefined
					? (clampScale(input.customScale) ?? existing.customScale)
					: input.depth !== undefined
						? ZOOM_DEPTH_SCALES[depth]
						: existing.customScale;
			const cx = clampCoord(input.cx);
			const cy = clampCoord(input.cy);
			const focus =
				cx !== undefined && cy !== undefined
					? clampFocusToDepth({ cx, cy }, depth)
					: existing.focus;

			const updated: ZoomRegion = {
				...existing,
				...span,
				depth,
				customScale,
				focus,
				focusMode: cx !== undefined && cy !== undefined ? "manual" : existing.focusMode,
				// Hand-edited (even by AI) zooms survive the auto-zoom wand toggle.
				source: "manual",
			};
			return {
				partial: {
					zoomRegions: state.zoomRegions.map((z) => (z.id === id ? updated : z)),
				},
				ok: true,
				content: JSON.stringify({ updated: { ...updated } }),
				summary: `${formatMs(updated.startMs)}–${formatMs(updated.endMs)}`,
			};
		}

		case "delete_zooms": {
			const ids = Array.isArray(input.ids) ? input.ids.filter((v) => typeof v === "string") : [];
			if (ids.length === 0) return fail("ids must be a non-empty string array");
			const idSet = new Set(ids as string[]);
			const removed = state.zoomRegions.filter((z) => idSet.has(z.id));
			if (removed.length === 0) return fail(`no matching zooms among ${ids.join(", ")}`);
			return {
				partial: { zoomRegions: state.zoomRegions.filter((z) => !idSet.has(z.id)) },
				ok: true,
				content: JSON.stringify({ deleted: removed.map((z) => z.id) }),
				summary: `${removed.length}`,
			};
		}

		case "add_trims": {
			if (!Array.isArray(input.trims) || input.trims.length === 0) {
				return fail("trims must be a non-empty array");
			}
			const created: TrimRegion[] = [];
			const skipped: string[] = [];
			for (const entry of input.trims as Array<{ startMs?: unknown; endMs?: unknown }>) {
				const span = clampSpan(entry.startMs, entry.endMs, ctx.durationMs);
				if (!span) {
					skipped.push(`invalid span ${JSON.stringify(entry)}`);
					continue;
				}
				created.push({ id: ctx.allocTrimId(), ...span });
			}
			if (created.length === 0) return fail(`no trims created: ${skipped.join("; ")}`);
			return {
				partial: { trimRegions: [...state.trimRegions, ...created] },
				ok: true,
				content: JSON.stringify({
					created: created.map((r) => ({ id: r.id, startMs: r.startMs, endMs: r.endMs })),
					skipped,
				}),
				summary:
					created.length === 1
						? `${formatMs(created[0].startMs)}–${formatMs(created[0].endMs)}`
						: `${created.length}×`,
			};
		}

		case "delete_trims": {
			const ids = Array.isArray(input.ids) ? input.ids.filter((v) => typeof v === "string") : [];
			if (ids.length === 0) return fail("ids must be a non-empty string array");
			const idSet = new Set(ids as string[]);
			const removed = state.trimRegions.filter((r) => idSet.has(r.id));
			if (removed.length === 0) return fail(`no matching trims among ${ids.join(", ")}`);
			return {
				partial: { trimRegions: state.trimRegions.filter((r) => !idSet.has(r.id)) },
				ok: true,
				content: JSON.stringify({ deleted: removed.map((r) => r.id) }),
				summary: `${removed.length}`,
			};
		}

		case "add_speed_regions": {
			if (!Array.isArray(input.regions) || input.regions.length === 0) {
				return fail("regions must be a non-empty array");
			}
			const created: SpeedRegion[] = [];
			const skipped: string[] = [];
			for (const entry of input.regions as Array<{
				startMs?: unknown;
				endMs?: unknown;
				speed?: unknown;
				rampInMs?: unknown;
				rampOutMs?: unknown;
			}>) {
				const span = clampSpan(entry.startMs, entry.endMs, ctx.durationMs);
				if (!span || typeof entry.speed !== "number" || !Number.isFinite(entry.speed)) {
					skipped.push(`invalid region ${JSON.stringify(entry)}`);
					continue;
				}
				const conflict = [...state.speedRegions, ...created].find((existing) =>
					overlaps(existing, span),
				);
				if (conflict) {
					skipped.push(`span ${span.startMs}-${span.endMs}ms overlaps speed region ${conflict.id}`);
					continue;
				}
				const spanMs = span.endMs - span.startMs;
				const rampInMs = clampRamp(entry.rampInMs, spanMs);
				const rampOutMs = clampRamp(entry.rampOutMs, spanMs);
				created.push({
					id: ctx.allocSpeedId(),
					...span,
					speed: clampPlaybackSpeed(entry.speed),
					...(rampInMs ? { rampInMs } : {}),
					...(rampOutMs ? { rampOutMs } : {}),
				});
			}
			if (created.length === 0) return fail(`no speed regions created: ${skipped.join("; ")}`);
			return {
				partial: { speedRegions: [...state.speedRegions, ...created] },
				ok: true,
				content: JSON.stringify({
					created: created.map((r) => ({
						id: r.id,
						startMs: r.startMs,
						endMs: r.endMs,
						speed: r.speed,
					})),
					skipped,
				}),
				summary:
					created.length === 1
						? `${created[0].speed}× ${formatMs(created[0].startMs)}–${formatMs(created[0].endMs)}`
						: `${created.length}×`,
			};
		}

		case "update_speed_region": {
			const id = input.id;
			if (typeof id !== "string") return fail("id is required");
			const existing = state.speedRegions.find((r) => r.id === id);
			if (!existing) return fail(`speed region ${id} not found`);
			const span = clampSpan(
				input.startMs ?? existing.startMs,
				input.endMs ?? existing.endMs,
				ctx.durationMs,
			);
			if (!span) return fail("resulting span is invalid");
			const conflict = state.speedRegions.find((other) => other.id !== id && overlaps(other, span));
			if (conflict) return fail(`updated span overlaps speed region ${conflict.id}`);
			const speed =
				typeof input.speed === "number" && Number.isFinite(input.speed)
					? clampPlaybackSpeed(input.speed)
					: existing.speed;
			const spanMs = span.endMs - span.startMs;
			// Ramp fields merge: omit to keep, 0 to clear, positive to set.
			const rampInMs =
				input.rampInMs === undefined ? existing.rampInMs : clampRamp(input.rampInMs, spanMs);
			const rampOutMs =
				input.rampOutMs === undefined ? existing.rampOutMs : clampRamp(input.rampOutMs, spanMs);
			const updated: SpeedRegion = {
				id: existing.id,
				...span,
				speed,
				...(rampInMs ? { rampInMs } : {}),
				...(rampOutMs ? { rampOutMs } : {}),
			};
			return {
				partial: { speedRegions: state.speedRegions.map((r) => (r.id === id ? updated : r)) },
				ok: true,
				content: JSON.stringify({ updated }),
				summary: `${updated.speed}× ${formatMs(updated.startMs)}–${formatMs(updated.endMs)}`,
			};
		}

		case "delete_speed_regions": {
			const ids = Array.isArray(input.ids) ? input.ids.filter((v) => typeof v === "string") : [];
			if (ids.length === 0) return fail("ids must be a non-empty string array");
			const idSet = new Set(ids as string[]);
			const removed = state.speedRegions.filter((r) => idSet.has(r.id));
			if (removed.length === 0) return fail(`no matching speed regions among ${ids.join(", ")}`);
			return {
				partial: { speedRegions: state.speedRegions.filter((r) => !idSet.has(r.id)) },
				ok: true,
				content: JSON.stringify({ deleted: removed.map((r) => r.id) }),
				summary: `${removed.length}`,
			};
		}

		case "add_effects": {
			if (!Array.isArray(input.effects) || input.effects.length === 0) {
				return fail("effects must be a non-empty array");
			}
			const created: EffectRegion[] = [];
			const skipped: string[] = [];
			for (const entry of input.effects as Array<{
				startMs?: unknown;
				endMs?: unknown;
				type?: unknown;
				intensity?: unknown;
			}>) {
				const span = clampSpan(entry.startMs, entry.endMs, ctx.durationMs);
				if (!span || !isEffectType(entry.type)) {
					skipped.push(`invalid effect ${JSON.stringify(entry)}`);
					continue;
				}
				const intensity = clampEffectIntensity(entry.type, entry.intensity);
				created.push({
					id: ctx.allocEffectId(),
					...span,
					type: entry.type,
					...(intensity !== undefined ? { intensity } : {}),
				});
			}
			if (created.length === 0) return fail(`no effects created: ${skipped.join("; ")}`);
			return {
				partial: { effectRegions: [...state.effectRegions, ...created] },
				ok: true,
				content: JSON.stringify({
					created: created.map((e) => ({
						id: e.id,
						type: e.type,
						startMs: e.startMs,
						endMs: e.endMs,
						intensity: e.intensity,
					})),
					skipped,
				}),
				summary: created.length === 1 ? created[0].type : `${created.length}×`,
			};
		}

		case "update_effect": {
			const id = input.id;
			if (typeof id !== "string") return fail("id is required");
			const existing = state.effectRegions.find((e) => e.id === id);
			if (!existing) return fail(`effect ${id} not found`);
			const span = clampSpan(
				input.startMs ?? existing.startMs,
				input.endMs ?? existing.endMs,
				ctx.durationMs,
			);
			if (!span) return fail("resulting span is invalid");
			const type = isEffectType(input.type) ? input.type : existing.type;
			const intensity =
				input.intensity === undefined
					? existing.intensity
					: clampEffectIntensity(type, input.intensity);
			const updated: EffectRegion = {
				id: existing.id,
				...span,
				type,
				...(intensity !== undefined ? { intensity } : {}),
			};
			return {
				partial: {
					effectRegions: state.effectRegions.map((e) => (e.id === id ? updated : e)),
				},
				ok: true,
				content: JSON.stringify({ updated }),
				summary: `${updated.type} ${formatMs(updated.startMs)}–${formatMs(updated.endMs)}`,
			};
		}

		case "delete_effects": {
			const ids = Array.isArray(input.ids) ? input.ids.filter((v) => typeof v === "string") : [];
			if (ids.length === 0) return fail("ids must be a non-empty string array");
			const idSet = new Set(ids as string[]);
			const removed = state.effectRegions.filter((e) => idSet.has(e.id));
			if (removed.length === 0) return fail(`no matching effects among ${ids.join(", ")}`);
			return {
				partial: { effectRegions: state.effectRegions.filter((e) => !idSet.has(e.id)) },
				ok: true,
				content: JSON.stringify({ deleted: removed.map((e) => e.id) }),
				summary: `${removed.length}`,
			};
		}

		case "set_style": {
			const partial: Partial<EditorState> = {};
			const applied: string[] = [];
			const rejected: string[] = [];

			const numeric = (
				key: "padding" | "shadowIntensity" | "borderRadius" | "motionBlurAmount",
				min: number,
				max: number,
			) => {
				const value = input[key];
				if (value === undefined) return;
				if (typeof value !== "number" || !Number.isFinite(value)) {
					rejected.push(`${key} must be a number`);
					return;
				}
				partial[key] = Math.max(min, Math.min(max, value));
				applied.push(key);
			};
			numeric("padding", 0, 100);
			numeric("shadowIntensity", 0, 1);
			numeric("motionBlurAmount", 0, 1);
			numeric("borderRadius", 0, 64);

			if (input.wallpaper !== undefined) {
				const value = typeof input.wallpaper === "string" ? input.wallpaper.trim() : "";
				const isBuiltIn = /^wallpaper([1-9]|1[0-8])$/.test(value);
				const isSafe =
					isBuiltIn ||
					value.startsWith("/wallpapers/") ||
					value.startsWith("#") ||
					/^(repeating-)?(linear|radial|conic)-gradient\(/.test(value) ||
					/^(rgb|rgba|hsl|hsla|oklch|oklab)\(/.test(value);
				if (isSafe && value) {
					partial.wallpaper = isBuiltIn ? `/wallpapers/${value}.jpg` : value;
					applied.push("wallpaper");
				} else {
					rejected.push(
						"wallpaper must be wallpaper1..wallpaper18, a #hex/rgb()/hsl() color, or a CSS gradient",
					);
				}
			}

			if (input.webcamLayoutPreset !== undefined) {
				const value = input.webcamLayoutPreset;
				if (
					value === "picture-in-picture" ||
					value === "vertical-stack" ||
					value === "dual-frame"
				) {
					partial.webcamLayoutPreset = value;
					applied.push("webcamLayoutPreset");
				} else
					rejected.push(
						"webcamLayoutPreset must be picture-in-picture | vertical-stack | dual-frame",
					);
			}
			if (input.webcamMaskShape !== undefined) {
				const value = input.webcamMaskShape;
				if (
					value === "rectangle" ||
					value === "circle" ||
					value === "square" ||
					value === "rounded"
				) {
					partial.webcamMaskShape = value;
					applied.push("webcamMaskShape");
				} else rejected.push("webcamMaskShape must be rectangle | circle | square | rounded");
			}
			if (input.webcamSizePreset !== undefined) {
				const value = input.webcamSizePreset;
				if (typeof value === "number" && Number.isFinite(value)) {
					partial.webcamSizePreset = Math.max(10, Math.min(50, Math.round(value)));
					applied.push("webcamSizePreset");
				} else rejected.push("webcamSizePreset must be a number 10-50");
			}
			if (input.webcamPosition !== undefined) {
				const pos = input.webcamPosition as { cx?: unknown; cy?: unknown };
				const cx = clampCoord(pos?.cx);
				const cy = clampCoord(pos?.cy);
				if (cx !== undefined && cy !== undefined) {
					partial.webcamPosition = { cx, cy };
					applied.push("webcamPosition");
				} else rejected.push("webcamPosition must be {cx, cy} normalized 0-1");
			}

			if (applied.length === 0) {
				return fail(`no style changes applied: ${rejected.join("; ") || "no known fields given"}`);
			}
			return {
				partial,
				ok: true,
				content: JSON.stringify({ applied, rejected }),
				summary: applied.join(", "),
			};
		}

		case "add_captions": {
			if (!Array.isArray(input.captions) || input.captions.length === 0) {
				return fail("captions must be a non-empty array");
			}
			const styling = sanitizeCaptionStyle(input.style);
			const created: AnnotationRegion[] = [];
			const skipped: string[] = [...styling.rejected];
			for (const entry of input.captions as Array<{
				startMs?: unknown;
				endMs?: unknown;
				text?: unknown;
				motion?: unknown;
				exitAnimation?: unknown;
			}>) {
				const span = clampSpan(entry.startMs, entry.endMs, ctx.durationMs);
				const text = typeof entry.text === "string" ? entry.text.trim().slice(0, 200) : "";
				if (!span || !text) {
					skipped.push(`invalid caption ${JSON.stringify(entry)}`);
					continue;
				}
				const motion = sanitizeMotion(entry.motion, ctx.durationMs);
				const exitAnimation = sanitizeExitAnimation(entry.exitAnimation);
				created.push({
					id: ctx.allocAnnotationId(),
					...span,
					type: "text",
					content: text,
					// Tagged like auto-captions so styling edits sibling-sync and
					// the timeline renders them in the caption lane.
					annotationSource: "auto-caption",
					position: styling.position ?? { ...AI_CAPTION_POSITION },
					size: { ...AI_CAPTION_SIZE },
					style: { ...AI_CAPTION_STYLE, ...styling.style },
					zIndex: ctx.allocAnnotationZIndex(),
					...(motion ? { motion } : {}),
					...(exitAnimation ? { exitAnimation } : {}),
				});
			}
			if (created.length === 0) return fail(`no captions created: ${skipped.join("; ")}`);
			return {
				partial: { annotationRegions: [...state.annotationRegions, ...created] },
				ok: true,
				content: JSON.stringify({
					created: created.map((region) => ({
						id: region.id,
						startMs: region.startMs,
						endMs: region.endMs,
						text: region.content,
					})),
					styleApplied: styling.applied,
					skipped,
				}),
				summary: `${created.length}×`,
			};
		}

		case "update_caption": {
			const id = input.id;
			if (typeof id !== "string") return fail("id is required");
			const existing = state.annotationRegions.find(
				(region) => region.id === id && region.type === "text",
			);
			if (!existing) return fail(`text annotation ${id} not found`);
			const span = clampSpan(
				input.startMs ?? existing.startMs,
				input.endMs ?? existing.endMs,
				ctx.durationMs,
			);
			if (!span) return fail("resulting span is invalid");
			const text =
				typeof input.text === "string" && input.text.trim()
					? input.text.trim().slice(0, 200)
					: existing.content;
			const styling = sanitizeCaptionStyle(input.style);
			// Motion: omit to keep, provide to replace. exitAnimation "none" clears it.
			const motion =
				input.motion === undefined ? existing.motion : sanitizeMotion(input.motion, ctx.durationMs);
			const exitAnimation =
				input.exitAnimation === undefined
					? existing.exitAnimation
					: sanitizeExitAnimation(input.exitAnimation);
			const updated: AnnotationRegion = {
				...existing,
				...span,
				content: text,
				position: styling.position ?? existing.position,
				style: { ...existing.style, ...styling.style },
				motion,
				exitAnimation,
			};
			return {
				partial: {
					annotationRegions: state.annotationRegions.map((region) =>
						region.id === id ? updated : region,
					),
				},
				ok: true,
				content: JSON.stringify({
					updated: { id, startMs: updated.startMs, endMs: updated.endMs, text: updated.content },
					styleApplied: styling.applied,
					styleRejected: styling.rejected,
				}),
				summary: `${formatMs(updated.startMs)}–${formatMs(updated.endMs)}`,
			};
		}

		case "set_caption_style": {
			const styling = sanitizeCaptionStyle(input.style);
			if (styling.applied.length === 0) {
				return fail(
					`no valid style fields: ${styling.rejected.join("; ") || "style object is required"}`,
				);
			}
			const ids = Array.isArray(input.ids)
				? new Set((input.ids as unknown[]).filter((v): v is string => typeof v === "string"))
				: null;
			const isCaption = (region: AnnotationRegion) =>
				region.type === "text" && (ids ? ids.has(region.id) : true);
			const targets = state.annotationRegions.filter(isCaption);
			if (targets.length === 0) {
				return fail(
					ids ? `no matching captions among ${[...ids].join(", ")}` : "no captions exist",
				);
			}
			const targetIds = new Set(targets.map((region) => region.id));
			return {
				partial: {
					annotationRegions: state.annotationRegions.map((region) =>
						targetIds.has(region.id)
							? {
									...region,
									position: styling.position ?? region.position,
									style: { ...region.style, ...styling.style },
								}
							: region,
					),
				},
				ok: true,
				content: JSON.stringify({
					restyled: targets.length,
					styleApplied: styling.applied,
					styleRejected: styling.rejected,
				}),
				summary: `${targets.length}× ${styling.applied.join(", ")}`,
			};
		}

		case "delete_captions": {
			const ids = Array.isArray(input.ids) ? input.ids.filter((v) => typeof v === "string") : [];
			if (ids.length === 0) return fail("ids must be a non-empty string array");
			const idSet = new Set(ids as string[]);
			const removed = state.annotationRegions.filter(
				(region) => idSet.has(region.id) && region.type === "text",
			);
			if (removed.length === 0) return fail(`no matching text annotations among ${ids.join(", ")}`);
			const removedIds = new Set(removed.map((region) => region.id));
			return {
				partial: {
					annotationRegions: state.annotationRegions.filter((region) => !removedIds.has(region.id)),
				},
				ok: true,
				content: JSON.stringify({ deleted: [...removedIds] }),
				summary: `${removed.length}`,
			};
		}

		default:
			return fail(`unknown command: ${name}`);
	}
}
