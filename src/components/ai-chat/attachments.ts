/**
 * Turns files the user drops into the chat composer into model-ready images.
 * Images are downscaled and JPEG-encoded (IPC payload + model context stay
 * small). Videos can't be sent to a text model at all, so they go through the
 * same scene-aware keyframe pipeline as the recording itself
 * (keyframeExtraction) and arrive as labelled contact sheets — the model
 * "watches" an attached clip exactly the way it watches the project video.
 */

import { extractKeyframes, formatFrameTime, makeContactSheets } from "./keyframeExtraction";

const MAX_IMAGE_DIMENSION = 1568;
const IMAGE_JPEG_QUALITY = 0.85;
const THUMB_SIZE = 96;
const VIDEO_MAX_KEYFRAMES = 18;

export interface OutgoingAttachment {
	kind: "image" | "video";
	name: string;
	/** Images actually sent to the model (a video becomes contact sheets). */
	images: Array<{ data: string; mimeType: string }>;
	/** Tiny data-URL thumbnail for the chat transcript UI. */
	thumb: string;
	/** Context line appended to the outgoing message text (not shown in the UI). */
	note: string;
}

export function isSupportedAttachment(file: File): boolean {
	return file.type.startsWith("image/") || file.type.startsWith("video/");
}

function drawScaled(
	source: CanvasImageSource,
	sourceWidth: number,
	sourceHeight: number,
	maxDimension: number,
): HTMLCanvasElement {
	const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(sourceWidth * scale));
	canvas.height = Math.max(1, Math.round(sourceHeight * scale));
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("2d canvas unavailable");
	ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
	return canvas;
}

function toBase64Jpeg(canvas: HTMLCanvasElement, quality: number): string {
	const dataUrl = canvas.toDataURL("image/jpeg", quality);
	return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

async function processImage(file: File): Promise<OutgoingAttachment> {
	const bitmap = await createImageBitmap(file);
	try {
		const full = drawScaled(bitmap, bitmap.width, bitmap.height, MAX_IMAGE_DIMENSION);
		const thumb = drawScaled(bitmap, bitmap.width, bitmap.height, THUMB_SIZE);
		return {
			kind: "image",
			name: file.name,
			images: [{ data: toBase64Jpeg(full, IMAGE_JPEG_QUALITY), mimeType: "image/jpeg" }],
			thumb: thumb.toDataURL("image/jpeg", 0.7),
			note: `[Attached image: ${file.name}]`,
		};
	} finally {
		bitmap.close();
	}
}

async function processVideo(file: File): Promise<OutgoingAttachment> {
	const url = URL.createObjectURL(file);
	try {
		const { frames, endMs } = await extractKeyframes(url, { maxFrames: VIDEO_MAX_KEYFRAMES });
		if (frames.length === 0) throw new Error("no frames could be extracted from the video");
		const thumbCanvas = drawScaled(
			frames[0].bitmap,
			frames[0].bitmap.width,
			frames[0].bitmap.height,
			THUMB_SIZE,
		);
		const sheets = makeContactSheets(frames);
		return {
			kind: "video",
			name: file.name,
			images: sheets.map((sheet) => ({ data: sheet.data, mimeType: sheet.mimeType })),
			thumb: thumbCanvas.toDataURL("image/jpeg", 0.7),
			note: `[Attached video: ${file.name}, ${formatFrameTime(endMs)} long — ${frames.length} scene-detected keyframes tiled into the attached contact sheet(s); each cell's label '#n m:ss.s' is its timestamp inside the ATTACHED video, not the project timeline.]`,
		};
	} finally {
		URL.revokeObjectURL(url);
	}
}

export async function processAttachmentFile(file: File): Promise<OutgoingAttachment> {
	if (file.type.startsWith("image/")) return processImage(file);
	if (file.type.startsWith("video/")) return processVideo(file);
	throw new Error(`unsupported attachment type: ${file.type || "unknown"}`);
}
