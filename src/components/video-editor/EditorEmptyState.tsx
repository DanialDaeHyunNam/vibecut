import { AlertCircle, Clock, Film, FolderOpen, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useScopedT } from "@/contexts/I18nContext";
import { getProjectFolder, parentDirectoryOf, saveUserPreferences } from "@/lib/userPreferences";
import { nativeBridgeClient } from "@/native";

interface EditorEmptyStateProps {
	onVideoImported: (videoPath: string) => void;
	/** Called with the loaded project data; handles both button click and drag-drop */
	onProjectOpened: (project: unknown, path: string | null) => void;
}

type DropError = "unsupported-format" | "load-failed" | null;

interface RecentProject {
	path: string;
	name: string;
	lastOpenedAt: number;
}

export function EditorEmptyState({ onVideoImported, onProjectOpened }: EditorEmptyStateProps) {
	const te = useScopedT("editor");
	const tc = useScopedT("common");
	const [isDraggingOver, setIsDraggingOver] = useState(false);
	const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);

	// Recents come from the main process (userData JSON, dead paths pruned).
	useEffect(() => {
		let cancelled = false;
		void nativeBridgeClient.project
			.listRecentProjects()
			.then((projects) => {
				if (!cancelled) setRecentProjects(projects.slice(0, 5));
			})
			.catch(() => {
				// No recents is a fine state — the buttons above still work.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const handleOpenRecent = useCallback(
		async (projectPath: string) => {
			const result = await nativeBridgeClient.project.loadProjectFileFromPath(projectPath);
			if (!result.success || !result.project) {
				// Stale entry (moved/corrupt) — drop it from the list so a retry
				// doesn't hit the same wall.
				setRecentProjects((prev) => prev.filter((p) => p.path !== projectPath));
				return;
			}
			onProjectOpened(result.project, result.path ?? null);
		},
		[onProjectOpened],
	);
	const [dropError, setDropError] = useState<DropError>(null);
	// Freeze the last non-null error type so dialog content doesn't snap to the else-branch
	// during the closing animation (same pattern as UnsavedChangesDialog).
	const lastDropErrorRef = useRef<Exclude<DropError, null>>("unsupported-format");
	if (dropError !== null) {
		lastDropErrorRef.current = dropError;
	}

	const handleImportVideo = useCallback(async () => {
		const result = await window.electronAPI.openVideoFilePicker();
		if (result.canceled || !result.success || !result.path) return;

		const setResult = await nativeBridgeClient.project.setCurrentVideoPath(result.path);
		if (!setResult.success) return;

		onVideoImported(result.path);
	}, [onVideoImported]);

	const handleLoadProject = useCallback(async () => {
		const result = await nativeBridgeClient.project.loadProjectFile(getProjectFolder());
		if (result.canceled || !result.success || !result.project) return;
		if (result.path) {
			const folder = parentDirectoryOf(result.path);
			if (folder) {
				saveUserPreferences({ projectFolder: folder });
			}
		}
		onProjectOpened(result.project, result.path ?? null);
	}, [onProjectOpened]);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		if (e.dataTransfer.items.length > 0) {
			setIsDraggingOver(true);
		}
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		if (!e.currentTarget.contains(e.relatedTarget as Node)) {
			setIsDraggingOver(false);
		}
	}, []);

	const handleDrop = useCallback(
		async (e: React.DragEvent) => {
			e.preventDefault();
			setIsDraggingOver(false);

			const files = Array.from(e.dataTransfer.files);
			if (files.length === 0) return;

			const projectFile = files.find((f) => f.name.endsWith(".openscreen"));
			if (!projectFile) {
				setDropError("unsupported-format");
				return;
			}

			// Use Electron's webUtils.getPathForFile; File.path was removed in Electron 32+
			let filePath: string;
			try {
				filePath = window.electronAPI.getPathForFile(projectFile);
			} catch {
				setDropError("load-failed");
				return;
			}
			if (!filePath) {
				setDropError("load-failed");
				return;
			}

			let result: Awaited<ReturnType<typeof window.electronAPI.loadProjectFileFromPath>>;
			try {
				result = await window.electronAPI.loadProjectFileFromPath(filePath);
			} catch {
				setDropError("load-failed");
				return;
			}
			if (!result.success || !result.project) {
				setDropError("load-failed");
				return;
			}

			onProjectOpened(result.project, result.path ?? null);
		},
		[onProjectOpened],
	);

	return (
		<div
			className="flex h-full w-full flex-col items-center justify-center bg-[#09090b]"
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			{/* Drop overlay */}
			{isDraggingOver && (
				<div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#7C5CFF] bg-[#7C5CFF]/10">
					<Upload className="mb-3 h-10 w-10 text-[#7C5CFF]" />
					<p className="text-base font-semibold text-[#7C5CFF]">{te("emptyState.dropOverlay")}</p>
				</div>
			)}

			{/* Drop error dialog */}
			<Dialog open={dropError !== null} onOpenChange={(open) => !open && setDropError(null)}>
				<DialogContent className="bg-[#09090b] border-white/10 rounded-2xl max-w-sm p-6 gap-0">
					<DialogHeader className="mb-4">
						<div className="flex items-center gap-3">
							<img
								src="./vibecut.png"
								alt=""
								aria-hidden="true"
								className="w-9 h-9 rounded-xl flex-shrink-0"
							/>
							<DialogTitle className="text-base font-semibold text-slate-200 leading-tight">
								{lastDropErrorRef.current === "unsupported-format"
									? te("emptyState.dropErrors.unsupportedFormatTitle")
									: te("emptyState.dropErrors.couldNotOpenTitle")}
							</DialogTitle>
						</div>
					</DialogHeader>

					<div className="flex flex-col items-center gap-3 mb-6 text-center">
						<div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/5 ring-1 ring-white/10">
							<AlertCircle className="w-5 h-5 text-slate-400 flex-shrink-0" />
						</div>
						<p className="text-sm text-slate-400 leading-relaxed">
							{lastDropErrorRef.current === "unsupported-format"
								? te("emptyState.dropErrors.unsupportedFormatMessage")
								: te("emptyState.dropErrors.couldNotOpenMessage")}
						</p>
					</div>

					<button
						type="button"
						onClick={() => setDropError(null)}
						className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-medium text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
					>
						<X className="w-4 h-4" />
						{tc("actions.close")}
					</button>
				</DialogContent>
			</Dialog>

			<div className="relative flex flex-col items-center gap-8 px-6 text-center">
				{/* Logo */}
				<img
					src="./vibecut.png"
					alt=""
					aria-hidden="true"
					className="h-16 w-16 rounded-2xl opacity-90"
				/>

				<div className="flex flex-col gap-2">
					<h2 className="text-xl font-semibold text-slate-200">{te("emptyState.title")}</h2>
					<p className="max-w-sm text-sm leading-relaxed text-slate-500">
						{te("emptyState.description")}
					</p>
				</div>

				{/* Actions */}
				<div className="flex flex-col gap-3 w-full max-w-xs">
					<button
						type="button"
						onClick={handleImportVideo}
						className="flex items-center justify-center gap-2.5 w-full px-4 py-3 rounded-xl bg-[#7C5CFF] hover:bg-[#2d9e6c] active:bg-[#27885c] text-white font-medium text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
					>
						<Film className="h-4 w-4" />
						{te("emptyState.importVideoButton")}
					</button>
					<button
						type="button"
						onClick={handleLoadProject}
						className="flex items-center justify-center gap-2.5 w-full px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-medium text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
					>
						<FolderOpen className="h-4 w-4" />
						{te("emptyState.loadProjectButton")}
					</button>
				</div>

				{/* One-click reopening of recent projects (newest first). */}
				{recentProjects.length > 0 && (
					<div className="w-full max-w-xs text-left">
						<div className="mb-2 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
							<Clock className="h-3 w-3" />
							{te("emptyState.recentProjects")}
						</div>
						<div className="flex flex-col gap-1">
							{recentProjects.map((project) => (
								<button
									key={project.path}
									type="button"
									onClick={() => void handleOpenRecent(project.path)}
									title={project.path}
									className="group flex w-full items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-left transition-colors hover:border-[#7C5CFF]/40 hover:bg-[#7C5CFF]/10 outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF]/50"
								>
									<Film className="h-3.5 w-3.5 shrink-0 text-slate-500 group-hover:text-[#9B84FF]" />
									<span className="min-w-0 flex-1 truncate text-sm text-slate-300 group-hover:text-white">
										{project.name}
									</span>
									<span className="shrink-0 text-[10px] tabular-nums text-slate-600">
										{new Date(project.lastOpenedAt).toLocaleDateString(undefined, {
											month: "short",
											day: "numeric",
										})}
									</span>
								</button>
							))}
						</div>
					</div>
				)}

				<div className="flex flex-col items-center gap-2">
					<p className="text-xs text-slate-600">{te("emptyState.supportedFormats")}</p>
					<div className="flex items-center gap-1.5 text-xs text-slate-700 mt-4">
						<Upload className="h-3 w-3" />
						<span>{te("emptyState.dragDropHint")}</span>
					</div>
				</div>
			</div>
		</div>
	);
}
