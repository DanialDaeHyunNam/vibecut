# AI 편집 어시스턴트 — 자연어 비디오 편집 패널

**Participants**: Dan, claude

## Summary
에디터 우측 레일의 [AI|설정] 탭에서 로컬 Claude Code 구독으로 영상을 자연어 편집하는
에이전트 패널. 멀티모달 툴(줌/트림/배속/자막·자막디자인/스타일 + 프레임/트랜스크립트/클릭 +
ask_user)과 프로젝트별 대화 저장·세션 이어가기. 입력도 멀티모달(이미지·영상 첨부),
영상 분석은 scene-detect+dedup 키프레임(crv 이식), 자막은 AI가 디자인까지.

## Context
- **Background**: 로드맵 1번(원클릭 UX)의 구현체 — Donkey Cut의 우측 AI 패널을 레퍼런스로, 손 편집 대신 자연어 지시로 편집하는 흐름을 원함
- **Requirements**: 로컬 Claude 구독 연동(API key 불필요), 4개 프로바이더(Claude/OpenAI/Gemini/Grok) 대응 구조, 모델 피커, 변이 툴콜 1회=undo 1스텝
- **Decisions**: ① Agent SDK를 main 프로세스에서 구동(네이티브 claude 바이너리 vendored — launchd PATH 문제 원천 차단) ② 편집 상태 변이는 렌더러 aiCommandExecutor(순수 함수)→pushState 단일 경로 ③ `tools: []`+MCP allowlist로 에이전트 파일/셸 접근 차단 ④ `settingSources: []`로 사용자 글로벌 설정(output style) 격리 ⑤ 자막은 auto-caption과 동일한 AnnotationRegion 재사용 ⑥ ask_user는 툴콜 RPC 경로를 그대로 쓰되 응답자만 사람(채팅 캐러셀 카드)
- **Constraints**: Agent SDK는 MIT 아님(Anthropic 약관) — 소스 공개는 무관, 패키징 배포 시 동봉 약관 확인 필요; vitest는 Node 22 필요(로컬 20.12에서 전체 실패, `ASDF_NODEJS_VERSION=22.12.0`로 실행); 툴 타임아웃 기본 15s(트랜스크립트 300s, ask_user 600s, get_video_frames 스토리보드 180s)
- **Decisions(2026-07-20 추가)**: ⑦ 영상 프레임화는 단일 파이프라인(`keyframeExtraction.ts`)으로 통일 — get_video_frames 스토리보드·비디오 첨부가 공유(claude-real-video MIT 이식, ffmpeg 대신 캔버스) ⑧ 프로바이더별 이미지 입력 능력차는 숨기지 않고 정직 안내(Gemini headless 미지원) ⑨ 자막 기본 스타일을 dim 박스로 변경(가독성이 기본값) — 자동 자막·AI 자막 공통, set_caption_style로 사후 디자인

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

