#!/usr/bin/env node
/**
 * Stdio MCP server that proxies every request to the Vibecut tool host
 * (electron/ai/toolHost.ts) over a local socket. External CLI agents
 * (Codex, Gemini) spawn this file as their "cinerec" MCP server; the editor
 * tools themselves live in the Electron main process, which passes the
 * endpoint + auth token via env when it launches the CLI.
 *
 * Runs under `ELECTRON_RUN_AS_NODE=1 <electron-binary> mcpBridge.cjs`, so it
 * must stay dependency-free CommonJS (node builtins only, never bundled).
 */
"use strict";

const net = require("node:net");
const readline = require("node:readline");

const ENDPOINT = process.env.CINEREC_TOOL_HOST_ENDPOINT;
const TOKEN = process.env.CINEREC_TOOL_HOST_TOKEN;

if (!ENDPOINT || !TOKEN) {
	process.stderr.write("mcpBridge: CINEREC_TOOL_HOST_ENDPOINT/TOKEN env missing\n");
	process.exit(1);
}

/** ---- Tool host connection (newline-delimited JSON over the socket) ---- */

let nextHostId = 1;
const pendingHostCalls = new Map(); // id -> {resolve, reject}

const hostSocket = net.connect(ENDPOINT);
hostSocket.setNoDelay(true);

const hostReady = new Promise((resolve, reject) => {
	hostSocket.once("connect", () => {
		hostRequest("hello", { token: TOKEN }).then(resolve, reject);
	});
	hostSocket.once("error", reject);
});

readline.createInterface({ input: hostSocket }).on("line", (line) => {
	let message;
	try {
		message = JSON.parse(line);
	} catch {
		return;
	}
	const pending = pendingHostCalls.get(message.id);
	if (!pending) return;
	pendingHostCalls.delete(message.id);
	if (message.error) {
		pending.reject(new Error(message.error.message || "Tool host error"));
	} else {
		pending.resolve(message.result);
	}
});

function failAllHostCalls(reason) {
	for (const [, pending] of pendingHostCalls) {
		pending.reject(new Error(reason));
	}
	pendingHostCalls.clear();
}

hostSocket.on("close", () => failAllHostCalls("Tool host connection closed"));
hostSocket.on("error", (error) => failAllHostCalls(`Tool host error: ${error.message}`));

function hostRequest(method, params) {
	return new Promise((resolve, reject) => {
		const id = nextHostId++;
		pendingHostCalls.set(id, { resolve, reject });
		hostSocket.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
			if (error) {
				pendingHostCalls.delete(id);
				reject(error);
			}
		});
	});
}

/** ---- MCP server over stdio (newline-delimited JSON-RPC 2.0) ---- */

function respond(id, result) {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function respondError(id, code, message) {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

async function handleRequest(request) {
	const { id, method, params } = request;
	switch (method) {
		case "initialize":
			respond(id, {
				protocolVersion: (params && params.protocolVersion) || "2025-06-18",
				capabilities: { tools: {} },
				serverInfo: { name: "cinerec", version: "1.0.0" },
			});
			return;
		case "ping":
			respond(id, {});
			return;
		case "tools/list": {
			await hostReady;
			const listed = await hostRequest("list");
			respond(id, { tools: listed.tools });
			return;
		}
		case "tools/call": {
			await hostReady;
			const result = await hostRequest("call", {
				name: params && params.name,
				input: (params && params.arguments) || {},
			});
			respond(id, {
				content: [
					{ type: "text", text: result.content },
					...(result.images || []).map((image) => ({
						type: "image",
						data: image.data,
						mimeType: image.mimeType,
					})),
				],
				isError: !result.ok,
			});
			return;
		}
		default:
			respondError(id, -32601, `Method not found: ${method}`);
	}
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
	if (!line.trim()) return;
	let request;
	try {
		request = JSON.parse(line);
	} catch {
		respondError(null, -32700, "Parse error");
		return;
	}
	// Notifications (no id) need no reply — notifications/initialized etc.
	if (request.id === undefined || request.id === null) return;
	handleRequest(request).catch((error) => {
		respondError(request.id, -32603, error && error.message ? error.message : String(error));
	});
});

// The MCP client owns our lifetime: when it closes stdin, shut down.
process.stdin.on("close", () => {
	hostSocket.destroy();
	process.exit(0);
});
