import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useScopedT } from "@/contexts/I18nContext";
import type { ExportFormat, ExportQuality } from "@/lib/exporter";
import { cn } from "@/lib/utils";
import { formatSourceDimensions, MP4_EXPORT_SHORT_SIDES } from "./SettingsPanel";
import type { CropRegion } from "./types";

interface ExportOptionsDialogProps {
	isOpen: boolean;
	onClose: () => void;
	/** Starts the export (the save-path dialog follows); the modal closes itself. */
	onExport: () => void;
	exportFormat: ExportFormat;
	exportQuality: ExportQuality;
	onExportQualityChange: (quality: ExportQuality) => void;
	hasCaptions: boolean;
	burnCaptions: boolean;
	onBurnCaptionsChange: (burn: boolean) => void;
	saveSrtSidecar: boolean;
	onSaveSrtSidecarChange: (save: boolean) => void;
	videoElement?: HTMLVideoElement | null;
	cropRegion?: CropRegion;
}

/**
 * Compact export confirmation for the top-bar button: the same resolution and
 * caption options as Settings → Export, in a modal, so exporting never jumps
 * straight to the save dialog without a chance to review the output settings.
 */
export function ExportOptionsDialog({
	isOpen,
	onClose,
	onExport,
	exportFormat,
	exportQuality,
	onExportQualityChange,
	hasCaptions,
	burnCaptions,
	onBurnCaptionsChange,
	saveSrtSidecar,
	onSaveSrtSidecarChange,
	videoElement,
	cropRegion,
}: ExportOptionsDialogProps) {
	const t = useScopedT("settings");
	const sourceDimensions = formatSourceDimensions(videoElement, cropRegion);

	const qualityOptions: Array<{ value: ExportQuality; label: string; shortSide?: number }> = [
		{ value: "medium", label: t("exportQuality.low"), shortSide: MP4_EXPORT_SHORT_SIDES.medium },
		{ value: "good", label: t("exportQuality.medium"), shortSide: MP4_EXPORT_SHORT_SIDES.good },
		{ value: "source", label: t("exportQuality.high") },
	];

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="bg-[#09090b] border-white/10 rounded-2xl max-w-sm p-6 gap-0">
				<DialogHeader className="mb-4">
					<DialogTitle className="text-base font-semibold text-slate-200">
						{exportFormat === "gif" ? t("export.gifButton") : t("export.videoButton")}
					</DialogTitle>
				</DialogHeader>

				{exportFormat === "mp4" && (
					<div className="mb-4 space-y-1.5">
						<div className="flex items-center justify-between px-0.5 text-[11px] leading-none text-slate-500">
							<span>{t("exportQuality.title")}</span>
							{sourceDimensions && (
								<span>
									Source {sourceDimensions.width}x{sourceDimensions.height}
								</span>
							)}
						</div>
						<div className="bg-white/5 border border-white/5 p-0.5 w-full grid grid-cols-3 h-10 rounded-lg">
							{qualityOptions.map((option) => (
								<button
									key={option.value}
									type="button"
									onClick={() => onExportQualityChange(option.value)}
									className={cn(
										"rounded-md transition-all text-[11px] font-medium flex flex-col items-center justify-center leading-none gap-0.5",
										exportQuality === option.value
											? "bg-white text-black"
											: "text-slate-400 hover:text-slate-200",
									)}
								>
									<span>{option.label}</span>
									{option.shortSide !== undefined
										? sourceDimensions &&
											sourceDimensions.shortSide < option.shortSide && (
												<span
													className={cn(
														"text-[8px] font-medium",
														exportQuality === option.value ? "text-black/55" : "text-amber-300/80",
													)}
												>
													Upscale
												</span>
											)
										: sourceDimensions && (
												<span
													className={cn(
														"text-[8px] font-medium",
														exportQuality === option.value ? "text-black/55" : "text-slate-500",
													)}
												>
													{sourceDimensions.shortSide}p
												</span>
											)}
								</button>
							))}
						</div>
					</div>
				)}

				{hasCaptions && (
					<div className="mb-4 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] space-y-2.5">
						<div className="flex items-center justify-between">
							<span className="text-xs font-medium text-slate-300">{t("export.burnCaptions")}</span>
							<Switch checked={burnCaptions} onCheckedChange={onBurnCaptionsChange} />
						</div>
						<div className="flex items-center justify-between">
							<span className="text-xs font-medium text-slate-300">{t("export.saveSrt")}</span>
							<Switch checked={saveSrtSidecar} onCheckedChange={onSaveSrtSidecarChange} />
						</div>
						{!burnCaptions && (
							<p className="text-[10px] text-slate-500">{t("export.captionsPreviewOnly")}</p>
						)}
					</div>
				)}

				<Button
					onClick={() => {
						onClose();
						onExport();
					}}
					className="w-full gap-2 bg-[#7C5CFF] hover:bg-[#9B84FF] text-white h-10 rounded-xl font-medium"
				>
					<Download className="w-4 h-4" />
					{exportFormat === "gif" ? t("export.gifButton") : t("export.videoButton")}
				</Button>
			</DialogContent>
		</Dialog>
	);
}
