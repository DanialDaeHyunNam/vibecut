import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	createSdkMcpServer,
	type Query,
	query,
	type SDKMessage,
	type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { app } from "electron";
import { loadAiSettings } from "../settings";
import { allowedToolNames, CINEREC_MCP_SERVER_NAME, createCinerecTools } from "../toolDefinitions";
import type {
	AiChatSession,
	AiChatSessionOptions,
	AiModelInfo,
	AiProvider,
	AiProviderStatus,
	AiToolImage,
} from "./types";

const MAX_TURNS = 12;

const MODELS: AiModelInfo[] = [
	{ id: "claude-fable-5", label: "Fable 5" },
	{ id: "claude-opus-4-8", label: "Opus 4.8", isDefault: true },
	{ id: "claude-sonnet-5", label: "Sonnet 5" },
	{ id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

/**
 * The Agent SDK vendors the Claude Code CLI as a native binary in a
 * platform-specific optional package, so no PATH lookup is needed — important
 * because the launchd-launched dev app has a minimal PATH. This probe only
 * powers the status check; the SDK resolves the binary itself when spawning.
 */
function findVendoredClaudeBinary(): string | null {
	const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
	const bin = process.platform === "win32" ? "claude.exe" : "claude";
	const appPath = app.getAppPath();
	const candidates = [
		path.join(appPath, "node_modules", pkg, bin),
		path.join(appPath.replace(/app\.asar$/, "app.asar.unpacked"), "node_modules", pkg, bin),
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * Cheap heuristic for "logged in to Claude Code" — the definitive check is the
 * first query() call, whose auth error flips the panel to the login state.
 */
function looksAuthenticated(): boolean {
	return (
		existsSync(path.join(os.homedir(), ".claude.json")) ||
		existsSync(path.join(os.homedir(), ".claude", ".credentials.json"))
	);
}

function isAuthErrorMessage(message: string): boolean {
	const lowered = message.toLowerCase();
	return (
		lowered.includes("not logged in") ||
		lowered.includes("please run /login") ||
		lowered.includes("authentication") ||
		lowered.includes("invalid api key") ||
		lowered.includes("oauth")
	);
}

/**
 * Push-based async iterable feeding the SDK's streaming-input mode: one
 * long-lived query() consumes it, so the CLI process and its context survive
 * across chat turns.
 */
class MessageQueue implements AsyncIterable<SDKUserMessage> {
	private readonly buffer: SDKUserMessage[] = [];
	private wake: (() => void) | null = null;
	private closed = false;

	push(message: SDKUserMessage): void {
		if (this.closed) return;
		this.buffer.push(message);
		this.wake?.();
	}

	close(): void {
		this.closed = true;
		this.wake?.();
	}

	async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
		while (true) {
			while (this.buffer.length > 0) {
				yield this.buffer.shift() as SDKUserMessage;
			}
			if (this.closed) return;
			await new Promise<void>((resolve) => {
				this.wake = resolve;
			});
			this.wake = null;
		}
	}
}

class ClaudeCodeSession implements AiChatSession {
	private readonly queue = new MessageQueue();
	private readonly activeQuery: Query;
	private disposed = false;

	constructor(private readonly options: AiChatSessionOptions) {
		const tools = createCinerecTools(options.executeTool, options.onEvent);
		const server = createSdkMcpServer({
			name: CINEREC_MCP_SERVER_NAME,
			version: "1.0.0",
			tools,
		});

		this.activeQuery = query({
			prompt: this.queue,
			options: {
				model: options.model,
				systemPrompt: options.systemPrompt,
				// A stored Anthropic API key is the alternative to subscription
				// login — inject it into the spawned CLI's environment.
				...(options.apiKey
					? {
							env: {
								...(process.env as Record<string, string>),
								ANTHROPIC_API_KEY: options.apiKey,
							},
						}
					: {}),
				mcpServers: { [CINEREC_MCP_SERVER_NAME]: server },
				// Editing happens only through our MCP tools; disable every
				// built-in tool so the agent has no file/shell/network access.
				tools: [],
				allowedTools: allowedToolNames(),
				maxTurns: MAX_TURNS,
				includePartialMessages: true,
				// Isolate from the user's global Claude Code config (CLAUDE.md,
				// output styles) — this agent should only see our system prompt.
				settingSources: [],
				// Continue the project's prior conversation across app restarts.
				...(options.resumeSessionId ? { resume: options.resumeSessionId } : {}),
				stderr: (data: string) => {
					console.error("[ai-claude-code]", data);
				},
			},
		});

		void this.pump();
	}

	private async pump(): Promise<void> {
		try {
			for await (const message of this.activeQuery as AsyncIterable<SDKMessage>) {
				if (this.disposed) break;
				this.handleMessage(message);
			}
		} catch (error) {
			if (this.disposed) return;
			const messageText = error instanceof Error ? error.message : String(error);
			this.options.onEvent({
				type: "error",
				code: isAuthErrorMessage(messageText) ? "not-authenticated" : "unknown",
				message: messageText,
			});
		}
	}

	private handleMessage(message: SDKMessage): void {
		switch (message.type) {
			case "system": {
				const systemMessage = message as { subtype?: string; session_id?: string };
				if (systemMessage.subtype === "init" && systemMessage.session_id) {
					this.options.onEvent({
						type: "session-started",
						sessionId: systemMessage.session_id,
					});
				}
				break;
			}
			case "stream_event": {
				const event = message.event as {
					type?: string;
					delta?: { type?: string; text?: string };
				};
				if (
					event?.type === "content_block_delta" &&
					event.delta?.type === "text_delta" &&
					event.delta.text
				) {
					this.options.onEvent({ type: "text-delta", text: event.delta.text });
				}
				break;
			}
			case "result": {
				const resultMessage = message as { subtype?: string; result?: string };
				if (resultMessage.subtype && resultMessage.subtype !== "success") {
					const detail = resultMessage.result ?? resultMessage.subtype;
					this.options.onEvent({
						type: "error",
						code: isAuthErrorMessage(String(detail)) ? "not-authenticated" : "unknown",
						message: String(detail),
					});
				}
				this.options.onEvent({ type: "turn-done" });
				break;
			}
			default:
				break;
		}
	}

	send(text: string, images: AiToolImage[] = []): void {
		this.queue.push({
			type: "user",
			message: {
				role: "user",
				content: [
					// Images first — the model reads them before the instructions
					// that reference them.
					...images.map((image) => ({
						type: "image" as const,
						source: {
							type: "base64" as const,
							media_type: image.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
							data: image.data,
						},
					})),
					{ type: "text", text },
				],
			},
			parent_tool_use_id: null,
		});
	}

	async cancel(): Promise<void> {
		try {
			await this.activeQuery.interrupt();
		} catch (error) {
			console.error("[ai-claude-code] interrupt failed:", error);
		}
		this.options.onEvent({ type: "error", code: "aborted", message: "Cancelled." });
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.queue.close();
		void this.activeQuery.interrupt().catch(() => {
			// Best-effort teardown; the CLI process may already be gone.
		});
	}
}

export class ClaudeCodeProvider implements AiProvider {
	// Internal id stays "claude-code" (persisted in settings); the user-facing
	// label must not use "Claude Code" — Anthropic's partner branding
	// guidelines allow "Claude" / "Claude Agent" only.
	readonly id = "claude-code" as const;
	readonly label = "Claude";
	readonly requiresApiKey = false;

	listModels(): AiModelInfo[] {
		return MODELS;
	}

	async getStatus(): Promise<AiProviderStatus> {
		const binary = findVendoredClaudeBinary();
		if (!binary) {
			return {
				available: false,
				reason: "not-installed",
				detail: "Bundled Claude agent binary not found in node_modules.",
			};
		}
		const settings = await loadAiSettings();
		const hasStoredKey = Boolean(settings.apiKeys["claude-code"]);
		if (!looksAuthenticated() && !hasStoredKey && !process.env.ANTHROPIC_API_KEY) {
			return {
				available: false,
				reason: "not-authenticated",
				detail:
					"No Claude login found. Run `claude` in a terminal and use /login, or save an Anthropic API key below.",
			};
		}
		return { available: true };
	}

	createSession(options: AiChatSessionOptions): AiChatSession {
		return new ClaudeCodeSession(options);
	}
}
