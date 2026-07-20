import type { RowDefinition } from "dnd-timeline";
import { useRow } from "dnd-timeline";
import { useState } from "react";

interface RowProps extends RowDefinition {
	children: React.ReactNode;
	hint?: string;
	isEmpty?: boolean;
	background?: React.ReactNode;
	/** Marks this lane as the Alt+←/→ navigation target. */
	isActiveLane?: boolean;
	/** The lane's identity color (matches its blocks); tints the click handle. */
	laneColor?: string;
	onLaneClick?: () => void;
}

/** 6-digit hex + alpha byte → 8-digit hex (falls back to the color as-is). */
function withAlpha(hex: string, alpha: string): string {
	return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alpha}` : hex;
}

/**
 * A horizontal timeline lane. Wraps dnd-timeline's `useRow` and adds an optional
 * `background` layer, an empty-state hint label, and a minimum height. Clicking
 * anywhere in the lane focuses it for keyboard navigation. A 10px handle in the
 * lane's identity color sits in dnd-timeline's row *sidebar* — its width feeds
 * the context's sidebarWidth, so the time axis, playhead and item mapping all
 * start after it and 0:00 content never hides under the handle. Dim when idle,
 * brighter on hover, fully lit when the lane is the active navigation target —
 * "click here to select this lane" should read at a glance.
 */
export default function Row({
	id,
	children,
	hint,
	isEmpty,
	background,
	isActiveLane,
	laneColor,
	onLaneClick,
}: RowProps) {
	const { setNodeRef, setSidebarRef, rowWrapperStyle, rowStyle, rowSidebarStyle } = useRow({ id });
	const [handleHovered, setHandleHovered] = useState(false);

	const handleColor = laneColor ?? "#7C5CFF";

	return (
		<div
			className={`border-b border-white/[0.055] relative ${
				isActiveLane ? "bg-[#14121F]" : "bg-[#101116]"
			}`}
			style={{
				...rowWrapperStyle,
				minHeight: 36,
			}}
			onClick={onLaneClick}
		>
			<div
				ref={setSidebarRef}
				style={{
					...rowSidebarStyle,
					width: 10,
					backgroundColor: isActiveLane
						? handleColor
						: withAlpha(handleColor, handleHovered ? "73" : "2E"),
					boxShadow: isActiveLane ? `0 0 8px 0 ${withAlpha(handleColor, "80")}` : undefined,
				}}
				className="self-stretch cursor-pointer transition-colors duration-150"
				onMouseEnter={() => setHandleHovered(true)}
				onMouseLeave={() => setHandleHovered(false)}
			/>
			<div className="relative flex-1 overflow-hidden flex">
				{background}
				{isEmpty && hint && (
					<div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-10">
						<span className="text-[11px] text-white/[0.12] font-medium">{hint}</span>
					</div>
				)}
				<div ref={setNodeRef} style={rowStyle}>
					{children}
				</div>
			</div>
		</div>
	);
}
