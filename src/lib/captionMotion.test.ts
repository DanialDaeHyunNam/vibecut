import { describe, expect, it } from "vitest";
import type { AnnotationRegion } from "@/components/video-editor/types";
import { getCaptionRenderState } from "./captionMotion";

function caption(over: Partial<AnnotationRegion> = {}): AnnotationRegion {
	return {
		id: "c",
		startMs: 1000,
		endMs: 3000,
		type: "text",
		content: "hi",
		position: { x: 50, y: 50 },
		size: { width: 40, height: 12 },
		style: {
			color: "#fff",
			backgroundColor: "transparent",
			fontSize: 24,
			fontFamily: "Inter",
			fontWeight: "normal",
			fontStyle: "normal",
			textDecoration: "none",
			textAlign: "center",
		},
		zIndex: 1,
		...over,
	};
}

describe("getCaptionRenderState", () => {
	it("returns base values when there is no motion", () => {
		const state = getCaptionRenderState(caption(), 2000);
		expect(state.position).toEqual({ x: 50, y: 50 });
		expect(state.fontSize).toBe(24);
	});

	it("interpolates position and fontSize across the span", () => {
		const region = caption({
			motion: { toPosition: { x: 50, y: 90 }, toFontSize: 40 },
		});
		// Start of span: base.
		expect(getCaptionRenderState(region, 1000).position.y).toBeCloseTo(50, 3);
		expect(getCaptionRenderState(region, 1000).fontSize).toBeCloseTo(24, 3);
		// Midpoint: halfway (smoothstep(0.5) = 0.5).
		expect(getCaptionRenderState(region, 2000).position.y).toBeCloseTo(70, 3);
		expect(getCaptionRenderState(region, 2000).fontSize).toBeCloseTo(32, 3);
		// End: target.
		expect(getCaptionRenderState(region, 3000).position.y).toBeCloseTo(90, 3);
		expect(getCaptionRenderState(region, 3000).fontSize).toBeCloseTo(40, 3);
	});

	it("respects a move sub-window (holds base before, target after)", () => {
		const region = caption({
			startMs: 0,
			endMs: 5000,
			motion: { toPosition: { x: 50, y: 90 }, startMs: 1000, endMs: 3000 },
		});
		expect(getCaptionRenderState(region, 500).position.y).toBeCloseTo(50, 3); // before window
		expect(getCaptionRenderState(region, 2000).position.y).toBeCloseTo(70, 3); // mid window
		expect(getCaptionRenderState(region, 4000).position.y).toBeCloseTo(90, 3); // after window
	});

	it("leaves untargeted fields at their base", () => {
		const region = caption({ motion: { toFontSize: 40 } });
		const state = getCaptionRenderState(region, 3000);
		expect(state.position).toEqual({ x: 50, y: 50 });
		expect(state.size).toEqual({ width: 40, height: 12 });
		expect(state.fontSize).toBeCloseTo(40, 3);
	});
});
