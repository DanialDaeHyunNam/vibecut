import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type { AiProviderId } from "./providers/types";

/**
 * Remote provider-policy manifest — the kill switch that decouples policy
 * response from the release cycle. AI-provider subscription terms shifted
 * three times in 2026 alone; if they shift again, we edit one JSON on the
 * landing deployment and every installed app reacts within a day, no app
 * update needed. Privacy: this is a single static-file GET with no payload —
 * nothing about the user or their usage is transmitted (disclosed in README).
 */

const POLICY_URL = "https://vibecut-orcin.vercel.app/provider-policy.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

export type ProviderPolicyStatus = "ok" | "notice" | "disabled";

export interface ProviderPolicyEntry {
	status: ProviderPolicyStatus;
	/** Localized message, keyed by locale ("en" fallback required for non-ok). */
	message?: Record<string, string>;
	link?: string;
}

export interface ProviderPolicy {
	updatedAt: string;
	providers: Partial<Record<AiProviderId, ProviderPolicyEntry>>;
}

const ALL_OK: ProviderPolicy = { updatedAt: "", providers: {} };

/**
 * Parse an untrusted manifest into a safe shape. Unknown statuses degrade to
 * "ok" — a malformed manifest must never lock users out of a working feature.
 */
export function normalizeProviderPolicy(raw: unknown): ProviderPolicy {
	if (typeof raw !== "object" || raw === null) return ALL_OK;
	const data = raw as { updatedAt?: unknown; providers?: unknown };
	const providers: ProviderPolicy["providers"] = {};
	if (typeof data.providers === "object" && data.providers !== null) {
		for (const [id, entry] of Object.entries(data.providers as Record<string, unknown>)) {
			if (typeof entry !== "object" || entry === null) continue;
			const candidate = entry as { status?: unknown; message?: unknown; link?: unknown };
			const status: ProviderPolicyStatus =
				candidate.status === "notice" || candidate.status === "disabled" ? candidate.status : "ok";
			const message =
				typeof candidate.message === "object" && candidate.message !== null
					? Object.fromEntries(
							Object.entries(candidate.message as Record<string, unknown>).filter(
								([, value]) => typeof value === "string",
							) as Array<[string, string]>,
						)
					: undefined;
			providers[id as AiProviderId] = {
				status,
				message,
				link: typeof candidate.link === "string" ? candidate.link : undefined,
			};
		}
	}
	return {
		updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
		providers,
	};
}

interface PolicyCache {
	fetchedAt: number;
	policy: ProviderPolicy;
}

function cachePath(): string {
	return path.join(app.getPath("userData"), "provider-policy-cache.json");
}

async function readCache(): Promise<PolicyCache | null> {
	try {
		const raw = JSON.parse(await fs.readFile(cachePath(), "utf-8")) as PolicyCache;
		if (typeof raw?.fetchedAt !== "number") return null;
		return { fetchedAt: raw.fetchedAt, policy: normalizeProviderPolicy(raw.policy) };
	} catch {
		return null;
	}
}

let inFlight: Promise<ProviderPolicy> | null = null;

/**
 * Current policy, at most one network fetch per TTL. Fail-open: on any
 * network/parse failure the last cached policy (or all-ok) is returned so an
 * offline machine keeps working.
 */
export async function getProviderPolicy(): Promise<ProviderPolicy> {
	const cache = await readCache();
	if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
		return cache.policy;
	}
	inFlight ??= (async () => {
		try {
			const response = await fetch(POLICY_URL, {
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
				cache: "no-store",
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const policy = normalizeProviderPolicy(await response.json());
			await fs
				.writeFile(
					cachePath(),
					JSON.stringify({ fetchedAt: Date.now(), policy } satisfies PolicyCache),
					"utf-8",
				)
				.catch(() => {
					// Cache write failure just means a re-fetch next time.
				});
			return policy;
		} catch {
			return cache?.policy ?? ALL_OK;
		} finally {
			inFlight = null;
		}
	})();
	return inFlight;
}
