import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useScopedT } from "@/contexts/I18nContext";
import type { AiChatItem } from "@/hooks/useAiChat";
import { AskUserQuestionCard } from "./AskUserQuestionCard";
import { formatElapsed } from "./elapsed";
import { ToolCallChip } from "./ToolCallChip";

/**
 * Assistant text is model-generated markdown (bold, lists, tables). Rendered
 * with GFM and compact styles tuned for the ~300px rail; wide tables scroll
 * horizontally inside their own container instead of breaking the layout.
 */
function AssistantMarkdown({ text }: { text: string }) {
	return (
		<div className="ai-chat-markdown text-sm text-white/90 break-words space-y-2">
			<Markdown
				remarkPlugins={[remarkGfm]}
				components={{
					a: ({ children, href }) => (
						<a href={href} target="_blank" rel="noreferrer" className="text-[#BDAEFF] underline">
							{children}
						</a>
					),
					ul: ({ children }) => <ul className="list-disc pl-4 space-y-1">{children}</ul>,
					ol: ({ children }) => <ol className="list-decimal pl-4 space-y-1">{children}</ol>,
					h1: ({ children }) => <p className="font-semibold text-white">{children}</p>,
					h2: ({ children }) => <p className="font-semibold text-white">{children}</p>,
					h3: ({ children }) => <p className="font-semibold text-white">{children}</p>,
					code: ({ children, className }) =>
						className ? (
							<code className="block overflow-x-auto rounded bg-black/40 px-2 py-1.5 text-xs font-mono">
								{children}
							</code>
						) : (
							<code className="rounded bg-white/10 px-1 py-0.5 text-xs font-mono">{children}</code>
						),
					pre: ({ children }) => <pre className="overflow-x-auto">{children}</pre>,
					table: ({ children }) => (
						<div className="overflow-x-auto -mx-1">
							<table className="text-xs border-collapse w-full min-w-max">{children}</table>
						</div>
					),
					th: ({ children }) => (
						<th className="border border-white/15 bg-white/5 px-2 py-1 text-left font-medium">
							{children}
						</th>
					),
					td: ({ children }) => (
						<td className="border border-white/10 px-2 py-1 align-top">{children}</td>
					),
					blockquote: ({ children }) => (
						<blockquote className="border-l-2 border-white/20 pl-2 text-white/70">
							{children}
						</blockquote>
					),
					hr: () => <hr className="border-white/10" />,
				}}
			>
				{text}
			</Markdown>
		</div>
	);
}

/**
 * A once-per-second clock that only ticks while `active` — so an in-flight AI
 * turn shows a live elapsed counter without re-rendering the panel when idle.
 */
function useTick(active: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [active]);
	return now;
}

interface ChatMessageListProps {
	items: AiChatItem[];
	busy: boolean;
	/** One-click auto edit CTA shown in the empty state. */
	onAutoEdit?: () => void;
	/** "Understand & brief me" CTA shown in the empty state. */
	onUnderstand?: () => void;
	onAnswerQuestion?: (itemId: number, answers: Record<string, string[]>) => void;
}

/**
 * Scrollable transcript. Auto-follows the bottom while streaming unless the
 * user has scrolled up to read something.
 */
