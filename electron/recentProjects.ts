import { promises as fs } from "node:fs";
import path from "node:path";
import { app } from "electron";

export interface RecentProjectEntry {
	path: string;
	/** Project file basename without the .openscreen extension. */
	name: string;
	lastOpenedAt: number;
}

const MAX_RECENT_PROJECTS = 8;

function storeFilePath(): string {
	return path.join(app.getPath("userData"), "recent-projects.json");
}

async function readStore(): Promise<RecentProjectEntry[]> {
	try {
		const raw = await fs.readFile(storeFilePath(), "utf-8");
		const parsed = JSON.parse(raw) as { projects?: unknown };
		if (!Array.isArray(parsed.projects)) return [];
		return parsed.projects.filter(
			(entry): entry is RecentProjectEntry =>
				typeof (entry as RecentProjectEntry)?.path === "string" &&
				typeof (entry as RecentProjectEntry)?.name === "string" &&
				typeof (entry as RecentProjectEntry)?.lastOpenedAt === "number",
		);
	} catch {
		return []; // missing or corrupt store — start fresh
	}
}

/** Move (or insert) a project at the top of the recents list. Best-effort. */
export async function recordRecentProject(projectPath: string): Promise<void> {
	try {
		const existing = await readStore();
		const entry: RecentProjectEntry = {
			path: projectPath,
			name: path.basename(projectPath).replace(/\.openscreen$/i, ""),
			lastOpenedAt: Date.now(),
		};
		const projects = [entry, ...existing.filter((p) => p.path !== projectPath)].slice(
			0,
			MAX_RECENT_PROJECTS,
		);
		await fs.writeFile(storeFilePath(), JSON.stringify({ projects }, null, "\t"), "utf-8");
	} catch {
		// Recents are a convenience — never fail the save/load that triggered this.
	}
}

/** Recents that still exist on disk, newest first. Prunes dead entries lazily. */
export async function listRecentProjects(): Promise<RecentProjectEntry[]> {
	const entries = await readStore();
	const alive: RecentProjectEntry[] = [];
	for (const entry of entries) {
		try {
			await fs.access(entry.path);
			alive.push(entry);
		} catch {
			// deleted/moved — drop from the listing (and from the store below)
		}
	}
	if (alive.length !== entries.length) {
		try {
			await fs.writeFile(storeFilePath(), JSON.stringify({ projects: alive }, null, "\t"), "utf-8");
		} catch {
			// pruning is best-effort
		}
	}
	return alive;
}
