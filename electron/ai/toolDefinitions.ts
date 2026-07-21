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

const captionStyleFields = {
	color: z
		.string()
		.max(50)
		.optional()
		.describe("Text color: #hex, rgb()/rgba(), hsl()/hsla(), or 'transparent'."),
	backgroundColor: z
		.string()
		.max(50)
		.optional()
		.describe(
			"Box color behind each line: e.g. 'rgba(0,0,0,0.6)' (the default dim box), '#7C5CFF', or 'transparent' for bare text.",
		),
	fontSize: z
		.number()
		.min(16)
		.max(192)
		.optional()
		.describe(
			"Font size in px at a 1080p-tall reference frame; every render scales it to the actual frame, so the caption keeps the same proportion at any size. Default 48 (~4.5% of frame height); 64+ reads as a headline.",
		),
	fontWeight: z
		.union([z.enum(["normal", "bold"]), z.number().min(100).max(900)])
		.optional()
		.describe(
			"'normal', 'bold', or a numeric weight 100-900 (e.g. 800 for extra-bold, 900 for black). The nearest face the font family provides is used.",
		),
	fontFamily: z
		.string()
		.max(60)
		.optional()
		.describe(
			"Font family name, e.g. 'Inter' (default), 'Arial Black', 'Impact', 'Georgia, serif'. Must be installed on the user's system.",
		),
	fontStyle: z.enum(["normal", "italic"]).optional(),
	boxPaddingX: z
		.number()
		.min(0)
		.max(2)
		.optional()
		.describe("Caption box horizontal padding in em (default 0.2 — e.g. 0.4 doubles it)."),
	boxPaddingY: z
		.number()
		.min(0)
		.max(2)
		.optional()
		.describe("Caption box vertical padding in em (default 0.1)."),
	boxRadius: z
		.number()
		.min(0)
		.max(48)
		.optional()
		.describe("Caption box corner radius in px (default 4)."),
	boxShadow: z
		.number()
		.min(0)
		.max(1)
		.optional()
		.describe(
			"Drop-shadow strength behind the caption box, 0 (none, default) to 1. Only visible when the box has a background color.",
		),
	textAlign: z.enum(["left", "center", "right"]).optional(),
	textAnimation: z
		.enum(["none", "fade", "rise", "pop", "slide-left", "typewriter", "pulse"])
		.optional()
		.describe("Entrance animation. 'pop' with short 1-3 word lines gives a word-pop feel."),
	position: z
		.enum(["bottom", "middle", "top"])
		.optional()
		.describe("Vertical placement preset (default bottom)."),
};

const captionStyleObject = z.object(captionStyleFields);

const captionMotionField = z
	.object({
		toAnchor: z
			.enum(["top", "middle", "bottom"])
			.optional()
			.describe(
				"Semantic destination: travel to the top band, vertical center, or bottom caption line. Prefer this over toPosition whenever the user says 'to the center/top/bottom' — no coordinate math needed. Overrides toPosition if both are given.",
			),
		toPosition: z
			.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) })
			.optional()
			.describe(
				"Destination top-left corner as % of the frame, in SCREEN coordinates: y=0 is the TOP edge, y=100 the BOTTOM — a larger y moves the caption DOWN (not up). Rough anchors: y≈5 top band, y≈40 vertical center, y≈80 bottom caption line. x grows rightward.",
			),
		toFontSize: z
			.number()
			.min(16)
			.max(192)
			.optional()
			.describe("Destination font size (px @1080p reference, same unit as style.fontSize)."),
		toSize: z
			.object({ width: z.number().min(1).max(100), height: z.number().min(1).max(100) })
			.optional()
			.describe("Destination box size as % of frame."),
		startMs: z.number().optional().describe("When the move starts (default: caption start)."),
		endMs: z.number().optional().describe("When the move ends (default: caption end)."),
	})
	.optional()
	.describe(
		"Animate the caption from its base position/size/fontSize to these targets over the span — e.g. center at 1s drifting to the lower third by 3s.",
	);

