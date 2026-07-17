import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));

const { normalizeProviderPolicy } = await import("./providerPolicy");

describe("normalizeProviderPolicy", () => {
	it("parses a well-formed manifest", () => {
		const policy = normalizeProviderPolicy({
			updatedAt: "2026-07-17",
			providers: {
				"claude-code": {
					status: "notice",
					message: { en: "Heads up", ko: "안내" },
					link: "https://x",
				},
				gemini: { status: "disabled" },
				openai: { status: "ok" },
			},
		});
		expect(policy.updatedAt).toBe("2026-07-17");
		expect(policy.providers["claude-code"]).toEqual({
			status: "notice",
			message: { en: "Heads up", ko: "안내" },
			link: "https://x",
		});
		expect(policy.providers.gemini?.status).toBe("disabled");
		expect(policy.providers.openai?.status).toBe("ok");
	});

	it("degrades malformed input to all-ok instead of locking users out", () => {
		expect(normalizeProviderPolicy(null).providers).toEqual({});
		expect(normalizeProviderPolicy("nonsense").providers).toEqual({});
		expect(
			normalizeProviderPolicy({ providers: { gemini: { status: "banana" } } }).providers.gemini
				?.status,
		).toBe("ok");
		expect(
			normalizeProviderPolicy({
				providers: { gemini: { status: "disabled", message: { en: 42 } } },
			}).providers.gemini?.message,
		).toEqual({});
	});
});
