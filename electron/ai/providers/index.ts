import { ClaudeCodeProvider } from "./claudeCode";
import { CodexCliProvider } from "./codexCli";
import { GeminiCliProvider } from "./geminiCli";
import type {
	AiChatSession,
	AiChatSessionOptions,
	AiModelInfo,
	AiProvider,
	AiProviderId,
	AiProviderStatus,
} from "./types";

/**
 * Placeholder for API-key providers not implemented yet (Grok). They render
 * as disabled "coming soon" rows in the model picker; the settings schema
 * (ai-settings.json apiKeys) already stores their keys so the UI can collect
 * one ahead of the implementation.
 */
class ComingSoonProvider implements AiProvider {
	readonly requiresApiKey = true;

	constructor(
		readonly id: AiProviderId,
		readonly label: string,
	) {}

	listModels(): AiModelInfo[] {
		return [];
	}

	async getStatus(): Promise<AiProviderStatus> {
		return { available: false, reason: "coming-soon" };
	}

	createSession(_options: AiChatSessionOptions): AiChatSession {
		throw new Error(`${this.label} support is not implemented yet.`);
	}
}

const providers: Record<AiProviderId, AiProvider> = {
	"claude-code": new ClaudeCodeProvider(),
	// The "openai" slot is served by the Codex CLI: same ChatGPT-subscription
	// trick as Claude Code — no API key, reuse the CLI's login.
	openai: new CodexCliProvider(),
	gemini: new GeminiCliProvider(),
	grok: new ComingSoonProvider("grok", "Grok"),
};

export function getAiProvider(id: AiProviderId): AiProvider | null {
	return providers[id] ?? null;
}

export function listAiProviders(): AiProvider[] {
	return Object.values(providers);
}
