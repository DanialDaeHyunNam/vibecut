# cinerec — Recorded/Screen Studio 클론 (OpenScreen 포크)

> 폴더명 `cinerec`는 작업용 코드네임. 브랜딩 확정 시 변경 가능.

## 목표

[Recorded](https://recorded.app)·[Screen Studio](https://screen.studio)를 그대로 베낀 데스크톱 화면 녹화 앱.
핵심 가치: **클릭 감지 → AI 자동 시네마틱 줌** — 키프레임/타임라인 편집 없이 1분 안에 프로급 영상.

## 베이스: OpenScreen 포크 (MIT)

- upstream: https://github.com/EtienneLescot/openscreen (커뮤니티 계승 포크, v1.6.0~, 활발히 유지보수 중)
- 원본(https://github.com/siddharthvaddem/openscreen)은 아카이브됨 — 참고만
- **MIT 라이선스**: 상업적 이용 가능. LICENSE의 원저작자 고지(Siddharth Vaddem) 유지 필수
- upstream 개선사항은 `git fetch upstream` 후 선별 머지

## 스택 / 구조

- Electron + Vite + React + TypeScript + Tailwind + Radix UI
- 렌더링/줌 합성: **PixiJS** (GPU 캔버스)
- 네이티브 캡처: macOS **ScreenCaptureKit**(Swift 헬퍼), Windows **WGC**(C++), Linux는 브라우저 파이프라인
- 클릭/커서 추적: `electron/native-bridge/cursor/` — OS 수준 커서 이벤트를 네이티브로 캡처 → 자동 줌 키프레임 생성
- 주요 디렉토리:
  - `electron/` — main process, ipc, recording, native-bridge
  - `src/components/video-editor/` — 타임라인 편집기
  - `src/components/launch/` — 녹화 시작 UI
  - `scripts/build-macos-screencapturekit-helper.mjs` — 네이티브 헬퍼 빌드

## 실행

루트 Makefile에 편입됨 — Vite 렌더러 포트 **3732 고정** (`make all`에 포함, 단독은 `make rec`):

```bash
make rec                                    # 루트에서: 포그라운드 실행 (Electron 창 뜸)
npm run dev -- --port 3732 --strictPort     # 폴더에서 직접 실행 시 동일 포트 유지
npm run build:mac                           # 네이티브 헬퍼 빌드 포함 macOS 배포 빌드
npm test                                    # vitest
```

웹앱이 아니라 Electron 데스크톱 앱 — 3732는 개발용 렌더러 서버 포트이고 실제 UI는 Electron 창.
브라우저로 3732에 접속하면 네이티브 기능(캡처/커서 훅) 없이 렌더러만 뜬다.

- **Node 요구 22.x** (engines: 22.22.1) — 로컬은 20.12.0. engine-strict 아니라 설치는 되지만, 런타임 이슈 시 Node 22 설치 먼저 의심할 것
- 첫 녹화 시 macOS 화면 기록 + 손쉬운 사용(접근성) 권한 필요

## 로드맵 (Recorded 대비 갭)

OpenScreen에 이미 있음: 자동/수동 줌, 커서 이펙트, 웹캠 오버레이, 자막, 타임라인, 주석, MP4/GIF 내보내기, 14개 언어.

베끼면서 개선할 것 (Recorded/Screen Studio의 강점):
1. **원클릭 UX** — 녹화 종료 → 자동 줌 적용된 결과가 바로 나오는 흐름 (Recorded의 "1분 안에 완성")
2. **줌 품질** — 모션 블러 전환, 이징 곡선 다듬기 (Screen Studio 수준)
3. **커서 스무딩** — 흔들리는 커서를 부드러운 글라이드로 (Screen Studio 시그니처)
4. 배경 프리셋(macOS 월페이퍼/그라디언트) + 패딩/그림자/라운드 프리셋
5. 공유 링크 (무결전 Vercel Blob 패턴 재활용 가능)

## 격리 규칙

워크스페이스 공통: 이 세션은 이 폴더만 수정. 루트 `CLAUDE.md` 참조.

### 🗂 Omniscitus (auto-tracking)

- **Blueprints**: every Write/Edit is auto-tracked by a PostToolUse hook. Do not edit `.omniscitus/blueprints/*.yaml` by hand.
- **Session end**: run `/wrap-up` (or say "wrap up", "마무리"). Work is classified into domain-based topic units under `.omniscitus/history/{domain}/`.
- **Pending review**: `/follow-up` surfaces open items relevant to the current session (last 3 days).
- **Visual browser**: `/birdview` — combined blueprint + history + tests viewer.
- **Tests**: keep real test files wherever they already live. Run `/test-add {file}` to generate an overlay `.omniscitus/tests/{mirrored-path}/meta.yaml` that indexes them for birdview — no file moves, no framework changes. Use `/test-add:prompt {name}` for LLM-judged prompt tests.
- **Domain taxonomy**: `.omniscitus/ontology.yaml` (if present) defines how work is classified.