### 2026-07-19
**Focus**: 멀티 프로바이더(A1) + 구독 약관 대응 + 웹캠 AI 변신 + 패널 UX
- **A1 Codex/Gemini 프로바이더**: 공용 stdio MCP 브리지(`mcpBridge.cjs`, ELECTRON_RUN_AS_NODE)+툴 호스트(유닉스 소켓, 토큰 인증)로 툴 18종을 외부 CLI에 노출. Codex=`exec resume` 메모리·read-only 샌드박스, Gemini=헤드리스 resume 없어 트랜스크립트 자가 재생. 반복 배선을 `PerTurnCliSession` 베이스로 추출. Grok은 coming-soon+키 입력만
- **구독 약관 조사→구현**: Claude 라벨 "Claude Code"→"Claude"(브랜딩 가이드), Anthropic API key 대안(SDK env 주입); Gemini는 Google이 서드파티 OAuth 금지·계정 정지 → AI Studio API key(GEMINI_API_KEY)로 전면 전환, oauth 감지 제거; Codex 무변경
- **원격 정책 킬스위치**: `providerPolicy.ts`가 `site/provider-policy.json`을 하루 1회 fetch(fail-open, userData 캐시) → notice 배너/disabled 게이트를 재배포 없이 전 앱에 24h 내 전파. 구독 프로바이더 1회 고지 카드. 프라이버시=정적 GET 1회, 무전송
- **restyle_webcam 툴(A4)**: 웹캠 오버레이를 생성형 AI로 변신(Decart Lucy 큐 API). main에서만 실행(키 렌더러 미노출), `EditorState.webcamSourceOverridePath` 1 undo, 원본 미변경. Decart 키는 AiKeyId에 추가·safeStorage. **비용: Lucy Pro만 API 제공 ~$0.15/s → 명시 필수(미구현)**
- **패널 UX 4건**: ① 선택 모델의 키 없을 때만 컨텍스트 키 행 노출 ② `providerExplicit` 플래그—첫 실행은 가용 프로바이더 자동선택(claude>openai>gemini>grok), 이후 마지막 선택 기억 ③ AI/설정 탭 슬라이딩 하이라이트 ④ (레이아웃은 brand 유닛)
- **문서**: `docs/ai-providers.md` — 프로바이더별 논의→결정→구현 기록(OSS 기여자용), ARCHITECTURE.md 링크

**Learned**: Decart SDK에 비실시간 큐 클라이언트가 있어 WebRTC 없이 후처리 가능 — 조사가 구현 난이도를 크게 낮췄다. 구독 인증은 프로바이더 약관이 유동적(2026 3회 변동)이라 코드보다 "재배포 없이 끌 수 있는 스위치"가 핵심 안전장치. 브랜딩 가이드(제품 내 "Claude Code" 금지)는 라이선스와 별개의 준수 항목.

### 2026-07-20
**Focus**: 멀티모달 입력 + crv 방식 영상 분석 + AI 자막 디자인 (요청 3건 + UXW 리서치)
- **멀티모달 입력**: 컴포저에 📎 버튼·클립보드 붙여넣기·드래그&드롭(`attachments.ts`). 이미지는 Claude 네이티브 image 블록/Codex `-i` 파일 경로로 전달, Gemini는 headless 이미지 채널 부재라 "못 봄" 정직 안내. 비디오 첨부는 keyframe 파이프라인으로 프레임화→콘택트 시트. `AiChatSession.send(text, images)` 시그니처 확장, cliSession 큐가 이미지 동반. 첨부 썸네일은 유저 트랜스크립트 아이템에 저장(localStorage 안전한 소형 data-URL)
- **영상 분석 개선(claude-real-video 이식)**: `get_video_frames`를 타임스탬프 없이 부르면 스토리보드 모드 — scene-change 검출 + 슬라이딩 윈도우 dedup(16×16 RGB 시그니처) + 스크린레코딩용 settled-local 간이 채널(96×96, 쿨다운) + density floor → 타임스탬프 라벨(`#n m:ss.s`) 박힌 3×3 콘택트 시트. `keyframeExtraction.ts`(+테스트 15개). ffmpeg 대신 캔버스, Whisper 경로·yt-dlp·±1px shift는 미이식. 타임아웃 60→180s
- **AI 자막 디자인**: 기본 스타일을 dim 박스(볼드 흰 글씨·rgba(0,0,0,0.7)·하단 여백 6%)로 변경. 신규 `set_caption_style` 툴 + add_captions/update_caption에 style 파라미터(색·박스·크기·정렬·애니메이션 pop 등·위치 상/중/하). aiCommandExecutor에 sanitizeCaptionStyle(안전 CSS 색·클램프)·get_project_context에 현재 captionStyle 노출(+테스트 6개)
- **UXW 리서치**: 서브에이전트로 숏폼 자막 톤앤매너/디자인 웹 리서치 → 시스템 프롬프트에 압축(들리는 문장·큐당 1–6s·초당 17자 이하·이모지 라인끝 0–1개·word-pop vs fade·안전영역). 자동편집 첫 질문을 "자막 언어"→"영상 목적/타겟"으로 확장

