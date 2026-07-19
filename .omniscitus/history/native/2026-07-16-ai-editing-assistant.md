# AI 편집 어시스턴트 — 자연어 비디오 편집 패널

**Participants**: Dan, claude

## Summary
에디터 우측 레일의 [AI|설정] 탭에서 로컬 Claude Code 구독으로 영상을 자연어 편집하는
에이전트 패널. 멀티모달 툴 15종(줌/트림/배속/자막/스타일 + 프레임/트랜스크립트/클릭 +
ask_user)과 프로젝트별 대화 저장·세션 이어가기까지 하루에 구축.

## Context
- **Background**: 로드맵 1번(원클릭 UX)의 구현체 — Donkey Cut의 우측 AI 패널을 레퍼런스로, 손 편집 대신 자연어 지시로 편집하는 흐름을 원함
- **Requirements**: 로컬 Claude 구독 연동(API key 불필요), 4개 프로바이더(Claude/OpenAI/Gemini/Grok) 대응 구조, 모델 피커, 변이 툴콜 1회=undo 1스텝
- **Decisions**: ① Agent SDK를 main 프로세스에서 구동(네이티브 claude 바이너리 vendored — launchd PATH 문제 원천 차단) ② 편집 상태 변이는 렌더러 aiCommandExecutor(순수 함수)→pushState 단일 경로 ③ `tools: []`+MCP allowlist로 에이전트 파일/셸 접근 차단 ④ `settingSources: []`로 사용자 글로벌 설정(output style) 격리 ⑤ 자막은 auto-caption과 동일한 AnnotationRegion 재사용 ⑥ ask_user는 툴콜 RPC 경로를 그대로 쓰되 응답자만 사람(채팅 캐러셀 카드)
- **Constraints**: Agent SDK는 MIT 아님(Anthropic 약관) — 소스 공개는 무관, 패키징 배포 시 동봉 약관 확인 필요; vitest는 Node 22 필요(로컬 20.12에서 전체 실패, `ASDF_NODEJS_VERSION=22.12.0`로 실행); 툴 타임아웃 기본 15s(트랜스크립트 300s, ask_user 600s)

## Timeline

### 2026-07-16
**Focus**: AI 채팅 패널 전체 구축 (플랜 승인 → 4단계 구현 → 실사용 피드백 반영 5회전)
- Phase 1-3: 프로바이더 추상화, IPC/preload, 툴 브리지(correlation id RPC), 줌/트림/배속 executor+vitest, 채팅 UI([AI|설정] 탭, 스트리밍, 툴 칩)
- 실사용 피드백 회전: 마크다운 렌더링(react-markdown+GFM), get_video_frames(비전), add_captions/set_style/get_transcript, 프로젝트별 대화 저장+SDK resume, 원클릭 자동편집·이해브리핑 버튼, ask_user 질문 캐러셀 카드(선택 즉시 접힘·자동 진행, 답변 전송됨 표시)
- 에이전트가 실전에서 101초 부동산 시뮬레이터 영상을 프레임 24장으로 보고 줌 14개를 서사 구조로 재배치 — 자막 요청은 정직하게 거절(툴 부재)→즉시 자막 툴 구현으로 이어짐
- AI 탭을 기본 탭으로 승격, 로딩 인디케이터 패딩 등 UI 폴리시

**Learned**: 에이전트 세션이 Claude Code 세션이라 `~/.claude/projects/-/`(cwd 기준)에 JSONL이 남음 — 날아간 사용자 문구 복구와 세션 resume 모두 이 파일 덕분. 에이전트의 "못 한다" 거절이 곧 다음 툴의 로드맵이 됨.

### 2026-07-16 (오후 추가분)
**Focus**: SRT 자막 내보내기 + 컴포저 UX 마감
- `export_captions_srt` 툴(저장 다이얼로그) + `src/lib/captioning/srt.ts`(테스트 2개) + export 패널 "자막 굽기/SRT 별도 저장" 토글 (`handleExportSaved`에서 사이드카 기록)
- 컴포저: ⋮ 빠른 작업 메뉴(자동편집/브리핑 상시 접근), textarea 3줄로 확대, 버튼 레일 상하 정렬
- ask_user 카드: 답변 완료 시 흐림+"답변 전송됨" 표시 (복원된 과거 카드 혼동 해소)
- 구독 연동 조사: Codex CLI(ChatGPT 구독)·Gemini CLI 가능/Grok은 API key만 — stdio MCP 브리지가 공통 과제

