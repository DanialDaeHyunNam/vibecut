/**
 * Minimal inline-color markup for caption text: `{#FFD700|golden words}`.
 * Both the preview overlay and the export renderer resolve caption content
 * through these helpers, so a highlighted word looks identical in both.
 * The syntax never spans line breaks; unmatched braces render literally.
 */

export interface CaptionSegment {
	text: string;
	/** Hex color for this run; undefined = the caption's base text color. */
	color?: string;
}

const COLOR_SPAN = /\{(#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}))\|([^{}\n]*)\}/g;

/** Split one line of caption content into colored/plain runs, in order. */
export function parseCaptionSegments(line: string): CaptionSegment[] {
	const segments: CaptionSegment[] = [];
	let lastIndex = 0;
	COLOR_SPAN.lastIndex = 0;
	for (let match = COLOR_SPAN.exec(line); match; match = COLOR_SPAN.exec(line)) {
		if (match.index > lastIndex) {
			segments.push({ text: line.slice(lastIndex, match.index) });
		}
		if (match[2]) {
			segments.push({ text: match[2], color: match[1] });
		}
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < line.length) {
		segments.push({ text: line.slice(lastIndex) });
	}
	return segments.length > 0 ? segments : [{ text: line }];
}

/** Caption content with color markup removed — for SRT export, labels, search. */
export function stripCaptionMarkup(content: string): string {
	return content.replace(COLOR_SPAN, "$2");
}

/** Whether the content contains any color spans (cheap pre-check). */
export function hasCaptionMarkup(content: string): boolean {
	COLOR_SPAN.lastIndex = 0;
	return COLOR_SPAN.test(content);
}
