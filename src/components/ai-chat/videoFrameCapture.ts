/**
 * Captures still frames from the loaded recording for the AI agent's
 * get_video_frames tool. Uses a detached <video> element so grabbing frames
 * never scrubs the visible preview player. Frames are downscaled and JPEG
 * encoded to keep the IPC payload and model context small.
 */

const MAX_FRAME_WIDTH = 768;
const JPEG_QUALITY = 0.7;
const SEEK_TIMEOUT_MS = 4_000;

export interface CapturedFrame {
	timeMs: number;
	data: string;
	mimeType: string;
}

function waitForEvent(target: EventTarget, event: string, timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`timed out waiting for ${event}`));
		}, timeoutMs);
		const onEvent = () => {
			cleanup();
			resolve();
		};
		const onError = () => {
			cleanup();
			reject(new Error("video failed to load"));
		};
		function cleanup() {
			clearTimeout(timer);
			target.removeEventListener(event, onEvent);
			target.removeEventListener("error", onError);
		}
		target.addEventListener(event, onEvent, { once: true });
		target.addEventListener("error", onError, { once: true });
	});
}

export async function captureVideoFrames(
	videoUrl: string,
	timestampsMs: number[],
): Promise<CapturedFrame[]> {
	const video = document.createElement("video");
	video.muted = true;
	video.preload = "auto";
	video.src = videoUrl;

	try {
		if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
			await waitForEvent(video, "loadedmetadata", SEEK_TIMEOUT_MS);
		}

		const durationMs = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
		const width = Math.min(MAX_FRAME_WIDTH, video.videoWidth || MAX_FRAME_WIDTH);
		const height = Math.round(width * ((video.videoHeight || 9) / (video.videoWidth || 16)));
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("2d canvas unavailable");

		const frames: CapturedFrame[] = [];
		for (const rawTimeMs of timestampsMs) {
			const timeMs = Math.max(0, Math.min(rawTimeMs, Math.max(0, durationMs - 50)));
			video.currentTime = timeMs / 1000;
			await waitForEvent(video, "seeked", SEEK_TIMEOUT_MS);
			context.drawImage(video, 0, 0, width, height);
			const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
			frames.push({
				timeMs: Math.round(timeMs),
				data: dataUrl.slice(dataUrl.indexOf(",") + 1),
				mimeType: "image/jpeg",
			});
		}
		return frames;
	} finally {
		video.removeAttribute("src");
		video.load();
	}
}
