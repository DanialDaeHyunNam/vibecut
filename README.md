<p align="center">
  <img src="icons/icons/png/128x128.png" alt="Vibecut Logo" width="80" />
</p>

# <p align="center">Vibecut</p>

<p align="center"><strong>Vibe-edit your screen recordings. Record, then tell the AI what you want — it watches the video, listens to your narration, and edits for you.</strong></p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-8B7CFF?style=for-the-badge" alt="License" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=for-the-badge" alt="Platform" />
  <img src="https://img.shields.io/badge/AI-Claude%20subscription%2C%20no%20API%20key-7C5CFF?style=for-the-badge" alt="AI" />
</p>

---

Vibecut is an open-source screen recorder and editor with an **AI editing assistant built in**. Instead of dragging keyframes, you chat:

> "Watch the whole video and edit it professionally — zooms that follow the story, cut the dead air, add subtitles."

The agent **sees** your video (frame sampling), **hears** it (on-device Whisper transcription), asks you clarifying questions with selectable option cards, then applies zooms, cuts, speed-ups, captions, and styling — every change is one undo step.

## ✨ AI editing assistant

- **Runs on your Claude subscription** via Claude Code — no API key, nothing leaves your machine except the model calls you already pay for. OpenAI (Codex) and Gemini CLI support is on the roadmap.
- **Multimodal context**: project state, click telemetry, video frames, narration transcript.
- **16 editing tools**: zoom / trim / speed / caption CRUD, frame styling (wallpaper, padding, shadows, webcam PIP), SRT export, and `ask_user` interactive questions.
- **One-click flows**: "Understand & brief me" and "Auto-edit this video" (asks your zoom style, target length, and caption language first).
- **Per-project chat memory** that survives restarts — the agent resumes the same session.

## 🎥 Recording & editing

Everything from OpenScreen, refined:

- Automatic cinematic zooms from OS-level cursor/click tracking (ScreenCaptureKit on macOS, WGC on Windows)
- Floating webcam self-view while recording — excluded from the capture itself
- Timeline editor: zooms, trims, speed regions, annotations, blur, captions (local Whisper auto-captions)
- Caption export: burn-in toggle + standalone `.srt` (SubRip) sidecar
- Backgrounds, padding, shadows, webcam layouts, MP4/GIF export, 14 languages

## 🚀 Development

```bash
npm install
npm run build:native:mac   # macOS: Swift capture/cursor helper (Xcode required, ~5s)
npm run dev                # Vite + Electron
npm test                   # vitest (Node 22+)
```

Requirements: Node 22.x, and for the AI assistant a [Claude](https://claude.com) subscription logged in via Claude Code (`claude` → `/login` once in any terminal).

## 🙏 Credits & license

Vibecut is built on [OpenScreen](https://github.com/EtienneLescot/openscreen) by [Siddharth Vaddem](https://github.com/siddharthvaddem) and the community continuation by [Etienne Lescot](https://github.com/EtienneLescot) — the recording pipeline, timeline editor, and export engine come from that excellent foundation.

MIT licensed. See [LICENSE](LICENSE) — original OpenScreen copyright preserved.
