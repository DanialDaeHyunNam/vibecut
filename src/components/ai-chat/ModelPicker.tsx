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
	/** Fired after an API key is saved/removed so the parent can re-check provider status. */
	onApiKeyChanged?: () => void;
}

/**
 * Services that take an API key in the picker. Gemini requires one (Google's
 * terms prohibit third-party software from using Gemini CLI OAuth, so Vibecut
 * uses AI Studio keys instead of the user's Google login). The Anthropic key
 * is an optional alternative to subscription login and only shows while that
 * provider is active. Decart powers the webcam restyle tool. Grok's key is
 * collected ahead of its provider implementation.
 */
const KEY_ROWS: Array<{
	keyId: AiKeyId;
	name: string;
	optional: boolean;
	whenProviderActive?: AiProviderId;
}> = [
	{ keyId: "gemini", name: "Gemini", optional: false },
	{ keyId: "claude-code", name: "Anthropic", optional: true, whenProviderActive: "claude-code" },
	{ keyId: "decart", name: "Decart", optional: false },
	{ keyId: "grok", name: "Grok", optional: false },
];

function ApiKeyRow({
	keyId,
	name,
	optional,
	hasKey,
	onSaved,
}: {
	keyId: AiKeyId;
	name: string;
	optional: boolean;
	hasKey: boolean;
	onSaved: () => void;
}) {
	const t = useScopedT("aiChat");
	const [draft, setDraft] = useState("");
	const [error, setError] = useState(false);

	const saveKey = async (value: string | null) => {
		setError(false);
		const result = await window.electronAPI.aiSaveSettings({ apiKeys: { [keyId]: value } });
		if (result.success) {
			setDraft("");
			onSaved();
		} else {
			setError(true);
		}
	};

	if (hasKey) {
		return (
			<div className="mt-2 flex items-center gap-1.5 text-[11px] text-white/50">
				<Check className="h-3 w-3 text-emerald-400/80 shrink-0" />
				<span className="flex-1 truncate">{t("apiKeySaved", { name })}</span>
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
 * useAiChat). Below the picker, API key rows collect keys for key-based
 * providers.
 */
export function ModelPicker({
	providers,
	provider,
	model,
	onModelChange,
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
			{hasApiKey !== null &&
				KEY_ROWS.filter(
					// Keep the rail compact: rows gated to a provider only show while
					// that provider is active; the rest always show.
					({ whenProviderActive }) => !whenProviderActive || whenProviderActive === provider,
				).map(({ keyId, name, optional }) => (
					<ApiKeyRow
						key={keyId}
						keyId={keyId}
						name={name}
						optional={optional}
						hasKey={Boolean(hasApiKey[keyId])}
						onSaved={() => {
							refreshKeys();
							onApiKeyChanged?.();
						}}
					/>
				))}
		</div>
	);
}
