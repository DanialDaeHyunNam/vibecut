/**
 * Provider abstraction for the AI chat panel. Claude (via the local Claude
 * Code subscription) ships first; OpenAI/Gemini/Grok slot in later behind the
 * same interface using API keys stored in ai-settings.json.
 */

export type AiProviderId = "claude-code" | "openai" | "gemini" | "grok";

export interface AiModelInfo {
	id: string;
	label: string;
	isDefault?: boolean;
}

export type AiProviderStatus =
	| { available: true; detail?: string }
	| {
			available: false;
			reason: "not-installed" | "not-authenticated" | "no-api-key" | "coming-soon" | "error";
			detail?: string;
	  };

/** Streaming events pushed to the renderer over the `ai:chat-event` channel. */
export type AiChatEvent =
	| { type: "session-started"; sessionId: string }
	| { type: "text-delta"; text: string }
	| { type: "tool-start"; toolCallId: string; name: string; input: unknown }
	| { type: "tool-end"; toolCallId: string; ok: boolean; summary?: string }
	| { type: "turn-done" }
	| {
			type: "error";
			code: "not-installed" | "not-authenticated" | "aborted" | "unknown";
			message: string;
	  };

/**
 * Executes one editor tool call. Implemented by the main-process tool bridge,
 * which RPCs into the renderer where the editor state lives.
 */
export interface AiToolImage {
	/** Base64-encoded image bytes (no data: prefix). */
	data: string;
	mimeType: string;
}

export type AiToolExecutor = (
	name: string,
	input: unknown,
) => Promise<{ ok: boolean; content: string; summary?: string; images?: AiToolImage[] }>;

export interface AiChatSessionOptions {
	model: string;
	systemPrompt: string;
	executeTool: AiToolExecutor;
	onEvent: (event: AiChatEvent) => void;
	/** Resume a prior CLI session so the agent keeps its conversation memory. */
	resumeSessionId?: string;
}

export interface AiChatSession {
	/** Queue a user message; streaming responses arrive via onEvent. */
	send(text: string): void;
	/** Interrupt the in-flight turn. The session stays usable. */
	cancel(): Promise<void>;
	/** Tear down the underlying process/stream. The session is unusable after. */
	dispose(): void;
}

export interface AiProvider {
	readonly id: AiProviderId;
	readonly label: string;
	readonly requiresApiKey: boolean;
	listModels(): AiModelInfo[];
	getStatus(): Promise<AiProviderStatus>;
	createSession(options: AiChatSessionOptions): AiChatSession;
}
