import { describe, expect, it } from "vitest";
import { INITIAL_EDITOR_STATE } from "@/hooks/useEditorHistory";
import type { CursorTelemetryPoint, ZoomRegion } from "../video-editor/types";
import { type AiCommandContext, executeAiCommand } from "./aiCommandExecutor";

function makeContext(overrides: Partial<AiCommandContext> = {}): AiCommandContext {
	let zoomId = 1;
	let trimId = 1;
	let speedId = 1;
	let annotationId = 1;
	let zIndex = 1;
	return {
		durationMs: 10_000,
		aspectRatio: "16:9",
		cursorTelemetry: [],
		allocZoomId: () => `zoom-${zoomId++}`,
		allocTrimId: () => `trim-${trimId++}`,
		allocSpeedId: () => `speed-${speedId++}`,
		allocAnnotationId: () => `annotation-${annotationId++}`,
		allocAnnotationZIndex: () => zIndex++,
		...overrides,
	};
}

const CLICK_TELEMETRY: CursorTelemetryPoint[] = [
	{ timeMs: 1000, cx: 0.2, cy: 0.3, interactionType: "move" },
	{ timeMs: 3000, cx: 0.7, cy: 0.6, interactionType: "click" },
	{ timeMs: 5000, cx: 0.4, cy: 0.5, interactionType: "double-click" },
];

