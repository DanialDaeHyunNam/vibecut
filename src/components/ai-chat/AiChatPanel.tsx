import { Info, KeyRound, LogIn, PackageX, Search, ShieldAlert, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { type AiChatSnapshotSource, useAiChat } from "@/hooks/useAiChat";
import { ChatComposer, type ComposerAction } from "./ChatComposer";
import { ChatMessageList } from "./ChatMessageList";
import { type KeyPrompt, ModelPicker } from "./ModelPicker";

interface AiChatPanelProps {
	getSnapshot: AiChatSnapshotSource;
	/** Per-project persistence key (the recording path). */
	storageKey: string | null;
	/** Old project-path key to recover a pre-fix transcript from, if any. */
	legacyStorageKey?: string | null;
	/** Text to append to the composer (timeline "@" context), bumped by nonce. */
	contextInsert?: { text: string; nonce: number };
}

/** Providers that authenticate with the user's own subscription login. */
const SUBSCRIPTION_PROVIDERS: AiProviderId[] = ["claude-code", "openai"];

/** Resolve a remote policy message ({"en": ..., "ko": ...}) for the UI locale. */
function localizedPolicyMessage(
	message: Record<string, string> | undefined,
	locale: string,
): string | null {
	if (!message) return null;
	return (
		message[locale] ??
		message[locale.split("-")[0]] ??
		message.en ??
		Object.values(message)[0] ??
		null
	);
}

function safeGetItem(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function safeSetItem(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Losing persistence just re-shows the banner next launch.
	}
}

/**
 * Right-rail AI tab: policy gate / status gate (provider missing, not signed
 * in, key needed, or remotely disabled) → transcript → composer → model
 * picker. The picker stays visible under every gate so the user can switch
 * providers or paste an API key instead of being stuck. All editing happens
 * through the main-process agent whose tool calls land back in VideoEditor
 * via useAiToolHost — this panel is pure conversation UI.
 */
export function AiChatPanel({
	getSnapshot,
	storageKey,
	legacyStorageKey,
	contextInsert,
}: AiChatPanelProps) {
	const t = useScopedT("aiChat");
	const { locale } = useI18n();
	const chat = useAiChat(getSnapshot, storageKey, legacyStorageKey);
	const [, forceRender] = useState(0);
	const bump = () => forceRender((n) => n + 1);

	// Quick-action arrangement: Understand / Auto-edit start as big CTAs in the
	// empty state, float above the input once the chat has started, and collapse
	// into the ⋮ menu after both were used this session. Reset when the chat is
	// cleared (project/video switch empties items).
	const [usedActions, setUsedActions] = useState({ understand: false, autoEdit: false });
	const chatStarted = chat.items.length > 0;
	useEffect(() => {
		if (!chatStarted) setUsedActions({ understand: false, autoEdit: false });
	}, [chatStarted]);

	const runUnderstand = () => {
		setUsedActions((prev) => ({ ...prev, understand: true }));
		void chat.send(t("understandPrompt"));
	};
	const runAutoEdit = () => {
		setUsedActions((prev) => ({ ...prev, autoEdit: true }));
		void chat.send(t("autoEditPrompt"));
	};

	const understandAction: ComposerAction = {
		key: "understand",
		label: t("understandButton"),
		icon: <Search className="h-3.5 w-3.5" />,
		onClick: runUnderstand,
	};
	const autoEditAction: ComposerAction = {
		key: "autoEdit",
		label: t("autoEditButton"),
		icon: <Sparkles className="h-3.5 w-3.5" />,
		onClick: runAutoEdit,
	};

	const bothUsed = usedActions.understand && usedActions.autoEdit;
	// Above the input: the session's not-yet-used quick actions (only once the
	// chat has started — the empty state has its own CTAs). In the ⋮ menu: both,
	// but only after both were used, so the row above can go away.
	const aboveActions: ComposerAction[] =
		chatStarted && !bothUsed
			? [
					...(usedActions.understand ? [] : [understandAction]),
					...(usedActions.autoEdit ? [] : [autoEditAction]),
				]
			: [];
	const menuActions: ComposerAction[] =
		chatStarted && bothUsed ? [understandAction, autoEditAction] : [];

	// CLI-backed providers other than Claude share templated gate copy.
	const cliInfo: Partial<Record<AiProviderId, { name: string; install: string; login: string }>> = {
		openai: { name: "Codex", install: "npm install -g @openai/codex", login: "codex login" },
		gemini: { name: "Gemini CLI", install: "npm install -g @google/gemini-cli", login: "" },
	};
	// Key-auth providers: where the user gets a key from.
	const keyInfo: Partial<Record<AiProviderId, { name: string; source: string }>> = {
		gemini: { name: "Gemini", source: "Google AI Studio (aistudio.google.com/apikey)" },
		"claude-code": { name: "Anthropic", source: "platform.claude.com" },
	};

	const providerLabel =
		chat.providers.find((entry) => entry.id === chat.provider)?.label ?? chat.provider;
	const policyEntry = chat.policy?.providers[chat.provider];
	const policyMessage = localizedPolicyMessage(policyEntry?.message, locale);

	const gate = (() => {
		// Remote kill switch outranks local status: a provider the manifest
		// disabled must not be usable even if login/key checks pass.
		if (policyEntry?.status === "disabled") {
			return {
				icon: <ShieldAlert className="h-8 w-8 text-amber-400/70" />,
				title: t("policyDisabledTitle", { name: providerLabel }),
				body: policyMessage ?? t("policyDisabledBody"),
				link: policyEntry.link,
			};
		}
		if (!chat.status || chat.status.available) return null;
		const cli = cliInfo[chat.provider];
		switch (chat.status.reason) {
			case "not-installed":
				return {
					icon: <PackageX className="h-8 w-8 text-white/30" />,
					title: cli ? t("cliNotInstalledTitle", { name: cli.name }) : t("notInstalledTitle"),
					body: cli
						? t("cliNotInstalledBody", { name: cli.name, install: cli.install })
						: t("notInstalledBody"),
				};
			case "not-authenticated":
				return {
					icon: <LogIn className="h-8 w-8 text-white/30" />,
					title:
						cli && cli.login
							? t("cliNotAuthenticatedTitle", { name: cli.name })
							: t("notAuthenticatedTitle"),
					body:
						cli && cli.login
							? t("cliNotAuthenticatedBody", { name: cli.name, login: cli.login })
							: t("notAuthenticatedBody"),
				};
			case "no-api-key": {
				const info = keyInfo[chat.provider];
				return {
					icon: <KeyRound className="h-8 w-8 text-white/30" />,
					title: t("noApiKeyTitle", { name: info?.name ?? chat.provider }),
					body: t("noApiKeyBody", {
						name: info?.name ?? chat.provider,
						source: info?.source ?? "",
					}),
				};
			}
			default:
				return {
					icon: <Sparkles className="h-8 w-8 text-white/30" />,
					title: t("unavailableTitle"),
					body: chat.status.detail ?? "",
				};
		}
	})();

	// Remote "notice" banner — dismissible per exact message, so an updated
	// notice resurfaces even if an older one was dismissed.
	const noticeDismissKey = `vibecut-policy-dismissed:${chat.provider}:${policyMessage ?? ""}`;
	const showPolicyNotice =
		policyEntry?.status === "notice" && policyMessage && !safeGetItem(noticeDismissKey);

	// One-time informed-consent note for subscription-auth providers.
	const consentKey = `vibecut-sub-consent:${chat.provider}`;
	const showConsent =
		!gate && SUBSCRIPTION_PROVIDERS.includes(chat.provider) && !safeGetItem(consentKey);

	const banners = (
		<>
			{showPolicyNotice && (
				<div className="mx-3 mb-2 flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2 text-[11.5px] text-amber-100/90">
					<ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/80" />
					<span className="flex-1">
						{policyMessage}
						{policyEntry?.link && (
							<button
								type="button"
								className="ml-1.5 underline underline-offset-2 hover:text-amber-50"
								onClick={() => window.electronAPI.openExternalUrl(policyEntry.link as string)}
							>
								{t("policyLearnMore")}
							</button>
						)}
					</span>
					<button
						type="button"
						aria-label={t("dismiss")}
						className="text-amber-200/50 hover:text-amber-100"
						onClick={() => {
							safeSetItem(noticeDismissKey, "1");
							bump();
						}}
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>
			)}
			{showConsent && (
				<div className="mx-3 mb-2 flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[11.5px] text-white/60">
					<Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/35" />
					<span className="flex-1">{t("subscriptionNotice", { name: providerLabel })}</span>
					<Button
						size="sm"
						variant="secondary"
						className="h-6 px-2 text-[11px]"
						onClick={() => {
							safeSetItem(consentKey, "1");
							bump();
						}}
					>
						{t("subscriptionNoticeOk")}
					</Button>
				</div>
			)}
		</>
	);

	// Just-in-time key prompts: only ask for a key the user is actually blocked
	// on. The active chat provider gets a row when its status needs one; Decart
	// gets one only after the agent tries the webcam-restyle tool.
	const keyPrompts: KeyPrompt[] = [];
	if (chat.status && !chat.status.available) {
		if (chat.status.reason === "no-api-key" && chat.provider === "gemini") {
			keyPrompts.push({ keyId: "gemini", name: "Gemini", optional: false });
		} else if (chat.status.reason === "not-authenticated" && chat.provider === "claude-code") {
			keyPrompts.push({ keyId: "claude-code", name: "Anthropic", optional: true });
		}
	}
	if (chat.restyleRequested) {
		keyPrompts.push({ keyId: "decart", name: "Decart", optional: false });
	}

	const picker = (
		<ModelPicker
			providers={chat.providers}
			model={chat.model}
			onModelChange={chat.setModel}
			keyPrompts={keyPrompts}
			onApiKeyChanged={() => void chat.refreshStatus()}
		/>
	);

	if (gate) {
		return (
			<div className="editor-preview-panel h-full flex flex-col min-h-0 overflow-hidden">
				<div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center min-h-0">
					{gate.icon}
					<h3 className="text-sm font-medium text-white/80">{gate.title}</h3>
					<p className="text-xs text-white/50 whitespace-pre-line">{gate.body}</p>
					{gate.link && (
						<button
							type="button"
							className="text-xs text-white/60 underline underline-offset-2 hover:text-white/90"
							onClick={() => window.electronAPI.openExternalUrl(gate.link as string)}
						>
							{t("policyLearnMore")}
						</button>
					)}
					<Button size="sm" variant="secondary" onClick={() => void chat.refreshStatus()}>
						{t("retry")}
					</Button>
				</div>
				{picker}
			</div>
		);
	}

	return (
		<div className="editor-preview-panel h-full flex flex-col min-h-0 overflow-hidden">
			<ChatMessageList
				items={chat.items}
				busy={chat.busy}
				onAutoEdit={runAutoEdit}
				onUnderstand={runUnderstand}
				onAnswerQuestion={chat.answerQuestion}
			/>
			{banners}
			<ChatComposer
				busy={chat.busy}
				disabled={!chat.status?.available}
				onSend={(text, attachments) => void chat.send(text, attachments)}
				onStop={() => void chat.stop()}
				aboveActions={aboveActions}
				menuActions={menuActions}
				contextInsert={contextInsert}
			/>
			{picker}
		</div>
	);
}
