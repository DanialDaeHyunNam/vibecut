import { useCallback, useEffect, useRef, useState } from "react";

export interface AskUserOption {
	label: string;
	description?: string;
}

export interface AskUserQuestionSpec {
	question: string;
	header?: string;
	multiSelect?: boolean;
	options: AskUserOption[];
}

export type AiChatItem =
	| { kind: "user"; id: number; text: string }
	| { kind: "assistant"; id: number; text: string }
	| {
			kind: "tool";
			id: number;
			toolCallId: string;
			name: string;
			status: "running" | "ok" | "error";
			summary?: string;
	  }
	| {
			kind: "question";
			id: number;
			callId: string;
			questions: AskUserQuestionSpec[];
			/** null while awaiting the user's picks; map of question → selected labels after. */
			answers: Record<string, string[]> | null;
			expired?: boolean;
	  }
	| { kind: "error"; id: number; code: string; message: string };

export interface AiChatSnapshotSource {
	(): AiProjectSnapshot;
}

const MAX_PERSISTED_ITEMS = 200;

interface PersistedChat {
	items: AiChatItem[];
	sessionId: string | null;
}

function loadPersistedChat(storage: string | null): PersistedChat {
	if (!storage) return { items: [], sessionId: null };
	try {
		const parsed = JSON.parse(localStorage.getItem(storage) ?? "null") as PersistedChat | null;
		if (parsed && Array.isArray(parsed.items)) {
			// A question that was never answered can't be answered after a
			// restart — the main-process tool call it belonged to is gone.
			const items = parsed.items.map((item) =>
				item.kind === "question" && item.answers === null ? { ...item, expired: true } : item,
			);
			return { items, sessionId: parsed.sessionId ?? null };
		}
	} catch {
		// Corrupt entry — start fresh.
	}
	return { items: [], sessionId: null };
}

/**
 * Owns the chat panel's state: provider/model selection (persisted via
 * ai-settings), provider status, the message list, and the streaming event
 * subscription. The transcript persists per project (localStorage) and the
 * underlying CLI session id is stored with it, so after an app restart the
 * next message resumes the same agent conversation.
 */
