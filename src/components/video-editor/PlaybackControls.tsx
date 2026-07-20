import { AtSign, Maximize, Minimize, Pause, Play, SkipBack, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

interface PlaybackControlsProps {
	isPlaying: boolean;
	currentTime: number;
	duration: number;
	isFullscreen?: boolean;
	onToggleFullscreen?: () => void;
	onTogglePlayPause: () => void;
	onSeek: (time: number) => void;
	/** Shift-drag on the scrubber selects a range; this sends it to the AI chat. */
	onAddRangeContext?: (text: string) => void;
}

/** m:ss.s — one-decimal range endpoints, matching the timeline "@" tags. */
function formatRangeTime(seconds: number): string {
	const safe = Math.max(0, seconds);
	const mins = Math.floor(safe / 60);
	const secs = safe % 60;
	return `${mins}:${secs.toFixed(1).padStart(4, "0")}`;
}

export default function PlaybackControls({
	isPlaying,
	currentTime,
	duration,
	isFullscreen = false,
	onToggleFullscreen,
	onTogglePlayPause,
	onSeek,
	onAddRangeContext,
}: PlaybackControlsProps) {
	const t = useScopedT("common");
	const tt = useScopedT("timeline");

	const trackRef = useRef<HTMLDivElement>(null);
	const [shiftHeld, setShiftHeld] = useState(false);
	// Selected range in seconds while/after a shift-drag; null when none.
	const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
	const draggingRef = useRef(false);

	// Track Shift so the range-select overlay only intercepts the scrubber while
	// the modifier is down — ordinary clicks/drags still seek.
	useEffect(() => {
		if (!onAddRangeContext) return;
		const onKey = (event: KeyboardEvent) => setShiftHeld(event.shiftKey);
		window.addEventListener("keydown", onKey);
		window.addEventListener("keyup", onKey);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("keyup", onKey);
		};
	}, [onAddRangeContext]);

	function formatTime(seconds: number) {
		if (!Number.isFinite(seconds) || Number.isNaN(seconds) || seconds < 0) return "0:00";
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, "0")}`;
	}

	function handleSeekChange(e: React.ChangeEvent<HTMLInputElement>) {
		setSelection(null); // a normal seek clears any pending range
		onSeek(parseFloat(e.target.value));
	}

	/** Pointer X → time (seconds), clamped to the track. */
	function timeFromPointer(clientX: number): number {
		const rect = trackRef.current?.getBoundingClientRect();
		if (!rect || rect.width === 0 || duration <= 0) return 0;
		const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		return ratio * duration;
	}

	const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
	const selStartPct = selection && duration > 0 ? (selection.start / duration) * 100 : 0;
	const selEndPct = selection && duration > 0 ? (selection.end / duration) * 100 : 0;

	return (
		<div className="flex items-center gap-2 px-1 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 shadow-xl transition-all duration-300 hover:bg-black/70 hover:border-white/20">
			<Button
				onClick={() => onSeek(0)}
				size="icon"
				variant="ghost"
				className="w-7 h-7 rounded-full transition-all duration-200 border border-transparent bg-transparent hover:bg-white/10 text-white hover:text-white hover:border-white/10 shrink-0 shadow-none"
				aria-label={t("playback.skipToStart")}
			>
				<SkipBack className="w-3.5 h-3.5 fill-current" />
			</Button>
			<Button
				onClick={onTogglePlayPause}
				size="icon"
				className={cn(
					"w-8 h-8 rounded-full transition-all duration-200 border border-white/10",
					isPlaying
						? "bg-white/10 text-white hover:bg-white/20"
						: "bg-white text-black hover:bg-white/90 hover:scale-105 shadow-[0_0_15px_rgba(255,255,255,0.3)]",
				)}
				aria-label={isPlaying ? t("playback.pause") : t("playback.play")}
			>
				{isPlaying ? (
					<Pause className="w-3.5 h-3.5 fill-current" />
				) : (
					<Play className="w-3.5 h-3.5 fill-current ml-0.5" />
				)}
			</Button>

			<span className="text-[9px] font-medium text-slate-300 tabular-nums w-[30px] text-right">
				{formatTime(currentTime)}
			</span>

			<div
				ref={trackRef}
				className="flex-1 relative h-6 flex items-center group"
				title={onAddRangeContext ? tt("labels.rangeSelectHint") : undefined}
			>
				{/* Custom Track Background */}
				<div className="absolute left-0 right-0 h-0.5 bg-white/10 rounded-full overflow-hidden">
					<div className="h-full bg-[#7C5CFF] rounded-full" style={{ width: `${progress}%` }} />
				</div>

				{/* Selected range band (shift-drag) */}
				{selection && (
					<div
						className="absolute h-2 rounded-sm bg-[#7C5CFF]/35 border-x border-[#7C5CFF] pointer-events-none"
						style={{ left: `${selStartPct}%`, width: `${Math.max(0, selEndPct - selStartPct)}%` }}
					/>
				)}

				{/* Interactive Input (seek) */}
				<input
					type="range"
					min="0"
					max={duration || 100}
					value={currentTime}
					onChange={handleSeekChange}
					step="0.01"
					className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
				/>

				{/* Range-select overlay: only intercepts the track while Shift is held. */}
				{onAddRangeContext && (
					<div
						className={`absolute inset-0 z-20 ${shiftHeld ? "cursor-col-resize" : ""}`}
						style={{ pointerEvents: shiftHeld || draggingRef.current ? "auto" : "none" }}
						onPointerDown={(event) => {
							if (!event.shiftKey) return;
							event.preventDefault();
							event.currentTarget.setPointerCapture(event.pointerId);
							draggingRef.current = true;
							const start = timeFromPointer(event.clientX);
							setSelection({ start, end: start });
						}}
						onPointerMove={(event) => {
							if (!draggingRef.current) return;
							const end = timeFromPointer(event.clientX);
							setSelection((prev) => (prev ? { ...prev, end } : prev));
						}}
						onPointerUp={(event) => {
							if (!draggingRef.current) return;
							draggingRef.current = false;
							event.currentTarget.releasePointerCapture(event.pointerId);
							setSelection((prev) => {
								if (!prev) return null;
								const lo = Math.min(prev.start, prev.end);
								const hi = Math.max(prev.start, prev.end);
								// Drop a too-short drag (reads as a mis-click, not a range).
								return hi - lo < 0.15 ? null : { start: lo, end: hi };
							});
						}}
					/>
				)}

				{/* Custom Thumb (visual only, follows progress) */}
				<div
					className="absolute w-2.5 h-2.5 bg-white rounded-full shadow-lg pointer-events-none group-hover:scale-125 transition-transform duration-100"
					style={{ left: `${progress}%`, transform: "translateX(-50%)" }}
				/>

				{/* Floating "@ add range" action, centered over the band */}
				{selection &&
					!draggingRef.current &&
					selection.end > selection.start &&
					onAddRangeContext && (
						<div
							className="absolute -top-8 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[#7C5CFF]/50 bg-black/85 px-2 py-1 shadow-lg"
							style={{ left: `${(selStartPct + selEndPct) / 2}%` }}
						>
							<button
								type="button"
								className="flex items-center gap-1 text-[10px] font-medium text-white/90 hover:text-white"
								onClick={() => {
									onAddRangeContext(
										`${tt("labels.range")} ${formatRangeTime(selection.start)} – ${formatRangeTime(selection.end)}`,
									);
									setSelection(null);
								}}
							>
								<AtSign className="h-3 w-3" />
								{formatRangeTime(selection.start)} – {formatRangeTime(selection.end)}
							</button>
							<button
								type="button"
								aria-label={t("actions.close")}
								className="text-white/40 hover:text-white/80"
								onClick={() => setSelection(null)}
							>
								<X className="h-3 w-3" />
							</button>
						</div>
					)}
			</div>

			<span className="text-[9px] font-medium text-slate-500 tabular-nums w-[30px]">
				{formatTime(duration)}
			</span>

			{onToggleFullscreen && (
				<Button
					onClick={onToggleFullscreen}
					size="icon"
					variant="ghost"
					className="w-7 h-7 rounded-full transition-all duration-200 border border-transparent bg-transparent hover:bg-white/10 text-white hover:text-white hover:border-white/10 shrink-0 shadow-none ml-0.5"
					aria-label={isFullscreen ? t("playback.exitFullscreen") : t("playback.fullscreen")}
				>
					{isFullscreen ? (
						<Minimize className="w-3.5 h-3.5" />
					) : (
						<Maximize className="w-3.5 h-3.5" />
					)}
				</Button>
			)}
		</div>
	);
}
