import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { parseCodexEventLine } from "./providers/codexEvents";
import { cinerecToolSpecs, listToolJsonSchemas } from "./toolDefinitions";
import { AiToolHost } from "./toolHost";

describe("parseCodexEventLine", () => {
	it("reads the current thread/item event shape", () => {
		expect(parseCodexEventLine('{"type":"thread.started","thread_id":"t-123"}')).toEqual({
			kind: "session",
			sessionId: "t-123",
		});
		expect(
			parseCodexEventLine(
				'{"type":"item.completed","item":{"id":"i0","type":"agent_message","text":"Done."}}',
			),
		).toEqual({ kind: "message", text: "Done." });
		expect(
			parseCodexEventLine('{"type":"turn.failed","error":{"message":"model overloaded"}}'),
		).toEqual({ kind: "error", message: "model overloaded" });
	});

	it("reads the legacy {id, msg} event shape", () => {
		expect(
			parseCodexEventLine('{"id":"0","msg":{"type":"session_configured","session_id":"s-9"}}'),
		).toEqual({ kind: "session", sessionId: "s-9" });
		expect(
			parseCodexEventLine('{"id":"1","msg":{"type":"agent_message_delta","delta":"Hel"}}'),
		).toEqual({ kind: "delta", text: "Hel" });
		expect(
			parseCodexEventLine('{"id":"1","msg":{"type":"agent_message","message":"Hello"}}'),
		).toEqual({ kind: "message", text: "Hello" });
	});

	it("ignores noise: non-JSON lines, unknown events, item_type variants", () => {
		expect(parseCodexEventLine("Reading prompt from stdin...")).toBeNull();
		expect(parseCodexEventLine('{"type":"turn.completed","usage":{}}')).toBeNull();
		expect(
			parseCodexEventLine(
				'{"type":"item.completed","item":{"item_type":"agent_message","text":"alt key"}}',
			),
		).toEqual({ kind: "message", text: "alt key" });
		expect(
			parseCodexEventLine('{"type":"item.completed","item":{"type":"command_execution"}}'),
		).toBeNull();
	});
});

describe("listToolJsonSchemas", () => {
	it("exposes every registered tool with a bare object schema", () => {
		const schemas = listToolJsonSchemas();
		expect(schemas.map((s) => s.name)).toEqual(cinerecToolSpecs.map((s) => s.name));
		for (const schema of schemas) {
			expect(schema.description.length).toBeGreaterThan(0);
			expect(schema.inputSchema.type).toBe("object");
			expect(schema.inputSchema.$schema).toBeUndefined();
		}
	});

	it("keeps constraints from the zod specs", () => {
		const addZooms = listToolJsonSchemas().find((s) => s.name === "add_zooms");
		const properties = addZooms?.inputSchema.properties as Record<
			string,
			{ type?: string; minItems?: number }
		>;
		expect(properties.zooms.type).toBe("array");
		expect(properties.zooms.minItems).toBe(1);
	});
});

describe("AiToolHost + mcpBridge stdio round-trip", () => {
	let host: AiToolHost | null = null;
	let bridge: ChildProcess | null = null;

	afterEach(() => {
		bridge?.kill("SIGKILL");
		bridge = null;
		host?.close();
		host = null;
	});

	async function startBridge(token: string): Promise<{
		request: (message: Record<string, unknown>) => Promise<Record<string, unknown>>;
	}> {
		const bridgePath = path.join(__dirname, "mcpBridge.cjs");
		const child = spawn(process.execPath, [bridgePath], {
			env: {
				...process.env,
				ELECTRON_RUN_AS_NODE: "1",
				CINEREC_TOOL_HOST_ENDPOINT: (host as AiToolHost).endpoint,
				CINEREC_TOOL_HOST_TOKEN: token,
			},
			stdio: ["pipe", "pipe", "inherit"],
		});
		bridge = child;

		const pending = new Map<number, (response: Record<string, unknown>) => void>();
		readline
			.createInterface({ input: child.stdout as NodeJS.ReadableStream })
			.on("line", (line) => {
				const message = JSON.parse(line) as { id?: number };
				if (typeof message.id === "number") pending.get(message.id)?.(message);
			});

		return {
			request: (message) =>
				new Promise((resolve, reject) => {
					const timer = setTimeout(() => reject(new Error("bridge timeout")), 5000);
					pending.set(message.id as number, (response) => {
						clearTimeout(timer);
						resolve(response);
					});
					child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
				}),
		};
	}

	it("serves initialize, tools/list and tools/call through the socket", async () => {
		const events: string[] = [];
		host = new AiToolHost(
			async (name, input) => ({
				ok: true,
				content: JSON.stringify({ echo: { name, input } }),
				summary: "echoed",
			}),
			(event) => events.push(event.type),
		);
		await host.start();
		const client = await startBridge(host.authToken);

		const init = (await client.request({ id: 1, method: "initialize", params: {} })) as {
			result: { serverInfo: { name: string } };
		};
		expect(init.result.serverInfo.name).toBe("cinerec");

		const listed = (await client.request({ id: 2, method: "tools/list" })) as {
			result: { tools: Array<{ name: string }> };
		};
		expect(listed.result.tools).toHaveLength(cinerecToolSpecs.length);

		const called = (await client.request({
			id: 3,
			method: "tools/call",
			params: { name: "add_zooms", arguments: { zooms: [{ startMs: 0, endMs: 1000 }] } },
		})) as { result: { isError: boolean; content: Array<{ type: string; text: string }> } };
		expect(called.result.isError).toBe(false);
		expect(JSON.parse(called.result.content[0].text).echo.name).toBe("add_zooms");
		// Chip events reached the session's event sink through the host.
		expect(events).toEqual(["tool-start", "tool-end"]);
	});

	it("rejects tool calls with a bad token", async () => {
		host = new AiToolHost(
			async () => ({ ok: true, content: "{}" }),
			() => undefined,
		);
		await host.start();
		const client = await startBridge("wrong-token");

		const called = (await client.request({
			id: 1,
			method: "tools/call",
			params: { name: "get_project_context", arguments: {} },
		})) as {
			error?: { message: string };
		};
		expect(called.error?.message).toBeTruthy();
	});
});
