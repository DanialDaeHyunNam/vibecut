import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { findExecutable, mcpBridgeLaunch } from "../cliDiscovery";
import { AiToolHost } from "../toolHost";
import { parseCodexEventLine } from "./codexEvents";
import type {
	AiChatSession,
	AiChatSessionOptions,
	AiModelInfo,
	AiProvider,
	AiProviderStatus,
} from "./types";

const MODELS: AiModelInfo[] = [
	{ id: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max", isDefault: true },
	{ id: "gpt-5.1-codex", label: "GPT-5.1 Codex" },
	{ id: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini" },
	{ id: "gpt-5.1", label: "GPT-5.1" },
];

/**
 * Session ids are namespaced per provider before they reach the renderer —
 * the per-project transcript stores one opaque id, and a provider must not
 * try to resume another provider's session after the user switches models.
 */
const RESUME_PREFIX = "codex:";

function isAuthErrorText(text: string): boolean {
	const lowered = text.toLowerCase();
	return (
		lowered.includes("not logged in") ||
		lowered.includes("codex login") ||
		lowered.includes("unauthorized") ||
		lowered.includes("401") ||
		lowered.includes("authentication")
	);
}

/** Render an env map as a TOML inline table for `codex -c mcp_servers...`. */
function tomlInlineTable(entries: Record<string, string>): string {
	const pairs = Object.entries(entries).map(([key, value]) => `${key} = ${JSON.stringify(value)}`);
	return `{ ${pairs.join(", ")} }`;
}

/**
 * Chat session backed by the Codex CLI (ChatGPT subscription auth). Codex has
 * no long-lived streaming-input mode, so each turn is one `codex exec --json`
 * run; conversation memory rides on `codex exec resume <session-id>`. Editor
 * tools reach the agent through the stdio MCP bridge configured via -c
 * overrides, pointing back at this session's tool host.
 */
class CodexCliSession implements AiChatSession {
	private readonly host: AiToolHost;
	private child: ChildProcess | null = null;
	private disposed = false;
	private workspacePromise: Promise<string> | null = null;
	private sessionId: string | null;
	private readonly queue: string[] = [];
	private draining = false;

	constructor(
		private readonly options: AiChatSessionOptions,
		private readonly binaryPath: string,
	) {
		this.host = new AiToolHost(options.executeTool, options.onEvent);
		this.sessionId = options.resumeSessionId?.startsWith(RESUME_PREFIX)
			? options.resumeSessionId.slice(RESUME_PREFIX.length)
			: null;
	}

	/** Temp dir acting as the agent's cwd: AGENTS.md carries the system prompt. */
	private ensureWorkspace(): Promise<string> {
		this.workspacePromise ??= (async () => {
			const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vibecut-codex-"));
			await fs.writeFile(path.join(dir, "AGENTS.md"), this.options.systemPrompt, "utf-8");
			await this.host.start();
			return dir;
		})();
		return this.workspacePromise;
	}

	send(text: string): void {
		if (this.disposed) return;
		this.queue.push(text);
		void this.drain();
	}

	private async drain(): Promise<void> {
		if (this.draining) return;
		this.draining = true;
		try {
			while (this.queue.length > 0 && !this.disposed) {
				const text = this.queue.shift() as string;
				await this.runTurn(text);
			}
		} finally {
			this.draining = false;
		}
	}

	private runTurn(text: string): Promise<void> {
		return new Promise((resolve) => {
			void (async () => {
				let workspace: string;
				try {
					workspace = await this.ensureWorkspace();
				} catch (error) {
					this.options.onEvent({
						type: "error",
						code: "unknown",
						message: error instanceof Error ? error.message : String(error),
					});
					resolve();
					return;
				}
				if (this.disposed) {
					resolve();
					return;
				}

				const bridge = mcpBridgeLaunch(this.host);
				const args = [
					"exec",
					...(this.sessionId ? ["resume", this.sessionId] : []),
					"--json",
					// The agent must only edit through our MCP tools; read-only keeps
					// Codex's built-in shell from touching anything.
					"--sandbox",
					"read-only",
					"--skip-git-repo-check",
					"--cd",
					workspace,
					"--model",
					this.options.model,
					"-c",
					`mcp_servers.cinerec.command=${JSON.stringify(bridge.command)}`,
					"-c",
					`mcp_servers.cinerec.args=${JSON.stringify(bridge.args)}`,
					"-c",
					`mcp_servers.cinerec.env=${tomlInlineTable(bridge.env)}`,
					"-c",
					// ask_user / get_transcript can block for minutes.
					"mcp_servers.cinerec.tool_timeout_sec=600",
					text,
				];

				const child = spawn(this.binaryPath, args, {
					cwd: workspace,
					env: { ...process.env, RUST_LOG: "error" },
					stdio: ["ignore", "pipe", "pipe"],
				});
				this.child = child;

				let emittedThisTurn = false;
				let sawDelta = false;
				let stderrTail = "";

				readline
					.createInterface({ input: child.stdout as NodeJS.ReadableStream })
					.on("line", (line) => {
						const action = parseCodexEventLine(line);
						if (!action || this.disposed) return;
						switch (action.kind) {
							case "session":
								this.sessionId = action.sessionId;
								this.options.onEvent({
									type: "session-started",
									sessionId: `${RESUME_PREFIX}${action.sessionId}`,
								});
								break;
							case "delta":
								sawDelta = true;
								emittedThisTurn = true;
								this.options.onEvent({ type: "text-delta", text: action.text });
								break;
							case "message":
								// Streams that emit deltas repeat the full text in a final
								// message event — skip it to avoid doubling.
								if (sawDelta) {
									sawDelta = false;
									break;
								}
								this.options.onEvent({
									type: "text-delta",
									text: emittedThisTurn ? `\n\n${action.text}` : action.text,
								});
								emittedThisTurn = true;
								break;
							case "error":
								this.options.onEvent({
									type: "error",
									code: isAuthErrorText(action.message) ? "not-authenticated" : "unknown",
									message: action.message,
								});
								break;
						}
					});

				child.stderr?.on("data", (chunk: Buffer) => {
					stderrTail = (stderrTail + chunk.toString()).slice(-4096);
				});

				child.on("error", (error) => {
					this.child = null;
					this.options.onEvent({ type: "error", code: "unknown", message: error.message });
					resolve();
				});

				child.on("close", (code) => {
					this.child = null;
					if (this.disposed) {
						resolve();
						return;
					}
					if (code !== 0 && code !== null) {
						const detail = stderrTail.trim() || `Codex exited with code ${code}.`;
						this.options.onEvent({
							type: "error",
							code: isAuthErrorText(detail) ? "not-authenticated" : "unknown",
							message: detail,
						});
					}
					this.options.onEvent({ type: "turn-done" });
					resolve();
				});
			})();
		});
	}

	async cancel(): Promise<void> {
		this.queue.length = 0;
		const child = this.child;
		if (child) {
			child.kill("SIGINT");
			setTimeout(() => {
				if (!child.killed) child.kill("SIGKILL");
			}, 2000).unref();
		}
		this.options.onEvent({ type: "error", code: "aborted", message: "Cancelled." });
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.queue.length = 0;
		this.child?.kill("SIGKILL");
		this.child = null;
		this.host.close();
		void this.workspacePromise
			?.then((dir) => fs.rm(dir, { recursive: true, force: true }))
			.catch(() => {
				// Temp-dir cleanup is best-effort.
			});
	}
}

export class CodexCliProvider implements AiProvider {
	readonly id = "openai" as const;
	readonly label = "Codex (ChatGPT)";
	readonly requiresApiKey = false;

	listModels(): AiModelInfo[] {
		return MODELS;
	}

	async getStatus(): Promise<AiProviderStatus> {
		const binary = findExecutable("codex");
		if (!binary) {
			return {
				available: false,
				reason: "not-installed",
				detail:
					"Codex CLI not found. Install with `npm install -g @openai/codex` (or `brew install codex`).",
			};
		}
		const authenticated =
			existsSync(path.join(os.homedir(), ".codex", "auth.json")) ||
			Boolean(process.env.OPENAI_API_KEY);
		if (!authenticated) {
			return {
				available: false,
				reason: "not-authenticated",
				detail: "Run `codex login` in a terminal to sign in with your ChatGPT account.",
			};
		}
		return { available: true };
	}

	createSession(options: AiChatSessionOptions): AiChatSession {
		const binary = findExecutable("codex");
		if (!binary) {
			throw new Error("Codex CLI not found. Install it and sign in with `codex login`.");
		}
		return new CodexCliSession(options, binary);
	}
}