describe("aiCommandExecutor", () => {
	it("returns project context without mutating", () => {
		const result = executeAiCommand("get_project_context", {}, INITIAL_EDITOR_STATE, makeContext());
		expect(result.ok).toBe(true);
		expect(result.partial).toBeNull();
		const payload = JSON.parse(result.content);
		expect(payload.durationMs).toBe(10_000);
		expect(payload.zoomRegions).toEqual([]);
	});

	it("filters click events from telemetry (moves excluded)", () => {
		const result = executeAiCommand(
			"get_click_events",
			{},
			INITIAL_EDITOR_STATE,
			makeContext({ cursorTelemetry: CLICK_TELEMETRY }),
		);
		const payload = JSON.parse(result.content);
		expect(payload.clicks).toHaveLength(2);
		expect(payload.clicks[0]).toMatchObject({ timeMs: 3000, cx: 0.7, cy: 0.6 });
	});

	it("adds a batch of zooms as one partial (one undo checkpoint)", () => {
		const result = executeAiCommand(
			"add_zooms",
			{
				zooms: [
					{ startMs: 1000, endMs: 3000 },
					{ startMs: 4000, endMs: 6000, customScale: 2.5, cx: 0.7, cy: 0.6 },
				],
			},
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		expect(result.ok).toBe(true);
		const zooms = result.partial?.zoomRegions as ZoomRegion[];
		expect(zooms).toHaveLength(2);
		expect(zooms[1]).toMatchObject({
			customScale: 2.5,
			focus: { cx: 0.7, cy: 0.6 },
			focusMode: "manual",
			source: "manual",
		});
		// No telemetry in this context → can't follow cursor, falls back to manual center.
		expect(zooms[0].focusMode).toBe("manual");
		expect(zooms[0].focus).toEqual({ cx: 0.5, cy: 0.5 });
	});

	it("uses cursor-follow focus mode when telemetry exists and no focus given", () => {
		const result = executeAiCommand(
			"add_zooms",
			{ zooms: [{ startMs: 1000, endMs: 3000 }] },
			INITIAL_EDITOR_STATE,
			makeContext({ cursorTelemetry: CLICK_TELEMETRY }),
		);
		const zooms = result.partial?.zoomRegions as ZoomRegion[];
		expect(zooms[0].focusMode).toBe("auto");
	});

	it("clamps spans to video duration and rejects too-short spans", () => {
		const clamped = executeAiCommand(
			"add_zooms",
			{ zooms: [{ startMs: -500, endMs: 99_000 }] },
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		const zooms = clamped.partial?.zoomRegions as ZoomRegion[];
		expect(zooms[0]).toMatchObject({ startMs: 0, endMs: 10_000 });

		const rejected = executeAiCommand(
			"add_zooms",
			{ zooms: [{ startMs: 1000, endMs: 1050 }] },
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		expect(rejected.ok).toBe(false);
		expect(rejected.partial).toBeNull();
	});

	it("clamps depth and custom scale into valid ranges", () => {
		const result = executeAiCommand(
			"add_zooms",
			{ zooms: [{ startMs: 0, endMs: 2000, depth: 99, customScale: 42 }] },
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		const zooms = result.partial?.zoomRegions as ZoomRegion[];
		expect(zooms[0].depth).toBe(6);
		expect(zooms[0].customScale).toBe(5.0);
	});

	it("skips zooms overlapping existing regions but keeps valid ones", () => {
		const state = {
			...INITIAL_EDITOR_STATE,
			zoomRegions: [
				{
					id: "zoom-existing",
					startMs: 1000,
					endMs: 3000,
					depth: 3,
					customScale: 1.8,
					focus: { cx: 0.5, cy: 0.5 },
				} as ZoomRegion,
			],
		};
		const result = executeAiCommand(
			"add_zooms",
			{
				zooms: [
					{ startMs: 2000, endMs: 4000 },
					{ startMs: 5000, endMs: 7000 },
				],
			},
			state,
			makeContext(),
		);
		expect(result.ok).toBe(true);
		expect(result.partial?.zoomRegions).toHaveLength(2); // existing + 1 created
		const payload = JSON.parse(result.content);
		expect(payload.created).toHaveLength(1);
		expect(payload.skipped).toHaveLength(1);
	});

	it("updates a zoom and promotes it to manual source", () => {
		const state = {
			...INITIAL_EDITOR_STATE,
			zoomRegions: [
				{
					id: "zoom-1",
					startMs: 1000,
					endMs: 3000,
					depth: 3,
					customScale: 1.8,
					focus: { cx: 0.5, cy: 0.5 },
					source: "auto",
				} as ZoomRegion,
			],
		};
		const result = executeAiCommand(
			"update_zoom",
			{ id: "zoom-1", customScale: 3.0, cx: 0.8, cy: 0.2 },
			state,
			makeContext(),
		);
		expect(result.ok).toBe(true);
		const updated = (result.partial?.zoomRegions as ZoomRegion[])[0];
		expect(updated).toMatchObject({
			customScale: 3.0,
			focus: { cx: 0.8, cy: 0.2 },
			focusMode: "manual",
			source: "manual",
		});
	});

	it("errors on unknown ids", () => {
		const result = executeAiCommand(
			"delete_zooms",
			{ ids: ["zoom-nope"] },
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		expect(result.ok).toBe(false);
		expect(result.partial).toBeNull();
	});

	it("adds trims and clamps playback speed", () => {
		const trims = executeAiCommand(
			"add_trims",
			{ trims: [{ startMs: 0, endMs: 2000 }] },
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		expect(trims.partial?.trimRegions).toHaveLength(1);

		const speeds = executeAiCommand(
			"add_speed_regions",
			{ regions: [{ startMs: 5000, endMs: 8000, speed: 500 }] },
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		expect(speeds.partial?.speedRegions?.[0].speed).toBe(100);
	});

	it("adds captions styled as auto-captions and deletes them by id", () => {
		const added = executeAiCommand(
			"add_captions",
			{
				captions: [
					{ startMs: 1500, endMs: 4800, text: "이 집, 지금 살 수 있을까?" },
					{ startMs: 6500, endMs: 11000, text: "질문 7개면 끝납니다" },
					{ startMs: 0, endMs: 50, text: "too short" },
				],
			},
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		expect(added.ok).toBe(true);
		const regions = added.partial?.annotationRegions ?? [];
		expect(regions).toHaveLength(2);
		expect(regions[0]).toMatchObject({
			type: "text",
			annotationSource: "auto-caption",
			content: "이 집, 지금 살 수 있을까?",
		});
		expect(JSON.parse(added.content).skipped).toHaveLength(1);

		const state = { ...INITIAL_EDITOR_STATE, annotationRegions: regions };
		const deleted = executeAiCommand(
			"delete_captions",
			{ ids: regions.map((r) => r.id) },
			state,
			makeContext(),
		);
		expect(deleted.ok).toBe(true);
		expect(deleted.partial?.annotationRegions).toHaveLength(0);
	});

	it("lists captions in project context", () => {
		const added = executeAiCommand(
			"add_captions",
			{ captions: [{ startMs: 1000, endMs: 3000, text: "hello" }] },
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		const state = {
			...INITIAL_EDITOR_STATE,
			annotationRegions: added.partial?.annotationRegions ?? [],
		};
		const context = executeAiCommand("get_project_context", {}, state, makeContext());
		const payload = JSON.parse(context.content);
		expect(payload.captions).toHaveLength(1);
		expect(payload.captions[0]).toMatchObject({ text: "hello", isCaption: true });
	});

	it("applies style changes with clamping and validates wallpaper", () => {
		const result = executeAiCommand(
			"set_style",
			{
				wallpaper: "wallpaper7",
				padding: 250,
				shadowIntensity: 0.8,
				webcamMaskShape: "circle",
				webcamSizePreset: 5,
			},
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		expect(result.ok).toBe(true);
		expect(result.partial).toMatchObject({
			wallpaper: "/wallpapers/wallpaper7.jpg",
			padding: 100,
			shadowIntensity: 0.8,
			webcamMaskShape: "circle",
			webcamSizePreset: 10,
		});

		const gradient = executeAiCommand(
			"set_style",
			{ wallpaper: "linear-gradient(135deg, #667eea, #764ba2)" },
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		expect(gradient.partial?.wallpaper).toBe("linear-gradient(135deg, #667eea, #764ba2)");

		const bad = executeAiCommand(
			"set_style",
			{ wallpaper: "file:///etc/passwd" },
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		expect(bad.ok).toBe(false);
	});

	it("rejects unknown commands", () => {
		const result = executeAiCommand("format_hard_drive", {}, INITIAL_EDITOR_STATE, makeContext());
		expect(result.ok).toBe(false);
		expect(result.partial).toBeNull();
	});
});
