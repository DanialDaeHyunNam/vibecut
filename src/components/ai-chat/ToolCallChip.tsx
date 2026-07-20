import { AlertCircle, Check, Loader2, Wrench } from "lucide-react";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { formatElapsed } from "./elapsed";

interface ToolCallChipProps {
	name: string;
	status: "running" | "ok" | "error";
	summary?: string;
	/** Live elapsed for a running tool — surfaces slow steps (video scan, transcribe). */
	elapsedMs?: number;
}

/** Inline chip showing one editor tool call: spinner → result summary. */
export function ToolCallChip({ name, status, summary, elapsedMs }: ToolCallChipProps) {
	const t = useScopedT("aiChat");
	const base = t(`tool.${name}`);
	const label = summary ? `${base} · ${summary}` : base;

	return (
		<div
			className={cn(
				"inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
				status === "running" && "border-white/15 bg-white/5 text-white/70",
				status === "ok" && "border-[#7C5CFF]/40 bg-[#7C5CFF]/10 text-[#BDAEFF]",
				status === "error" && "border-red-500/40 bg-red-500/10 text-red-300",
			)}
		>
			{status === "running" && <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />}
			{status === "ok" && <Check className="h-3 w-3 flex-shrink-0" />}
			{status === "error" && <AlertCircle className="h-3 w-3 flex-shrink-0" />}
			{status === "running" && <Wrench className="h-3 w-3 flex-shrink-0 opacity-60" />}
			<span className="truncate">{status === "running" ? base : label}</span>
			{status === "running" && elapsedMs !== undefined && elapsedMs >= 2000 && (
				<span className="flex-shrink-0 tabular-nums text-white/40">{formatElapsed(elapsedMs)}</span>
			)}
		</div>
	);
}
