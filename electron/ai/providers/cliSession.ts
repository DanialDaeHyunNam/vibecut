import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { AiToolHost } from "../toolHost";
import type { AiChatEvent, AiChatSession, AiChatSessionOptions } from "./types";

/**
 * Base for chat sessions backed by an external CLI with no long-lived
 * streaming-input mode (Codex, Gemini): each turn spawns one process, and the
 * session owns everything that is identical across such providers — the
 * send queue with sequential draining, the lazy temp workspace, the per-session
 * tool host lifecycle, and cancel/dispose semantics. Subclasses only describe
 * how to prepare the workspace and how to run one turn.
 */
export abstract class PerTurnCliSession implements AiChatSession {
	protected readonly host: AiToolHost;
	protected child: ChildProcess | null = null;
	protected disposed = false;
	private workspacePromise: Promise<string> | null = null;
	private readonly queue: string[] = [];
	private draining = false;

	constructor(protected readonly options: AiChatSessionOptions) {
		this.host = new AiToolHost(options.executeTool, options.onEvent);
	}

	/** Prefix for the mkdtemp workspace directory, e.g. "vibecut-codex-". */
	protected abstract readonly workspacePrefix: string;

	/** Write the system prompt / CLI config files into the fresh workspace. */
	protected abstract prepareWorkspace(dir: string): Promise<void>;

	/** Run one conversation turn; resolve when the turn's process has closed. */
	protected abstract runTurn(text: string, workspace: string): Promise<void>;

	protected emit(event: AiChatEvent): void {
		this.options.onEvent(event);
	}

	protected emitError(message: string, code: "not-authenticated" | "unknown" = "unknown"): void {
		this.emit({ type: "error", code, message });
	}

	private ensureWorkspace(): Promise<string> {
		this.workspacePromise ??= (async () => {
			await this.host.start();
			const dir = await fs.mkdtemp(path.join(os.tmpdir(), this.workspacePrefix));
			await this.prepareWorkspace(dir);
			return dir;
		})();
		return this.workspacePromise;
	}

	send(text: string): void {
		if (this.disposed) return;
		this.queue.push(text);
		void this.drain();
	}

	private async drain(): Promise<void> {
		if (this.draining) return;
		this.draining = true;
		try {
			while (this.queue.length > 0 && !this.disposed) {
				const text = this.queue.shift() as string;
				let workspace: string;
				try {
					workspace = await this.ensureWorkspace();
				} catch (error) {
					this.emitError(error instanceof Error ? error.message : String(error));
					continue;
				}
				if (this.disposed) break;
				await this.runTurn(text, workspace);
			}
		} finally {
			this.draining = false;
		}
	}

	/**
	 * Spawn the turn's CLI process and resolve when it closes. Tracks the child
	 * for cancel/dispose, tails stderr, and swallows everything after dispose.
	 * `onClose` runs only when the session is still live.
	 */
	protected runChild(config: {
		command: string;
		args: string[];
		cwd: string;
		env?: NodeJS.ProcessEnv;
		onStdoutLine?: (line: string) => void;
		collectStdout?: boolean;
		onClose: (result: { code: number | null; stdout: string; stderrTail: string }) => void;
	}): Promise<void> {
		return new Promise((resolve) => {
			const child = spawn(config.command, config.args, {
				cwd: config.cwd,
				env: config.env ?? process.env,
				stdio: ["ignore", "pipe", "pipe"],
			});
			this.child = child;

			let stdout = "";
			let stderrTail = "";

			if (config.onStdoutLine) {
				readline
					.createInterface({ input: child.stdout as NodeJS.ReadableStream })
					.on("line", (line) => {
						if (!this.disposed) config.onStdoutLine?.(line);
					});
			}
			if (config.collectStdout) {
				child.stdout?.on("data", (chunk: Buffer) => {
					stdout += chunk.toString();
				});
			}
			child.stderr?.on("data", (chunk: Buffer) => {
				stderrTail = (stderrTail + chunk.toString()).slice(-4096);
			});

			child.on("error", (error) => {
				this.child = null;
				if (!this.disposed) this.emitError(error.message);
				resolve();
			});
			child.on("close", (code) => {
				this.child = null;
				if (!this.disposed) config.onClose({ code, stdout, stderrTail });
				resolve();
			});
		});
	}

	async cancel(): Promise<void> {
		this.queue.length = 0;
		const child = this.child;
		if (child) {
			child.kill("SIGINT");
			setTimeout(() => {
				if (!child.killed) child.kill("SIGKILL");
			}, 2000).unref();
		}
		this.emit({ type: "error", code: "aborted", message: "Cancelled." });
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.queue.length = 0;
		this.child?.kill("SIGKILL");
		this.child = null;
		this.host.close();
		void this.workspacePromise
			?.then((dir) => fs.rm(dir, { recursive: true, force: true }))
			.catch(() => {
				// Temp-dir cleanup is best-effort.
			});
	}
}
