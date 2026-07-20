import { Loader2, MoreVertical, Paperclip, Send, Square, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useScopedT } from "@/contexts/I18nContext";
import {
	isSupportedAttachment,
	type OutgoingAttachment,
	processAttachmentFile,
} from "./attachments";

/** A quick-action (Understand / Auto-edit): floats above the input until used. */
export interface ComposerAction {
	key: string;
	label: string;
	icon: ReactNode;
	onClick: () => void;
}

interface ChatComposerProps {
	busy: boolean;
	disabled: boolean;
	onSend: (text: string, attachments: OutgoingAttachment[]) => void;
	onStop: () => void;
	/** Quick actions shown as a row directly above the input (session's unused ones). */
	aboveActions?: ComposerAction[];
	/** Quick actions collapsed into the ⋮ menu on the right (once all were used). */
	menuActions?: ComposerAction[];
	/** Timeline "@" context to append to the input; re-appends when nonce changes. */
	contextInsert?: { text: string; nonce: number };
}

interface PendingAttachment {
	id: number;
	name: string;
	/** null while the file is still being processed (video keyframe scan). */
	ready: OutgoingAttachment | null;
	failed: boolean;
}

/**
 * Message input. Enter sends, Shift+Enter inserts a newline. The isComposing
 * guard keeps Enter from firing mid-composition with Korean/Japanese/Chinese
 * IMEs (the classic double-submit bug).
 *
 * Quick actions live above the input while at least one is unused this session,
 * then collapse into the right-side ⋮ menu once both have been run — so the
 * common next step is always one glance away, without permanent chrome. Rows
 * stack top→bottom as: quick actions → attachment chips → input, so context
 * (chips) sits closest to the text it belongs to. Images and videos attach via
 * the paperclip, paste, or drag & drop; videos become keyframe contact sheets
 * before send, so a send waits until every attachment finished processing.
 */
