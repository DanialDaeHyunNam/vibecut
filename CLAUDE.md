# cinerec — Recorded/Screen Studio 클론 (OpenScreen 포크)

> 폴더명 `cinerec`는 작업용 코드네임. **브랜드명 확정: Vibecut** (2026-07-16, appId app.vibecut).

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

**최초 클론/재설치 후 필수**: `npm run build:native:mac` — 커서 추적·캡처용 Swift 헬퍼 빌드.
안 하면 녹화 시 "cursor helper couldn't be found in this build" 팝업이 뜬다 (Xcode 필요, ~5초).

- **Node 요구 22.x** (engines: 22.22.1) — 로컬은 20.12.0. engine-strict 아니라 설치는 되지만, 런타임 이슈 시 Node 22 설치 먼저 의심할 것
- 첫 녹화 시 macOS 화면 기록 + 손쉬운 사용(접근성) 권한 필요

### ⚠️ 화면 기록 권한이 계속 denied일 때 (2026-07-14 삽질 기록)

**근본 원인 2개가 겹쳐 있었다:**

1. **TCC 책임 프로세스 귀속**: Electron을 셸(터미널/Claude 세션)의 자식으로 띄우면 macOS가
   화면기록 권한을 Electron이 아니라 **터미널 계보**에 물어서 denied가 된다.
   → 해결: vite는 `CINEREC_NO_SPAWN=1`로 Electron 스폰 없이 띄우고, Electron은
   `launchctl setenv VITE_DEV_SERVER_URL http://localhost:3732` 후
   `open -n node_modules/electron/dist/Electron.app --args {cinerec 절대경로}` 로
   **launchd 직속** 실행 (루트 Makefile `make rec`/`make all`이 이 구조).
2. **adhoc 서명**: 개발용 Electron은 adhoc 서명이라 TCC가 허용을 붙일 안정적 신원이 없다.
   → 해결: `codesign --force --deep --sign "Apple Development: <본인 인증서>" node_modules/electron/dist/Electron.app`
   (인증서 이름은 `security find-identity -v -p codesigning`으로 확인)

**진단법** (팝업 없이 즉시 확인): Electron으로 `getMediaAccessStatus("screen")` 출력하는
프로브 스크립트를 ① 셸에서 ② `open -n`으로 각각 실행해 비교. ①denied·②granted면 원인 1.

**`npm install`이 Electron을 다시 풀면 서명이 초기화된다** — 권한 문제 재발 시 codesign부터.
`launchctl setenv`는 `make stop`에서 unsetenv됨 (남아있으면 패키지 앱도 dev URL을 열려고 하니 주의).

### ⚠️ dev Electron이 아무 출력 없이 즉시 종료될 때 (2026-07-16 삽질 기록)

`/Applications/Openscreen.app`(패키지 설치본)이 실행 중이면 **단일 인스턴스 락**
(`$TMPDIR/openscreen-single-instance-uid-501.lock` + `app.requestSingleInstanceLock`)을
쥐고 있어서 dev Electron이 에러·로그 하나 없이 exit 0으로 죽는다 (electron/main.ts:120-129).
진단: 락 디렉토리의 `pid` 파일을 `ps -p`로 확인. 해결: 패키지 앱 종료 후 `make rec` 재실행.

## AI 채팅 패널 (자연어 편집)

에디터 우측 레일 [AI|설정] 탭에서 LLM에게 자연어로 편집 지시 ("0:03에 줌 추가해줘").
- **Claude Code 구독 연동** (API key 불필요): `@anthropic-ai/claude-agent-sdk`가 main 프로세스에서
  네이티브 `claude` 바이너리(`@anthropic-ai/claude-agent-sdk-darwin-arm64` 패키지에 내장, ~240MB)를
  spawn — PATH 불필요, 인증은 `~/.claude` 로그인 재사용. **OpenAI=Codex CLI·Gemini=AI Studio 키**도
  실동작 (공용 stdio MCP 브리지 `mcpBridge.cjs` + 유닉스 소켓 툴 호스트); Grok은 coming-soon.
- 구조: main `electron/ai/` (프로바이더/툴 정의/브리지/원격 정책 킬스위치) ↔ 렌더러
  `src/components/ai-chat/` + `useAiToolHost` (툴콜을 `aiCommandExecutor`로 실행 → `pushState` =
  변이 툴콜 1회당 undo 1스텝). 에이전트는 파일/셸 접근 불가(`tools: []` + MCP allowlist), maxTurns 12.
- 멀티모달: 입력 첨부(이미지/영상→키프레임 콘택트 시트, `keyframeExtraction.ts` 단일 파이프라인),
  `get_video_frames`(무인자 호출 시 scene-detect 스토리보드), `get_transcript`(로컬 Whisper),
  클릭 텔레메트리(`get_click_events`)로 지시를 실제 클릭 좌표에 정렬.
- **자막 시스템**: fontSize는 "1080p 기준 px"(프리뷰/export가 표면 높이에 비례 스케일 — 화면 비율 고정),
  인라인 부분 색상 `{#hex|단어}`(`captionRichText.ts` 파서를 프리뷰·export·SRT·라벨 공유),
  박스 스타일(boxPaddingX/Y em·boxRadius·boxShadow), motion `toAnchor: top|middle|bottom`
  (시작=style.position, 도착=toAnchor 조합), 숫자 fontWeight(100–900)·fontFamily.
- **대화 지속성 3중**: 프로젝트별 localStorage(키=녹화 경로) + `<video>.chat.json` 파일
  write-through 백업(quota 무관) + SDK `resume`. 로드 시 아이템 많은 쪽 채택.
  에이전트 트랜스크립트는 `~/.claude/projects/`(cwd 기준)에 JSONL로 남음 — 최후 복구 수단.
- 설정: `<userData>/ai-settings.json` (API key는 safeStorage 암호화). 최근 프로젝트는
  `<userData>/recent-projects.json`(main이 저장/열기 시 기록, 빈 화면에서 원클릭 오픈).
  테스트: `aiCommandExecutor.test.ts` 등 vitest 425+.

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
