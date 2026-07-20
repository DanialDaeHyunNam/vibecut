import { clampPlaybackSpeed, type SpeedRegion } from "@/components/video-editor/types";

/**
 * Speed ramping without a variable-speed engine. The export and preview
 * pipelines only understand *constant* speed per span, so a smooth
 * accelerate → hold → decelerate is produced by expanding a region's ramp
 * portions into a run of fine constant-speed micro-steps along an ease curve —
 * the same trick a user would do by hand, but as one region property with one
 * undo step, a clean curve, and automatic connection to the neighbour's speed.
 *
 * Continuity rule: each boundary between two regions is owned by exactly one
 * ramp. The left region's rampOut wins; only if it has none does the right
 * region's rampIn take over. So two touching ramped regions never fight over a
 * boundary and the resulting speed(t) is continuous. The very first region
 * ramps in from 1×, the last ramps out to 1×, and any real gap between regions
 * (a 1× stretch) makes the adjacent ramp target 1× so the seam stays smooth.
 */

/** Touching-within this many ms counts as adjacent (ramp targets the neighbour's speed). */
const ADJACENCY_EPS_MS = 5;
/** Micro-step granularity along a ramp; smaller = smoother, more segments. */
const RAMP_STEP_MS = 40;
/** Cap the steps of a single ramp so a very long ramp can't explode the segment count. */
const MAX_RAMP_STEPS = 24;

/** Smoothstep ease-in-out on [0,1]. */
function easeInOut(u: number): number {
	const t = Math.max(0, Math.min(1, u));
	return t * t * (3 - 2 * t);
}

/** Are `a` (before) and `b` (after) touching, so a ramp should connect their speeds? */
function adjacent(a: SpeedRegion, b: SpeedRegion): boolean {
	return Math.abs(b.startMs - a.endMs) <= ADJACENCY_EPS_MS;
}

/** Split [fromSpeed → toSpeed] over [startMs,endMs] into eased constant-speed steps. */
function rampSteps(
	id: string,
	startMs: number,
	endMs: number,
	fromSpeed: number,
	toSpeed: number,
): SpeedRegion[] {
	const spanMs = endMs - startMs;
	if (spanMs <= 0) return [];
	const steps = Math.max(1, Math.min(MAX_RAMP_STEPS, Math.round(spanMs / RAMP_STEP_MS)));
	const out: SpeedRegion[] = [];
	for (let k = 0; k < steps; k++) {
		const s0 = startMs + (spanMs * k) / steps;
		const s1 = startMs + (spanMs * (k + 1)) / steps;
		// Sample the eased curve at the step midpoint so the run brackets the
		// true speed rather than lagging a step behind.
		const eased = easeInOut((k + 0.5) / steps);
		const speed = clampPlaybackSpeed(fromSpeed + (toSpeed - fromSpeed) * eased);
		out.push({ id: `${id}#r${k}`, startMs: s0, endMs: s1, speed });
	}
	return out;
}

/**
 * Expand ramped speed regions into constant-speed regions the export/preview
 * engines can consume directly. Regions with no ramp pass through untouched, so
 * this is an identity on existing projects.
 */
export function expandSpeedRamps(regions: SpeedRegion[]): SpeedRegion[] {
	if (!regions.length) return regions;
	const sorted = [...regions].sort((a, b) => a.startMs - b.startMs);
	const out: SpeedRegion[] = [];

	sorted.forEach((region, i) => {
		const prev = sorted[i - 1];
		const next = sorted[i + 1];
		const prevAdjacent = prev ? adjacent(prev, region) : false;
		const nextAdjacent = next ? adjacent(region, next) : false;

		// A ramp targets the touching neighbour's speed, else 1× (start/end of the
		// timeline, or across a real gap).
		const fromSpeed = prevAdjacent ? prev.speed : 1;
		const toSpeed = nextAdjacent ? next.speed : 1;

		// Boundary ownership: the previous region's rampOut owns the shared seam,
		// so this region's rampIn is suppressed there to avoid a double ramp.
		const rampInOwned = !(prevAdjacent && (prev.rampOutMs ?? 0) > 0);
		let rampIn = rampInOwned ? Math.max(0, region.rampInMs ?? 0) : 0;
		let rampOut = Math.max(0, region.rampOutMs ?? 0);

		const len = region.endMs - region.startMs;
		if (rampIn + rampOut > len && rampIn + rampOut > 0) {
			// Scale both ramps to fit, leaving no steady plateau rather than overlapping.
			const scale = len / (rampIn + rampOut);
			rampIn *= scale;
			rampOut *= scale;
		}

		if (rampIn <= 0 && rampOut <= 0) {
			out.push(region); // fast path: unchanged region
			return;
		}

		const inEnd = region.startMs + rampIn;
		const outStart = region.endMs - rampOut;
		if (rampIn > 0)
			out.push(...rampSteps(region.id, region.startMs, inEnd, fromSpeed, region.speed));
		if (outStart > inEnd) {
			out.push({ id: `${region.id}#s`, startMs: inEnd, endMs: outStart, speed: region.speed });
		}
		if (rampOut > 0)
			out.push(...rampSteps(region.id, outStart, region.endMs, region.speed, toSpeed));
	});

	return out;
}
