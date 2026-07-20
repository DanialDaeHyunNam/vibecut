import { describe, expect, it } from "vitest";
import {
	COARSE_SIZE,
	FINE_GRID,
	FINE_SIZE,
	type FrameSignature,
	formatFrameTime,
	KeyframeSelector,
	maxCellDiffPct,
	pctDiff,
	thinUniformly,
} from "./keyframeExtraction";

function uniform(size: number, value: number): Uint8ClampedArray {
	return new Uint8ClampedArray(size * size * 3).fill(value);
}

/** Fine signature with one grid cell's pixels set to `cellValue` (a fraction of them). */
function fineWithCell(base: number, cellValue: number, fraction = 1): Uint8ClampedArray {
	const fine = uniform(FINE_SIZE, base);
	const cellPx = FINE_SIZE / FINE_GRID;
	const changedRows = Math.round(cellPx * fraction);
	for (let y = 0; y < changedRows; y++) {
		for (let x = 0; x < cellPx; x++) {
			const i = (y * FINE_SIZE + x) * 3;
			fine[i] = cellValue;
			fine[i + 1] = cellValue;
			fine[i + 2] = cellValue;
		}
	}
	return fine;
}

function sig(coarseValue: number, fine?: Uint8ClampedArray): FrameSignature {
	return {
		coarse: uniform(COARSE_SIZE, coarseValue),
		fine: fine ?? uniform(FINE_SIZE, coarseValue),
	};
}

describe("pctDiff", () => {
	it("returns 0 for identical signatures", () => {
		expect(pctDiff(uniform(COARSE_SIZE, 100), uniform(COARSE_SIZE, 100))).toBe(0);
	});

	it("returns 100 when every cell changes beyond tolerance", () => {
		expect(pctDiff(uniform(COARSE_SIZE, 0), uniform(COARSE_SIZE, 200))).toBe(100);
	});

	it("ignores changes within the tolerance", () => {
		expect(pctDiff(uniform(COARSE_SIZE, 100), uniform(COARSE_SIZE, 110), 25)).toBe(0);
	});
});

describe("maxCellDiffPct", () => {
	it("scores a single fully-changed cell at 100 while the global diff stays tiny", () => {
		const a = uniform(FINE_SIZE, 50);
		const b = fineWithCell(50, 250);
		expect(maxCellDiffPct(a, b)).toBe(100);
		// One cell out of 12x12 — under 1% of coarse cells would move.
		expect(100 / (FINE_GRID * FINE_GRID)).toBeLessThan(1);
	});

	it("returns 0 for identical signatures", () => {
		expect(maxCellDiffPct(uniform(FINE_SIZE, 50), uniform(FINE_SIZE, 50))).toBe(0);
	});
});

describe("KeyframeSelector", () => {
	it("keeps the first frame", () => {
		const selector = new KeyframeSelector();
		expect(selector.consider(sig(10), 0)).toBe("first");
	});

	it("keeps a scene change and drops a near-duplicate", () => {
		const selector = new KeyframeSelector();
		selector.consider(sig(10), 0);
		expect(selector.consider(sig(200), 500)).toBe("scene");
		expect(selector.consider(sig(200), 1000)).toBeNull();
	});

	it("does not re-keep a shot already in the window (A-B-A alternation)", () => {
		const selector = new KeyframeSelector();
		selector.consider(sig(10), 0);
		expect(selector.consider(sig(200), 500)).toBe("scene");
		expect(selector.consider(sig(10), 1000)).toBeNull();
	});

	it("keeps a small local change when the scene is otherwise static", () => {
		const selector = new KeyframeSelector();
		selector.consider(sig(50), 0);
		// Same coarse look, one fine cell rewritten — a typed word, a small UI update.
		expect(selector.consider(sig(50, fineWithCell(50, 250)), 500)).toBe("local");
	});

	it("raises the local gate right after a local keep (cooldown)", () => {
		const selector = new KeyframeSelector();
		selector.consider(sig(50), 0);
		expect(selector.consider(sig(50, fineWithCell(50, 250)), 500)).toBe("local");
		// A 60%-of-one-cell change clears the base gate (45) but not the
		// cooldown-raised one — and the density floor hasn't elapsed.
		expect(selector.consider(sig(50, fineWithCell(50, 180, 0.6)), 1000)).toBeNull();
	});

	it("forces a keep once the density floor elapses", () => {
		const selector = new KeyframeSelector({ floorMs: 5000 });
		selector.consider(sig(10), 0);
		expect(selector.consider(sig(10), 2500)).toBeNull();
		expect(selector.consider(sig(10), 5100)).toBe("floor");
	});
});

describe("thinUniformly", () => {
	it("returns the input untouched when under the cap", () => {
		const items = [1, 2, 3];
		expect(thinUniformly(items, 5)).toEqual(items);
	});

	it("keeps survivors spread across the whole list", () => {
		const items = Array.from({ length: 10 }, (_, i) => i);
		const thinned = thinUniformly(items, 5);
		expect(thinned).toHaveLength(5);
		expect(thinned[0]).toBe(0);
		expect(thinned[thinned.length - 1]).toBeGreaterThanOrEqual(8);
	});
});

describe("formatFrameTime", () => {
	it("formats zero and sub-minute times", () => {
		expect(formatFrameTime(0)).toBe("0:00.0");
		expect(formatFrameTime(3200)).toBe("0:03.2");
	});

	it("formats minutes", () => {
		expect(formatFrameTime(63500)).toBe("1:03.5");
	});
});
