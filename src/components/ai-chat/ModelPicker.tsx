import { KeyRound } from "lucide-react";
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

/** A key input the panel asks the picker to surface, only when it's needed. */
export interface KeyPrompt {
	keyId: AiKeyId;
	name: string;
	/** true = an optional alternative to sign-in (softer placeholder copy). */
	optional: boolean;
}

interface ModelPickerProps {
	providers: AiProviderListing[];
	model: string;
	onModelChange: (model: string) => void;
	/** Key rows to surface — only shown while the corresponding key is missing. */
	keyPrompts: KeyPrompt[];
	/** Fired after an API key is saved/removed so the parent can re-check status. */
	onApiKeyChanged?: () => void;
}

function ApiKeyRow({
	keyId,
	name,
	optional,
	onSaved,
}: {
	keyId: AiKeyId;
	name: string;
	optional: boolean;
	onSaved: () => void;
}) {
	const t = useScopedT("aiChat");
	const [draft, setDraft] = useState("");
	const [error, setError] = useState(false);

	const saveKey = async (value: string) => {
		setError(false);
		const result = await window.electronAPI.aiSaveSettings({ apiKeys: { [keyId]: value } });
		if (result.success) {
			setDraft("");
			onSaved();
		} else {
			setError(true);
		}
	};

	return (
		<div className="mt-2 flex items-center gap-1.5">
			<KeyRound className="h-3 w-3 text-white/30 shrink-0" />
			<input
				type="password"
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
				placeholder={t(optional ? "apiKeyOptionalPlaceholder" : "apiKeyPlaceholder", { name })}
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
 * useAiChat). Key inputs are surfaced just-in-time: a row appears only for a
 * provider/service the user is actually trying to use whose key is missing —
 * never the whole set at once.
 */
export function ModelPicker({
	providers,
	model,
	onModelChange,
	keyPrompts,
	onApiKeyChanged,
}: ModelPickerProps) {
	const t = useScopedT("aiChat");
	const [hasApiKey, setHasApiKey] = useState<Partial<Record<AiKeyId, boolean>> | null>(null);

	const refreshKeys = () => {
		void window.electronAPI.aiGetSettings().then((settings) => {
			setHasApiKey(settings.hasApiKey);
		});
	};

	useEffect(refreshKeys, []);

	// Only render a prompt whose key is still missing — once saved the row
	// disappears (and onApiKeyChanged re-checks provider status upstream).
	const visiblePrompts =
		hasApiKey === null ? [] : keyPrompts.filter((prompt) => !hasApiKey[prompt.keyId]);

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
									<SelectItem key={modelInfo.id} value={modelInfo.id}>
										{modelInfo.label}
									</SelectItem>
								))
							)}
						</SelectGroup>
					))}
				</SelectContent>
			</Select>
			{visiblePrompts.map((prompt) => (
				<ApiKeyRow
					key={prompt.keyId}
					keyId={prompt.keyId}
					name={prompt.name}
					optional={prompt.optional}
					onSaved={() => {
						refreshKeys();
						onApiKeyChanged?.();
					}}
				/>
			))}
		</div>
	);
}
