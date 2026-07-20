import { describe, expect, it } from "vitest";
import type { EffectRegion } from "@/components/video-editor/types";
import { computeVideoEffectState } from "./videoEffects";

function fx(over: Partial<EffectRegion> & { type: EffectRegion["type"] }): EffectRegion {
	return { id: "e", startMs: 0, endMs: 1000, ...over };
}

describe("computeVideoEffectState", () => {
	it("is inert with no effects or outside any span", () => {
		expect(computeVideoEffectState(undefined, 500)).toEqual({ blurPx: 0, blackAlpha: 0 });
		expect(computeVideoEffectState([fx({ type: "dim" })], 2000)).toEqual({
			blurPx: 0,
			blackAlpha: 0,
		});
	});

	it("fadeIn is full black at the start and clear at the end", () => {
		const e = [fx({ type: "fadeIn", startMs: 0, endMs: 1000 })];
		expect(computeVideoEffectState(e, 0).blackAlpha).toBeCloseTo(1, 5);
		expect(computeVideoEffectState(e, 1000).blackAlpha).toBeCloseTo(0, 5);
		expect(computeVideoEffectState(e, 500).blackAlpha).toBeCloseTo(0.5, 5);
	});

	it("fadeOut is clear at the start and full black at the end", () => {
		const e = [fx({ type: "fadeOut", startMs: 0, endMs: 1000 })];
		expect(computeVideoEffectState(e, 0).blackAlpha).toBeCloseTo(0, 5);
		expect(computeVideoEffectState(e, 1000).blackAlpha).toBeCloseTo(1, 5);
	});

	it("dim holds a constant black opacity across its span", () => {
		const e = [fx({ type: "dim", intensity: 0.6, startMs: 0, endMs: 1000 })];
		expect(computeVideoEffectState(e, 250).blackAlpha).toBeCloseTo(0.6, 5);
		expect(computeVideoEffectState(e, 750).blackAlpha).toBeCloseTo(0.6, 5);
	});

	it("blur reports its radius while active and clamps to the max", () => {
		expect(computeVideoEffectState([fx({ type: "blur", intensity: 12 })], 500).blurPx).toBe(12);
		expect(computeVideoEffectState([fx({ type: "blur", intensity: 999 })], 500).blurPx).toBe(40);
		expect(computeVideoEffectState([fx({ type: "blur" })], 500).blurPx).toBe(8); // default
	});

	it("combines overlapping effects: max black, max blur, independently", () => {
		const state = computeVideoEffectState(
			[
				fx({ id: "a", type: "dim", intensity: 0.3, startMs: 0, endMs: 1000 }),
				fx({ id: "b", type: "fadeOut", startMs: 0, endMs: 1000 }),
				fx({ id: "c", type: "blur", intensity: 10, startMs: 0, endMs: 1000 }),
			],
			1000,
		);
		expect(state.blackAlpha).toBeCloseTo(1, 5); // fadeOut wins over dim 0.3
		expect(state.blurPx).toBe(10);
	});
});
