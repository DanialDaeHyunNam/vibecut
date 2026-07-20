import { describe, expect, it } from "vitest";
import type { SpeedRegion } from "@/components/video-editor/types";
import { expandSpeedRamps } from "./speedRamp";

function region(
	over: Partial<SpeedRegion> & { id: string; startMs: number; endMs: number },
): SpeedRegion {
	return { speed: 2, ...over };
}

/** Assert the expanded regions tile [start,end] contiguously with no gaps/overlaps. */
function expectContiguous(regions: SpeedRegion[]) {
	for (let i = 1; i < regions.length; i++) {
		expect(regions[i].startMs).toBeCloseTo(regions[i - 1].endMs, 5);
	}
}

describe("expandSpeedRamps", () => {
	it("passes non-ramped regions through unchanged (identity)", () => {
		const input = [region({ id: "a", startMs: 1000, endMs: 3000, speed: 2 })];
		expect(expandSpeedRamps(input)).toEqual(input);
	});

	it("returns an empty array unchanged", () => {
		expect(expandSpeedRamps([])).toEqual([]);
	});

	it("ramps in from 1x to the region speed over rampInMs", () => {
		const out = expandSpeedRamps([
			region({ id: "a", startMs: 0, endMs: 5000, speed: 10, rampInMs: 400 }),
		]);
		expectContiguous(out);
		// First micro-step starts near 1x, not at 10x.
		expect(out[0].speed).toBeLessThan(5);
		expect(out[0].startMs).toBe(0);
		// The steady plateau at the region's own speed exists and reaches the end.
		const last = out[out.length - 1];
		expect(last.speed).toBe(10);
		expect(last.endMs).toBe(5000);
	});

	it("ramps out to 1x at the end of the timeline", () => {
		const out = expandSpeedRamps([
			region({ id: "a", startMs: 0, endMs: 5000, speed: 10, rampOutMs: 400 }),
		]);
		expectContiguous(out);
		expect(out[0].speed).toBe(10); // starts at steady
		expect(out[out.length - 1].speed).toBeLessThan(5); // eases toward 1x
		expect(out[out.length - 1].endMs).toBe(5000);
	});

	it("connects the ramp to a touching neighbour's speed, not 1x", () => {
		// A (30x) abuts B; B ramps out toward C's 2.5x steady.
		const out = expandSpeedRamps([
			region({ id: "b", startMs: 0, endMs: 4000, speed: 30, rampOutMs: 500 }),
			region({ id: "c", startMs: 4000, endMs: 8000, speed: 2.5 }),
		]);
		// The last micro-step of b's ramp-out should approach 2.5x, not 1x.
		const bSteps = out.filter((r) => r.id.startsWith("b"));
		expect(bSteps[bSteps.length - 1].speed).toBeLessThan(5);
		expect(bSteps[bSteps.length - 1].speed).toBeGreaterThan(2); // heading to 2.5, not 1
	});

	it("gives each boundary a single ramp (prev rampOut wins over next rampIn)", () => {
		// Both touch at 4000 and both declare a ramp there. Only b's rampOut should
		// act; c's rampIn at that seam is suppressed, so c starts at its steady 2.5x.
		const out = expandSpeedRamps([
			region({ id: "b", startMs: 0, endMs: 4000, speed: 30, rampOutMs: 500 }),
			region({ id: "c", startMs: 4000, endMs: 8000, speed: 2.5, rampInMs: 500 }),
		]);
		const cSteps = out.filter((r) => r.id.startsWith("c"));
		// c is a single steady region (no ramp-in steps), starting exactly at 4000/2.5x.
		expect(cSteps).toHaveLength(1);
		expect(cSteps[0].speed).toBe(2.5);
		expect(cSteps[0].startMs).toBe(4000);
	});

	it("scales overlapping ramps to fit a short region (no negative steady)", () => {
		const out = expandSpeedRamps([
			region({ id: "a", startMs: 0, endMs: 300, speed: 8, rampInMs: 400, rampOutMs: 400 }),
		]);
		expectContiguous(out);
		expect(out[0].startMs).toBe(0);
		expect(out[out.length - 1].endMs).toBe(300);
	});

	it("keeps a steady plateau between ramp-in and ramp-out", () => {
		const out = expandSpeedRamps([
			region({ id: "a", startMs: 0, endMs: 6000, speed: 20, rampInMs: 500, rampOutMs: 500 }),
		]);
		const steady = out.filter((r) => r.speed === 20);
		expect(steady.length).toBeGreaterThanOrEqual(1);
		expectContiguous(out);
	});
});
