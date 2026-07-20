import type { Span } from "dnd-timeline";
import { useItem } from "dnd-timeline";
import {
	Aperture,
	AtSign,
	Gauge,
	MessageSquare,
	MousePointer2,
	Scissors,
	ZoomIn,
} from "lucide-react";
import { useMemo } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import glassStyles from "./ItemGlass.module.css";

interface ItemProps {
	id: string;
	span: Span;
	rowId: string;
	children: React.ReactNode;
	isSelected?: boolean;
	onSelect?: () => void;
	zoomDepth?: number;
	zoomCustomScale?: number;
	speedValue?: number;
	isAutoFocus?: boolean;
	effectType?: "fadeIn" | "fadeOut" | "blur" | "dim";
	variant?: "zoom" | "trim" | "annotation" | "speed" | "blur" | "effect";
	/** Send this block's lane + range to the AI chat input as context. */
	onAddContext?: (contextText: string) => void;
}

// Map zoom depth to multiplier labels
const ZOOM_LABELS: Record<number, string> = {
	1: "1.25×",
	2: "1.5×",
	3: "1.8×",
	4: "2.2×",
	5: "3.5×",
	6: "5×",
};

function formatMs(ms: number): string {
	const totalSeconds = ms / 1000;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes > 0) {
		return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
	}
	return `${seconds.toFixed(1)}s`;
}

export default function Item({
	id,
	span,
	rowId,
	isSelected = false,
	onSelect,
	zoomDepth = 1,
	zoomCustomScale,
	speedValue,
	isAutoFocus = false,
	variant = "zoom",
	children,
	onAddContext,
}: ItemProps) {
	const t = useScopedT("timeline");
	const { setNodeRef, attributes, listeners, itemStyle, itemContentStyle } = useItem({
		id,
		span,
		data: { rowId },
	});

	const isZoom = variant === "zoom";
	const isTrim = variant === "trim";
	const isSpeed = variant === "speed";
	const isEffect = variant === "effect";

	const glassClass = isZoom
		? glassStyles.glassGreen
		: isTrim
			? glassStyles.glassRed
			: isSpeed
				? glassStyles.glassAmber
				: isEffect
					? glassStyles.glassFuchsia
					: glassStyles.glassYellow;

	// Resize handles sit a shade deeper than each lane's block so they read
	// as grabbable edges: zoom=deep violet, trim=red, speed=amber, effect=fuchsia, text=cyan.
	const endCapColor = isZoom
		? "#4C2FE0"
		: isTrim
			? "#ef4444"
			: isSpeed
				? "#d97706"
				: isEffect
					? "#c026d3"
					: "#0E7490";

	const timeLabel = useMemo(
		() => `${formatMs(span.start)} – ${formatMs(span.end)}`,
		[span.start, span.end],
	);

	// Lane name for the chat-context tag: "줌 0:05.5 – 0:47.0".
	const laneLabel = isZoom
		? t("labels.zoom")
		: isTrim
			? t("labels.trim")
			: isSpeed
				? t("labels.speed")
				: isEffect
					? t("labels.effect")
					: t("labels.annotationItem");

	// Minimum clickable width on the outer wrapper. Kept small so items keep their real
	// positions; zoom in to interact with sub-second items precisely.
	const MIN_ITEM_PX = 6;
	const safeItemStyle = { ...itemStyle, minWidth: MIN_ITEM_PX };

	return (
		<div
			ref={setNodeRef}
			style={safeItemStyle}
			{...listeners}
			{...attributes}
			onPointerDownCapture={() => onSelect?.()}
			className="group"
		>
			<div style={{ ...itemContentStyle, minWidth: 24 }}>
				<div
					className={cn(
						glassClass,
						"w-full h-full overflow-hidden flex items-center justify-center gap-1.5 cursor-grab active:cursor-grabbing relative",
						isSelected && glassStyles.selected,
					)}
					style={{ height: 30, color: "#fff", minWidth: 24 }}
					onClick={(event) => {
						event.stopPropagation();
						onSelect?.();
					}}
				>
					<div
						className={cn(glassStyles.zoomEndCap, glassStyles.left)}
						style={{
							cursor: "col-resize",
							pointerEvents: "auto",
							width: 8,
							opacity: 0.9,
							background: endCapColor,
						}}
						title="Resize left"
					/>
					<div
						className={cn(glassStyles.zoomEndCap, glassStyles.right)}
						style={{
							cursor: "col-resize",
							pointerEvents: "auto",
							width: 8,
							opacity: 0.9,
							background: endCapColor,
						}}
						title="Resize right"
					/>
					{/* "@" — pull this block's lane + range into the AI chat input.
					    Hover-revealed to avoid clutter on small blocks; stops
					    propagation so it neither drags nor selects the block. */}
					{onAddContext && (
						<button
							type="button"
							title={t("labels.addToChat")}
							aria-label={t("labels.addToChat")}
							className="absolute top-0.5 right-2.5 z-20 hidden group-hover:flex items-center justify-center h-[15px] w-[15px] rounded-[4px] bg-black/45 text-white/80 hover:bg-black/70 hover:text-white"
							onPointerDown={(event) => event.stopPropagation()}
							onClick={(event) => {
								event.stopPropagation();
								onAddContext(`${laneLabel} ${timeLabel}`);
							}}
						>
							<AtSign className="h-[11px] w-[11px]" />
						</button>
					)}
					{/* Content */}
					<div className="relative z-10 flex min-w-0 flex-col items-center justify-center text-white/90 opacity-85 group-hover:opacity-100 transition-opacity select-none overflow-hidden px-3">
						<div className="flex items-center gap-1.5">
							{isZoom ? (
								<>
									<ZoomIn className="w-3.5 h-3.5 shrink-0" />
									<span className="text-[11px] font-semibold whitespace-nowrap">
										{zoomCustomScale != null
											? `${zoomCustomScale.toFixed(2)}×`
											: ZOOM_LABELS[zoomDepth] || `${zoomDepth}×`}
									</span>
									{isAutoFocus && (
										<MousePointer2
											className="w-3 h-3 shrink-0 opacity-90"
											aria-label="Cursor-follow"
										/>
									)}
								</>
							) : isTrim ? (
								<>
									<Scissors className="w-3.5 h-3.5 shrink-0" />
									<span className="text-[11px] font-semibold whitespace-nowrap">
										{t("labels.trim")}
									</span>
								</>
							) : isSpeed ? (
								<>
									<Gauge className="w-3.5 h-3.5 shrink-0" />
									<span className="text-[11px] font-semibold whitespace-nowrap">
										{speedValue !== undefined ? `${speedValue}×` : t("labels.speed")}
									</span>
								</>
							) : isEffect ? (
								<>
									<Aperture className="w-3.5 h-3.5 shrink-0" />
									<span className="text-[11px] font-semibold truncate whitespace-nowrap">
										{children}
									</span>
								</>
							) : (
								<>
									<MessageSquare className="w-3.5 h-3.5 shrink-0" />
									<span className="text-[11px] font-semibold truncate whitespace-nowrap">
										{children}
									</span>
								</>
							)}
						</div>
						<span
							className={`text-[9px] tabular-nums tracking-tight whitespace-nowrap transition-opacity ${
								isSelected ? "opacity-60" : "opacity-0 group-hover:opacity-40"
							}`}
						>
							{timeLabel}
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}
