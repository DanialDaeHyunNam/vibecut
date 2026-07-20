import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findExecutable, mcpBridgeLaunch } from "../cliDiscovery";
import { PerTurnCliSession } from "./cliSession";
import { parseCodexEventLine } from "./codexEvents";
import type {
	AiChatSession,
	AiChatSessionOptions,
	AiModelInfo,
	AiProvider,
	AiProviderStatus,
	AiToolImage,
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
 * Chat session backed by the Codex CLI (ChatGPT subscription auth). Each turn
 * is one `codex exec --json` run; conversation memory rides on
 * `codex exec resume <session-id>`. Editor tools reach the agent through the
 * stdio MCP bridge configured via -c overrides, pointing back at this
 * session's tool host.
 */
class CodexCliSession extends PerTurnCliSession {
	protected readonly workspacePrefix = "vibecut-codex-";
	private sessionId: string | null;

	constructor(
		options: AiChatSessionOptions,
		private readonly binaryPath: string,
	) {
		super(options);
		this.sessionId = options.resumeSessionId?.startsWith(RESUME_PREFIX)
			? options.resumeSessionId.slice(RESUME_PREFIX.length)
			: null;
	}

	/** AGENTS.md in the workspace carries the system prompt (Codex reads cwd). */
	protected async prepareWorkspace(dir: string): Promise<void> {
		await fs.writeFile(path.join(dir, "AGENTS.md"), this.options.systemPrompt, "utf-8");
	}

	protected async runTurn(text: string, workspace: string, images: AiToolImage[]): Promise<void> {
		// Codex takes images as file paths (`-i`), so attachments land in the
		// workspace temp dir first. Filenames are turn-unique; the whole dir is
		// removed on dispose.
		const imageArgs: string[] = [];
		for (const [index, image] of images.entries()) {
			const ext = image.mimeType === "image/png" ? "png" : "jpg";
			const file = path.join(workspace, `attachment-${Date.now()}-${index}.${ext}`);
			await fs.writeFile(file, Buffer.from(image.data, "base64"));
			imageArgs.push("-i", file);
		}
		const bridge = mcpBridgeLaunch(this.host);
		const args = [
			"exec",
			...(this.sessionId ? ["resume", this.sessionId] : []),
			...imageArgs,
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

		let emittedThisTurn = false;
		let sawDelta = false;

		return this.runChild({
			command: this.binaryPath,
			args,
			cwd: workspace,
			env: { ...process.env, RUST_LOG: "error" },
			onStdoutLine: (line) => {
				const action = parseCodexEventLine(line);
				if (!action) return;
				switch (action.kind) {
					case "session":
						this.sessionId = action.sessionId;
						this.emit({
							type: "session-started",
							sessionId: `${RESUME_PREFIX}${action.sessionId}`,
						});
						break;
					case "delta":
						sawDelta = true;
						emittedThisTurn = true;
						this.emit({ type: "text-delta", text: action.text });
						break;
					case "message":
						// Streams that emit deltas repeat the full text in a final
						// message event — skip it to avoid doubling.
						if (sawDelta) {
							sawDelta = false;
							break;
						}
						this.emit({
							type: "text-delta",
							text: emittedThisTurn ? `\n\n${action.text}` : action.text,
						});
						emittedThisTurn = true;
						break;
					case "error":
						this.emitError(
							action.message,
							isAuthErrorText(action.message) ? "not-authenticated" : "unknown",
						);
						break;
				}
			},
			onClose: ({ code, stderrTail }) => {
				if (code !== 0 && code !== null) {
					const detail = stderrTail.trim() || `Codex exited with code ${code}.`;
					this.emitError(detail, isAuthErrorText(detail) ? "not-authenticated" : "unknown");
				}
				this.emit({ type: "turn-done" });
			},
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
