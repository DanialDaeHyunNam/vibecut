import { Check, KeyRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useScopedT } from "@/contexts/I18nContext";

interface ModelPickerProps {
	providers: AiProviderListing[];
	provider: AiProviderId;
	model: string;
	onModelChange: (model: string) => void;
}

/**
 * Grok has no subscription CLI, so its key is collected ahead of the provider
 * implementation: stored encrypted (safeStorage) via ai-settings, surfaced
 * here as a compact row under the picker.
 */
function GrokApiKeyRow() {
	const t = useScopedT("aiChat");
	const [hasKey, setHasKey] = useState<boolean | null>(null);
	const [draft, setDraft] = useState("");
	const [error, setError] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void window.electronAPI.aiGetSettings().then((settings) => {
			if (!cancelled) setHasKey(Boolean(settings.hasApiKey.grok));
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const saveKey = async (value: string | null) => {
		setError(false);
		const result = await window.electronAPI.aiSaveSettings({ apiKeys: { grok: value } });
		if (result.success) {
			setHasKey(Boolean(result.settings?.hasApiKey.grok));
			setDraft("");
		} else {
			setError(true);
		}
	};

	if (hasKey === null) return null;

	if (hasKey) {
		return (
			<div className="mt-2 flex items-center gap-1.5 text-[11px] text-white/50">
				<Check className="h-3 w-3 text-emerald-400/80 shrink-0" />
				<span className="flex-1 truncate">{t("grokApiKeySaved")}</span>
				<Button
					size="sm"
					variant="ghost"
					className="h-6 px-1.5 text-[11px] text-white/40 hover:text-white/80"
					onClick={() => void saveKey(null)}
				>
					<X className="h-3 w-3" />
				</Button>
			</div>
		);
	}

	return (
		<div className="mt-2 flex items-center gap-1.5">
			<KeyRound className="h-3 w-3 text-white/30 shrink-0" />
			<input
				type="password"
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
				placeholder={t("grokApiKeyPlaceholder")}
				className={`h-6 min-w-0 flex-1 rounded bg-white/[0.04] border px-2 text-[11px] text-white/80 placeholder:text-white/25 focus:outline-none focus:border-white/25 ${error ? "border-red-400/50" : "border-white/10"}`}
				onKeyDown={(event) => {
					if (event.key === "Enter" && draft.trim()) void saveKey(draft.trim());
				}}
			/>
			<Button
				size="sm"
				variant="secondary"
				className="h-6 px-2 text-[11px]"
				disabled={!draft.trim()}
				onClick={() => void saveKey(draft.trim())}
			>
				{t("apiKeySave")}
			</Button>
		</div>
	);
}

/**
 * Bottom-bar model selector, grouped by provider like the reference UI.
 * Picking a model from another provider switches the provider too (handled in
 * useAiChat). API-key providers without an implementation render as disabled
 * rows.
 */
export function ModelPicker({ providers, provider, model, onModelChange }: ModelPickerProps) {
	const t = useScopedT("aiChat");

	return (
		<div className="px-3 pb-3">
			<Select value={model} onValueChange={onModelChange}>
				<SelectTrigger className="h-8 w-full text-xs bg-white/[0.04] border-white/10">
					<SelectValue placeholder={t("pickModel")} />
				</SelectTrigger>
				<SelectContent>
					{providers.map((entry) => (
						<SelectGroup key={entry.id}>
							<SelectLabel className="text-[10px] uppercase tracking-wider opacity-60">
								{entry.label}
							</SelectLabel>
							{entry.models.length === 0 ? (
								<SelectItem value={`__coming-soon-${entry.id}`} disabled>
									{t("comingSoon")}
								</SelectItem>
							) : (
								entry.models.map((modelInfo) => (
									<SelectItem
										key={modelInfo.id}
										value={modelInfo.id}
										disabled={entry.id !== provider && entry.requiresApiKey}
									>
										{modelInfo.label}
									</SelectItem>
								))
							)}
						</SelectGroup>
					))}
				</SelectContent>
			</Select>
			{providers.some((entry) => entry.id === "grok") && <GrokApiKeyRow />}
		</div>
	);
}
