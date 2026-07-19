/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
	interface ProcessEnv {
		/**
		 * The built directory structure
		 *
		 * ```tree
		 * ├─┬─┬ dist
		 * │ │ └── index.html
		 * │ │
		 * │ ├─┬ dist-electron
		 * │ │ ├── main.js
		 * │ │ └── preload.js
		 * │
		 * ```
		 */
		APP_ROOT: string;
		/** /dist/ or /public/ */
		VITE_PUBLIC: string;
	}
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
	electronAPI: {
		invokeNativeBridge: <TData = unknown>(
			request: import("../src/native/contracts").NativeBridgeRequest,
		) => Promise<import("../src/native/contracts").NativeBridgeResponse<TData>>;
		getSources: (opts: Electron.SourcesOptions) => Promise<ProcessedDesktopSource[]>;
		switchToEditor: () => Promise<void>;
		switchToHud: () => Promise<void>;
		startNewRecording: () => Promise<{ success: boolean; error?: string }>;
		openSourceSelector: () => Promise<{
			opened: boolean;
			reason?: string;
			access?: {
				success: boolean;
				granted: boolean;
				status: string;
				error?: string;
			};
		}>;
		openNotes: () => Promise<{
			opened: boolean;
			reason?: string;
		}>;
		selectSource: (source: ProcessedDesktopSource) => Promise<ProcessedDesktopSource | null>;
		getSelectedSource: () => Promise<ProcessedDesktopSource | null>;
		onSelectedSourceChanged: (callback: (source: ProcessedDesktopSource) => void) => () => void;
		onSourceSelectorClosed: (callback: () => void) => () => void;
		requestCameraAccess: () => Promise<{
			success: boolean;
			granted: boolean;
			status: string;
			error?: string;
		}>;
		requestScreenAccess: () => Promise<{
			success: boolean;
			granted: boolean;
			status: string;
			error?: string;
		}>;
		requestNativeMacCursorAccess: () => Promise<{
			success: boolean;
			granted: boolean;
			status: string;
			error?: string;
		}>;
		assetBaseUrl: string;
		storeRecordedVideo: (
			videoData: ArrayBuffer,
			fileName: string,
		) => Promise<{
			success: boolean;
			path?: string;
			session?: import("../src/lib/recordingSession").RecordingSession;
			message?: string;
			error?: string;
		}>;
		storeRecordedSession: (
			payload: import("../src/lib/recordingSession").StoreRecordedSessionInput,
		) => Promise<{
			success: boolean;
			path?: string;
			session?: import("../src/lib/recordingSession").RecordingSession;
			message?: string;
			error?: string;
		}>;
		openRecordingStream: (fileName: string) => Promise<{ success: boolean; error?: string }>;
		appendRecordingChunk: (
			fileName: string,
			chunk: ArrayBuffer,
		) => Promise<{ success: boolean; error?: string }>;
		closeRecordingStream: (fileName: string) => Promise<{ success: boolean; error?: string }>;
		getRecordedVideoPath: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		setRecordingState: (
			recording: boolean,
			recordingId?: number,
			cursorCaptureMode?: import("../src/lib/recordingSession").CursorCaptureMode,
		) => Promise<void>;
		isNativeWindowsCaptureAvailable: () => Promise<{
			success: boolean;
			available: boolean;
			helperPath?: string;
			reason?: string;
			error?: string;
		}>;
		isNativeMacCaptureAvailable: () => Promise<{
			success: boolean;
			available: boolean;
			helperPath?: string;
			reason?: "unsupported-platform" | "missing-helper" | string;
			error?: string;
		}>;
		startNativeWindowsRecording: (
			request: import("../src/lib/nativeWindowsRecording").NativeWindowsRecordingRequest,
		) => Promise<import("../src/lib/nativeWindowsRecording").NativeWindowsRecordingStartResult>;
		stopNativeWindowsRecording: (discard?: boolean) => Promise<{
			success: boolean;
			path?: string;
			session?: import("../src/lib/recordingSession").RecordingSession;
			message?: string;
			discarded?: boolean;
			error?: string;
		}>;
		pauseNativeWindowsRecording: () => Promise<{
			success: boolean;
			error?: string;
		}>;
		resumeNativeWindowsRecording: () => Promise<{
			success: boolean;
			error?: string;
		}>;
		startNativeMacRecording: (
			request: import("../src/lib/nativeMacRecording").NativeMacRecordingRequest,
		) => Promise<import("../src/lib/nativeMacRecording").NativeMacRecordingStartResult>;
		pauseNativeMacRecording: () => Promise<{
			success: boolean;
			error?: string;
		}>;
		resumeNativeMacRecording: () => Promise<{
			success: boolean;
			error?: string;
		}>;
		stopNativeMacRecording: (discard?: boolean) => Promise<{
			success: boolean;
			path?: string;
			session?: import("../src/lib/recordingSession").RecordingSession;
			message?: string;
			discarded?: boolean;
			error?: string;
		}>;
		attachNativeMacWebcamRecording: (payload: {
			screenVideoPath: string;
			recordingId: number;
			webcam: import("../src/lib/recordingSession").RecordedVideoAssetInput;
			cursorCaptureMode?: import("../src/lib/recordingSession").CursorCaptureMode;
		}) => Promise<{
			success: boolean;
			path?: string;
			session?: import("../src/lib/recordingSession").RecordingSession;
			message?: string;
			error?: string;
		}>;
		discardCursorTelemetry: (recordingId: number) => Promise<void>;
		getCursorTelemetry: (videoPath?: string) => Promise<{
			success: boolean;
			samples: CursorTelemetryPoint[];
			clicks: number[];
			message?: string;
			error?: string;
		}>;
		onStopRecordingFromTray: (callback: () => void) => () => void;
		openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
		pickExportSavePath: (
			fileName: string,
			exportFolder?: string,
		) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		writeExportToPath: (
			videoData: ArrayBuffer,
			filePath: string,
		) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		openVideoFilePicker: () => Promise<{ success: boolean; path?: string; canceled?: boolean }>;
		setCurrentVideoPath: (path: string) => Promise<{ success: boolean }>;
		setCurrentRecordingSession: (
			session: import("../src/lib/recordingSession").RecordingSession | null,
		) => Promise<{
			success: boolean;
			session?: import("../src/lib/recordingSession").RecordingSession;
		}>;
		getCurrentVideoPath: () => Promise<{ success: boolean; path?: string }>;
		getCurrentRecordingSession: () => Promise<{
			success: boolean;
			session?: import("../src/lib/recordingSession").RecordingSession;
		}>;
		readBinaryFile: (filePath: string) => Promise<{
			success: boolean;
			data?: ArrayBuffer;
			path?: string;
			message?: string;
			error?: string;
		}>;
		getReadableFileInfo: (filePath: string) => Promise<{
			success: boolean;
			size?: number;
			mtimeMs?: number;
			path?: string;
			message?: string;
			error?: string;
		}>;
		readFileChunk: (
			filePath: string,
			offset: number,
			length: number,
		) => Promise<{
			success: boolean;
			data?: ArrayBuffer;
			bytesRead?: number;
			message?: string;
			error?: string;
		}>;
		preparePreviewAudioTrack: (filePath: string) => Promise<{
			success: boolean;
			path?: string | null;
			message?: string;
			error?: string;
		}>;
		clearCurrentVideoPath: () => Promise<{ success: boolean }>;
		saveProjectFile: (
			projectData: unknown,
			suggestedName?: string,
			existingProjectPath?: string,
		) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		loadProjectFile: (projectFolder?: string) => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		loadCurrentProjectFile: () => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		getPathForFile: (file: File) => string;
		loadProjectFileFromPath: (filePath: string) => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		onMenuNewProject: (callback: () => void) => () => void;
		onMenuImportVideo: (callback: () => void) => () => void;
		onMenuLoadProject: (callback: () => void) => () => void;
		onMenuSaveProject: (callback: () => void) => () => void;
		onMenuSaveProjectAs: (callback: () => void) => () => void;
		getPlatform: () => Promise<string>;
		revealInFolder: (
			filePath: string,
		) => Promise<{ success: boolean; error?: string; message?: string }>;
		getShortcuts: () => Promise<Record<string, unknown> | null>;
		saveShortcuts: (shortcuts: unknown) => Promise<{ success: boolean; error?: string }>;
		updateGlobalShortcut: (binding: {
			key: string;
			ctrl?: boolean;
			shift?: boolean;
			alt?: boolean;
		}) => Promise<{ success: boolean }>;
		hudOverlayHide: () => void;
		hudOverlayClose: () => void;
		setHudOverlayIgnoreMouseEvents: (ignore: boolean) => void;
		moveHudOverlayBy: (deltaX: number, deltaY: number) => void;
		setHudOverlaySize: (width: number, height: number) => void;
		showCountdownOverlay: (value: number, runId: number) => Promise<void>;
		setCountdownOverlayValue: (value: number, runId: number) => Promise<void>;
		hideCountdownOverlay: (runId: number) => Promise<void>;
		onCountdownOverlayValue: (callback: (value: number | null) => void) => () => void;
		setMicrophoneExpanded: (expanded: boolean) => void;
		setHasUnsavedChanges: (hasChanges: boolean) => void;
		onRequestSaveBeforeClose: (callback: () => Promise<boolean> | boolean) => () => void;
		onRequestCloseConfirm: (callback: () => void) => () => void;
		sendCloseConfirmResponse: (choice: "save" | "discard" | "cancel") => void;
		setLocale: (locale: string) => Promise<void>;
		saveDiagnostic: (payload: {
			error: string;
			stack?: string;
			projectState: unknown;
			logs: string[];
		}) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
		aiProviderStatus: (providerId: AiProviderId) => Promise<AiProviderStatus>;
		aiListProviders: () => Promise<AiProviderListing[]>;
		aiProviderPolicy: () => Promise<AiProviderPolicy>;
		aiGetSettings: () => Promise<AiSettingsPublic>;
		aiSaveSettings: (update: {
			provider?: AiProviderId;
			modelByProvider?: Partial<Record<AiProviderId, string>>;
			apiKeys?: Partial<Record<AiKeyId, string | null>>;
		}) => Promise<{ success: boolean; settings?: AiSettingsPublic; error?: string }>;
		aiRestyleWebcam: (payload: {
			sourcePath: string;
			prompt: string;
		}) => Promise<{ success: boolean; path?: string; error?: string }>;
		aiChatSend: (payload: {
			provider: AiProviderId;
			model: string;
			text: string;
			snapshot?: AiProjectSnapshot;
			resumeSessionId?: string;
		}) => Promise<{ success: boolean; error?: string }>;
		aiChatCancel: () => Promise<{ success: boolean }>;
		aiChatReset: () => Promise<{ success: boolean }>;
		onAiChatEvent: (callback: (event: AiChatEvent) => void) => () => void;
		onAiToolCall: (
			callback: (call: { callId: string; name: string; input: unknown }) => void,
		) => () => void;
		aiToolResult: (payload: {
			callId: string;
			ok: boolean;
			content: string;
			summary?: string;
			images?: Array<{ data: string; mimeType: string }>;
		}) => void;
		saveSrtFile: (
			filePath: string,
			content: string,
		) => Promise<{ success: boolean; path?: string; error?: string }>;
		saveSrtDialog: (
			content: string,
			suggestedName?: string,
		) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
		webcamPreviewShow: (deviceId?: string) => Promise<{ success: boolean }>;
		webcamPreviewHide: () => Promise<{ success: boolean }>;
		onWebcamPreviewDevice: (callback: (deviceId: string | null) => void) => () => void;
	};
}

