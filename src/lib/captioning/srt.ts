import type { AnnotationRegion } from "@/components/video-editor/types";
import { stripCaptionMarkup } from "./captionRichText";

/**
 * Serializes caption annotations to SubRip (.srt) — the de-facto interchange
 * format accepted by YouTube, Premiere, DaVinci, VLC, etc. Only caption-track
 * text annotations (annotationSource: "auto-caption") are included; titles and
 * other free-floating text overlays stay out of the subtitle track.
 */

function srtTimestamp(ms: number): string {
	const clamped = Math.max(0, Math.round(ms));
	const hours = Math.floor(clamped / 3_600_000);
	const minutes = Math.floor((clamped % 3_600_000) / 60_000);
	const seconds = Math.floor((clamped % 60_000) / 1000);
	const millis = clamped % 1000;
	const pad = (value: number, width = 2) => String(value).padStart(width, "0");
	return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

export function extractCaptionRegions(regions: AnnotationRegion[]): AnnotationRegion[] {
	return regions
		.filter(
			(region) =>
				region.type === "text" &&
				region.annotationSource === "auto-caption" &&
				(region.content ?? "").trim().length > 0,
		)
		.sort((a, b) => a.startMs - b.startMs);
}

export function captionsToSrt(regions: AnnotationRegion[]): string {
	const captions = extractCaptionRegions(regions);
	return captions
		.map((caption, index) => {
			// SRT has no color markup — export the plain text.
			const text = stripCaptionMarkup((caption.content ?? "").trim());
			return `${index + 1}\n${srtTimestamp(caption.startMs)} --> ${srtTimestamp(caption.endMs)}\n${text}\n`;
		})
		.join("\n");
}