**Learned**: 영상을 프레임화하는 파이프라인 하나(keyframeExtraction)가 세 곳에 재사용됨 — get_video_frames 스토리보드, 비디오 첨부, (기존) videoFrameCapture 클로즈업. crv의 핵심 통찰은 "고정 샘플링 대신 실제 변화만" — 스크린레코딩에선 전역 diff ~0%인 작은 UI 변화(타이핑)를 잡는 로컬 채널이 관건. 자막 dim 박스 기본화는 라이브러리(첨부 이미지)처럼 "가독성이 기본값"이어야 한다는 UX 판단.

### 2026-07-20 (저녁 연속 세션)
**Focus**: 실사용 편집 중 부딪힌 갭 대량 구현 — 진행 표시·채팅 유실 복구·speed 램프·비디오 효과·자막 이동
- **AI 패널 경과시간**: 툴 실행 중 무음이던 로딩을 총 경과시간(1s→1m 12s) + 실행 중 툴별 경과시간으로. 언어중립 `elapsed.ts`, `useTick`은 busy일 때만 틱. 프레임 스캔·Whisper가 오래 걸릴 때 "죽었나?" 해소
- **채팅 저장 버그 수정 + 복원**: Save Project 시 storageKey가 `currentProjectPath`로 갈아타 채팅이 빈 것으로 로드되던 버그 → 키를 **녹화 경로(videoSourcePath)** 기준으로 안정화 + legacy(프로젝트경로) 키 자동 마이그레이션. localStorage가 이미 비워진 케이스는 **Claude Code 세션 JSONL**(`~/.claude/projects/-/`)에서 복구 → `<video>.chat.json` 사이드카 자동 임포트(+세션 resume). 사용자 실데이터 2세션 복구해 Desktop md로 제공
- **speed 램프(A→B 가감속)**: `SpeedRegion.rampInMs/rampOutMs` — 순수 `expandSpeedRamps`가 램프 구간을 ease-in-out 미세 스텝으로 자동 확장(기존 상수-속도 엔진 재활용). 경계마다 램프 1개(prev.rampOut 우선)로 항상 연속, 이웃 speed로 연결. export(splitBySpeed)·프리뷰(expand 후 조회) 양쪽. AI 툴 add/update_speed_region에 노출(+테스트 8개). "43개 스텝 흉내" 제품화
- **비디오 효과 v1(fadeIn/fadeOut/blur/dim)**: `EffectRegion` + 소스타임 구간. 순수 `computeVideoEffectState`로 프리뷰(스테이지 오버레이 div: backdrop-filter blur + 검정 알파)·export(frameRenderer 최종 compositeCtx 필터/오버레이) 동일. AI 툴 add/update/delete_effects. **타임라인 Effects 레인**(툴바 Aperture 드롭다운→퓨시아 레인, add/select/드래그리사이즈/Delete) 추가로 AI 없이 수동 사용 가능(+테스트 6개)
- **자막 이동/변형 + exit**: `AnnotationRegion.motion`(toPosition/toSize/toFontSize + startMs/endMs 서브윈도우) + `exitAnimation`. 순수 `getCaptionRenderState` ease-in-out 보간을 프리뷰·export 공유. getTextAnimationState를 진입+exit 합성으로 확장(진입곡선 역재생). AI 툴(add/update_caption)·저장 반영(+테스트 4개)

**Learned**: "순수 헬퍼 1개 + 프리뷰/export 2곳 + AI 툴"이 이번 세션의 반복 패턴 — expandSpeedRamps·computeVideoEffectState·getCaptionRenderState 모두 동일 골격이라 테스트가 쉽고 프리뷰/export 불일치가 원천 차단됨. localStorage는 유실 가능하지만 in-app 에이전트가 Claude Code 세션이라 JSONL이 최후 백업. systemPrompt는 템플릿 리터럴이라 백틱 삽입 금지(빌드 깨짐).

