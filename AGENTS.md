# AGENTS.md

Vibecut is a free, open-source screen recorder with a built-in AI editing
assistant (Electron + React + TypeScript + Pixi.js), forked from
[OpenScreen](https://github.com/EtienneLescot/openscreen). This file is the
canonical guide for any AI coding agent (or human) working in this repo.
**Read [ARCHITECTURE.md](ARCHITECTURE.md) first** — it maps the processes,
directories, and data flows.

## Setup commands

- Install deps: `npm install` (Node 22.x, npm 10 — see `package.json#engines`)
- macOS, once per clone: `npm run build:native:mac` (Swift capture/cursor helper; Xcode, ~5s. Skipping it causes the "cursor helper couldn't be found" popup)
- Start dev:    `npm run dev` (Vite dev server; Electron window opens via `vite-plugin-electron`)
- Build:        `npm run build` (TypeScript check + Vite build + electron-builder)
- Typecheck:    `npx tsc --noEmit`
- Test (unit):  `npm run test` (Vitest, jsdom env — **requires Node 22**; all-red on older Node is your Node version, not your change)
- Test (browser): `npm run test:browser` (Vitest + Playwright, requires `npm run test:browser:install` first)
- Test (e2e):   `npm run test:e2e` (Playwright)
- Lint/format:  `npm run lint` / `npm run format` (Biome, tabs, double quotes, 100-col)
- i18n check:   `npm run i18n:check` (validates the 13 locale files)

## Project layout

- `src/` — React app: UI, editor components, timeline, i18n, captioning/cursor/exporter libs
- `src/components/ai-chat/` — AI panel UI + `aiCommandExecutor.ts` (the *only* editor-mutation gateway for AI)
- `electron/` — main process, IPC, recording orchestration
- `electron/ai/` — AI runtime: provider abstraction, tool registry, tool host, stdio MCP bridge, encrypted settings
- `electron/native/` — **native** capture helpers: `screencapturekit/` (Swift, macOS) and `wgc-capture/` (C++/Win32, Windows). Built and shipped with the app, not loaded from npm
- `site/` — static landing page (hand-written single HTML, no build step; deploy: `vercel deploy --cwd site --prod --yes`)
- `docs/`, `tests/`, `scripts/`, `nix/` — docs, Playwright e2e, build scripts, Linux packaging
- `.omniscitus/` — machine-generated project history. Never edit by hand; never base code changes on it

## Vibecut invariants — do not break these

1. **Editor mutations go through `pushState`.** For AI-driven edits the only
   entry point is `src/components/ai-chat/aiCommandExecutor.ts`. One mutating
   tool call = one undo step. The main process never mutates editor state.
2. **The AI tool registry has one source of truth** —
   `cinerecToolSpecs` in `electron/ai/toolDefinitions.ts`. Adding a tool means:
   spec there → executor case in `aiCommandExecutor.ts` → chip label under
   `tool.` in every `src/i18n/locales/*/aiChat.json` → a system-prompt mention
   (`electron/ai/systemPrompt.ts`) if the agent should be told about it.
   Never define a tool schema anywhere else.
3. **AI sessions stay sandboxed** — cinerec tools only, no file/shell/network.
   New providers must replicate the lockdown (`claudeCode.ts`: `tools: []` +
   allowlist; `codexCli.ts`: read-only sandbox; `geminiCli.ts`: excluded
   built-ins). Per-turn CLI providers extend `PerTurnCliSession`
   (`cliSession.ts`) instead of reimplementing queue/workspace/cancel logic.
4. **Every user-facing string is translated into every locale in the same
   change** (values only — keys are identical across locales). A small Node
   script patching all locale JSONs at once is the accepted pattern; run
   `npm run i18n:check` afterwards.
5. **Files opened by other processes live outside the asar** — declare them in
   `extraResources` (`electron-builder.json5`). `electron/ai/mcpBridge.cjs`
   must stay dependency-free CommonJS: external CLIs run it with
   `ELECTRON_RUN_AS_NODE=1 <electron-binary>`, so no bundling, no imports.
6. **API keys never reach the renderer.** `electron/ai/settings.ts` encrypts
   them with `safeStorage`; the renderer only sees `hasApiKey` booleans.
7. **Keep upstream merges viable.** `upstream` is a configured git remote.
   Prefer additive modules over invasive edits to upstream files; keep diffs
   in shared files minimal. Generic bugfixes are candidates for upstream PRs.

## Code style

- TypeScript strict mode. No new `any`.
- Biome handles lint AND format (tabs, double quotes, 100-col, LF). Run
  `npm run lint:fix` (or `npx biome check --write`) before committing —
  husky + lint-staged enforce it on staged files.
- React functional components only; hooks at top level.
- Comments explain constraints and *why*, not what the next line does. Match
  existing comment density.
- Extract pure logic into Electron-free modules so it can be unit-tested
  (pattern: `codexEvents.ts`, `srt.ts`, `webm-duration.ts`).

## Testing instructions

- Unit tests live next to source as `*.test.ts` / `*.test.tsx`.
- Add a test for every new behavior in the same package as the code under test.
- `electron/ai/aiCliBridge.test.ts` round-trips the real tool host + stdio MCP
  bridge over a real socket — extend it when touching that layer.
- Browser tests (`vitest.browser.config.ts`) only when DOM/Pixi rendering
  matters; e2e specs in `tests/e2e/`.

## PR & commit conventions

- Branch from `main`; never push to it directly (solo-maintainer commits to
  `main` are the current exception, external contributions go through PRs).
- Commit messages: conventional-commit style (`feat(ai): …`, `docs(readme): …`)
  as in recent `git log`.
- **PR titles must follow Conventional Commits** (`feat:`, `fix:`, `chore:`,
  `refactor:`, `perf:`, `docs:`, `test:`, `build:`, `ci:`, `style:`,
  `revert:`) — enforced by the `semantic-pr` CI job.

## Release flow (inherited, not yet active on this fork)

The `.github/workflows/` release pipeline (RC cut → promote, milestones,
Discord notifications, homebrew/winget publishers) is inherited from upstream
OpenScreen and depends on secrets/org infrastructure this fork does not have
(`OPENSCREEN_RELEASE_TOKEN`, Discord webhooks). Until Vibecut wires its own
release automation, releases are cut manually: `npm run build:mac` locally,
then `gh release create` with the artifacts. Keep asset filenames matching the
table in README's Download section.

## Security

- Never commit secrets. `.env.example` exists; real `.env` is gitignored.
- `macos.entitlements` controls macOS permissions — review when touching the
  native recorder.
- Native helpers run with elevated privileges on user systems; treat
  `electron/native/` code as security-sensitive.
- The AI layer's trust boundary: external CLI agents may only reach the tool
  host socket with the per-session token, and the tool surface is the
  registry — widening either is a security decision, not a refactor.

## Gotchas that will waste your time

- **Dev Electron exits instantly, silent, code 0** → a packaged
  Vibecut/Openscreen app holds the single-instance lock
  (`electron/singleInstanceLock.ts`). Quit it and retry.
- **macOS screen-recording permission stays denied in dev** → TCC attributes
  the permission to whatever spawned Electron. Launch it detached from your
  shell; note `npm install` re-extracting Electron resets its code signature.
- **Pixi.js v8** is the rendering engine (filters from `pixi-filters`); GSAP +
  `motion` for animation — don't introduce a second animation stack.
- **Native capture is platform-fragile**; CI runs on Linux only. Manual smoke
  test on real macOS/Windows is required for native changes.
- **README tone**: Vibecut is free and open source — don't add paywalls,
  premium tiers, or upsell language to UI/copy.
