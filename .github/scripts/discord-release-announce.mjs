import { info, warning } from "@actions/core";
import { context, getOctokit } from "@actions/github";

const WEBHOOK_USERNAME = (process.env.DISCORD_WEBHOOK_USERNAME || "OpenScreen").trim();
const WEBHOOK_AVATAR = (process.env.DISCORD_WEBHOOK_AVATAR_URL || "").trim();

const botToken = (process.env.DISCORD_BOT_TOKEN || "").trim();
const channelId = (
	process.env.DISCORD_RC_TESTING_CHANNEL_ID ||
	process.env.DISCORD_RELEASE_CHANNEL_ID ||
	""
).trim();
const webhookUrl = (
	process.env.DISCORD_RC_TESTING_WEBHOOK_URL ||
	process.env.DISCORD_RELEASE_WEBHOOK_URL ||
	process.env.DISCORD_WEBHOOK_URL ||
	""
).trim();

const kind = (process.env.KIND || "stable").trim();
const stableTag = (process.env.STABLE_TAG || "").trim();
const rcTag = (process.env.RC_TAG || "").trim();
const extra = (process.env.EXTRA || "").trim();

if (!stableTag) {
	warning("STABLE_TAG missing; skipping.");
	process.exit(0);
}
if (!webhookUrl && (!botToken || !channelId)) {
	info(
		"Discord announce skipped: set either a webhook URL (preferred) or both " +
			"DISCORD_BOT_TOKEN and a channel id.",
	);
	process.exit(0);
}

const owner = context.repo.owner;
const repo = context.repo.repo;
const releaseUrl = `${context.serverUrl}/${owner}/${repo}/releases/tag/${stableTag}`;
const stableVersion = stableTag.replace(/^v/, "").replace(/-.*$/, "");

let closedIssues = [];
if (process.env.GITHUB_TOKEN) {
	try {
		const octokit = getOctokit(process.env.GITHUB_TOKEN);
		const versionTitle = `v${stableVersion}`;
		const milestones = await octokit.paginate(octokit.rest.issues.listMilestones, {
			owner,
			repo,
			state: "closed",
			per_page: 100,
		});
		const m = milestones.find((x) => x.title === versionTitle);
		if (m) {
			const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
				owner,
				repo,
				milestone: `${m.number}`,
				state: "closed",
				per_page: 100,
			});
			closedIssues = issues
				.filter((i) => !i.pull_request)
				.slice(0, 20)
				.map((i) => `• [#${i.number}](${i.html_url}) ${i.title}`);
		}
	} catch (err) {
		warning(`Failed to fetch closed issues: ${err?.message ?? err}`);
	}
}

const isRc = kind === "rc";
const title = isRc
	? `🧪 ${stableTag} release candidate ready for testing`
	: `🚀 ${stableTag} released`;
const color = isRc ? 15844367 : 5814783;

const description = [
	extra ? `> ${extra}\n` : "",
	`📦 **Download:** [${stableTag}](${releaseUrl})`,
	isRc && rcTag ? `_Promoted from \`${rcTag}\`_` : "",
	closedIssues.length > 0 ? `\n**Closed issues in this release:**\n${closedIssues.join("\n")}` : "",
]
	.filter(Boolean)
	.join("\n");

const payload = {
	embeds: [
		{
			title,
			url: releaseUrl,
			description,
			color,
			timestamp: new Date().toISOString(),
		},
	],
	allowed_mentions: { parse: [] },
};

async function postViaWebhook() {
	const endpoint = new URL(webhookUrl);
	endpoint.searchParams.set("wait", "true");
	const res = await fetch(endpoint.toString(), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			username: WEBHOOK_USERNAME,
			avatar_url: WEBHOOK_AVATAR || undefined,
			...payload,
		}),
	});
	if (!res.ok) {
		const txt = await res.text();
		warning(`Discord webhook POST failed ${res.status}: ${txt}`);
		return false;
	}
	info(`📣 ${kind} announcement posted for ${stableTag} via webhook.`);
	return true;
}

async function postViaBot() {
	const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
		method: "POST",
		headers: {
			Authorization: `Bot ${botToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
	});
	if (!res.ok) {
		const txt = await res.text();
		warning(`Discord bot POST failed ${res.status}: ${txt}`);
		return false;
	}
	info(`📣 ${kind} announcement posted for ${stableTag} via bot.`);
	return true;
}

if (webhookUrl) {
	await postViaWebhook();
} else {
	await postViaBot();
}
