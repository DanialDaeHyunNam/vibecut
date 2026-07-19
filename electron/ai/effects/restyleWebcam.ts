import fs from "node:fs/promises";
import path from "node:path";
import { getDecryptedApiKey } from "../settings";

/**
 * Webcam restyle via Decart's queue API (Lucy pro v2v): upload the webcam
 * clip + prompt, poll until the transformed video is ready, write it next to
 * the source file. Runs entirely in the main process so the user's Decart API
 * key never reaches the renderer (same invariant as the LLM keys). The SDK is
 * imported lazily and kept external to the bundle — its realtime half drags
 * in browser-only WebRTC deps we must never load in main.
 */

export interface RestyleWebcamResult {
	success: boolean;
	path?: string;
	error?: string;
}

const MAX_PROMPT_LENGTH = 500;

export async function restyleWebcam(payload: {
	sourcePath: string;
	prompt: string;
}): Promise<RestyleWebcamResult> {
	const prompt = payload.prompt?.trim();
	if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
		return { success: false, error: `prompt must be 1-${MAX_PROMPT_LENGTH} characters` };
	}

	const apiKey = await getDecryptedApiKey("decart");
	if (!apiKey) {
		return {
			success: false,
			error:
				"No Decart API key saved. Ask the user to paste one (from platform.decart.ai) into the Decart field under the model picker.",
		};
	}

	let sourceBytes: Buffer;
	try {
		sourceBytes = await fs.readFile(payload.sourcePath);
	} catch (error) {
		return {
			success: false,
			error: `Could not read the webcam video: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	try {
		const { createDecartClient, models } = await import("@decartai/sdk");
		const client = createDecartClient({ apiKey });
		const result = await client.queue.submitAndPoll({
			model: models.video("lucy-pro-v2v"),
			prompt,
			data: new Blob([new Uint8Array(sourceBytes)], { type: "video/mp4" }),
		});
		if (result.status !== "completed") {
			return { success: false, error: `Decart job failed: ${result.error}` };
		}

		const parsed = path.parse(payload.sourcePath);
		const outputPath = path.join(parsed.dir, `${parsed.name}-restyled-${Date.now()}.mp4`);
		await fs.writeFile(outputPath, Buffer.from(await result.data.arrayBuffer()));
		return { success: true, path: outputPath };
	} catch (error) {
		return {
			success: false,
			error: `Restyle failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}