### 2026-07-20 (밤 연속 세션)
**Focus**: 수동 슬라이더 인스펙터 + 자막 좌표계 혼란 해소(toAnchor) + 자막 박스 디자인 필드 확장
- **speed 램프/효과 강도 수동 슬라이더**: SettingsPanel에 선택 구간 인스펙터 — speed 선택 시 램프 인/아웃(0~5000ms, 0=끔), effect 선택 시 blur px(0~40)/dim %(0~1) 슬라이더. 줌 customScale 패턴 그대로 updateState(드래그 중)+onValueCommit→commitState(undo 1스텝). hasTimelineSelection에 effect 포함, effect 퓨시아 타입 칩
- **자막 좌표계 혼란 해소** (실사용 스크린샷: 에이전트가 y=0을 아래로 오해): ① motion에 `toAnchor: top|middle|bottom` 시맨틱 앵커 추가(CAPTION_POSITION_PRESETS 재사용, raw toPosition보다 우선) ② 시스템 프롬프트에 "시작=style.position, 도착=motion.toAnchor" 조합 레시피("중앙→아래", "아래→중앙까지만") ③ 좌표계 SCREEN 규약(y=0 위, y≈5/40/80 앵커) 툴 설명+프롬프트 양쪽 명시
- **자막 박스 스타일 확장** (에이전트가 "padding/radius 필드 없음" 정직 거절→즉시 구현): AnnotationTextStyle에 `fontWeight` 숫자(100~900)·`boxPaddingX/Y`(em)·`boxRadius`(px) 추가. 기존 하드코딩이 em 기반(0.1/0.2em)이라 em 필드화로 프리뷰(CSS)·export(캔버스) 일치 자동 유지. 패널(Weight 드롭다운 300~900 실굵기 렌더, 박스 슬라이더 3개, Bold 토글 600 기준 호환) + AI(sanitize: 클램프+폰트명 유니코드 정규식으로 CSS 주입 차단). i18n 패널 라벨 13로케일
- 테스트 418→420 (toAnchor 프리셋 해석, 박스/폰트 sanitize)

**Learned**: 에이전트 좌표 실수는 프롬프트 사후 교정보다 "좌표가 필요 없는 시맨틱 필드"가 근본 해법 — toAnchor는 스타일 프리셋과 같은 어휘라 오해 여지가 0. "박스 넓게=fontSize 올려라" 같은 우회 제안도 프롬프트에 반례로 명시해야 교정됨.

### 2026-07-20 (심야 연속 세션)
**Focus**: 채팅 유실 재발 → 복구 + 3중 방지, 자막 폰트 비율 스케일링, 복원 채팅의 CTA 접기
- **채팅 유실 복구**: 세션 JSONL(ebfa5563, 22:38까지)에서 user/assistant 텍스트 74개 재추출 → `<video>.chat.json` 사이드카 재구축(기존 31개본은 .bak). sessionId 유지로 resume 가능
- **유실 근본 원인 코드에서 확인**: load 이펙트와 persist 이펙트가 같은 커밋에 실행 — persist가 이전 상태(빈 배열)로 저장본을 순간 덮고, HMR 리로드가 그 틈에 끼거나 재저장이 quota로 실패하면 빈 채팅 확정 → 빈 채팅은 옛 사이드카를 임포트해 "과거 것만 남는" 증상
- **3중 방지**: ① `skipNextPersistRef`로 load 직후 stale persist 1회 스킵(빈값/이전 프로젝트 교차 오염 차단) ② persist마다 0.8s 디바운스로 `ai-chat-write-backup` IPC → 사이드카 파일 미러링(quota 무관, 빈 채팅은 미러 안 함) ③ 로드 시 localStorage vs 사이드카 중 **아이템 많은 쪽 채택**(기존엔 완전히 비어야만 임포트)
- **자막 폰트 비율 스케일링**: fontSize 의미를 "1080p 기준 px"로 통일 — 프리뷰 `containerHeight/1080`, export `출력높이/1080`(기존 "프리뷰→출력" 배율 폐기). 이동량·boxRadius도 동일 스케일. 기본값 주석 32→64·AI 자막 24→48(~4.5%), 범위 16~192. 에이전트가 화면 크기를 눈대중 보정하던 문제의 근본 해결 — 프롬프트에 "보정 금지" 명시. 기존 프로젝트 자막은 1회 재조정 필요(사용자에게 재조정용 프롬프트 전달)
- **복원 채팅 CTA 접기**: useAiChat이 `restoredFromStorage` 신호 노출 → 히스토리 복원 시 Understand/Auto-edit를 사용됨 처리(⋮ 메뉴로). 질문의 답: usedActions는 원래 in-memory 세션 한정 설계였음

