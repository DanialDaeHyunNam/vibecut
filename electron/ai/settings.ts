import fs from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";
import type { AiProviderId } from "./providers/types";

/**
 * Persisted AI-panel configuration, stored as JSON under userData like
 * shortcuts.json. API keys are encrypted with Electron safeStorage and kept
 * as base64 — never written in plaintext and never sent to the renderer.
 */
export interface AiSettings {
	version: 1;
	provider: AiProviderId;
	modelByProvider: Partial<Record<AiProviderId, string>>;
	/** safeStorage-encrypted, base64-encoded API keys keyed by provider. */
	apiKeys: Partial<Record<AiProviderId, string>>;
}

/** Settings shape exposed to the renderer — never includes key material. */
export interface AiSettingsPublic {
	provider: AiProviderId;
	modelByProvider: Partial<Record<AiProviderId, string>>;
	hasApiKey: Partial<Record<AiProviderId, boolean>>;
}

const DEFAULT_SETTINGS: AiSettings = {
	version: 1,
	provider: "claude-code",
	modelByProvider: {},
	apiKeys: {},
};

const VALID_PROVIDERS: AiProviderId[] = ["claude-code", "openai", "gemini", "grok"];

function settingsFilePath(): string {
	return path.join(app.getPath("userData"), "ai-settings.json");
}

export async function loadAiSettings(): Promise<AiSettings> {
	try {
		const raw = await fs.readFile(settingsFilePath(), "utf-8");
		const parsed = JSON.parse(raw) as Partial<AiSettings>;
		return {
			version: 1,
			provider: VALID_PROVIDERS.includes(parsed.provider as AiProviderId)
				? (parsed.provider as AiProviderId)
				: DEFAULT_SETTINGS.provider,
			modelByProvider:
				parsed.modelByProvider && typeof parsed.modelByProvider === "object"
					? parsed.modelByProvider
					: {},
			apiKeys: parsed.apiKeys && typeof parsed.apiKeys === "object" ? parsed.apiKeys : {},
		};
	} catch (error) {
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code !== "ENOENT") {
			console.error("Failed to load ai-settings.json:", error);
		}
		return { ...DEFAULT_SETTINGS };
	}
}

export function toPublicSettings(settings: AiSettings): AiSettingsPublic {
	const hasApiKey: Partial<Record<AiProviderId, boolean>> = {};
	for (const provider of VALID_PROVIDERS) {
		hasApiKey[provider] = Boolean(settings.apiKeys[provider]);
	}
	return { provider: settings.provider, modelByProvider: settings.modelByProvider, hasApiKey };
}

export async function saveAiSettings(update: {
	provider?: AiProviderId;
	modelByProvider?: Partial<Record<AiProviderId, string>>;
	/** Plaintext keys from the renderer; encrypted before persisting. */
	apiKeys?: Partial<Record<AiProviderId, string | null>>;
}): Promise<AiSettings> {
	const current = await loadAiSettings();

	if (update.provider && VALID_PROVIDERS.includes(update.provider)) {
		current.provider = update.provider;
	}
	if (update.modelByProvider) {
		current.modelByProvider = { ...current.modelByProvider, ...update.modelByProvider };
	}
	if (update.apiKeys) {
		for (const [provider, key] of Object.entries(update.apiKeys)) {
			if (!VALID_PROVIDERS.includes(provider as AiProviderId)) continue;
			if (key === null || key === "") {
				delete current.apiKeys[provider as AiProviderId];
				continue;
			}
			if (!safeStorage.isEncryptionAvailable()) {
				throw new Error("safeStorage encryption unavailable; refusing to persist API key");
			}
			current.apiKeys[provider as AiProviderId] = safeStorage.encryptString(key).toString("base64");
		}
	}

	await fs.writeFile(settingsFilePath(), JSON.stringify(current, null, 2), "utf-8");
	return current;
}

/** Decrypt a stored API key. Returns null when absent or undecryptable. */
export async function getDecryptedApiKey(provider: AiProviderId): Promise<string | null> {
	const settings = await loadAiSettings();
	const encrypted = settings.apiKeys[provider];
	if (!encrypted) return null;
	try {
		return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
	} catch (error) {
		console.error(`Failed to decrypt API key for ${provider}:`, error);
		return null;
	}
}