export function ChatComposer({
	busy,
	disabled,
	onSend,
	onStop,
	aboveActions = [],
	menuActions = [],
	contextInsert,
}: ChatComposerProps) {
	const t = useScopedT("aiChat");
	const [text, setText] = useState("");
	const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
	const [dragOver, setDragOver] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const nextAttachmentId = useRef(1);

	// Append timeline "@" context to the draft (each with a trailing space so the
	// user keeps typing their instruction), then focus. Keyed on nonce so adding
	// the same block twice still appends; nonce 0 is the initial no-op.
	const insertNonce = contextInsert?.nonce ?? 0;
	const insertText = contextInsert?.text ?? "";
	// biome-ignore lint/correctness/useExhaustiveDependencies: nonce is the sole trigger — insertText is read fresh but must not re-run the append on its own.
	useEffect(() => {
		if (insertNonce === 0 || !insertText) return;
		setText((prev) => (prev ? `${prev.replace(/\s*$/, "")} ${insertText} ` : `${insertText} `));
		textareaRef.current?.focus();
	}, [insertNonce]);

	const addFiles = (files: Iterable<File>) => {
		for (const file of files) {
			if (!isSupportedAttachment(file)) continue;
			const id = nextAttachmentId.current++;
			setAttachments((prev) => [...prev, { id, name: file.name, ready: null, failed: false }]);
			void processAttachmentFile(file)
				.then((ready) => {
					setAttachments((prev) =>
						prev.map((entry) => (entry.id === id ? { ...entry, ready } : entry)),
					);
				})
				.catch(() => {
					setAttachments((prev) =>
						prev.map((entry) => (entry.id === id ? { ...entry, failed: true } : entry)),
					);
				});
		}
	};

	const processing = attachments.some((entry) => entry.ready === null && !entry.failed);
	const readyAttachments = attachments
		.filter((entry) => entry.ready !== null)
		.map((entry) => entry.ready as OutgoingAttachment);

	const submit = () => {
		const trimmed = text.trim();
		if ((!trimmed && readyAttachments.length === 0) || busy || disabled || processing) return;
		onSend(trimmed, readyAttachments);
		setText("");
		setAttachments([]);
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && !event.shiftKey) {
			if (event.nativeEvent.isComposing) return;
			event.preventDefault();
			submit();
		}
	};

	const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
		const files = Array.from(event.clipboardData?.files ?? []).filter(isSupportedAttachment);
		if (files.length > 0) {
			event.preventDefault();
			addFiles(files);
		}
	};

	return (
		<div className="px-3 pb-2">
			{aboveActions.length > 0 && (
				<div className="flex flex-wrap gap-1.5 pb-1.5">
					{aboveActions.map((action) => (
						<button
							key={action.key}
							type="button"
							disabled={busy || disabled}
							onClick={action.onClick}
							className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-white/70 hover:text-white hover:bg-white/[0.08] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
						>
							{action.icon}
							{action.label}
						</button>
					))}
				</div>
			)}
			{attachments.length > 0 && (
				<div className="flex flex-wrap gap-1.5 pb-1.5">
					{attachments.map((entry) => (
						<div
							key={entry.id}
							className={`flex items-center gap-1.5 rounded-lg border px-1.5 py-1 text-[11px] ${
								entry.failed
									? "border-red-500/40 bg-red-500/10 text-red-300"
									: "border-white/10 bg-white/[0.05] text-white/70"
							}`}
						>
							{entry.ready ? (
								<img src={entry.ready.thumb} alt="" className="h-6 w-6 rounded object-cover" />
							) : entry.failed ? null : (
								<Loader2 className="h-3.5 w-3.5 animate-spin text-white/40" />
							)}
							<span className="max-w-[120px] truncate">
								{entry.failed ? t("attachFailed", { name: entry.name }) : entry.name}
							</span>
							<button
								type="button"
								aria-label={t("attachRemove")}
								className="text-white/40 hover:text-white/80"
								onClick={() => setAttachments((prev) => prev.filter(({ id }) => id !== entry.id))}
							>
								<X className="h-3 w-3" />
							</button>
						</div>
					))}
				</div>
			)}
			<div
				className={`flex items-stretch gap-1.5 rounded-lg ${dragOver ? "ring-1 ring-[#7C5CFF]/60" : ""}`}
				onDragOver={(event) => {
					if (event.dataTransfer.types.includes("Files")) {
						event.preventDefault();
						setDragOver(true);
					}
				}}
				onDragLeave={() => setDragOver(false)}
				onDrop={(event) => {
					event.preventDefault();
					setDragOver(false);
					addFiles(event.dataTransfer.files);
				}}
			>
				<input
					ref={fileInputRef}
					type="file"
					accept="image/*,video/*"
					multiple
					className="hidden"
					onChange={(event) => {
						addFiles(event.target.files ?? []);
						event.target.value = "";
					}}
				/>
				<Textarea
					ref={textareaRef}
					value={text}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={handleKeyDown}
					onPaste={handlePaste}
					placeholder={t("composerPlaceholder")}
					disabled={disabled}
					rows={3}
					className="resize-none min-h-[76px] max-h-44 text-sm bg-white/[0.04] border-white/10"
				/>
				{/* Right rail: ⋮ (only when both quick actions were used) / 📎 / send,
				    evenly spaced so no two buttons read as a pair. */}
				<div className="flex flex-col flex-shrink-0 gap-1.5">
					{menuActions.length > 0 && (
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
								{menuActions.map((action) => (
									<DropdownMenuItem
										key={action.key}
										disabled={busy || disabled}
										onSelect={() => action.onClick()}
									>
										<span className="mr-2 flex h-3.5 w-3.5 items-center justify-center">
											{action.icon}
										</span>
										{action.label}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					)}
					<Button
						size="icon"
						variant="ghost"
						className="h-8 w-8 border border-white/10 bg-white/[0.04]"
						title={t("attach")}
						disabled={disabled}
						onClick={() => fileInputRef.current?.click()}
					>
						<Paperclip className="h-4 w-4" />
					</Button>
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
							disabled={disabled || processing || (!text.trim() && readyAttachments.length === 0)}
							title={t("send")}
						>
							<Send className="h-4 w-4" />
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
