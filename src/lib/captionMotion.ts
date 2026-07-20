import type {
	AnnotationPosition,
	AnnotationRegion,
	AnnotationSize,
} from "@/components/video-editor/types";

/**
 * Keyframed caption motion: the effective position, size, and font size at a
 * given time. With no `motion` the base values pass through unchanged, so this
 * is a no-op for static captions. Both the preview overlay and the export
 * renderer resolve their layout through this one function, so a moving caption
 * looks identical in both.
 */

export interface CaptionRenderState {
	position: AnnotationPosition;
	size: AnnotationSize;
	fontSize: number;
}

/** Smoothstep ease-in-out so the move accelerates and settles instead of sliding linearly. */
function easeInOut(u: number): number {
	const t = Math.max(0, Math.min(1, u));
	return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

export function getCaptionRenderState(
	region: Pick<AnnotationRegion, "startMs" | "endMs" | "position" | "size" | "style" | "motion">,
	currentTimeMs: number,
): CaptionRenderState {
	const base: CaptionRenderState = {
		position: region.position,
		size: region.size,
		fontSize: region.style.fontSize,
	};
	const motion = region.motion;
	if (!motion || (!motion.toPosition && !motion.toSize && motion.toFontSize === undefined)) {
		return base;
	}

	const from = Math.max(region.startMs, motion.startMs ?? region.startMs);
	const to = Math.min(region.endMs, motion.endMs ?? region.endMs);
	// Before the move window hold the base; after it, hold the target.
	const t =
		to <= from ? (currentTimeMs >= to ? 1 : 0) : easeInOut((currentTimeMs - from) / (to - from));

	const position = motion.toPosition
		? {
				x: lerp(region.position.x, motion.toPosition.x, t),
				y: lerp(region.position.y, motion.toPosition.y, t),
			}
		: region.position;
	const size = motion.toSize
		? {
				width: lerp(region.size.width, motion.toSize.width, t),
				height: lerp(region.size.height, motion.toSize.height, t),
			}
		: region.size;
	const fontSize =
		motion.toFontSize !== undefined
			? lerp(region.style.fontSize, motion.toFontSize, t)
			: region.style.fontSize;

	return { position, size, fontSize };
}
