import { randomUUID } from "node:crypto";
import type { BrowserWindow, IpcMain } from "electron";

export interface AiToolCallResult {
	ok: boolean;
	content: string;
	/** Short human-readable summary shown in the chat tool chip. */
	summary?: string;
	/** Captured video frames (base64) returned by get_video_frames. */
	images?: Array<{ data: string; mimeType: string }>;
}

const TOOL_CALL_TIMEOUT_MS = 15_000;
// Slow renderer-side tools get more headroom: Whisper transcription of a long
// recording can take minutes; frame capture seeks through the video file.
const TOOL_TIMEOUT_OVERRIDES_MS: Record<string, number> = {
	get_transcript: 300_000,
	get_video_frames: 60_000,
	// Waits for a human to pick options in the chat UI.
	ask_user: 600_000,
	// Waits on a native save dialog.
	export_captions_srt: 600_000,
	// Cloud video transform: processing time scales with clip length.
	restyle_webcam: 900_000,
};

/**
 * Main→renderer RPC for AI tool calls. Editor state lives in the renderer, so
 * each tool call is sent over `ai:tool-call` with a correlation id and the
 * renderer replies on `ai:tool-result` after running the command through
 * `pushState`. Pending calls resolve as errors on timeout or window loss so
 * the agent never hangs.
 */
export class RendererToolBridge {
	private readonly pending = new Map<
		string,
		{ resolve: (result: AiToolCallResult) => void; timer: NodeJS.Timeout }
	>();

	constructor(private readonly getWindow: () => BrowserWindow | null) {}

	register(ipcMain: IpcMain): void {
		ipcMain.on("ai:tool-result", (_event, payload: { callId: string } & AiToolCallResult) => {
			const entry = this.pending.get(payload.callId);
			if (!entry) return;
			this.pending.delete(payload.callId);
			clearTimeout(entry.timer);
			entry.resolve({
				ok: payload.ok,
				content: payload.content,
				summary: payload.summary,
				images: payload.images,
			});
		});
	}

	call(name: string, input: unknown): Promise<AiToolCallResult> {
		const win = this.getWindow();
		if (!win || win.isDestroyed()) {
			return Promise.resolve({ ok: false, content: "Editor window is not available." });
		}

		const callId = randomUUID();
		const timeoutMs = TOOL_TIMEOUT_OVERRIDES_MS[name] ?? TOOL_CALL_TIMEOUT_MS;
		return new Promise<AiToolCallResult>((resolve) => {
			const timer = setTimeout(() => {
				this.pending.delete(callId);
				resolve({ ok: false, content: `Tool call timed out after ${timeoutMs}ms.` });
			}, timeoutMs);
			this.pending.set(callId, { resolve, timer });
			win.webContents.send("ai:tool-call", { callId, name, input });
		});
	}

	/** Resolve every pending call as an error (chat cancelled, window closed). */
	rejectAll(reason: string): void {
		for (const [callId, entry] of this.pending) {
			clearTimeout(entry.timer);
			entry.resolve({ ok: false, content: reason });
			this.pending.delete(callId);
		}
	}
}
