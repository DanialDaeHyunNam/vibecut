import { MoreVertical, Search, Send, Sparkles, Square } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useScopedT } from "@/contexts/I18nContext";

interface ChatComposerProps {
	busy: boolean;
	disabled: boolean;
	onSend: (text: string) => void;
	onStop: () => void;
	/** Quick actions (auto-edit / understand) — always reachable from the ⋮ menu. */
	onAutoEdit?: () => void;
	onUnderstand?: () => void;
}

/**
 * Message input. Enter sends, Shift+Enter inserts a newline. The isComposing
 * guard keeps Enter from firing mid-composition with Korean/Japanese/Chinese
 * IMEs (the classic double-submit bug). The ⋮ menu keeps the auto-edit and
 * understand actions reachable after the empty-state CTAs scroll away.
 */
export function ChatComposer({
	busy,
	disabled,
	onSend,
	onStop,
	onAutoEdit,
	onUnderstand,
}: ChatComposerProps) {
	const t = useScopedT("aiChat");
	const [text, setText] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const submit = () => {
		const trimmed = text.trim();
		if (!trimmed || busy || disabled) return;
		onSend(trimmed);
		setText("");
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && !event.shiftKey) {
			if (event.nativeEvent.isComposing) return;
			event.preventDefault();
			submit();
		}
	};

	const hasActions = Boolean(onAutoEdit || onUnderstand);

	return (
		<div className="flex items-stretch gap-1.5 px-3 pb-2">
			<Textarea
				ref={textareaRef}
				value={text}
				onChange={(event) => setText(event.target.value)}
				onKeyDown={handleKeyDown}
				placeholder={t("composerPlaceholder")}
				disabled={disabled}
				rows={3}
				className="resize-none min-h-[76px] max-h-44 text-sm bg-white/[0.04] border-white/10"
			/>
			{/* Button rail stretches with the textarea: ⋮ pinned top, send pinned bottom. */}
			<div
				className={`flex flex-col flex-shrink-0 ${hasActions ? "justify-between" : "justify-end"}`}
			>
				{hasActions && (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								size="icon"
								variant="ghost"
								className="h-8 w-8 border border-white/10 bg-white/[0.04]"
								title={t("actionsMenu")}
							>
								<MoreVertical className="h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent side="top" align="end" className="min-w-[200px]">
							{onUnderstand && (
								<DropdownMenuItem disabled={busy || disabled} onSelect={() => onUnderstand()}>
									<Search className="h-3.5 w-3.5 mr-2" />
									{t("understandButton")}
								</DropdownMenuItem>
							)}
							{onAutoEdit && (
								<DropdownMenuItem disabled={busy || disabled} onSelect={() => onAutoEdit()}>
									<Sparkles className="h-3.5 w-3.5 mr-2" />
									{t("autoEditButton")}
								</DropdownMenuItem>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
				{busy ? (
					<Button
						size="icon"
						variant="secondary"
						className="h-8 w-8"
						onClick={onStop}
						title={t("stop")}
					>
						<Square className="h-4 w-4" />
					</Button>
				) : (
					<Button
						size="icon"
						className="h-8 w-8"
						onClick={submit}
						disabled={disabled || !text.trim()}
						title={t("send")}
					>
						<Send className="h-4 w-4" />
					</Button>
				)}
			</div>
		</div>
	);
}
