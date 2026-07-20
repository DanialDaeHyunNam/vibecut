import { describe, expect, it } from "vitest";
import { INITIAL_EDITOR_STATE } from "@/hooks/useEditorHistory";
import type { CursorTelemetryPoint, ZoomRegion } from "../video-editor/types";
import { type AiCommandContext, executeAiCommand } from "./aiCommandExecutor";

function makeContext(overrides: Partial<AiCommandContext> = {}): AiCommandContext {
	let zoomId = 1;
	let trimId = 1;
	let speedId = 1;
	let effectId = 1;
	let annotationId = 1;
	let zIndex = 1;
	return {
		durationMs: 10_000,
		aspectRatio: "16:9",
		cursorTelemetry: [],
		allocZoomId: () => `zoom-${zoomId++}`,
		allocTrimId: () => `trim-${trimId++}`,
		allocSpeedId: () => `speed-${speedId++}`,
		allocEffectId: () => `effect-${effectId++}`,
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

	it("adds a speed region with ramps and clamps them to the region length", () => {
		const result = executeAiCommand(
			"add_speed_regions",
			{ regions: [{ startMs: 1000, endMs: 3000, speed: 4, rampInMs: 400, rampOutMs: 9000 }] },
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		const region = result.partial?.speedRegions?.[0];
		expect(region?.rampInMs).toBe(400);
		// rampOut 9000 clamped to the 2000ms region length.
		expect(region?.rampOutMs).toBe(2000);
	});

	it("clears a ramp on update when set to 0 and keeps it when omitted", () => {
		const added = executeAiCommand(
			"add_speed_regions",
			{ regions: [{ startMs: 1000, endMs: 5000, speed: 3, rampInMs: 500, rampOutMs: 500 }] },
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		const state = { ...INITIAL_EDITOR_STATE, speedRegions: added.partial?.speedRegions ?? [] };
		const id = state.speedRegions[0].id;
		const updated = executeAiCommand(
			"update_speed_region",
			{ id, rampInMs: 0 },
			state,
			makeContext(),
		);
		const region = updated.partial?.speedRegions?.[0];
		expect(region?.rampInMs).toBeUndefined(); // cleared
		expect(region?.rampOutMs).toBe(500); // omitted → kept
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

	it("applies caption style overrides and position presets on add_captions", () => {
		const added = executeAiCommand(
			"add_captions",
			{
				captions: [{ startMs: 1000, endMs: 3000, text: "임팩트 있게 🚀" }],
				style: {
					backgroundColor: "rgba(0,0,0,0.75)",
					fontSize: 200,
					textAnimation: "pop",
					position: "top",
					color: "url(javascript:alert(1))",
				},
			},
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		expect(added.ok).toBe(true);
		const region = added.partial?.annotationRegions?.[0];
		expect(region?.style).toMatchObject({
			backgroundColor: "rgba(0,0,0,0.75)",
			fontSize: 96, // clamped
			textAnimation: "pop",
			// Unsafe color rejected — default (white) kept.
			color: "#ffffff",
		});
		expect(region?.position.y).toBe(4);
		expect(JSON.parse(added.content).skipped.join(" ")).toContain("color");
	});

	it("applies box shape, numeric weight, and font family; rejects unsafe families", () => {
		const added = executeAiCommand(
			"add_captions",
			{
				captions: [{ startMs: 1000, endMs: 3000, text: "두꺼운 박스" }],
				style: {
					fontWeight: 800,
					fontFamily: "Arial Black",
					boxPaddingX: 0.4,
					boxPaddingY: 5, // clamped to 2em
					boxRadius: 8.6, // rounded
				},
			},
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		expect(added.ok).toBe(true);
		expect(added.partial?.annotationRegions?.[0].style).toMatchObject({
			fontWeight: 800,
			fontFamily: "Arial Black",
			boxPaddingX: 0.4,
			boxPaddingY: 2,
			boxRadius: 9,
		});

		const rejected = executeAiCommand(
			"add_captions",
			{
				captions: [{ startMs: 1000, endMs: 3000, text: "주입 시도" }],
				style: { fontFamily: "Inter; background:url(evil)" },
			},
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		expect(rejected.partial?.annotationRegions?.[0].style.fontFamily).not.toContain("evil");
		expect(JSON.parse(rejected.content).skipped.join(" ")).toContain("fontFamily");
	});

	it("resolves motion.toAnchor to the same slot as the position preset", () => {
		// "rise from the bottom, stop at center": start = style.position,
		// destination = motion.toAnchor — no raw coordinates involved.
		const added = executeAiCommand(
			"add_captions",
			{
				captions: [
					{
						startMs: 1000,
						endMs: 3000,
						text: "아래에서 중앙까지",
						motion: { toAnchor: "middle", toPosition: { x: 0, y: 0 } },
					},
				],
				style: { position: "bottom" },
			},
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		expect(added.ok).toBe(true);
		const region = added.partial?.annotationRegions?.[0];
		expect(region).toBeDefined();
		if (!region) throw new Error("caption missing");
		// Anchor overrides the raw toPosition and lands above the bottom start.
		expect(region.motion?.toPosition).toBeDefined();
		expect(region.motion?.toPosition?.y).toBeCloseTo((100 - region.size.height) / 2);
		expect(region.motion?.toPosition?.y ?? 0).toBeLessThan(region.position.y);
	});

	it("defaults new captions to the dim-box look", () => {
		const added = executeAiCommand(
			"add_captions",
			{ captions: [{ startMs: 1000, endMs: 3000, text: "기본 스타일" }] },
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		expect(added.partial?.annotationRegions?.[0].style).toMatchObject({
			backgroundColor: "rgba(0, 0, 0, 0.7)",
			fontWeight: "bold",
			color: "#ffffff",
		});
	});

	it("restyles all captions at once via set_caption_style", () => {
		const added = executeAiCommand(
			"add_captions",
			{
				captions: [
					{ startMs: 1000, endMs: 3000, text: "one" },
					{ startMs: 4000, endMs: 6000, text: "two" },
				],
			},
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		const state = {
			...INITIAL_EDITOR_STATE,
			annotationRegions: added.partial?.annotationRegions ?? [],
		};
		const restyled = executeAiCommand(
			"set_caption_style",
			{ style: { backgroundColor: "transparent", position: "middle", fontWeight: "normal" } },
			state,
			makeContext(),
		);
		expect(restyled.ok).toBe(true);
		const regions = restyled.partial?.annotationRegions ?? [];
		expect(regions).toHaveLength(2);
		for (const region of regions) {
			expect(region.style.backgroundColor).toBe("transparent");
			expect(region.style.fontWeight).toBe("normal");
			// Text/timing untouched.
			expect(["one", "two"]).toContain(region.content);
		}
		expect(JSON.parse(restyled.content).restyled).toBe(2);

		const targeted = executeAiCommand(
			"set_caption_style",
			{ ids: [regions[0].id], style: { color: "#FFD84D" } },
			{ ...INITIAL_EDITOR_STATE, annotationRegions: regions },
			makeContext(),
		);
		const after = targeted.partial?.annotationRegions ?? [];
		expect(after[0].style.color).toBe("#FFD84D");
		expect(after[1].style.color).not.toBe("#FFD84D");
	});

	it("rejects set_caption_style with no valid fields or no captions", () => {
		const noFields = executeAiCommand(
			"set_caption_style",
			{ style: { position: "diagonal" } },
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		expect(noFields.ok).toBe(false);

		const noCaptions = executeAiCommand(
			"set_caption_style",
			{ style: { color: "#fff" } },
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		expect(noCaptions.ok).toBe(false);
	});

	it("merges style fields into an existing caption via update_caption", () => {
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
		const updated = executeAiCommand(
			"update_caption",
			{ id: state.annotationRegions[0].id, style: { textAnimation: "rise" } },
			state,
			makeContext(),
		);
		expect(updated.ok).toBe(true);
		const region = updated.partial?.annotationRegions?.[0];
		expect(region?.style.textAnimation).toBe("rise");
		// Untouched fields survive the merge.
		expect(region?.style.fontWeight).toBe("bold");
		expect(region?.content).toBe("hello");
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

	it("adds video effects, clamps intensity by type, and deletes them", () => {
		const added = executeAiCommand(
			"add_effects",
			{
				effects: [
					{ startMs: 0, endMs: 500, type: "fadeIn", intensity: 30 }, // intensity ignored
					{ startMs: 9000, endMs: 10000, type: "fadeOut" },
					{ startMs: 2000, endMs: 4000, type: "blur", intensity: 999 }, // clamps to 40
					{ startMs: 0, endMs: 50, type: "bogus" as never }, // invalid type → skipped
				],
			},
			INITIAL_EDITOR_STATE,
			makeContext(),
		);
		expect(added.ok).toBe(true);
		const effects = added.partial?.effectRegions ?? [];
		expect(effects).toHaveLength(3);
		expect(effects.find((e) => e.type === "fadeIn")?.intensity).toBeUndefined();
		expect(effects.find((e) => e.type === "blur")?.intensity).toBe(40);
		expect(JSON.parse(added.content).skipped).toHaveLength(1);

		const state = { ...INITIAL_EDITOR_STATE, effectRegions: effects };
		const deleted = executeAiCommand(
			"delete_effects",
			{ ids: [effects[0].id, effects[1].id] },
			state,
			makeContext(),
		);
		expect(deleted.partial?.effectRegions).toHaveLength(1);
	});

	it("rejects unknown commands", () => {
		const result = executeAiCommand("format_hard_drive", {}, INITIAL_EDITOR_STATE, makeContext());
		expect(result.ok).toBe(false);
		expect(result.partial).toBeNull();
	});
});
