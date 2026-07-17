import { randomBytes } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type { AiChatEvent, AiToolExecutor } from "./providers/types";
import { cinerecToolSpecs, executeToolWithEvents, listToolJsonSchemas } from "./toolDefinitions";

/**
 * Local IPC server that lets the out-of-process stdio MCP bridge
 * (mcpBridge.cjs, spawned by external CLIs like Codex/Gemini) execute editor
 * tools that only exist in this process. One host per chat session, bound to
 * that session's executor and event sink.
 *
 * Wire protocol: newline-delimited JSON over a unix socket / named pipe.
 *   → {id, method: "hello", params: {token}}
 *   → {id, method: "list"}
 *   → {id, method: "call", params: {name, input}}
 *   ← {id, result} | {id, error: {message}}
 * The random token (passed to the bridge via env) rejects strangers who find
 * the pipe path; nothing sensitive transits beyond editor state.
 */
export class AiToolHost {
	private server: net.Server | null = null;
	private readonly token = randomBytes(24).toString("hex");
	private readonly sockets = new Set<net.Socket>();

	constructor(
		private readonly executeTool: AiToolExecutor,
		private readonly onEvent: (event: AiChatEvent) => void,
	) {}

	get authToken(): string {
		return this.token;
	}

	/** Endpoint the bridge should connect to; set by start(). */
	endpoint = "";

	async start(): Promise<void> {
		if (this.server) return;
		const suffix = `${process.pid}-${randomBytes(4).toString("hex")}`;
		this.endpoint =
			process.platform === "win32"
				? `\\\\.\\pipe\\vibecut-ai-${suffix}`
				: path.join(os.tmpdir(), `vibecut-ai-${suffix}.sock`);

		const server = net.createServer((socket) => this.handleConnection(socket));
		this.server = server;
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(this.endpoint, () => {
				server.removeListener("error", reject);
				resolve();
			});
		});
	}

	private handleConnection(socket: net.Socket): void {
		this.sockets.add(socket);
		socket.on("close", () => this.sockets.delete(socket));
		socket.on("error", () => {
			// Bridge process died mid-write; close handles cleanup.
		});

		let authenticated = false;
		const rl = readline.createInterface({ input: socket });
		rl.on("line", (line) => {
			let request: { id?: number; method?: string; params?: Record<string, unknown> };
			try {
				request = JSON.parse(line);
			} catch {
				socket.destroy();
				return;
			}
			const id = request.id;
			const reply = (payload: Record<string, unknown>) => {
				if (!socket.destroyed) {
					socket.write(`${JSON.stringify({ id, ...payload })}\n`);
				}
			};

			if (request.method === "hello") {
				authenticated = request.params?.token === this.token;
				if (!authenticated) {
					reply({ error: { message: "Bad token" } });
					socket.destroy();
					return;
				}
				reply({ result: { ok: true } });
				return;
			}
			if (!authenticated) {
				reply({ error: { message: "Not authenticated" } });
				socket.destroy();
				return;
			}

			if (request.method === "list") {
				reply({ result: { tools: listToolJsonSchemas() } });
				return;
			}
			if (request.method === "call") {
				const name = String(request.params?.name ?? "");
				const spec = cinerecToolSpecs.find((candidate) => candidate.name === name);
				if (!spec) {
					reply({ error: { message: `Unknown tool: ${name}` } });
					return;
				}
				executeToolWithEvents(spec, this.executeTool, this.onEvent, request.params?.input)
					.then((result) => reply({ result }))
					.catch((error) =>
						reply({ error: { message: error instanceof Error ? error.message : String(error) } }),
					);
				return;
			}
			reply({ error: { message: `Unknown method: ${String(request.method)}` } });
		});
	}

	close(): void {
		for (const socket of this.sockets) {
			socket.destroy();
		}
		this.sockets.clear();
		this.server?.close();
		this.server = null;
	}
}
