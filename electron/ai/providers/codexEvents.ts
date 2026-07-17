/**
 * Parser for `codex exec --json` output lines. Pure and electron-free so it
 * can be unit-tested. Codex has shipped two JSONL shapes — the current
 * thread/item events and the older {id, msg} protocol — and this handles
 * both, mapping each line to at most one session-level action.
 */

export type CodexEventAction =
	| { kind: "session"; sessionId: string }
	| { kind: "delta"; text: string }
	| { kind: "message"; text: string }
	| { kind: "error"; message: string };

export function parseCodexEventLine(line: string): CodexEventAction | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith("{")) return null;

	let event: Record<string, unknown>;
	try {
		event = JSON.parse(trimmed);
	} catch {
		return null;
	}

	// Current shape: {"type":"thread.started","thread_id":...} /
	// {"type":"item.completed","item":{"type":"agent_message","text":...}}
	const type = typeof event.type === "string" ? event.type : null;
	if (type === "thread.started" || type === "session.created") {
		const sessionId = event.thread_id ?? event.session_id;
		if (typeof sessionId === "string" && sessionId) return { kind: "session", sessionId };
		return null;
	}
	if (type === "item.completed") {
		const item = event.item as { type?: string; item_type?: string; text?: string } | undefined;
		const itemType = item?.type ?? item?.item_type;
		if (itemType === "agent_message" && typeof item?.text === "string" && item.text) {
			return { kind: "message", text: item.text };
		}
		return null;
	}
	if (type === "turn.failed") {
		const error = event.error as { message?: string } | undefined;
		return { kind: "error", message: error?.message ?? "Codex turn failed." };
	}
	if (type === "error") {
		return { kind: "error", message: String(event.message ?? "Codex error.") };
	}

	// Legacy shape: {"id":"0","msg":{"type":"agent_message","message":...}}
	const msg = event.msg as
		| { type?: string; session_id?: string; message?: string; delta?: string }
		| undefined;
	if (!msg || typeof msg.type !== "string") return null;
	switch (msg.type) {
		case "session_configured":
			return typeof msg.session_id === "string" && msg.session_id
				? { kind: "session", sessionId: msg.session_id }
				: null;
		case "agent_message_delta":
			return typeof msg.delta === "string" && msg.delta ? { kind: "delta", text: msg.delta } : null;
		case "agent_message":
			return typeof msg.message === "string" && msg.message
				? { kind: "message", text: msg.message }
				: null;
		case "error":
			return { kind: "error", message: msg.message ?? "Codex error." };
		default:
			return null;
	}
}
