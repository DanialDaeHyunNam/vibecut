import { KeyRound, LogIn, PackageX, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import { type AiChatSnapshotSource, useAiChat } from "@/hooks/useAiChat";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageList } from "./ChatMessageList";
import { ModelPicker } from "./ModelPicker";

interface AiChatPanelProps {
	getSnapshot: AiChatSnapshotSource;
	/** Per-project persistence key (project path or video path). */
	storageKey: string | null;
}

/**
 * Right-rail AI tab: status gate (provider missing / not signed in / key
 * needed) → transcript → composer → model picker. The picker stays visible
 * under the gate so the user can switch providers or paste an API key instead
 * of being stuck. All editing happens through the main-process agent whose
 * tool calls land back in VideoEditor via useAiToolHost — this panel is pure
 * conversation UI.
 */
export function AiChatPanel({ getSnapshot, storageKey }: AiChatPanelProps) {
	const t = useScopedT("aiChat");
	const chat = useAiChat(getSnapshot, storageKey);

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

	const gate = (() => {
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

	const picker = (
		<ModelPicker
			providers={chat.providers}
			provider={chat.provider}
			model={chat.model}
			onModelChange={chat.setModel}
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
				onAutoEdit={() => void chat.send(t("autoEditPrompt"))}
				onUnderstand={() => void chat.send(t("understandPrompt"))}
				onAnswerQuestion={chat.answerQuestion}
			/>
			<ChatComposer
				busy={chat.busy}
				disabled={!chat.status?.available}
				onSend={(text) => void chat.send(text)}
				onStop={() => void chat.stop()}
				onAutoEdit={() => void chat.send(t("autoEditPrompt"))}
				onUnderstand={() => void chat.send(t("understandPrompt"))}
			/>
			{picker}
		</div>
	);
}
