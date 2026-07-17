import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import type { AiToolHost } from "./toolHost";

/**
 * Locate a user-installed CLI (codex, gemini). The app may be launched by
 * launchd with a minimal PATH (see the screen-recording TCC notes in
 * CLAUDE.md), so PATH alone is not enough — also probe the directories the
 * common installers (homebrew, npm -g, volta, asdf, bun) put binaries in.
 */
export function findExecutable(command: string): string | null {
	const home = os.homedir();
	const pathDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
	const extraDirs =
		process.platform === "win32"
			? [
					path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "npm"),
					path.join(home, ".volta", "bin"),
					path.join(home, ".bun", "bin"),
				]
			: [
					"/opt/homebrew/bin",
					"/usr/local/bin",
					"/usr/bin",
					path.join(home, ".local", "bin"),
					path.join(home, "bin"),
					path.join(home, ".npm-global", "bin"),
					path.join(home, ".volta", "bin"),
					path.join(home, ".asdf", "shims"),
					path.join(home, ".bun", "bin"),
				];
	const names =
		process.platform === "win32" ? [`${command}.cmd`, `${command}.exe`, command] : [command];

	for (const dir of [...pathDirs, ...extraDirs]) {
		for (const name of names) {
			const candidate = path.join(dir, name);
			if (existsSync(candidate)) return candidate;
		}
	}
	return null;
}

/**
 * Path of the dependency-free stdio MCP bridge script. Shipped as a raw file:
 * straight from the source tree in dev, from extraResources when packaged
 * (spawning a script out of the asar with ELECTRON_RUN_AS_NODE is unreliable).
 */
export function resolveMcpBridgePath(): string {
	if (app.isPackaged) {
		return path.join(process.resourcesPath, "ai", "mcpBridge.cjs");
	}
	return path.join(app.getAppPath(), "electron", "ai", "mcpBridge.cjs");
}

export interface McpBridgeLaunch {
	command: string;
	args: string[];
	env: Record<string, string>;
}

/**
 * How an external CLI should spawn the bridge as an MCP server. Reuses the
 * Electron binary as the node runtime so users need no node install.
 */
export function mcpBridgeLaunch(host: AiToolHost): McpBridgeLaunch {
	return {
		command: process.execPath,
		args: [resolveMcpBridgePath()],
		env: {
			ELECTRON_RUN_AS_NODE: "1",
			CINEREC_TOOL_HOST_ENDPOINT: host.endpoint,
			CINEREC_TOOL_HOST_TOKEN: host.authToken,
		},
	};
}
