# AI provider integrations — decisions & implementation

How Vibecut's AI editing assistant connects to each model provider: the
discussion that shaped each choice, the decision we landed on, and how it's
actually wired. Written for contributors evaluating or extending the provider
layer. For the system-wide map see [ARCHITECTURE.md](../ARCHITECTURE.md); for
the working rules see [AGENTS.md](../AGENTS.md).

## The through-line: bring the AI you already have

Every provider decision descends from one product principle: **the user pays
for their own model access, and Vibecut never handles the raw credential.**
Vibecut is a local desktop app with no backend; we don't proxy model calls, we
don't hold API keys on a server, and we don't extract or replay a provider's
login token. Concretely that means:

- Subscription providers (Claude, ChatGPT) are driven through the provider's
  own official CLI/SDK, which owns its login. Vibecut spawns it and talks to it
  over a local protocol — it never reads the token file.
- Key providers (Gemini, Grok, and the Decart effect service) store the key
  encrypted on-device (`safeStorage`) and inject it only into the child
  process that needs it. The renderer never sees key material.

This principle is also a moving target: AI providers changed their
third-party-usage terms repeatedly in 2026, which is why the provider layer
carries a remote policy kill switch (see the cross-cutting section).

## Shared architecture (all providers)

The providers plug into one tool pipeline, so a provider is only responsible
for "turn text into streamed events + tool calls." Everything editor-specific
is shared:

- **One tool registry** — `electron/ai/toolDefinitions.ts` defines the ~18
  editor tools (zoom/trim/speed/caption CRUD, styling, frame capture,
  transcript, SRT export, `ask_user`, `restyle_webcam`) exactly once, as zod
  schemas. Two consumers derive from it: the Claude Agent SDK's in-process MCP
  server, and JSON Schemas served to external CLIs (`listToolJsonSchemas`).
- **One mutation path** — every tool call is RPC'd into the renderer
  (`toolBridge.ts` → `useAiToolHost` → `aiCommandExecutor.ts`) and applied
  through the editor's `pushState`, so one tool call is exactly one undo step.
- **Provider interface** — `electron/ai/providers/types.ts`: `listModels()`,
  `getStatus()`, `createSession()`. `getStatus()` powers the panel's gate
  (missing binary / not signed in / needs key / remotely disabled).
- **stdio MCP bridge** — external CLIs reach the editor tools through
  `electron/ai/mcpBridge.cjs` (a dependency-free stdio MCP server the CLI
  spawns) which proxies to `electron/ai/toolHost.ts` in the main process over a
  token-authenticated local socket. Chip events flow identically for every
  provider.

New provider ≈ implement the interface + (for CLIs) extend `PerTurnCliSession`.

---

## Claude — `claude-code` (label: "Claude")

**Discussion.** Claude was the anchor provider: the whole assistant concept
started from "drive the editor with the Claude Code subscription, no API key."
The open question was auth. An API key would have been simplest to build but
breaks the core principle (the user would pay per-token on top of a
subscription they already have, and we'd be handling a secret). The
alternative — reuse the user's Claude subscription — is exactly what the
`@anthropic-ai/claude-agent-sdk` is built to do: it vendors the native `claude`
binary and authenticates against the existing `~/.claude` login.

A second discussion was process placement. The Agent SDK can run in the
renderer or main. We chose **main** so the launchd-launched dev app's minimal
PATH can't break binary resolution (the SDK resolves its vendored binary
itself), and so no model traffic touches the renderer.

**Decision.** Subscription auth via the Agent SDK, run in the main process,
with a stored **Anthropic API key as an optional fallback** (added later when
provider terms proved unstable — see cross-cutting). Long-lived streaming
session so conversation memory survives across chat turns and app restarts.

**Implementation** (`electron/ai/providers/claudeCode.ts`).
- One long-lived `query()` consumes a push-based `MessageQueue`, so the CLI
  process and its context survive across turns; `resume` continues the
  per-project conversation after a restart.
