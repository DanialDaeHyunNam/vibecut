import { Check, ChevronRight, Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useScopedT } from "@/contexts/I18nContext";
import type { AskUserQuestionSpec } from "@/hooks/useAiChat";
import { cn } from "@/lib/utils";

interface AskUserQuestionCardProps {
	questions: AskUserQuestionSpec[];
	/** null while awaiting input; the picked labels after submission. */
	answers: Record<string, string[]> | null;
	expired?: boolean;
	onSubmit: (answers: Record<string, string[]>) => void;
}

const OTHER = "__other__";

/**
 * Step-carousel question card: one question is open at a time; picking a
 * single-select option collapses it into a summary chip and advances (the
 * last pick submits). Multi-select and custom text confirm with a button.
 * Collapsed steps can be reopened until the card is submitted.
 */
export function AskUserQuestionCard({
	questions,
	answers,
	expired,
	onSubmit,
}: AskUserQuestionCardProps) {
	const t = useScopedT("aiChat");
	const [activeIndex, setActiveIndex] = useState(0);
	const [picks, setPicks] = useState<Record<string, string[]>>({});
	const [customText, setCustomText] = useState<Record<string, string>>({});
	const submitted = answers !== null;
	const frozen = submitted || Boolean(expired);

	const resolved = (spec: AskUserQuestionSpec, raw?: string[]): string[] =>
		(raw ?? picks[spec.question] ?? [])
			.map((label) => (label === OTHER ? (customText[spec.question] ?? "").trim() : label))
			.filter((label) => label.length > 0);

	const finishWith = (finalPicks: Record<string, string[]>) => {
		const result: Record<string, string[]> = {};
		for (const spec of questions) {
			result[spec.question] = resolved(spec, finalPicks[spec.question]);
		}
		onSubmit(result);
	};

	/** Collapse the current step; advance or submit when it was the last one. */
	const advance = (finalPicks: Record<string, string[]>) => {
		const nextUnanswered = questions.findIndex(
			(spec, index) =>
				index !== activeIndex && resolved(spec, finalPicks[spec.question]).length === 0,
		);
		if (nextUnanswered === -1) {
			finishWith(finalPicks);
		} else {
			setActiveIndex(nextUnanswered);
		}
	};

	const pickSingle = (spec: AskUserQuestionSpec, label: string) => {
		if (frozen) return;
		const nextPicks = { ...picks, [spec.question]: [label] };
		setPicks(nextPicks);
		if (label !== OTHER) {
			advance(nextPicks);
		}
	};

	const toggleMulti = (spec: AskUserQuestionSpec, label: string) => {
		if (frozen) return;
		setPicks((prev) => {
			const current = prev[spec.question] ?? [];
			return {
				...prev,
				[spec.question]: current.includes(label)
					? current.filter((entry) => entry !== label)
					: [...current, label],
			};
		});
	};

	const summaryFor = (spec: AskUserQuestionSpec): string => {
		const labels = submitted ? (answers?.[spec.question] ?? []) : resolved(spec);
		return labels.join(", ");
	};

	return (
		<div
			className={cn(
				"w-full rounded-xl border border-[#7C5CFF]/30 bg-[#7C5CFF]/[0.04] p-2.5 space-y-1.5",
				// Past cards (answered or expired) read as history, not as a
				// question waiting for input.
				submitted && "opacity-60 border-white/10 bg-white/[0.02]",
				expired && "opacity-50 border-white/10 bg-white/[0.02]",
			)}
		>
			{!frozen && questions.length > 1 && (
				<div className="flex items-center gap-1 px-0.5 pb-0.5">
					{questions.map((spec, index) => (
						<span
							key={spec.question}
							className={cn(
								"h-1 flex-1 rounded-full",
								index === activeIndex
									? "bg-[#7C5CFF]"
									: resolved(spec).length > 0
										? "bg-[#7C5CFF]/40"
										: "bg-white/10",
							)}
						/>
					))}
				</div>
			)}

			{questions.map((spec, index) => {
				const isActive = !frozen && index === activeIndex;
				const summary = summaryFor(spec);

				// Collapsed chip: answered (or inactive) step in one row.
				if (!isActive) {
					return (
						<button
							key={spec.question}
							type="button"
							disabled={frozen}
							onClick={() => setActiveIndex(index)}
							className={cn(
								"flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-left",
								!frozen && "hover:border-white/25",
							)}
						>
							{spec.header && (
								<span className="flex-shrink-0 rounded-full bg-[#7C5CFF]/15 px-2 py-0.5 text-[10px] font-medium text-[#BDAEFF]">
									{spec.header}
								</span>
							)}
							<span
								className={cn(
									"min-w-0 flex-1 truncate text-xs",
									summary ? "text-white/90" : "text-white/40",
								)}
							>
								{summary || spec.question}
							</span>
							{summary ? (
								<Check className="h-3 w-3 flex-shrink-0 text-[#7C5CFF]" />
							) : (
								<ChevronRight className="h-3 w-3 flex-shrink-0 text-white/30" />
							)}
							{!frozen && summary && <Pencil className="h-2.5 w-2.5 flex-shrink-0 text-white/30" />}
						</button>
					);
				}

				// Active step: full question with options.
				const currentRaw = picks[spec.question] ?? [];
				const otherSelected = currentRaw.includes(OTHER);
				const canConfirm = resolved(spec).length > 0;
				const needsConfirmButton = spec.multiSelect || otherSelected;

				return (
					<div key={spec.question} className="space-y-1.5 rounded-lg bg-white/[0.02] p-2">
						<div className="flex items-center gap-2">
							{spec.header && (
								<span className="rounded-full bg-[#7C5CFF]/15 px-2 py-0.5 text-[10px] font-medium text-[#BDAEFF]">
									{spec.header}
								</span>
							)}
							{questions.length > 1 && (
								<span className="text-[10px] text-white/30">
									{index + 1}/{questions.length}
								</span>
							)}
						</div>
						<p className="text-sm text-white/90">{spec.question}</p>
						<div className="space-y-1">
							{spec.options.map((option) => {
								const isSelected = currentRaw.includes(option.label);
								return (
									<button
										key={option.label}
										type="button"
										onClick={() =>
											spec.multiSelect
												? toggleMulti(spec, option.label)
												: pickSingle(spec, option.label)
										}
										className={cn(
											"w-full rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
											isSelected
												? "border-[#7C5CFF] bg-[#7C5CFF]/15 text-white"
												: "border-white/10 bg-white/[0.03] text-white/80 hover:border-white/25",
										)}
									>
										<span className="flex items-start gap-2">
											<span
												className={cn(
													"mt-0.5 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center border",
													spec.multiSelect ? "rounded" : "rounded-full",
													isSelected ? "border-[#7C5CFF] bg-[#7C5CFF]" : "border-white/30",
												)}
											>
												{isSelected && <Check className="h-2.5 w-2.5 text-black" />}
											</span>
											<span className="min-w-0">
												<span className="block font-medium">{option.label}</span>
												{option.description && (
													<span className="block text-white/50">{option.description}</span>
												)}
											</span>
										</span>
									</button>
								);
							})}
							<div className="flex items-center gap-2 pl-1">
								<button
									type="button"
									aria-label={t("question.custom")}
									onClick={() =>
										spec.multiSelect ? toggleMulti(spec, OTHER) : pickSingle(spec, OTHER)
									}
									className={cn(
										"flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center border",
										spec.multiSelect ? "rounded" : "rounded-full",
										otherSelected ? "border-[#7C5CFF] bg-[#7C5CFF]" : "border-white/30",
									)}
								>
									{otherSelected && <Check className="h-2.5 w-2.5 text-black" />}
								</button>
								<Input
									value={customText[spec.question] ?? ""}
									onChange={(event) => {
										const value = event.target.value;
										setCustomText((prev) => ({ ...prev, [spec.question]: value }));
										if (value && !otherSelected) {
											if (spec.multiSelect) toggleMulti(spec, OTHER);
											else setPicks((prev) => ({ ...prev, [spec.question]: [OTHER] }));
										}
									}}
									onKeyDown={(event) => {
										if (
											event.key === "Enter" &&
											!event.nativeEvent.isComposing &&
											canConfirm &&
											!spec.multiSelect
										) {
											event.preventDefault();
											advance(picks);
										}
									}}
									placeholder={t("question.custom")}
									className="h-7 flex-1 text-xs bg-white/[0.03] border-white/10"
								/>
							</div>
						</div>
						{needsConfirmButton && (
							<Button
								size="sm"
								className="w-full h-7 text-xs"
								disabled={!canConfirm}
								onClick={() => advance(picks)}
							>
								{index === questions.length - 1 ||
								questions.every(
									(other, otherIndex) => otherIndex === index || resolved(other).length > 0,
								)
									? t("question.submit")
									: t("question.next")}
							</Button>
						)}
					</div>
				);
			})}

			{submitted && (
				<p className="text-[10px] text-[#BDAEFF]/70 text-center">✓ {t("question.answered")}</p>
			)}
			{expired && !submitted && (
				<p className="text-[10px] text-white/40 text-center">{t("question.expired")}</p>
			)}
		</div>
	);
}
