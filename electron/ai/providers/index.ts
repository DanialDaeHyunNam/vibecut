import { ClaudeCodeProvider } from "./claudeCode";
import type {
	AiChatSession,
	AiChatSessionOptions,
	AiModelInfo,
	AiProvider,
	AiProviderId,
	AiProviderStatus,
} from "./types";

/**
 * Placeholder for API-key providers (OpenAI/Gemini/Grok). They render as
 * disabled "coming soon" rows in the model picker until implemented; the
 * settings schema (ai-settings.json apiKeys) is already in place for them.
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
	openai: new ComingSoonProvider("openai", "OpenAI"),
	gemini: new ComingSoonProvider("gemini", "Gemini"),
	grok: new ComingSoonProvider("grok", "Grok"),
};

export function getAiProvider(id: AiProviderId): AiProvider | null {
	return providers[id] ?? null;
}

export function listAiProviders(): AiProvider[] {
	return Object.values(providers);
}
