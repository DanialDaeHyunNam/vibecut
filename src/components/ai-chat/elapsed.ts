/** Language-neutral elapsed label for in-flight AI turns: "8s", "1m 12s". */
export function formatElapsed(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	if (totalSeconds < 60) return `${totalSeconds}s`;
	return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}
