import { useEffect, useRef } from "react";
import { type AiCommandContext, executeAiCommand } from "@/components/ai-chat/aiCommandExecutor";
import { captureVideoFrames } from "@/components/ai-chat/videoFrameCapture";
import type { EditorState } from "@/hooks/useEditorHistory";
import { extractMono16kFromVideoUrl, transcribeMono16kToSegments } from "@/lib/captioning";
import { captionsToSrt, extractCaptionRegions } from "@/lib/captioning/srt";

/** Whisper runs take a while — cache the transcript per video URL. */
const transcriptCache = new Map<string, Array<{ startMs: number; endMs: number; text: string }>>();

async function getTranscriptSegments(videoUrl: string) {
	const cached = transcriptCache.get(videoUrl);
	if (cached) return cached;
	const { samples } = await extractMono16kFromVideoUrl(videoUrl);
	const { segments } = await transcribeMono16kToSegments(samples);
	const mapped = segments
		.map((segment) => ({
			startMs: Math.round(segment.startSec * 1000),
			endMs: Math.round(segment.endSec * 1000),
			text: segment.text.trim(),
		}))
		.filter((segment) => segment.text.length > 0)
		.slice(0, 500);
	transcriptCache.set(videoUrl, mapped);
	return mapped;
}

interface AiToolHostParams {
	/** Latest editor state — read through a ref so the subscription stays stable. */
	getState: () => EditorState;
	getContext: () => AiCommandContext;
	pushState: (update: Partial<EditorState>) => void;
	/** Object URL / file URL of the loaded recording (null before load). */
	getVideoUrl: () => string | null;
	/** Raw path of the current webcam source (override wins; null = no webcam). */
	getWebcamSourcePath: () => string | null;
}

const MAX_FRAMES_PER_CALL = 8;

/**
 * Renderer side of the AI tool bridge: listens for `ai:tool-call` from the
 * main-process agent, runs the command through the pure executor against the
 * current editor state, applies mutations via pushState (one call = one undo
 * checkpoint), and replies on `ai:tool-result`. get_video_frames is handled
 * here (not in the pure executor) because it is async and touches the DOM.
 */
export function useAiToolHost({
	getState,
	getContext,
	pushState,
	getVideoUrl,
	getWebcamSourcePath,
}: AiToolHostParams): void {
	const paramsRef = useRef({ getState, getContext, pushState, getVideoUrl, getWebcamSourcePath });
	paramsRef.current = { getState, getContext, pushState, getVideoUrl, getWebcamSourcePath };

	useEffect(() => {
		const unsubscribe = window.electronAPI.onAiToolCall(async (call) => {
			// ask_user renders as an interactive card; useAiChat owns its reply.
			if (call.name === "ask_user") return;
			const { getState, getContext, pushState, getVideoUrl, getWebcamSourcePath } =
				paramsRef.current;
			try {
				if (call.name === "get_video_frames") {
					const videoUrl = getVideoUrl();
					if (!videoUrl) {
						window.electronAPI.aiToolResult({
							callId: call.callId,
							ok: false,
							content: JSON.stringify({ error: "no video is loaded" }),
						});
						return;
					}
					const input = (call.input ?? {}) as { timestamps?: unknown };
					const timestamps = (Array.isArray(input.timestamps) ? input.timestamps : [])
						.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
						.slice(0, MAX_FRAMES_PER_CALL);
					if (timestamps.length === 0) {
						window.electronAPI.aiToolResult({
							callId: call.callId,
							ok: false,
							content: JSON.stringify({ error: "timestamps must be a non-empty number array" }),
						});
						return;
					}
					const frames = await captureVideoFrames(videoUrl, timestamps);
					window.electronAPI.aiToolResult({
						callId: call.callId,
						ok: true,
						content: JSON.stringify({
							frames: frames.map((frame, index) => ({
								index,
								timeMs: frame.timeMs,
							})),
							note: "Frames are attached as images in timestamp order.",
						}),
						summary: `${frames.length} frames`,
						images: frames.map((frame) => ({ data: frame.data, mimeType: frame.mimeType })),
					});
					return;
				}

				if (call.name === "get_transcript") {
					const videoUrl = getVideoUrl();
					if (!videoUrl) {
						window.electronAPI.aiToolResult({
							callId: call.callId,
							ok: false,
							content: JSON.stringify({ error: "no video is loaded" }),
						});
						return;
					}
					const segments = await getTranscriptSegments(videoUrl);
					window.electronAPI.aiToolResult({
						callId: call.callId,
						ok: true,
						content: JSON.stringify({
							segments,
							note: segments.length === 0 ? "No speech detected." : undefined,
						}),
						summary: `${segments.length}`,
					});
					return;
				}

				if (call.name === "restyle_webcam") {
					const sourcePath = getWebcamSourcePath();
					if (!sourcePath) {
						window.electronAPI.aiToolResult({
							callId: call.callId,
							ok: false,
							content: JSON.stringify({ error: "this project has no webcam recording" }),
						});
						return;
					}
					const input = (call.input ?? {}) as { prompt?: unknown };
					if (typeof input.prompt !== "string" || input.prompt.trim().length < 4) {
						window.electronAPI.aiToolResult({
							callId: call.callId,
							ok: false,
							content: JSON.stringify({
								error: "prompt must be a string of at least 4 characters",
							}),
						});
						return;
					}
					const restyled = await window.electronAPI.aiRestyleWebcam({
						sourcePath,
						prompt: input.prompt.trim(),
					});
					if (restyled.success && restyled.path) {
						// One undo step: the override swaps the webcam source in
						// preview and export; undo restores the previous source.
						pushState({ webcamSourceOverridePath: restyled.path });
					}
					window.electronAPI.aiToolResult({
						callId: call.callId,
						ok: restyled.success,
						content: JSON.stringify(
							restyled.success
								? {
										path: restyled.path,
										note: "Webcam overlay now plays the restyled video. Undo restores the original.",
									}
								: { error: restyled.error },
						),
						summary: restyled.success ? "restyled" : undefined,
					});
					return;
				}

				if (call.name === "export_captions_srt") {
					const captions = extractCaptionRegions(getState().annotationRegions);
					if (captions.length === 0) {
						window.electronAPI.aiToolResult({
							callId: call.callId,
							ok: false,
							content: JSON.stringify({ error: "there are no captions to export" }),
						});
						return;
					}
					const input = (call.input ?? {}) as { suggestedName?: unknown };
					const saved = await window.electronAPI.saveSrtDialog(
						captionsToSrt(captions),
						typeof input.suggestedName === "string" ? input.suggestedName : "captions",
					);
					window.electronAPI.aiToolResult({
						callId: call.callId,
						ok: saved.success,
						content: JSON.stringify(
							saved.success
								? { path: saved.path, captionCount: captions.length }
								: { error: saved.canceled ? "user canceled the save dialog" : saved.error },
						),
						summary: saved.success ? `${captions.length}줄` : undefined,
					});
					return;
				}

				const result = executeAiCommand(call.name, call.input, getState(), getContext());
				if (result.partial) {
					pushState(result.partial);
				}
				window.electronAPI.aiToolResult({
					callId: call.callId,
					ok: result.ok,
					content: result.content,
					summary: result.summary,
				});
			} catch (error) {
				window.electronAPI.aiToolResult({
					callId: call.callId,
					ok: false,
					content: JSON.stringify({
						error: error instanceof Error ? error.message : String(error),
					}),
				});
			}
		});
		return unsubscribe;
	}, []);
}