- Editor tools are exposed as an **in-process MCP server**
  (`createSdkMcpServer` + `createCinerecTools`); `tools: []` + an allowlist
  disables every built-in tool so the agent has no file/shell/network access.
- `settingSources: []` isolates the agent from the user's global Claude Code
  config (CLAUDE.md, output styles).
- Auth: `getStatus()` accepts a `~/.claude` login **or** a stored Anthropic
  key; when a key is present it's injected via the SDK's `env` option.
- **Naming constraint:** the internal id stays `claude-code` (persisted in
  settings) but the user-facing label is **"Claude"** — Anthropic's partner
  branding guidelines prohibit "Claude Code" as a product-facing name.
- Models: Fable 5, Opus 4.8 (default), Sonnet 5, Haiku 4.5.

---

## ChatGPT — `openai` (label: "Codex (ChatGPT)")

**Discussion.** After Claude worked, the goal was parity for ChatGPT
subscribers. There is no "OpenAI Agent SDK" equivalent, but the **Codex CLI**
supports ChatGPT-subscription login (`codex login`) — the same
bring-your-own-subscription shape. Two problems had to be solved to reuse it:
(1) Codex has no long-lived streaming-input mode like the Agent SDK, and (2)
it needs a way to call our editor tools. OpenAI is the most permissive of the
three majors about third-party CLI use, so subscription auth here was low-risk.

**Decision.** Spawn the official Codex CLI per turn; carry conversation memory
with `codex exec resume`; expose editor tools through the shared stdio MCP
bridge configured via Codex's `-c mcp_servers.*` overrides. `OPENAI_API_KEY`
remains an accepted env fallback but the UI leads with subscription login.

**Implementation** (`electron/ai/providers/codexCli.ts`, on
`providers/cliSession.ts`).
- Each turn runs `codex exec [resume <id>] --json` in a throwaway temp
  workspace whose `AGENTS.md` carries the system prompt.
- `--sandbox read-only` keeps Codex's built-in shell from touching anything;
  editing happens only through our MCP tools.
- The stdio bridge (`mcpBridge.cjs`) is wired in with `-c` TOML overrides
  pointing at this session's tool host; per-call timeout raised to 600s for
  slow tools (`ask_user`, transcript).
- Output is parsed by `codexEvents.ts` (unit-tested, Electron-free) which
  handles both the current thread/item JSONL shape and the legacy `{id,msg}`
  shape.
- Session ids handed to the renderer are namespaced (`codex:<id>`) so one
  provider never resumes another's persisted session.

---

## Gemini — `gemini` (label: "Gemini")

**Discussion.** Gemini is the one provider where subscription auth was
**deliberately rejected**. Google's 2026 service update explicitly prohibits
"using Gemini CLI OAuth with third-party software" and has **suspended real
paid accounts** (including Ultra subscribers) for that pattern; Google's own
recommendation for third-party agents is an API key. Reusing the user's Google
login would have put their account at risk — a non-starter given the whole
point is to be safe for the user. The trade-off (a free AI Studio key instead
of "no key at all") was worth avoiding an account-ban vector.

**Decision.** Authenticate with a free **Google AI Studio API key** injected as
`GEMINI_API_KEY` into the official `gemini` CLI — never the user's Google
login. `requiresApiKey = true`, and the panel gates on a missing key with a
link to `aistudio.google.com/apikey`. Google-login detection was removed
entirely (and a comment left so nobody "helpfully" adds it back).

**Implementation** (`electron/ai/providers/geminiCli.ts`, on
`PerTurnCliSession`).
- Each turn runs `gemini -p --output-format json` in a temp workspace whose
  `GEMINI.md` carries the system prompt.
- Gemini has no headless session resume, so the session **replays its own
  transcript** as context each turn (bounded to recent turns).
- MCP wiring + a built-in-tool lockdown (excluding shell/file/web tools, both
  legacy and current tool-name spellings) live in the workspace's
  `.gemini/settings.json`.
- Models: Gemini 3 Pro (default), 2.5 Pro, 2.5 Flash.

---

## Grok — `grok` (coming soon)