export function ChatMessageList({
	items,
	busy,
	onAutoEdit,
	onUnderstand,
	onAnswerQuestion,
}: ChatMessageListProps) {
	const t = useScopedT("aiChat");
	const containerRef = useRef<HTMLDivElement>(null);
	const stickToBottomRef = useRef(true);

	// Live elapsed for the in-flight turn: start when busy flips on, tick while busy.
	const now = useTick(busy);
	const turnStartRef = useRef<number | null>(null);
	if (busy && turnStartRef.current === null) turnStartRef.current = Date.now();
	if (!busy && turnStartRef.current !== null) turnStartRef.current = null;
	const turnElapsedMs = busy && turnStartRef.current !== null ? now - turnStartRef.current : 0;

	const prevItemCountRef = useRef(0);
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		// Sending a message (typed, quick action, or context inject) re-engages
		// bottom-following even if the user had scrolled up to read something.
		const grew = items.length > prevItemCountRef.current;
		prevItemCountRef.current = items.length;
		if (grew && items[items.length - 1]?.kind === "user") {
			stickToBottomRef.current = true;
		}
		if (stickToBottomRef.current) {
			el.scrollTop = el.scrollHeight;
		}
	}, [items]);

	const handleScroll = () => {
		const el = containerRef.current;
		if (!el) return;
		stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
	};

	if (items.length === 0) {
		return (
			<div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
				{onUnderstand && (
					<button
						type="button"
						onClick={onUnderstand}
						className="inline-flex items-center gap-2 rounded-full border border-[#7C5CFF]/50 bg-transparent px-4 py-2 text-sm font-medium text-[#BDAEFF] hover:bg-[#7C5CFF]/10 transition-colors"
					>
						🔍 {t("understandButton")}
					</button>
				)}
				{onAutoEdit && (
					<button
						type="button"
						onClick={onAutoEdit}
						className="inline-flex items-center gap-2 rounded-full bg-[#7C5CFF] px-4 py-2 text-sm font-medium text-black hover:bg-[#9B84FF] transition-colors"
					>
						✨ {t("autoEditButton")}
					</button>
				)}
				<p className="mt-1 text-sm text-white/40 whitespace-pre-line">{t("emptyState")}</p>
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			onScroll={handleScroll}
			className="flex-1 min-h-0 overflow-y-auto px-3 pt-2 pb-4 space-y-2"
		>
			{items.map((item) => {
				switch (item.kind) {
					case "user":
						return (
							<div key={item.id} className="flex justify-end">
								<div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[#7C5CFF]/15 px-3 py-2 text-sm text-white whitespace-pre-wrap break-words">
									{item.attachments && item.attachments.length > 0 && (
										<div className={`flex flex-wrap gap-1.5 ${item.text ? "mb-1.5" : ""}`}>
											{item.attachments.map((attachment, index) => (
												<span
													key={`${item.id}-att-${index}`}
													className="flex items-center gap-1.5 rounded-lg bg-black/25 px-1.5 py-1 text-[11px] text-white/70"
												>
													<img
														src={attachment.thumb}
														alt=""
														className="h-6 w-6 rounded object-cover"
													/>
													<span className="max-w-[110px] truncate">{attachment.name}</span>
												</span>
											))}
										</div>
									)}
									{item.text}
								</div>
							</div>
						);
					case "assistant":
						return (
							<div key={item.id} className="flex justify-start">
								<div className="max-w-[92%] min-w-0 rounded-2xl rounded-bl-sm bg-white/[0.06] px-3 py-2">
									<AssistantMarkdown text={item.text} />
								</div>
							</div>
						);
					case "tool":
						return (
							<div key={item.id} className="flex justify-start">
								<ToolCallChip
									name={item.name}
									status={item.status}
									summary={item.summary}
									elapsedMs={
										item.status === "running" && item.startedAt !== undefined
											? now - item.startedAt
											: undefined
									}
								/>
							</div>
						);
					case "question":
						return (
							<AskUserQuestionCard
								key={item.id}
								questions={item.questions}
								answers={item.answers}
								expired={item.expired}
								onSubmit={(answers) => onAnswerQuestion?.(item.id, answers)}
							/>
						);
					case "error":
						return (
							<div key={item.id} className="flex justify-start">
								<div className="max-w-[92%] rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300 whitespace-pre-wrap break-words">
									{item.message}
								</div>
							</div>
						);
				}
			})}
			{busy && (
				<div className="flex justify-start py-3">
					<div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-white/[0.06] px-3.5 py-2.5">
						<span className="flex items-center gap-1">
							<span className="h-1.5 w-1.5 rounded-full bg-white/40 animate-pulse" />
							<span className="h-1.5 w-1.5 rounded-full bg-white/40 animate-pulse [animation-delay:150ms]" />
							<span className="h-1.5 w-1.5 rounded-full bg-white/40 animate-pulse [animation-delay:300ms]" />
						</span>
						<span className="text-[11px] tabular-nums text-white/35">
							{formatElapsed(turnElapsedMs)}
						</span>
					</div>
				</div>
			)}
		</div>
	);
}
