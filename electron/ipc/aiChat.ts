import type { BrowserWindow, IpcMain } from "electron";
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

interface AiChatSendPayload {
	provider: AiProviderId;
	model: string;
	text: string;
	snapshot?: ProjectSnapshot;
	/** Prior CLI session to resume (per-project conversation memory). */
	resumeSessionId?: string;
}

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

		session.send(formatSnapshot(payload.snapshot) + payload.text);
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
