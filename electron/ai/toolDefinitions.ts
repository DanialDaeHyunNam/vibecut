import { randomUUID } from "node:crypto";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AiChatEvent, AiToolExecutor } from "./providers/types";

export const CINEREC_MCP_SERVER_NAME = "cinerec";

/**
 * Editor tool definitions exposed to the model as an in-process MCP server.
 * Handlers do no editing themselves — every call is forwarded verbatim to the
 * renderer executor (aiCommandExecutor.ts), which owns validation/clamping and
 * applies mutations through the editor's pushState so each mutating call is
 * one undo checkpoint. Mutating tools are array-shaped so batch edits ("zoom
 * on every click") land as a single checkpoint.
 */

const zoomFields = {
	depth: z
		.number()
		.int()
		.min(1)
		.max(6)
		.optional()
		.describe("Zoom depth preset 1 (subtle) to 6 (max). Default 3."),
	customScale: z
		.number()
		.min(1.0)
		.max(5.0)
		.optional()
		.describe("Exact zoom scale 1.0-5.0. Overrides depth when given."),
	cx: z.number().min(0).max(1).optional().describe("Zoom focus center X, normalized 0-1."),
	cy: z.number().min(0).max(1).optional().describe("Zoom focus center Y, normalized 0-1."),
};

const spanFields = {
	startMs: z.number().describe("Span start in milliseconds."),
	endMs: z.number().describe("Span end in milliseconds."),
};

