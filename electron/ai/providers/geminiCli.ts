import fs from "node:fs/promises";
import path from "node:path";
import { findExecutable, mcpBridgeLaunch } from "../cliDiscovery";
import { loadAiSettings } from "../settings";
import { PerTurnCliSession } from "./cliSession";
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
 * Chat session backed by the Gemini CLI, authenticated with an AI Studio API
 * key injected as GEMINI_API_KEY. Key auth (not Google login) is deliberate:
 * Google's 2026-02 service update prohibits "using Gemini CLI OAuth with
 * third-party software" and has suspended accounts over it, while explicitly
 * recommending API keys for third-party agents — so Vibecut never touches the
 * user's Google login. Gemini has no non-interactive session resume, so each
 * turn is a fresh `gemini -p` run and the session replays its own transcript
 * as context. The system prompt lives in the workspace's GEMINI.md; MCP
 * wiring and built-in tool lockdown live in the workspace's
 * .gemini/settings.json (project-level settings).
 */
class GeminiCliSession extends PerTurnCliSession {
	protected readonly workspacePrefix = "vibecut-gemini-";
	private readonly history: Array<{ role: "user" | "assistant"; text: string }> = [];

	constructor(
		options: AiChatSessionOptions,
		private readonly binaryPath: string,
	) {
		super(options);
	}

	protected async prepareWorkspace(dir: string): Promise<void> {
		const bridge = mcpBridgeLaunch(this.host);
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
	}

	private buildPrompt(text: string): string {
		if (this.history.length === 0) return text;
		const transcript = this.history
			.slice(-MAX_HISTORY_TURNS * 2)
			.map((entry) => `${entry.role === "user" ? "User" : "You"}: ${entry.text}`)
			.join("\n\n");
		return `Conversation so far (for context — do not repeat it):\n\n${transcript}\n\nUser: ${text}`;
	}

	protected runTurn(text: string, workspace: string): Promise<void> {
		return this.runChild({
			command: this.binaryPath,
			args: [
				"--model",
				this.options.model,
				"--output-format",
				"json",
				"--prompt",
				this.buildPrompt(text),
			],
			cwd: workspace,
			env: {
				...process.env,
				NO_COLOR: "1",
				...(this.options.apiKey ? { GEMINI_API_KEY: this.options.apiKey } : {}),
			},
			collectStdout: true,
			onClose: ({ code, stdout, stderrTail }) => {
				const response = extractResponse(stdout);
				if (response) {
					this.history.push({ role: "user", text });
					this.history.push({ role: "assistant", text: response });
					this.emit({ type: "text-delta", text: response });
				}
				if (code !== 0 && code !== null && !response) {
					const detail = stderrTail.trim() || stdout.trim() || `Gemini exited with code ${code}.`;
					this.emitError(detail, isAuthErrorText(detail) ? "not-authenticated" : "unknown");
				}
				this.emit({ type: "turn-done" });
			},
		});
	}
}

/** `--output-format json` prints {response, stats}; fall back to raw text. */
function extractResponse(stdout: string): string | null {
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

export class GeminiCliProvider implements AiProvider {
	readonly id = "gemini" as const;
	readonly label = "Gemini";
	readonly requiresApiKey = true;

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
		const settings = await loadAiSettings();
		const hasKey =
			Boolean(settings.apiKeys.gemini) ||
			Boolean(process.env.GEMINI_API_KEY) ||
			Boolean(process.env.GOOGLE_API_KEY);
		if (!hasKey) {
			return {
				available: false,
				reason: "no-api-key",
				detail:
					"Save a Gemini API key (free from Google AI Studio — aistudio.google.com/apikey). Google login is not used: Google's terms prohibit third-party software from using Gemini CLI OAuth.",
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
