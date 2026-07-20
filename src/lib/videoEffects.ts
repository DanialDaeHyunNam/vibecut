import {
	DEFAULT_EFFECT_BLUR_PX,
	DEFAULT_EFFECT_DIM_ALPHA,
	type EffectRegion,
	MAX_EFFECT_BLUR_PX,
} from "@/components/video-editor/types";

/**
 * Full-frame video effects (fade in/out, blur, dim) resolved to a single render
 * state at a given source time. Both preview (a CSS overlay on the player) and
 * export (a filter/overlay pass on the final composite canvas) consume this, so
 * the two always agree. Effects live on the source timeline like every other
 * region, and this is a pure function of (regions, time) — easy to unit test.
 */

export interface VideoEffectState {
	/** Gaussian blur radius in px to apply to the whole frame (0 = none). */
	blurPx: number;
	/** Black overlay opacity 0-1 combining fades and dims (0 = none, 1 = black). */
	blackAlpha: number;
}

/** Smoothstep ease-in-out so fades ramp gently instead of linearly. */
function easeInOut(u: number): number {
	const t = Math.max(0, Math.min(1, u));
	return t * t * (3 - 2 * t);
}

export function computeVideoEffectState(
	effects: EffectRegion[] | undefined,
	timeMs: number,
): VideoEffectState {
	let blurPx = 0;
	let blackAlpha = 0;
	if (!effects) return { blurPx, blackAlpha };

	for (const effect of effects) {
		if (timeMs < effect.startMs || timeMs > effect.endMs) continue;
		const span = Math.max(1, effect.endMs - effect.startMs);
		const progress = Math.max(0, Math.min(1, (timeMs - effect.startMs) / span));

		switch (effect.type) {
			case "fadeIn":
				// Black at the start, clearing to the video by the end.
				blackAlpha = Math.max(blackAlpha, 1 - easeInOut(progress));
				break;
			case "fadeOut":
				blackAlpha = Math.max(blackAlpha, easeInOut(progress));
				break;
			case "dim":
				blackAlpha = Math.max(blackAlpha, clampUnit(effect.intensity ?? DEFAULT_EFFECT_DIM_ALPHA));
				break;
			case "blur":
				blurPx = Math.max(
					blurPx,
					Math.min(MAX_EFFECT_BLUR_PX, Math.max(0, effect.intensity ?? DEFAULT_EFFECT_BLUR_PX)),
				);
				break;
		}
	}

	return { blurPx, blackAlpha: Math.min(1, blackAlpha) };
}

function clampUnit(value: number): number {
	return Math.max(0, Math.min(1, value));
}