**Learned**: SRT가 자막 이관의 사실상 표준. Agent SDK 매니페스트에 win32-x64/arm64 바이너리 포함 — Claude 연동은 윈도우도 지원됨 (실기기 검증은 미실시).

### 2026-07-17
**Focus**: aiChat 네임스페이스 14로케일 실번역 완료
- 영어 시드였던 11개 로케일(ar/es/fr/it/ja/ru/tr/vi/pt-BR/zh-CN/zh-TW)에 프롬프트 포함 전체 키 실번역 작성
- Whisper 언어 자동 감지 확인(transcribeCore가 language 미지정 → auto-detect); tiny 모델의 한국어 한계와 모델 업그레이드 옵션(base/small)은 제안 상태

**Learned**: autoEditPrompt/understandPrompt 같은 "에이전트에게 보내는 프롬프트"도 채팅에 사용자 메시지로 노출되므로 로케일 번역 대상에 포함해야 자연스럽다.

## Pending
- [ ] 실사용 검증 계속: ask_user 재질문 응답 후 맞춤 자동편집 완주 확인
- [ ] 패키징 스모크 (`npm run build:mac`) — SDK external/asarUnpack + 240MB 바이너리 동작 확인
- [ ] 기능 단위 커밋 정리 (40+ 파일 미커밋)
- [x] OpenAI/Gemini/Grok 프로바이더 (2026-07-17: OpenAI는 Codex CLI 구독 연동·Gemini는 Gemini CLI 구독 연동으로 구현 — 공용 stdio MCP 브리지(mcpBridge.cjs)+툴 호스트(유닉스 소켓) 경유로 툴 18종 공유. Grok은 API key 입력 UI만, 프로바이더는 coming-soon 유지)
- [ ] Codex/Gemini 실기기 검증 — 두 CLI 모두 로컬 미설치라 spawn 경로(코덱스 exec resume, gemini 설정 주입)는 실제 CLI로 미확인. `npm i -g @openai/codex` 후 `codex login`, `npm i -g @google/gemini-cli` 후 로그인하고 실채팅 확인 필요
- [ ] 내보내기(export) 트리거 툴 검토
- [ ] A4 restyle_webcam 실검증 (2026-07-19 구현 완료, 미검증): Decart 키 발급(platform.decart.ai) → 피커 하단 Decart 행에 저장 → 웹캠 포함 녹화 → 채팅 "웹캠을 애니 스타일로 바꿔줘" → 미리보기/내보내기/undo/프로젝트 저장·재열기 확인. **미확인 리스크**: lucy-pro-v2v의 클립 길이 제한(생성 모델은 5초 제한 문구 있었음 — v2v는 미명시), 과금 단가. 구조: main `electron/ai/effects/restyleWebcam.ts`(queue.submitAndPoll, 키는 main만) → 결과 파일 approveFilePath → 렌더러 pushState({webcamSourceOverridePath}) 1 undo. 프로젝트 로드 시 override 경로는 handlers.ts 프로젝트 승인 블록에서 trustedDirs 규칙으로 best-effort 승인
- [ ] A5 웹캠 로컬 배경 효과 (③ 설계 확정, 미구현): EditorState에 `webcamBackgroundEffect: "none"|"blur"|"remove"` + set_style 확장. 프리뷰 = VideoPlayback의 웹캠 DOM <video>(1962-2004 부근)를 효과 활성 시 canvas 파이프라인으로 스왑(rAF+세그멘테이션). 내보내기 = `src/lib/exporter/webcamFrameDrawing.ts:13-43 drawWebcamFrameImage`가 단일 초크포인트(gif도 동일 경로, 웹캠 있으면 네이티브 fastpath 이미 비활성). 의존성 @mediapipe/tasks-vision + selfie segmenter 모델을 caption-assets 패턴(extraResources)으로 오프라인 번들

## Notes
관련: [[2026-07-16-webcam-self-view]], [[2026-07-16-open-source-release-plan]].
아키텍처 요약은 CLAUDE.md "AI 채팅 패널" 섹션, 플랜 원본은 ~/.claude/plans/linked-strolling-dahl.md.