const exitAnimationField = z
	.enum(["none", "fade", "rise", "pop", "slide-left", "typewriter", "pulse"])
	.optional()
	.describe("Exit animation played in the caption's tail (the entrance curve in reverse).");

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
			"SEE the recording as images. Without timestamps: scans the video with scene-change detection, dedups near-identical frames, and returns keyframes packed into labelled contact sheets (each cell shows '#n m:ss.s' — its exact source timestamp). This storyboard mode is the best first look at any video. With timestamps: captures full-resolution stills at those exact moments (max 8 per call) — use for close-ups after the storyboard.",
		shape: {
			timestamps: z
				.array(z.number())
				.min(1)
				.max(8)
				.optional()
				.describe("Timeline positions in ms for full-res stills. Omit for auto keyframes."),
			startMs: z.number().optional().describe("Auto mode: only scan from this time."),
			endMs: z.number().optional().describe("Auto mode: only scan up to this time."),
			maxFrames: z
				.number()
				.int()
				.min(4)
				.max(45)
				.optional()
				.describe("Auto mode: cap on kept keyframes (default 27 = 3 sheets)."),
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
		description:
			"Add playback-speed regions (e.g. 2 = double speed, 0.5 = half speed). Optional rampInMs/rampOutMs give a smooth accelerate-in / decelerate-out instead of a hard cut — the ramp eases from the touching neighbor region's speed (or 1x) into this region's speed and back out, so speeds flow into each other. Prefer one region with ramps over many stepped regions.",
		shape: {
			regions: z
				.array(
					z.object({
						...spanFields,
						speed: z.number().min(0.25).max(100).describe("Playback speed multiplier."),
						rampInMs: z
							.number()
							.min(0)
							.max(5000)
							.optional()
							.describe("Ease-in duration (ms) accelerating from the previous speed to this one."),
						rampOutMs: z
							.number()
							.min(0)
							.max(5000)
							.optional()
							.describe("Ease-out duration (ms) decelerating from this speed to the next one."),
					}),
				)
				.min(1),
		},
		emitChips: true,
	},
	{
		name: "update_speed_region",
		description:
			"Update an existing speed region by id. Only the provided fields change. Set rampInMs/rampOutMs for a smooth accelerate/decelerate; 0 removes a ramp.",
		shape: {
			id: z.string(),
			startMs: z.number().optional(),
			endMs: z.number().optional(),
			speed: z.number().min(0.25).max(100).optional(),
			rampInMs: z.number().min(0).max(5000).optional(),
			rampOutMs: z.number().min(0).max(5000).optional(),
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
		name: "add_effects",
		description:
			"Add full-frame video effects over a time span: fadeIn (black→video), fadeOut (video→black), blur (whole frame), dim (darken). A fadeIn at the very start and a fadeOut at the very end are the usual intro/outro. intensity = blur radius px (default 8) or dim opacity 0-1 (default 0.45); ignored by fades. Batch related effects into one call.",
		shape: {
			effects: z
				.array(
					z.object({
						...spanFields,
						type: z.enum(["fadeIn", "fadeOut", "blur", "dim"]),
						intensity: z
							.number()
							.min(0)
							.max(40)
							.optional()
							.describe("blur radius in px, or dim opacity 0-1. Ignored by fades."),
					}),
				)
				.min(1),
		},
		emitChips: true,
	},
	{
		name: "update_effect",
		description: "Update a video effect by id. Only the provided fields change.",
		shape: {
			id: z.string(),
			startMs: z.number().optional(),
			endMs: z.number().optional(),
			type: z.enum(["fadeIn", "fadeOut", "blur", "dim"]).optional(),
			intensity: z.number().min(0).max(40).optional(),
		},
		emitChips: true,
	},
	{
		name: "delete_effects",
		description: "Delete video effects by id. Batch deletions into a single call.",
		shape: { ids: z.array(z.string()).min(1) },
		emitChips: true,
	},
	{
		name: "add_captions",
		description:
			"Add subtitle/caption text overlays to the video. Default look: bold white text on a dim rounded box, bottom-center (same as auto-captions). Each entry is one caption line shown for its span; emoji in the text render fine. Pass style to override the design for every line in the call. Batch a full subtitle track into one call — one call is one undo step.",
		shape: {
			captions: z
				.array(
					z.object({
						...spanFields,
						text: z
							.string()
							.min(1)
							.max(200)
							.describe(
								"Caption line text. Color individual words inline with {#hex|words} — e.g. 'Turn {#FFD700|raw} recordings into demos'. Everything else uses style.color.",
							),
						motion: captionMotionField,
						exitAnimation: exitAnimationField,
					}),
				)
				.min(1),
			style: captionStyleObject
				.optional()
				.describe("Design override applied to every caption in this call."),
		},
		emitChips: true,
	},
	{
		name: "update_caption",
		description:
			"Update a caption/text annotation by id. Only the provided fields change; style fields merge into the existing design. Use motion to make it travel/resize across its span and exitAnimation for how it leaves.",
		shape: {
			id: z.string(),
			startMs: z.number().optional(),
			endMs: z.number().optional(),
			text: z.string().min(1).max(200).optional(),
			style: captionStyleObject.optional(),
			motion: captionMotionField,
			exitAnimation: exitAnimationField,
		},
		emitChips: true,
	},
	{
		name: "set_caption_style",
		description:
			"Restyle existing captions without changing their text or timing: text/box colors (dim box via backgroundColor rgba), font size/family/weight (numeric weights supported), alignment, entrance animation, vertical position, and box shape (padding in em, corner radius in px). Omit ids to restyle every caption at once. One call is one undo step.",
		shape: {
			ids: z
				.array(z.string())
				.min(1)
				.optional()
				.describe("Target caption ids from get_project_context; omit for all captions."),
			style: captionStyleObject.describe("Design fields to apply."),
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
