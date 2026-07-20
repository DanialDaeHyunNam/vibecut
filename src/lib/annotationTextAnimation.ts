import type { AnnotationTextAnimation } from "@/components/video-editor/types";

export const TEXT_ANIMATION_DURATION_MS = 700;

export interface TextAnimationState {
	opacity: number;
	scale: number;
	translateX: number;
	translateY: number;
	revealProgress: number;
}

export const TEXT_ANIMATION_OPTIONS: Array<{
	value: AnnotationTextAnimation;
	translationKey: string;
}> = [
	{ value: "none", translationKey: "textAnimation.none" },
	{ value: "fade", translationKey: "textAnimation.fade" },
	{ value: "rise", translationKey: "textAnimation.rise" },
	{ value: "pop", translationKey: "textAnimation.pop" },
	{ value: "slide-left", translationKey: "textAnimation.slideLeft" },
	{ value: "typewriter", translationKey: "textAnimation.typewriter" },
	{ value: "pulse", translationKey: "textAnimation.pulse" },
];

function clamp(value: number, min = 0, max = 1) {
	return Math.min(max, Math.max(min, value));
}

function easeOutCubic(value: number) {
	const t = clamp(value);
	return 1 - (1 - t) ** 3;
}

function easeOutBack(value: number) {
	const t = clamp(value);
	const c1 = 1.70158;
	const c3 = c1 + 1;
	return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

export function normalizeTextAnimation(value: unknown): AnnotationTextAnimation {
	return TEXT_ANIMATION_OPTIONS.some((option) => option.value === value)
		? (value as AnnotationTextAnimation)
		: "none";
}

const NEUTRAL_STATE: TextAnimationState = {
	opacity: 1,
	scale: 1,
	translateX: 0,
	translateY: 0,
	revealProgress: 1,
};

/**
 * The animation state for one animation at `progress` (0 = fully out, 1 = fully
 * in). Entrance runs progress 0→1 after startMs; exit runs it 1→0 before endMs,
 * so the same curve plays in reverse on the way out.
 */
function animationStateAt(
	animation: AnnotationTextAnimation,
	progress: number,
): TextAnimationState {
	if (animation === "none") return NEUTRAL_STATE;
	const eased = easeOutCubic(progress);
	switch (animation) {
		case "fade":
			return {
				opacity: eased,
				scale: 1,
				translateX: 0,
				translateY: 0,
				revealProgress: 1,
			};
		case "rise":
			return {
				opacity: eased,
				scale: 1,
				translateX: 0,
				translateY: (1 - eased) * 18,
				revealProgress: 1,
			};
		case "pop":
			return {
				opacity: eased,
				scale: Math.max(0.72, easeOutBack(progress)),
				translateX: 0,
				translateY: 0,
				revealProgress: 1,
			};
		case "slide-left":
			return {
				opacity: eased,
				scale: 1,
				translateX: (1 - eased) * -28,
				translateY: 0,
				revealProgress: 1,
			};
		case "typewriter":
			return {
				opacity: 1,
				scale: 1,
				translateX: 0,
				translateY: 0,
				revealProgress: progress,
			};
		case "pulse":
			return {
				opacity: 1,
				scale: 1 + Math.sin(progress * Math.PI) * 0.06,
				translateX: 0,
				translateY: 0,
				revealProgress: 1,
			};
		default:
			return NEUTRAL_STATE;
	}
}

/**
 * Combined entrance + exit animation state at the current time. The entrance
 * (style.textAnimation) plays over the first TEXT_ANIMATION_DURATION_MS after
 * startMs; the exit (exitAnimation) plays over the last TEXT_ANIMATION_DURATION_MS
 * before endMs, running the same curve in reverse. The two are merged so a
 * caption can, e.g., pop in and fade out.
 */
export function getTextAnimationState(
	annotation: {
		startMs: number;
		endMs?: number;
		style: { textAnimation?: AnnotationTextAnimation };
		exitAnimation?: AnnotationTextAnimation;
	},
	currentTimeMs: number,
): TextAnimationState {
	const entranceAnim = normalizeTextAnimation(annotation.style.textAnimation);
	const entranceProgress = clamp(
		Math.max(0, currentTimeMs - annotation.startMs) / TEXT_ANIMATION_DURATION_MS,
	);
	const entrance = animationStateAt(entranceAnim, entranceProgress);

	const exitAnim = normalizeTextAnimation(annotation.exitAnimation);
	if (exitAnim === "none" || annotation.endMs === undefined) {
		return entrance;
	}
	// progress 1 at the tail's start, 0 exactly at endMs → the entrance curve
	// reversed, so the caption animates back out.
	const exitProgress = clamp((annotation.endMs - currentTimeMs) / TEXT_ANIMATION_DURATION_MS);
	const exit = animationStateAt(exitAnim, exitProgress);

	return {
		opacity: entrance.opacity * exit.opacity,
		scale: entrance.scale * exit.scale,
		translateX: entrance.translateX + exit.translateX,
		translateY: entrance.translateY + exit.translateY,
		// Reveal (typewriter) is an entrance-only concern.
		revealProgress: entrance.revealProgress,
	};
}