**Learned**: localStorage 이중화는 "빈 값을 절대 미러하지 않는" 파일 write-through + "많은 쪽 우선" 복구의 조합이 안전 — 어느 한쪽이 앞서거나 유실돼도 수렴. React에서 load/persist 이펙트 쌍은 같은 커밋의 stale 실행 1회를 반드시 가드해야 함(이번 유실의 근본).

### 2026-07-21
**Focus**: 채팅 전송 스크롤 + 자막 boxShadow·인라인 부분 색상
- **전송 시 최하단 스크롤**: 스크롤업 상태에서 답장 전송하면(타이핑/빠른액션/@ 주입 공통) user 아이템 추가 시점에 하단 고정 재활성화 — ChatMessageList에 이전 개수 ref로 "새 user 아이템" 감지
- **자막 boxShadow**: style.boxShadow 0~1 — 프리뷰 CSS `0 0.08em 0.4em`과 export 캔버스 shadowBlur/OffsetY 동일 레시피(em 비례), 배경색 있을 때만. 패널 4번째 슬라이더 + AI 필드 + 13로케일
- **인라인 부분 색상 `{#hex|텍스트}`**: 공유 파서 `captionRichText.ts`(parse/strip/has, 테스트 5개) — 프리뷰는 색 스팬, export는 색상 런 단위 드로잉(랩 경계 넘어도 유지, typewriter 리빌은 런 순서로 그래핌 소비). SRT 내보내기·타임라인 블록 라벨은 마크업 자동 strip. AI 프롬프트에 "메시지 끄는 1-2단어만" 가이드

**Learned**: export 텍스트 렌더의 "토큰에 색을 실어 랩핑"이 핵심 — 랩 후 인덱스 매핑보다 토큰 생성 시점에 세그먼트 색을 붙이는 쪽이 경계 케이스가 없음. 순수 파서 1개를 프리뷰/export/SRT/라벨 4곳이 공유하는 기존 패턴 재적용.

