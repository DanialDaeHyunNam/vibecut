import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findExecutable, mcpBridgeLaunch } from "../cliDiscovery";
import { AiToolHost } from "../toolHost";
import type {
	AiChatSession,
	AiChatSessionOptions,
	AiModelInfo,
	AiProvider,
	AiProviderStatus,
} from "./types";

const MODELS: AiModelInfo[] = [
	{ id: "gemini-3-pro-preview", label: "Gemini 3 Pro", isDefault: true },
	{ id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
	{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
];

/** Keep prompts bounded when replaying conversation history each turn. */
const MAX_HISTORY_TURNS = 24;

/**
 * Built-in Gemini CLI tools that could bypass the editor-tools-only contract.
 * Both the legacy and current tool names are listed; unknown names are ignored.
 */
const EXCLUDED_BUILTIN_TOOLS = [
	"run_shell_command",
	"write_file",
	"replace",
	"edit",
	"read_file",
	"read_many_files",
	"list_directory",
	"glob",
	"grep",
	"search_file_content",
	"web_fetch",
	"google_web_search",
	"save_memory",
	"write_todos",
];

function isAuthErrorText(text: string): boolean {
	const lowered = text.toLowerCase();
	return (
		lowered.includes("please set an auth method") ||
		lowered.includes("login") ||
		lowered.includes("unauthorized") ||
		lowered.includes("401") ||
		lowered.includes("authentication") ||
		lowered.includes("credentials")
	);
}

/**
 * Chat session backed by the Gemini CLI (Google-account login). Gemini has no
 * non-interactive session resume, so each turn is a fresh `gemini -p` run and
 * the session replays its own transcript as context. The system prompt lives
 * in the workspace's GEMINI.md; MCP wiring and built-in tool lockdown live in
 * the workspace's .gemini/settings.json (project-level settings).
 */
class GeminiCliSession implements AiChatSession {
	private readonly host: AiToolHost;
	private child: ChildProcess | null = null;
	private disposed = false;
	private workspacePromise: Promise<string> | null = null;
	private readonly history: Array<{ role: "user" | "assistant"; text: string }> = [];
	private readonly queue: string[] = [];
	private draining = false;

	constructor(
		private readonly options: AiChatSessionOptions,
		private readonly binaryPath: string,
	) {
		this.host = new AiToolHost(options.executeTool, options.onEvent);
	}

	private ensureWorkspace(): Promise<string> {
		this.workspacePromise ??= (async () => {
			await this.host.start();
			const bridge = mcpBridgeLaunch(this.host);
			const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vibecut-gemini-"));
			await fs.writeFile(path.join(dir, "GEMINI.md"), this.options.systemPrompt, "utf-8");
			await fs.mkdir(path.join(dir, ".gemini"), { recursive: true });
			const settings = {
				mcpServers: {
					cinerec: {
						command: bridge.command,
						args: bridge.args,
						env: bridge.env,
						// Auto-approve our own tools; there is no interactive consent
						// prompt in headless mode.
						trust: true,
						// ask_user / get_transcript can block for minutes.
						timeout: 600_000,
					},
				},
				// Old and new settings schema spellings, so the lockdown holds
				// across Gemini CLI versions.
				excludeTools: EXCLUDED_BUILTIN_TOOLS,
				tools: { exclude: EXCLUDED_BUILTIN_TOOLS },
			};
			await fs.writeFile(
				path.join(dir, ".gemini", "settings.json"),
				JSON.stringify(settings, null, 2),
				"utf-8",
			);
			return dir;
		})();
		return this.workspacePromise;
	}

	private buildPrompt(text: string): string {
		if (this.history.length === 0) return text;
		const transcript = this.history
			.slice(-MAX_HISTORY_TURNS * 2)
			.map((entry) => `${entry.role === "user" ? "User" : "You"}: ${entry.text}`)
			.join("\n\n");
		return `Conversation so far (for context — do not repeat it):\n\n${transcript}\n\nUser: ${text}`;
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

				const child = spawn(
					this.binaryPath,
					[
						"--model",
						this.options.model,
						"--output-format",
						"json",
						"--prompt",
						this.buildPrompt(text),
					],
					{
						cwd: workspace,
						env: { ...process.env, NO_COLOR: "1" },
						stdio: ["ignore", "pipe", "pipe"],
					},
				);
				this.child = child;

				let stdout = "";
				let stderrTail = "";
				child.stdout?.on("data", (chunk: Buffer) => {
					stdout += chunk.toString();
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
					const response = this.extractResponse(stdout);
					if (response) {
						this.history.push({ role: "user", text });
						this.history.push({ role: "assistant", text: response });
						this.options.onEvent({ type: "text-delta", text: response });
					}
					if (code !== 0 && code !== null && !response) {
						const detail = stderrTail.trim() || stdout.trim() || `Gemini exited with code ${code}.`;
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

	/** `--output-format json` prints {response, stats}; fall back to raw text. */
	private extractResponse(stdout: string): string | null {
		const trimmed = stdout.trim();
		if (!trimmed) return null;
		const jsonStart = trimmed.indexOf("{");
		if (jsonStart >= 0) {
			try {
				const parsed = JSON.parse(trimmed.slice(jsonStart)) as {
					response?: unknown;
					error?: { message?: string };
				};
				if (typeof parsed.response === "string" && parsed.response) return parsed.response;
				if (parsed.error?.message) return null;
			} catch {
				// Not JSON — some CLI versions print plain text in -p mode.
			}
		}
		return jsonStart === 0 ? null : trimmed;
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

export class GeminiCliProvider implements AiProvider {
	readonly id = "gemini" as const;
	readonly label = "Gemini CLI";
	readonly requiresApiKey = false;

	listModels(): AiModelInfo[] {
		return MODELS;
	}

	async getStatus(): Promise<AiProviderStatus> {
		const binary = findExecutable("gemini");
		if (!binary) {
			return {
				available: false,
				reason: "not-installed",
				detail:
					"Gemini CLI not found. Install with `npm install -g @google/gemini-cli` (or `brew install gemini-cli`).",
			};
		}
		const geminiDir = path.join(os.homedir(), ".gemini");
		const authenticated =
			existsSync(path.join(geminiDir, "oauth_creds.json")) ||
			existsSync(path.join(geminiDir, "google_accounts.json")) ||
			Boolean(process.env.GEMINI_API_KEY) ||
			Boolean(process.env.GOOGLE_API_KEY);
		if (!authenticated) {
			return {
				available: false,
				reason: "not-authenticated",
				detail: "Run `gemini` in a terminal once and sign in with your Google account.",
			};
		}
		return { available: true };
	}

	createSession(options: AiChatSessionOptions): AiChatSession {
		const binary = findExecutable("gemini");
		if (!binary) {
			throw new Error("Gemini CLI not found. Install it and sign in first.");
		}
		return new GeminiCliSession(options, binary);
	}
}