**Discussion.** xAI has no subscription CLI comparable to Codex/Gemini, so Grok
would be a pure API-key provider. Rather than ship a half-tested provider, we
scoped it to "collect the key ahead of the implementation."

**Decision.** Keep Grok a `coming-soon` provider — no session implementation —
but let the settings layer store its key so the UI can collect one early. Its
model list is empty, so it renders as a disabled "coming soon" row.

**Implementation** (`electron/ai/providers/index.ts`). A `ComingSoonProvider`
placeholder; `getStatus()` returns `{ available: false, reason: "coming-soon" }`;
`createSession()` throws. The key id exists in `AiKeyId` so a Grok key can be
saved via the same encrypted path.

---

## Decart — effect service (not a chat provider)

**Discussion.** Separate from the chat providers: the `restyle_webcam` tool
transforms the webcam overlay with generative video AI (Lucy). This is a
post-processing effect, not a conversation model. The only supported API is
Decart's, and it bills per second (~$0.15/s on Lucy Pro), so it's a paid,
key-based, cost-disclosed feature — kept out of the model picker and surfaced
only when the tool is actually used.

**Decision.** Store a Decart API key under the same encrypted settings
(`AiKeyId = providers + "decart"`); run the transform entirely in the main
process so the key never reaches the renderer; make it one undo step and never
touch the original file.

**Implementation** (`electron/ai/effects/restyleWebcam.ts`). Lazily imports
`@decartai/sdk` (externalized from the bundle — its realtime half pulls
browser-only WebRTC deps), submits the webcam clip via the queue API, writes
the result next to the source, and the renderer swaps it in via
`EditorState.webcamSourceOverridePath` (undoable). The Decart key row only
appears in the picker after the agent first tries the tool this session.

---

## Cross-cutting decisions

### Subscription-terms volatility → remote policy kill switch
AI-provider third-party-usage terms shifted three times in 2026 (Anthropic:
Feb ban → May SDK-credit program → Jun pause; Google: OAuth ban with
enforcement + account suspensions). A desktop app can't re-ship fast enough to
protect users from a mid-cycle change. So the app fetches a small static
manifest (`site/provider-policy.json`, served from the landing deployment)
once a day, fail-open, and can flag a provider (`notice` banner) or disable it
(`disabled` gate, with an API-key escape hatch) for **every installed app
within a day, no release needed**. It's a single static-file GET with no
payload — nothing about the user is transmitted. See
`electron/ai/providerPolicy.ts`.

### Default provider = the one you can actually use
Rather than always defaulting to Claude and hitting a login wall, the panel —
until the user explicitly picks a provider (`providerExplicit` flag) — probes
every provider's status and starts on the first **usable** one (has a key or a
login) in `claude → openai → gemini → grok` priority order. Once the user
chooses, that choice is remembered across launches.

### Just-in-time key prompts
The picker never shows every provider's key field at once. A key row appears
only for the provider the user selected when its key/login is missing, and
Decart's only after the restyle tool is tried. Once saved, the row disappears.

### Key storage
All keys (`AiKeyId`) are encrypted with Electron `safeStorage` under
`userData/ai-settings.json` and never sent to the renderer — the renderer only
ever sees `hasApiKey` booleans. See `electron/ai/settings.ts`.

---

## Decision timeline

| Date | Decision |
|---|---|
| 2026-07-16 | AI assistant built on Claude Agent SDK (subscription auth, in-process MCP, main process) |
| 2026-07-17 | Codex + Gemini providers via shared stdio MCP bridge; Grok = key-UI only |
| 2026-07-17 | Terms research → Claude label fix + API-key fallback; Gemini switched to AI Studio key (OAuth prohibited); provider-policy kill switch |
| 2026-07-19 | Decart `restyle_webcam` effect (key-based, cost-disclosed); just-in-time key prompts; availability-based default provider |

The narrative record (per-session discussion) lives under
`.omniscitus/history/native/2026-07-16-ai-editing-assistant.md` and
`.omniscitus/history/product/2026-07-16-open-source-release-plan.md`.
