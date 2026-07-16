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
 * Bottom-bar model selector, grouped by provider like the reference UI.
 * API-key providers without an implementation render as disabled rows.
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
		</div>
	);
}
