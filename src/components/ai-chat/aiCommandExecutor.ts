import type { EditorState } from "@/hooks/useEditorHistory";
import {
	AI_CAPTION_POSITION,
	AI_CAPTION_SIZE,
	AI_CAPTION_STYLE,
} from "@/lib/captioning/annotationsFromCaptions";
import {
	type AnnotationRegion,
	type CursorTelemetryPoint,
	clampFocusToDepth,
	clampPlaybackSpeed,
	DEFAULT_ZOOM_DEPTH,
	MAX_ZOOM_SCALE,
	MIN_ZOOM_SCALE,
	type SpeedRegion,
	type TrimRegion,
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
					captions: state.annotationRegions
						.filter((region) => region.type === "text")
						.map((region) => ({
							id: region.id,
							startMs: region.startMs,
							endMs: region.endMs,
							text: (region.content ?? "").slice(0, 80),
							isCaption: region.annotationSource === "auto-caption",
						})),
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
				created.push({ id: ctx.allocSpeedId(), ...span, speed: clampPlaybackSpeed(entry.speed) });
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
			const updated: SpeedRegion = { ...existing, ...span, speed };
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
			const created: AnnotationRegion[] = [];
			const skipped: string[] = [];
			for (const entry of input.captions as Array<{
				startMs?: unknown;
				endMs?: unknown;
				text?: unknown;
			}>) {
				const span = clampSpan(entry.startMs, entry.endMs, ctx.durationMs);
				const text = typeof entry.text === "string" ? entry.text.trim().slice(0, 200) : "";
				if (!span || !text) {
					skipped.push(`invalid caption ${JSON.stringify(entry)}`);
					continue;
				}
				created.push({
					id: ctx.allocAnnotationId(),
					...span,
					type: "text",
					content: text,
					// Tagged like auto-captions so styling edits sibling-sync and
					// the timeline renders them in the caption lane.
					annotationSource: "auto-caption",
					position: { ...AI_CAPTION_POSITION },
					size: { ...AI_CAPTION_SIZE },
					style: { ...AI_CAPTION_STYLE },
					zIndex: ctx.allocAnnotationZIndex(),
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
			const updated: AnnotationRegion = { ...existing, ...span, content: text };
			return {
				partial: {
					annotationRegions: state.annotationRegions.map((region) =>
						region.id === id ? updated : region,
					),
				},
				ok: true,
				content: JSON.stringify({
					updated: { id, startMs: updated.startMs, endMs: updated.endMs, text: updated.content },
				}),
				summary: `${formatMs(updated.startMs)}–${formatMs(updated.endMs)}`,
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
