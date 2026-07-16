import { LogIn, PackageX, Sparkles } from "lucide-react";
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
 * Right-rail AI tab: status gate (Claude Code missing / not logged in) →
 * transcript → composer → model picker. All editing happens through the
 * main-process agent whose tool calls land back in VideoEditor via
 * useAiToolHost — this panel is pure conversation UI.
 */
export function AiChatPanel({ getSnapshot, storageKey }: AiChatPanelProps) {
	const t = useScopedT("aiChat");
	const chat = useAiChat(getSnapshot, storageKey);

	const gate = (() => {
		if (!chat.status || chat.status.available) return null;
		switch (chat.status.reason) {
			case "not-installed":
				return {
					icon: <PackageX className="h-8 w-8 text-white/30" />,
					title: t("notInstalledTitle"),
					body: t("notInstalledBody"),
				};
			case "not-authenticated":
				return {
					icon: <LogIn className="h-8 w-8 text-white/30" />,
					title: t("notAuthenticatedTitle"),
					body: t("notAuthenticatedBody"),
				};
			default:
				return {
					icon: <Sparkles className="h-8 w-8 text-white/30" />,
					title: t("unavailableTitle"),
					body: chat.status.detail ?? "",
				};
		}
	})();

	if (gate) {
		return (
			<div className="editor-preview-panel h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
				{gate.icon}
				<h3 className="text-sm font-medium text-white/80">{gate.title}</h3>
				<p className="text-xs text-white/50 whitespace-pre-line">{gate.body}</p>
				<Button size="sm" variant="secondary" onClick={() => void chat.refreshStatus()}>
					{t("retry")}
				</Button>
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
			<ModelPicker
				providers={chat.providers}
				provider={chat.provider}
				model={chat.model}
				onModelChange={chat.setModel}
			/>
		</div>
	);
}
