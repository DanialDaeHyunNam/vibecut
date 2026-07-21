import fs from "node:fs/promises";
import type { BrowserWindow, IpcMain } from "electron";
import { restyleWebcam } from "../ai/effects/restyleWebcam";
import { getProviderPolicy } from "../ai/providerPolicy";
import { getAiProvider, listAiProviders } from "../ai/providers";
import type { AiChatEvent, AiChatSession, AiProviderId } from "../ai/providers/types";
import {
	getDecryptedApiKey,
	loadAiSettings,
	saveAiSettings,
	toPublicSettings,
} from "../ai/settings";
import { buildSystemPrompt, formatSnapshot, type ProjectSnapshot } from "../ai/systemPrompt";
import { RendererToolBridge } from "../ai/toolBridge";
import { approveFilePath } from "./handlers";

interface AiChatSendPayload {
	provider: AiProviderId;
	model: string;
	text: string;
	/** User-attached images (base64) — videos arrive pre-converted to contact sheets. */
	attachments?: Array<{ data: string; mimeType: string }>;
	snapshot?: ProjectSnapshot;
	/** Prior CLI session to resume (per-project conversation memory). */
	resumeSessionId?: string;
}

const MAX_ATTACHMENTS_PER_MESSAGE = 12;

/**
 * IPC surface for the AI chat panel. One live session at a time, keyed by
 * provider+model — switching either disposes the old session (conversation
 * context lives in the CLI process, so a switch starts fresh). Follows the
 * registerRecordingStreamHandlers module pattern.
 */
export function registerAiChatHandlers(
	ipcMain: IpcMain,
	getMainWindow: () => BrowserWindow | null,
): void {
	const toolBridge = new RendererToolBridge(getMainWindow);
	toolBridge.register(ipcMain);

	let session: AiChatSession | null = null;
	let sessionKey = "";

	function emit(event: AiChatEvent): void {
		const win = getMainWindow();
		if (win && !win.isDestroyed()) {
			win.webContents.send("ai:chat-event", event);
		}
	}

	function disposeSession(): void {
		toolBridge.rejectAll("Chat session ended.");
		session?.dispose();
		session = null;
		sessionKey = "";
	}

	ipcMain.handle("ai-provider-status", async (_event, providerId: AiProviderId) => {
		const provider = getAiProvider(providerId);
		if (!provider) {
			return { available: false, reason: "error", detail: `Unknown provider: ${providerId}` };
		}
		return provider.getStatus();
	});

	ipcMain.handle("ai-provider-policy", async () => {
		return getProviderPolicy();
	});

	// One-time transcript recovery: if a `<video>.chat.json` sidecar sits next to
	// the recording (written from a Claude Code session log), the renderer imports
	// it when this project's chat is otherwise empty. Returns null when absent.
	ipcMain.handle("ai-chat-read-backup", async (_event, videoPath: unknown) => {
		if (typeof videoPath !== "string" || !videoPath) return null;
		try {
			const raw = await fs.readFile(`${videoPath}.chat.json`, "utf-8");
			const parsed = JSON.parse(raw) as { items?: unknown; sessionId?: unknown };
			if (!Array.isArray(parsed.items)) return null;
			return {
				items: parsed.items,
				sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
			};
		} catch {
			return null; // no sidecar, unreadable, or malformed — nothing to recover
		}
	});

	// Write-through transcript backup: the renderer mirrors its localStorage copy
	// here so the chat survives quota failures and storage wipes. Same sidecar
	// the recovery path reads.
	ipcMain.handle("ai-chat-write-backup", async (_event, videoPath: unknown, payload: unknown) => {
		if (typeof videoPath !== "string" || !videoPath) return false;
		const data = payload as { items?: unknown; sessionId?: unknown } | null;
		if (!data || !Array.isArray(data.items)) return false;
		try {
			await fs.writeFile(
				`${videoPath}.chat.json`,
				JSON.stringify({
					items: data.items,
					sessionId: typeof data.sessionId === "string" ? data.sessionId : null,
				}),
				"utf-8",
			);
			return true;
		} catch {
			return false; // best-effort — localStorage still has the primary copy
		}
	});

	ipcMain.handle(
		"ai-restyle-webcam",
		async (_event, payload: { sourcePath?: unknown; prompt?: unknown }) => {
			if (typeof payload?.sourcePath !== "string" || typeof payload?.prompt !== "string") {
				return { success: false, error: "sourcePath and prompt are required" };
			}
			const result = await restyleWebcam({
				sourcePath: payload.sourcePath,
				prompt: payload.prompt,
			});
			if (result.success && result.path) {
				// The output sits next to the source webcam file; approve it so the
				// renderer can load it as a file:// URL.
				approveFilePath(result.path);
			}
			return result;
		},
	);

	ipcMain.handle("ai-list-providers", async () => {
		return listAiProviders().map((provider) => ({
			id: provider.id,
			label: provider.label,
			requiresApiKey: provider.requiresApiKey,
			models: provider.listModels(),
		}));
	});

	ipcMain.handle("ai-get-settings", async () => {
		return toPublicSettings(await loadAiSettings());
	});

	ipcMain.handle(
		"ai-save-settings",
		async (
			_event,
			update: {
				provider?: AiProviderId;
				modelByProvider?: Partial<Record<AiProviderId, string>>;
				apiKeys?: Partial<Record<AiProviderId, string | null>>;
			},
		) => {
			try {
				return { success: true, settings: toPublicSettings(await saveAiSettings(update)) };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	);

	ipcMain.handle("ai-chat-send", async (_event, payload: AiChatSendPayload) => {
		const provider = getAiProvider(payload.provider);
		if (!provider) {
			return { success: false, error: `Unknown provider: ${payload.provider}` };
		}

		const key = `${payload.provider}:${payload.model}`;
		if (!session || sessionKey !== key) {
			disposeSession();
			try {
				session = provider.createSession({
					model: payload.model,
					systemPrompt: buildSystemPrompt(),
					executeTool: (name, input) => toolBridge.call(name, input),
					onEvent: emit,
					resumeSessionId: payload.resumeSessionId,
					apiKey: await getDecryptedApiKey(payload.provider),
				});
				sessionKey = key;
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		}

		const attachments = (Array.isArray(payload.attachments) ? payload.attachments : [])
			.filter(
				(image): image is { data: string; mimeType: string } =>
					typeof image?.data === "string" && typeof image?.mimeType === "string",
			)
			.slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
		session.send(formatSnapshot(payload.snapshot) + payload.text, attachments);
		return { success: true };
	});

	ipcMain.handle("ai-chat-cancel", async () => {
		toolBridge.rejectAll("Cancelled by user.");
		await session?.cancel();
		return { success: true };
	});

	ipcMain.handle("ai-chat-reset", async () => {
		disposeSession();
		return { success: true };
	});
}