export function useAiChat(getSnapshot: AiChatSnapshotSource, storageKey: string | null) {
	const storage = storageKey ? `cinerec-ai-chat:${storageKey}` : null;
	const [providers, setProviders] = useState<AiProviderListing[]>([]);
	const [provider, setProviderState] = useState<AiProviderId>("claude-code");
	const [model, setModelState] = useState<string>("claude-opus-4-8");
	const [status, setStatus] = useState<AiProviderStatus | null>(null);
	const [items, setItems] = useState<AiChatItem[]>([]);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const nextIdRef = useRef(1);
	const sessionIdRef = useRef<string | null>(null);
	sessionIdRef.current = sessionId;

	const allocId = useCallback(() => nextIdRef.current++, []);

	// Load the project's saved transcript on project switch; drop any live
	// main-process session so the next send resumes this project's session.
	useEffect(() => {
		const saved = loadPersistedChat(storage);
		setItems(saved.items);
		setSessionId(saved.sessionId);
		nextIdRef.current = saved.items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
		setBusy(false);
		void window.electronAPI.aiChatReset();
	}, [storage]);

	// Persist transcript + session id (skips while nothing is loaded).
	useEffect(() => {
		if (!storage) return;
		try {
			localStorage.setItem(
				storage,
				JSON.stringify({ items: items.slice(-MAX_PERSISTED_ITEMS), sessionId }),
			);
		} catch {
			// Quota/serialization errors just lose persistence, not the session.
		}
	}, [storage, items, sessionId]);

	// Initial load: providers, persisted selection, provider status.
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const [listing, settings] = await Promise.all([
					window.electronAPI.aiListProviders(),
					window.electronAPI.aiGetSettings(),
				]);
				if (cancelled) return;
				setProviders(listing);
				const activeProvider = settings.provider;
				setProviderState(activeProvider);
				const providerModels = listing.find((p) => p.id === activeProvider)?.models ?? [];
				const savedModel = settings.modelByProvider[activeProvider];
				const fallbackModel =
					providerModels.find((m) => m.isDefault)?.id ?? providerModels[0]?.id ?? "";
				setModelState(
					savedModel && providerModels.some((m) => m.id === savedModel)
						? savedModel
						: fallbackModel,
				);
				setStatus(await window.electronAPI.aiProviderStatus(activeProvider));
			} catch (error) {
				console.error("Failed to initialize AI chat:", error);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	// ask_user tool calls render as an interactive question card; the reply
	// goes back over the tool-result channel once the user picks options.
	// (useAiToolHost deliberately ignores ask_user — this hook owns it.)
	useEffect(() => {
		const unsubscribe = window.electronAPI.onAiToolCall((call) => {
			if (call.name !== "ask_user") return;
			const input = (call.input ?? {}) as { questions?: unknown };
			const questions = (Array.isArray(input.questions) ? input.questions : []).filter(
				(q): q is AskUserQuestionSpec =>
					typeof (q as AskUserQuestionSpec)?.question === "string" &&
					Array.isArray((q as AskUserQuestionSpec)?.options),
			);
			if (questions.length === 0) {
				window.electronAPI.aiToolResult({
					callId: call.callId,
					ok: false,
					content: JSON.stringify({ error: "questions must be a non-empty array" }),
				});
				return;
			}
			setItems((prev) => [
				...prev,
				{
					kind: "question",
					id: nextIdRef.current++,
					callId: call.callId,
					questions,
					answers: null,
				},
			]);
		});
		return unsubscribe;
	}, []);

	const answerQuestion = useCallback((itemId: number, answers: Record<string, string[]>) => {
		setItems((prev) =>
			prev.map((item) => {
				if (item.kind !== "question" || item.id !== itemId || item.answers !== null) {
					return item;
				}
				// The bridge ignores duplicate replies for the same callId, so a
				// double-invoked updater (StrictMode) stays harmless.
				window.electronAPI.aiToolResult({
					callId: item.callId,
					ok: true,
					content: JSON.stringify({
						answers: item.questions.map((question) => ({
							question: question.question,
							selected: answers[question.question] ?? [],
						})),
					}),
				});
				return { ...item, answers };
			}),
		);
	}, []);

	// Streaming event subscription.
	useEffect(() => {
		const unsubscribe = window.electronAPI.onAiChatEvent((event) => {
			switch (event.type) {
				case "session-started":
					setSessionId(event.sessionId);
					break;
				case "text-delta":
					setItems((prev) => {
						const last = prev[prev.length - 1];
						if (last?.kind === "assistant") {
							return [...prev.slice(0, -1), { ...last, text: last.text + event.text }];
						}
						return [...prev, { kind: "assistant", id: nextIdRef.current++, text: event.text }];
					});
					break;
				case "tool-start":
					setItems((prev) => [
						...prev,
						{
							kind: "tool",
							id: nextIdRef.current++,
							toolCallId: event.toolCallId,
							name: event.name,
							status: "running",
						},
					]);
					break;
				case "tool-end":
					setItems((prev) =>
						prev.map((item) =>
							item.kind === "tool" && item.toolCallId === event.toolCallId
								? { ...item, status: event.ok ? "ok" : "error", summary: event.summary }
								: item,
						),
					);
					break;
				case "turn-done":
					setBusy(false);
					break;
				case "error":
					setBusy(false);
					if (event.code === "not-authenticated") {
						setStatus({ available: false, reason: "not-authenticated", detail: event.message });
					}
					if (event.code !== "aborted") {
						setItems((prev) => [
							...prev,
							{ kind: "error", id: nextIdRef.current++, code: event.code, message: event.message },
						]);
					}
					break;
			}
		});
		return unsubscribe;
	}, []);

	const send = useCallback(
		async (text: string) => {
			const trimmed = text.trim();
			if (!trimmed || busy) return;
			setBusy(true);
			setItems((prev) => [...prev, { kind: "user", id: allocId(), text: trimmed }]);
			const result = await window.electronAPI.aiChatSend({
				provider,
				model,
				text: trimmed,
				snapshot: getSnapshot(),
				resumeSessionId: sessionIdRef.current ?? undefined,
			});
			if (!result.success) {
				setBusy(false);
				setItems((prev) => [
					...prev,
					{
						kind: "error",
						id: allocId(),
						code: "unknown",
						message: result.error ?? "Unknown error",
					},
				]);
			}
		},
		[allocId, busy, getSnapshot, model, provider],
	);

	const stop = useCallback(async () => {
		await window.electronAPI.aiChatCancel();
		setBusy(false);
	}, []);

	const setModel = useCallback(
		(newModel: string) => {
			setModelState(newModel);
			void window.electronAPI.aiSaveSettings({ modelByProvider: { [provider]: newModel } });
			// Session context lives in the provider process; switching models starts fresh.
			void window.electronAPI.aiChatReset();
		},
		[provider],
	);

	const refreshStatus = useCallback(async () => {
		setStatus(await window.electronAPI.aiProviderStatus(provider));
	}, [provider]);

	return {
		providers,
		provider,
		model,
		setModel,
		status,
		refreshStatus,
		items,
		busy,
		send,
		stop,
		answerQuestion,
	};
}
