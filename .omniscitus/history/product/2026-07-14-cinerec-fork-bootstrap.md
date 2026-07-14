# cinerec bootstrap — forked OpenScreen to clone Recorded/Screen Studio

**Participants**: dan, claude

## Summary

Researched [Recorded](https://recorded.app) and [Screen Studio](https://screen.studio)
(AI auto-zoom screen recorders) with the goal of cloning their feature set.
Key finding: the "AI auto zoom" is OS-level click/cursor event logging synced to
the recording timeline, which generates zoom keyframes rendered on a GPU canvas —
impossible in a pure web app (browsers cannot observe clicks in other apps), so a
desktop (Electron) app is required.

Compared open-source bases: Cap (AGPLv3 — rejected for license contamination),
Reframed (macOS-only), Screenize (paused), and **OpenScreen (MIT — chosen)**.
The original repo (siddharthvaddem/openscreen) was archived mid-research; switched
upstream to the community continuation **EtienneLescot/openscreen** (v1.6.0,
author-approved successor, still MIT).

## Timeline

- 2026-07-14 — Researched Recorded/Screen Studio features and open-source alternatives
- 2026-07-14 — Cloned OpenScreen; remote renamed to `upstream`; switched to EtienneLescot fork main
- 2026-07-14 — Verified `tsc + vite build` passes on local Node 20.12 (engines wants 22)
- 2026-07-14 — Wrote CLAUDE.md (goals, stack, roadmap vs Recorded); added to workspace project map
- 2026-07-14 — Integrated into root Makefile: fixed Vite port **3732** (`make rec`, part of `make all`)
- 2026-07-14 — Launched dev app (Electron window) via detached session; all 4 workspace apps UP
- 2026-07-14 — Migrated into omniscitus (blueprints for 421 source files, 46 test overlays)

## Decisions

- **Fork, don't rewrite**: recording pipeline, native click hooks, and PixiJS renderer already work
- **MIT only**: never copy Cap (AGPL) code into this repo
- **Port 3732 fixed** ("REC" on a keypad); renderer dev server only — real UI is the Electron window
- Roadmap priorities (see CLAUDE.md): one-click UX, zoom easing/motion-blur quality,
  cursor smoothing, background presets, share links

## Pending

- Run the app end-to-end: record → auto-zoom → export (needs macOS screen-recording
  + accessibility permissions, user-granted)
- Gap analysis vs Recorded (zoom feel, Korean UI, onboarding)
- Distribution plan: landing page + signed/notarized downloads (Apple Developer
  Program needed for macOS notarization)