type AiProviderId = "claude-code" | "openai" | "gemini" | "grok";

/** Chat providers plus effect services (Decart = webcam restyle) that can own a stored API key. */
type AiKeyId = AiProviderId | "decart";

type AiProviderStatus =
	| { available: true; detail?: string }
	| {
			available: false;
			reason: "not-installed" | "not-authenticated" | "no-api-key" | "coming-soon" | "error";
			detail?: string;
	  };

type AiProviderPolicyStatus = "ok" | "notice" | "disabled";

interface AiProviderPolicyEntry {
	status: AiProviderPolicyStatus;
	message?: Record<string, string>;
	link?: string;
}

interface AiProviderPolicy {
	updatedAt: string;
	providers: Partial<Record<AiProviderId, AiProviderPolicyEntry>>;
}

interface AiModelInfo {
	id: string;
	label: string;
	isDefault?: boolean;
}

interface AiProviderListing {
	id: AiProviderId;
	label: string;
	requiresApiKey: boolean;
	models: AiModelInfo[];
}

interface AiSettingsPublic {
	provider: AiProviderId;
	modelByProvider: Partial<Record<AiProviderId, string>>;
	hasApiKey: Partial<Record<AiKeyId, boolean>>;
}

interface AiProjectSnapshot {
	durationMs: number;
	zoomCount: number;
	trimCount: number;
	speedCount: number;
	hasCursorTelemetry: boolean;
}

type AiChatEvent =
	| { type: "session-started"; sessionId: string }
	| { type: "text-delta"; text: string }
	| { type: "tool-start"; toolCallId: string; name: string; input: unknown }
	| { type: "tool-end"; toolCallId: string; ok: boolean; summary?: string }
	| { type: "turn-done" }
	| {
			type: "error";
			code: "not-installed" | "not-authenticated" | "aborted" | "unknown";
			message: string;
	  };

interface ProcessedDesktopSource {
	id: string;
	name: string;
	display_id: string;
	thumbnail: string | null;
	appIcon: string | null;
}

interface CursorTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
}
