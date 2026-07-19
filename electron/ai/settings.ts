import fs from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";
import type { AiProviderId } from "./providers/types";

/**
 * Ids that can own a stored API key: chat providers plus effect services
 * (Decart powers the webcam restyle tool). Kept separate from AiProviderId so
 * non-chat services never leak into the provider registry.
 */
export type AiKeyId = AiProviderId | "decart";

/**
 * Persisted AI-panel configuration, stored as JSON under userData like
 * shortcuts.json. API keys are encrypted with Electron safeStorage and kept
 * as base64 — never written in plaintext and never sent to the renderer.
 */
export interface AiSettings {
	version: 1;
	provider: AiProviderId;
	/**
	 * True once the user has actively chosen a provider/model. While false the
	 * renderer auto-selects the first *usable* provider (has a key or a login)
	 * on each launch; once the user picks one we honor that choice instead.
	 */
	providerExplicit: boolean;
	modelByProvider: Partial<Record<AiProviderId, string>>;
	/** safeStorage-encrypted, base64-encoded API keys keyed by key id. */
	apiKeys: Partial<Record<AiKeyId, string>>;
}

/** Settings shape exposed to the renderer — never includes key material. */
export interface AiSettingsPublic {
	provider: AiProviderId;
	providerExplicit: boolean;
	modelByProvider: Partial<Record<AiProviderId, string>>;
	hasApiKey: Partial<Record<AiKeyId, boolean>>;
}

const DEFAULT_SETTINGS: AiSettings = {
	version: 1,
	provider: "claude-code",
	providerExplicit: false,
	modelByProvider: {},
	apiKeys: {},
};

const VALID_PROVIDERS: AiProviderId[] = ["claude-code", "openai", "gemini", "grok"];
const VALID_KEY_IDS: AiKeyId[] = [...VALID_PROVIDERS, "decart"];

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
			providerExplicit: parsed.providerExplicit === true,
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
	const hasApiKey: Partial<Record<AiKeyId, boolean>> = {};
	for (const keyId of VALID_KEY_IDS) {
		hasApiKey[keyId] = Boolean(settings.apiKeys[keyId]);
	}
	return {
		provider: settings.provider,
		providerExplicit: settings.providerExplicit,
		modelByProvider: settings.modelByProvider,
		hasApiKey,
	};
}

export async function saveAiSettings(update: {
	provider?: AiProviderId;
	modelByProvider?: Partial<Record<AiProviderId, string>>;
	/** Plaintext keys from the renderer; encrypted before persisting. */
	apiKeys?: Partial<Record<AiKeyId, string | null>>;
}): Promise<AiSettings> {
	const current = await loadAiSettings();

	if (update.provider && VALID_PROVIDERS.includes(update.provider)) {
		current.provider = update.provider;
		// Any provider write comes from a user model change — from now on we
		// honor their choice instead of auto-selecting by availability.
		current.providerExplicit = true;
	}
	if (update.modelByProvider) {
		current.modelByProvider = { ...current.modelByProvider, ...update.modelByProvider };
	}
	if (update.apiKeys) {
		for (const [keyId, key] of Object.entries(update.apiKeys)) {
			if (!VALID_KEY_IDS.includes(keyId as AiKeyId)) continue;
			if (key === null || key === "") {
				delete current.apiKeys[keyId as AiKeyId];
				continue;
			}
			if (!safeStorage.isEncryptionAvailable()) {
				throw new Error("safeStorage encryption unavailable; refusing to persist API key");
			}
			current.apiKeys[keyId as AiKeyId] = safeStorage.encryptString(key).toString("base64");
		}
	}

	await fs.writeFile(settingsFilePath(), JSON.stringify(current, null, 2), "utf-8");
	return current;
}

/** Decrypt a stored API key. Returns null when absent or undecryptable. */
export async function getDecryptedApiKey(provider: AiKeyId): Promise<string | null> {
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
