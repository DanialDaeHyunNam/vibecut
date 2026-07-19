import { randomUUID } from "node:crypto";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AiChatEvent, AiToolExecutor } from "./providers/types";

export const CINEREC_MCP_SERVER_NAME = "cinerec";

/**
 * Editor tool definitions in a provider-neutral registry. Two consumers build
 * from the same specs: the Claude Agent SDK's in-process MCP server
 * (createCinerecTools) and the stdio MCP bridge handed to external CLIs like
 * Codex/Gemini (listToolJsonSchemas via the tool host). Handlers do no editing
 * themselves — every call is forwarded verbatim to the renderer executor
 * (aiCommandExecutor.ts), which owns validation/clamping and applies mutations
 * through the editor's pushState so each mutating call is one undo checkpoint.
 * Mutating tools are array-shaped so batch edits ("zoom on every click") land
 * as a single checkpoint.
 */

export interface CinerecToolSpec {
	name: string;
	description: string;
	shape: z.ZodRawShape;
	/**
	 * ask_user renders as an interactive question card in the chat instead of
	 * a start/end tool chip, so it opts out of chip events.
	 */
	emitChips: boolean;
}

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

export const cinerecToolSpecs: CinerecToolSpec[] = [
	{
		name: "get_project_context",
		description:
			"Get the current project state: video duration, aspect ratio, all existing zoom/trim/speed regions, and whether cursor telemetry (click data) is available. Call this before making edits.",
		shape: {},
		emitChips: true,
	},
	{
		name: "get_click_events",
		description:
			"Get the user's recorded mouse clicks (time + normalized position). Use this to place zooms at the exact moment and location of a click when the user references one ('when I click the button around 3s').",
		shape: {
			startMs: z.number().optional().describe("Only clicks at/after this time."),
			endMs: z.number().optional().describe("Only clicks at/before this time."),
		},
		emitChips: true,
	},
	{
		name: "get_video_frames",
		description:
			"Capture frames from the recording at the given timestamps and SEE them as images. Use this to understand what is actually on screen (which app, which button, what text) before making content-based editing decisions. Max 8 timestamps per call.",
		shape: {
			timestamps: z
				.array(z.number())
				.min(1)
				.max(8)
				.describe("Timeline positions in milliseconds to capture."),
		},
		emitChips: true,
	},
	{
		name: "add_zooms",
		description:
			"Add one or more zoom regions. Omit cx/cy to auto-follow the cursor; provide them to zoom into a fixed point. Batch all zooms from one request into a single call — each call is one undo step.",
		shape: {
			zooms: z
				.array(z.object({ ...spanFields, ...zoomFields }))
				.min(1)
				.describe("Zoom regions to create."),
		},
		emitChips: true,
	},
	{
		name: "update_zoom",
		description: "Update an existing zoom region by id. Only the provided fields change.",
		shape: {
			id: z.string().describe("Zoom region id from get_project_context."),
			startMs: z.number().optional(),
			endMs: z.number().optional(),
			...zoomFields,
		},
		emitChips: true,
	},
	{
		name: "delete_zooms",
		description: "Delete zoom regions by id. Batch deletions into a single call.",
		shape: { ids: z.array(z.string()).min(1) },
		emitChips: true,
	},
	{
		name: "add_trims",
		description: "Add trim (cut) regions — these spans are removed from the final video.",
		shape: {
			trims: z.array(z.object(spanFields)).min(1).describe("Spans to cut out."),
		},
		emitChips: true,
	},
	{
		name: "delete_trims",
		description: "Delete trim regions by id.",
		shape: { ids: z.array(z.string()).min(1) },
		emitChips: true,
	},
	{
		name: "add_speed_regions",
		description: "Add playback-speed regions (e.g. 2 = double speed, 0.5 = half speed).",
		shape: {
			regions: z
				.array(
					z.object({
						...spanFields,
						speed: z.number().min(0.25).max(100).describe("Playback speed multiplier."),
					}),
				)
				.min(1),
		},
		emitChips: true,
	},
	{
		name: "update_speed_region",
		description: "Update an existing speed region by id. Only the provided fields change.",
		shape: {
			id: z.string(),
			startMs: z.number().optional(),
			endMs: z.number().optional(),
			speed: z.number().min(0.25).max(100).optional(),
		},
		emitChips: true,
	},
	{
		name: "delete_speed_regions",
		description: "Delete speed regions by id.",
		shape: { ids: z.array(z.string()).min(1) },
		emitChips: true,
	},
	{
		name: "add_captions",
		description:
			"Add subtitle/caption text overlays to the video (bottom-center, styled like auto-captions). Each entry is one caption line shown for its span. Batch a full subtitle track into one call — one call is one undo step.",
		shape: {
			captions: z
				.array(
					z.object({
						...spanFields,
						text: z.string().min(1).max(200).describe("Caption line text."),
					}),
				)
				.min(1),
		},
		emitChips: true,
	},
	{
		name: "update_caption",
		description: "Update a caption/text annotation by id. Only the provided fields change.",
		shape: {
			id: z.string(),
			startMs: z.number().optional(),
			endMs: z.number().optional(),
			text: z.string().min(1).max(200).optional(),
		},
		emitChips: true,
	},
	{
		name: "delete_captions",
		description: "Delete caption/text annotations by id.",
		shape: { ids: z.array(z.string()).min(1) },
		emitChips: true,
	},
	{
		name: "set_style",
		description:
			"Change the video's frame styling. Only provided fields change. wallpaper accepts wallpaper1..wallpaper18 (built-in images), a hex/rgb/hsl color, or a CSS gradient string.",
		shape: {
			wallpaper: z
				.string()
				.optional()
				.describe("wallpaper1..18, '#0f172a', or 'linear-gradient(135deg, #667eea, #764ba2)'"),
			padding: z.number().min(0).max(100).optional().describe("Frame padding percent."),
			shadowIntensity: z.number().min(0).max(1).optional(),
			borderRadius: z.number().min(0).max(64).optional(),
			motionBlurAmount: z.number().min(0).max(1).optional().describe("Zoom motion blur strength."),
			webcamLayoutPreset: z.enum(["picture-in-picture", "vertical-stack", "dual-frame"]).optional(),
			webcamMaskShape: z.enum(["rectangle", "circle", "square", "rounded"]).optional(),
			webcamSizePreset: z.number().min(10).max(50).optional().describe("Webcam PIP size percent."),
			webcamPosition: z
				.object({ cx: z.number().min(0).max(1), cy: z.number().min(0).max(1) })
				.optional()
				.describe("Webcam PIP center, normalized 0-1."),
		},
		emitChips: true,
	},
	{
		name: "get_transcript",
		description:
			"Transcribe the microphone narration of the recording (on-device Whisper). Returns timed text segments. Use it to align captions and cuts with what the user actually says. The first call can take up to a couple of minutes; results are cached.",
		shape: {},
		emitChips: true,
	},
	{
		name: "export_captions_srt",
		description:
			"Export the current caption track as a standard SubRip (.srt) subtitle file. Opens a save dialog for the user to pick the destination. Use when the user wants the subtitles as a separate file for other services (YouTube, editors, players).",
		shape: {
			suggestedName: z
				.string()
				.max(80)
				.optional()
				.describe("Suggested file name without extension."),
		},
		emitChips: true,
	},
	{
		name: "restyle_webcam",
		description:
			"Transform the webcam overlay video with generative AI (Decart Lucy): restyle the person or scene from a text prompt, e.g. 'make me a marble statue', 'anime style', 'wearing a spacesuit'. Requires a webcam recording and a saved Decart API key. Processing takes roughly as long as the clip and costs the user per second — confirm with ask_user before running on long clips. The transformed video replaces the webcam overlay (one undo step); the original file is kept on disk.",
		shape: {
			prompt: z
				.string()
				.min(4)
				.max(500)
				.describe("What to transform the webcam video into, in English."),
		},
		emitChips: true,
	},
	{
		name: "ask_user",
		description:
			"Ask the user one or more multiple-choice questions and wait for their answer (renders as selectable option cards in the chat). Use whenever the user's intent is ambiguous, before large destructive edits, or to confirm editing preferences. Keep options concrete and mutually exclusive; the user can always type a custom answer.",
		shape: {
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
		emitChips: false,
	},
];

export interface CinerecToolResult {
	ok: boolean;
	content: string;
	summary?: string;
	images?: Array<{ data: string; mimeType: string }>;
}

/**
 * Run one tool call, surrounding it with the chat UI's start/end chip events
 * (unless the spec opts out). Shared by the SDK server and the tool host so
 * tool chips render identically for every provider.
 */
export async function executeToolWithEvents(
	spec: CinerecToolSpec,
	execute: AiToolExecutor,
	onEvent: (event: AiChatEvent) => void,
	input: unknown,
): Promise<CinerecToolResult> {
	if (!spec.emitChips) {
		return execute(spec.name, input);
	}
	const toolCallId = randomUUID();
	onEvent({ type: "tool-start", toolCallId, name: spec.name, input });
	const result = await execute(spec.name, input);
	onEvent({ type: "tool-end", toolCallId, ok: result.ok, summary: result.summary });
	return result;
}

/** Build the Agent SDK tool set for the in-process MCP server (Claude path). */
export function createCinerecTools(execute: AiToolExecutor, onEvent: (event: AiChatEvent) => void) {
	return cinerecToolSpecs.map((spec) =>
		tool(spec.name, spec.description, spec.shape, async (args) => {
			const result = await executeToolWithEvents(spec, execute, onEvent, args);
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
		}),
	);
}

export function allowedToolNames(): string[] {
	return cinerecToolSpecs.map((spec) => `mcp__${CINEREC_MCP_SERVER_NAME}__${spec.name}`);
}

export interface CinerecToolJsonSchema {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

/**
 * JSON Schema view of the registry for MCP clients outside this process
 * (served to the stdio bridge over the tool host socket). Uses zod v4's
 * native JSON Schema conversion, so the schemas stay in lockstep with what
 * the Claude path enforces.
 */
export function listToolJsonSchemas(): CinerecToolJsonSchema[] {
	return cinerecToolSpecs.map((spec) => {
		const schema = z.toJSONSchema(z.object(spec.shape)) as Record<string, unknown>;
		// MCP inputSchema is a bare object schema; the meta key is just noise.
		delete schema.$schema;
		return { name: spec.name, description: spec.description, inputSchema: schema };
	});
}