export function createCinerecTools(execute: AiToolExecutor, onEvent: (event: AiChatEvent) => void) {
	/** Wrap a handler so the renderer chat UI sees start/end chip events. */
	function run(name: string, input: unknown) {
		const toolCallId = randomUUID();
		onEvent({ type: "tool-start", toolCallId, name, input });
		return execute(name, input).then((result) => {
			onEvent({ type: "tool-end", toolCallId, ok: result.ok, summary: result.summary });
			return {
				content: [
					{ type: "text" as const, text: result.content },
					...(result.images ?? []).map((image) => ({
						type: "image" as const,
						data: image.data,
						mimeType: image.mimeType,
					})),
				],
				isError: !result.ok,
			};
		});
	}

	return [
		tool(
			"get_project_context",
			"Get the current project state: video duration, aspect ratio, all existing zoom/trim/speed regions, and whether cursor telemetry (click data) is available. Call this before making edits.",
			{},
			(args) => run("get_project_context", args),
		),
		tool(
			"get_click_events",
			"Get the user's recorded mouse clicks (time + normalized position). Use this to place zooms at the exact moment and location of a click when the user references one ('when I click the button around 3s').",
			{
				startMs: z.number().optional().describe("Only clicks at/after this time."),
				endMs: z.number().optional().describe("Only clicks at/before this time."),
			},
			(args) => run("get_click_events", args),
		),
		tool(
			"get_video_frames",
			"Capture frames from the recording at the given timestamps and SEE them as images. Use this to understand what is actually on screen (which app, which button, what text) before making content-based editing decisions. Max 8 timestamps per call.",
			{
				timestamps: z
					.array(z.number())
					.min(1)
					.max(8)
					.describe("Timeline positions in milliseconds to capture."),
			},
			(args) => run("get_video_frames", args),
		),
		tool(
			"add_zooms",
			"Add one or more zoom regions. Omit cx/cy to auto-follow the cursor; provide them to zoom into a fixed point. Batch all zooms from one request into a single call — each call is one undo step.",
			{
				zooms: z
					.array(z.object({ ...spanFields, ...zoomFields }))
					.min(1)
					.describe("Zoom regions to create."),
			},
			(args) => run("add_zooms", args),
		),
		tool(
			"update_zoom",
			"Update an existing zoom region by id. Only the provided fields change.",
			{
				id: z.string().describe("Zoom region id from get_project_context."),
				startMs: z.number().optional(),
				endMs: z.number().optional(),
				...zoomFields,
			},
			(args) => run("update_zoom", args),
		),
		tool(
			"delete_zooms",
			"Delete zoom regions by id. Batch deletions into a single call.",
			{ ids: z.array(z.string()).min(1) },
			(args) => run("delete_zooms", args),
		),
		tool(
			"add_trims",
			"Add trim (cut) regions — these spans are removed from the final video.",
			{
				trims: z.array(z.object(spanFields)).min(1).describe("Spans to cut out."),
			},
			(args) => run("add_trims", args),
		),
		tool(
			"delete_trims",
			"Delete trim regions by id.",
			{ ids: z.array(z.string()).min(1) },
			(args) => run("delete_trims", args),
		),
		tool(
			"add_speed_regions",
			"Add playback-speed regions (e.g. 2 = double speed, 0.5 = half speed).",
			{
				regions: z
					.array(
						z.object({
							...spanFields,
							speed: z.number().min(0.25).max(100).describe("Playback speed multiplier."),
						}),
					)
					.min(1),
			},
			(args) => run("add_speed_regions", args),
		),
		tool(
			"update_speed_region",
			"Update an existing speed region by id. Only the provided fields change.",
			{
				id: z.string(),
				startMs: z.number().optional(),
				endMs: z.number().optional(),
				speed: z.number().min(0.25).max(100).optional(),
			},
			(args) => run("update_speed_region", args),
		),
		tool(
			"delete_speed_regions",
			"Delete speed regions by id.",
			{ ids: z.array(z.string()).min(1) },
			(args) => run("delete_speed_regions", args),
		),
		tool(
			"add_captions",
			"Add subtitle/caption text overlays to the video (bottom-center, styled like auto-captions). Each entry is one caption line shown for its span. Batch a full subtitle track into one call — one call is one undo step.",
			{
				captions: z
					.array(
						z.object({
							...spanFields,
							text: z.string().min(1).max(200).describe("Caption line text."),
						}),
					)
					.min(1),
			},
			(args) => run("add_captions", args),
		),
		tool(
			"update_caption",
			"Update a caption/text annotation by id. Only the provided fields change.",
			{
				id: z.string(),
				startMs: z.number().optional(),
				endMs: z.number().optional(),
				text: z.string().min(1).max(200).optional(),
			},
			(args) => run("update_caption", args),
		),
		tool(
			"delete_captions",
			"Delete caption/text annotations by id.",
			{ ids: z.array(z.string()).min(1) },
			(args) => run("delete_captions", args),
		),
		tool(
			"set_style",
			"Change the video's frame styling. Only provided fields change. wallpaper accepts wallpaper1..wallpaper18 (built-in images), a hex/rgb/hsl color, or a CSS gradient string.",
			{
				wallpaper: z
					.string()
					.optional()
					.describe("wallpaper1..18, '#0f172a', or 'linear-gradient(135deg, #667eea, #764ba2)'"),
				padding: z.number().min(0).max(100).optional().describe("Frame padding percent."),
				shadowIntensity: z.number().min(0).max(1).optional(),
				borderRadius: z.number().min(0).max(64).optional(),
				motionBlurAmount: z
					.number()
					.min(0)
					.max(1)
					.optional()
					.describe("Zoom motion blur strength."),
				webcamLayoutPreset: z
					.enum(["picture-in-picture", "vertical-stack", "dual-frame"])
					.optional(),
				webcamMaskShape: z.enum(["rectangle", "circle", "square", "rounded"]).optional(),
				webcamSizePreset: z
					.number()
					.min(10)
					.max(50)
					.optional()
					.describe("Webcam PIP size percent."),
				webcamPosition: z
					.object({ cx: z.number().min(0).max(1), cy: z.number().min(0).max(1) })
					.optional()
					.describe("Webcam PIP center, normalized 0-1."),
			},
			(args) => run("set_style", args),
		),
		tool(
			"get_transcript",
			"Transcribe the microphone narration of the recording (on-device Whisper). Returns timed text segments. Use it to align captions and cuts with what the user actually says. The first call can take up to a couple of minutes; results are cached.",
			{},
			(args) => run("get_transcript", args),
		),
		tool(
			"export_captions_srt",
			"Export the current caption track as a standard SubRip (.srt) subtitle file. Opens a save dialog for the user to pick the destination. Use when the user wants the subtitles as a separate file for other services (YouTube, editors, players).",
			{
				suggestedName: z
					.string()
					.max(80)
					.optional()
					.describe("Suggested file name without extension."),
			},
			(args) => run("export_captions_srt", args),
		),
		tool(
			"ask_user",
			"Ask the user one or more multiple-choice questions and wait for their answer (renders as selectable option cards in the chat). Use whenever the user's intent is ambiguous, before large destructive edits, or to confirm editing preferences. Keep options concrete and mutually exclusive; the user can always type a custom answer.",
			{
				questions: z
					.array(
						z.object({
							question: z.string().max(300).describe("The full question, ending with ?"),
							header: z.string().max(16).optional().describe("Short chip label, e.g. '자막 언어'"),
							multiSelect: z.boolean().optional(),
							options: z
								.array(
									z.object({
										label: z.string().max(60),
										description: z.string().max(150).optional(),
									}),
								)
								.min(2)
								.max(5),
						}),
					)
					.min(1)
					.max(3),
			},
			// No chip events — the question itself renders as a card in the chat.
			(args) =>
				execute("ask_user", args).then((result) => ({
					content: [{ type: "text" as const, text: result.content }],
					isError: !result.ok,
				})),
		),
	];
}

export function allowedToolNames(): string[] {
	// Keep in sync with the tool names above; used for the SDK allowedTools list.
	return [
		"get_project_context",
		"get_click_events",
		"get_video_frames",
		"add_zooms",
		"update_zoom",
		"delete_zooms",
		"add_trims",
		"delete_trims",
		"add_speed_regions",
		"update_speed_region",
		"delete_speed_regions",
		"add_captions",
		"update_caption",
		"delete_captions",
		"set_style",
		"get_transcript",
		"export_captions_srt",
		"ask_user",
	].map((name) => `mcp__${CINEREC_MCP_SERVER_NAME}__${name}`);
}
