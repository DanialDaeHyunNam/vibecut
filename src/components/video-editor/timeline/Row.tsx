import type { RowDefinition } from "dnd-timeline";
import { useRow } from "dnd-timeline";

interface RowProps extends RowDefinition {
	children: React.ReactNode;
	hint?: string;
	isEmpty?: boolean;
	background?: React.ReactNode;
	/** Marks this lane as the Alt+←/→ navigation target. */
	isActiveLane?: boolean;
	onLaneClick?: () => void;
}

/**
 * A horizontal timeline lane. Wraps dnd-timeline's `useRow` and adds an optional
 * `background` layer, an empty-state hint label, and a minimum height. Clicking
 * anywhere in the lane focuses it for keyboard navigation; the focused lane
 * shows a violet left edge.
 */
export default function Row({
	id,
	children,
	hint,
	isEmpty,
	background,
	isActiveLane,
	onLaneClick,
}: RowProps) {
	const { setNodeRef, rowWrapperStyle, rowStyle } = useRow({ id });

	return (
		<div
			className={`border-b border-white/[0.055] relative overflow-hidden ${
				isActiveLane ? "bg-[#14121F]" : "bg-[#101116]"
			}`}
			style={{
				...rowWrapperStyle,
				minHeight: 36,
				boxShadow: isActiveLane ? "inset 2px 0 0 #7C5CFF" : undefined,
			}}
			onClick={onLaneClick}
		>
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
	);
}