## Pending
- [ ] 재시작 후 채팅 복구 확인: vibecut-promo 열기 → 74개 아이템 복원·세션 resume·write-through 파일 갱신 확인
- [ ] 기존 프로젝트 자막 크기 1회 재조정 (전달한 프롬프트로 에이전트에게 시키기 — 본문 48, 강조 64~96)
- [x] **speed 램프/효과 강도 수동 슬라이더** (2026-07-20 밤: SettingsPanel 인스펙터로 구현 완료 — 램프 인/아웃 + blur/dim intensity, 슬라이더 1회=undo 1스텝)
- [ ] 재시작 후 실검증(main 변경 다수): 채팅 패널 복원·speed 램프 프리뷰 부드러움·비디오 효과 fade/blur/dim 프리뷰·export·Effects 레인 조작·자막 motion 이동
- [ ] 재시작 후 AI 실검증 (2026-07-20 밤 main 변경): toAnchor("중앙에서 아래로" 지시)·자막 박스 스타일("굵게+padding 2배+radius 2배" 재시도)·좌표계 규약 준수 확인
- [ ] 실기기 검증: 멀티모달(이미지/영상 첨부→Claude 전송), get_video_frames 스토리보드 생성 시간(긴 영상), 자막 dim 박스가 프리뷰·내보내기 동일한지
- [ ] 실사용 검증 계속: ask_user 재질문 응답 후 맞춤 자동편집 완주 확인
- [ ] 패키징 스모크 (`npm run build:mac`) — SDK external/asarUnpack + 240MB 바이너리 동작 확인
- [x] 기능 단위 커밋 정리 (2026-07-19까지 기능 단위로 커밋 완료 — restyle_webcam/provider-policy/subscription-policy 등 개별 feat 커밋, 워킹 트리 클린)
- [x] OpenAI/Gemini/Grok 프로바이더 (2026-07-17: OpenAI는 Codex CLI 구독 연동·Gemini는 Gemini CLI 구독 연동으로 구현 — 공용 stdio MCP 브리지(mcpBridge.cjs)+툴 호스트(유닉스 소켓) 경유로 툴 18종 공유. Grok은 API key 입력 UI만, 프로바이더는 coming-soon 유지)
- [ ] Codex/Gemini 실기기 검증 — 두 CLI 모두 로컬 미설치라 spawn 경로(코덱스 exec resume, gemini 설정 주입)는 실제 CLI로 미확인. `npm i -g @openai/codex` 후 `codex login`, `npm i -g @google/gemini-cli` 후 로그인하고 실채팅 확인 필요
- [ ] 내보내기(export) 트리거 툴 검토
- [ ] A4 restyle_webcam 실검증 (2026-07-19 구현 완료, 미검증): Decart 키 발급(platform.decart.ai) → 피커 하단 Decart 행에 저장 → 웹캠 포함 녹화 → 채팅 "웹캠을 애니 스타일로 바꿔줘" → 미리보기/내보내기/undo/프로젝트 저장·재열기 확인. **미확인 리스크**: lucy-pro-v2v의 클립 길이 제한(생성 모델은 5초 제한 문구 있었음 — v2v는 미명시).
- [ ] A4 **비용 명시 의무** (Dan 확인 2026-07-19): API로 쓸 수 있는 건 Lucy Pro뿐이며 **약 $0.15/초** 수준 — 1분 클립 ≈ $9라 반드시 사용자에게 명시적으로 고지해야 함. 검증 때 platform.decart.ai에서 정확 단가 확정 후: ① 툴 description/시스템 프롬프트에 단가 반영("~$0.15 per second") ② ask_user 확인 질문에 예상 비용(클립 길이×단가) 포함하도록 프롬프트 강화 ③ Decart 키 입력 행 근처 또는 README에 단가 문구. 단가 미확정 상태로 하드코딩 금지 구조: main `electron/ai/effects/restyleWebcam.ts`(queue.submitAndPoll, 키는 main만) → 결과 파일 approveFilePath → 렌더러 pushState({webcamSourceOverridePath}) 1 undo. 프로젝트 로드 시 override 경로는 handlers.ts 프로젝트 승인 블록에서 trustedDirs 규칙으로 best-effort 승인
- [ ] A5 웹캠 로컬 배경 효과 (③ 설계 확정, 미구현): EditorState에 `webcamBackgroundEffect: "none"|"blur"|"remove"` + set_style 확장. 프리뷰 = VideoPlayback의 웹캠 DOM <video>(1962-2004 부근)를 효과 활성 시 canvas 파이프라인으로 스왑(rAF+세그멘테이션). 내보내기 = `src/lib/exporter/webcamFrameDrawing.ts:13-43 drawWebcamFrameImage`가 단일 초크포인트(gif도 동일 경로, 웹캠 있으면 네이티브 fastpath 이미 비활성). 의존성 @mediapipe/tasks-vision + selfie segmenter 모델을 caption-assets 패턴(extraResources)으로 오프라인 번들

## Notes
관련: [[2026-07-16-webcam-self-view]], [[2026-07-16-open-source-release-plan]].
아키텍처 요약은 CLAUDE.md "AI 채팅 패널" 섹션, 플랜 원본은 ~/.claude/plans/linked-strolling-dahl.md.
