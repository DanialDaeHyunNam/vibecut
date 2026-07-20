# 브랜드 테마 + 에디터 UX — 오픈스크린 티 벗기기

**Participants**: Dan, claude

## Summary
앱 전역 색상을 OpenScreen 그린에서 바이올렛 팔레트로 교체하고, 자체 앱 아이콘 제작,
타임라인 레인 색상 다변화, 재생 내비게이션(처음으로 버튼 + Alt+←/→ 레인 점프) 추가.

## Context
- **Background**: 오픈소스 재공개를 앞두고 "오픈스크린 티"를 빼고 자체 브랜드 아이덴티티가 필요
- **Decisions**: ① 메인 액센트 `#7C5CFF` (호버 `#9B84FF`, 라이트 `#BDAEFF`) — hex 155곳 + rgba 21곳 치환 ② 레인 팔레트: 줌=바이올렛/컷=레드(의미색 유지)/배속=앰버(유지)/주석·자막=시안 ③ 오디오 레벨 미터의 그린은 의미색이라 유지 ④ 아이콘: 다크 스쿼클+바이올렛 REC 링·도트+AI 스파클 (SVG 마스터 → qlmanage 래스터 → sips 리사이즈 → png2icons로 icns/ico)
- **Constraints**: SVG 래스터라이저 부재 시 macOS qlmanage(QuickLook)가 대안; dev 독 아이콘은 `app.dock.setIcon`으로 별도 지정 필요 (패키지드는 번들 아이콘)

## Timeline

### 2026-07-16
**Focus**: 테마 전면 교체 + 아이콘 + 내비게이션
- 그린 계열(hex `#34B27B`/`#3fcf90`/`#7fd6ac`, rgba 52,178,123 계열) → 바이올렛 전역 치환; HUD 토글 온 상태 `text-green-400`→바이올렛; 타임라인 glassYellow→시안
- `icons/cinerec-icon.svg` 마스터 제작, 전체 png 세트(16~1024)+icon.icns+icon.ico 교체, dev 독 아이콘 배선(main.ts)
- PlaybackControls: ⏮ 처음으로 버튼 (14로케일 `playback.skipToStart`)
- Alt+←/→: 선택된 레인(줌/트림/배속/주석)의 블록 시작점 사이를 단어 점프처럼 이동 + 선택 동기화 (기존 keydown 캡처 핸들러에 통합, 50ms 톨러런스)

**Learned**: qlmanage -t가 macOS에서 SVG→투명 PNG 래스터라이저로 쓸 만함 (rsvg/imagemagick 없이). 의미색(오디오 레벨 그린, 컷 레드)은 브랜드 치환에서 제외해야 함.

### 2026-07-17
**Focus**: 에디터 UX 마감 + 아이콘 알파 수정
- 타임라인 끝 캡(핸들)을 레인별 딥 컬러로(줌=딥바이올렛 #4C2FE0, 텍스트=딥시안) — rgba 그린 잔재까지 제거하며 레인 팔레트 완성
- **레인 포커스 내비**: 레인 클릭 → 바이올렛 좌측 엣지 표시 + Alt+←/→가 그 레인의 블록 시작점 사이를 점프 (선택과 동기화); 단축키 도움말에 표기
- 타임라인 우상단 힌트를 ‹ › **팁 캐러셀**로 (팬/줌/레인 점프/레인 클릭/구분선, 14로케일)
- **프리뷰↔레일 리사이즈 바** (16–42%, 더블클릭=기본 76:24) — CSS 그리드를 가로 PanelGroup으로 전환
- 아이콘 흰 배경 수정: qlmanage가 알파를 흰색 합성하는 문제 → **Electron 오프스크린 렌더러**(scripts/render-icon.mjs)로 진짜 투명 PNG 재생성, icns/ico/트레이 전부 교체
- 웹캠 셀프뷰 원형→mac 스타일 라운드 사각형(4:3 고정, 네이티브 그림자), 트레이 아이콘 교체

**Learned**: qlmanage는 결국 알파를 흰색으로 합성함 — 진짜 투명이 필요하면 Electron BrowserWindow(offscreen+transparent) capturePage가 의존성 없는 로컬 렌더러로 최적. PanelGroup의 인라인 flex가 기존 CSS 그리드 규칙을 자연스럽게 덮어써서 그리드 제거 없이 전환 가능.

### 2026-07-19
**Focus**: 2열 레이아웃 재구성 + 탭 전환 애니메이션 + 팁 캐러셀 가시성
- **2열 레이아웃**: 기존 [상: 영상|레일] / [하: 타임라인 풀폭] → **좌측 열=영상(위)+타임라인(아래), 우측 열=AI/설정 레일 풀하이트**. PanelGroup 중첩을 바깥 가로 → 좌:세로(영상·타임라인)/우:레일로 스왑. 대형 JSX는 손 인용 대신 라인 마커 Node splice로 이동 후 biome 재포맷. AI 패널 기본 폭 30→27%(-10%), 더블클릭 복원 유지
- **탭 슬라이딩 하이라이트**: AI↔설정 활성 pill이 팝업 대신 200ms ease로 미끄러짐. grid-cols-2+p-1이라 오른쪽 셀이 정확히 50%에서 시작 → 인디케이터 `left`를 4px↔50%(width calc(50%-4px))로 트랜지션하면 픽셀 정확. 트리거는 개별 배경 제거, 슬라이딩 pill만 활성 표시
- **팁 캐러셀**: 안 보이던 ‹ › 텍스트 글리프 → 💡 아이콘(좌) + 또렷한 chevron 버튼 + `N/M` 카운터; 폭 fit-content(고정 min-w 제거로 여백 삭제)

**Learned**: 깊게 중첩된 대형 JSX 구조 이동은 손 인용보다 라인 마커 기반 Node splice + biome --write 재포맷이 안전(들여쓰기 자동 정리). 세그먼티드 컨트롤의 슬라이딩은 컨테이너 패딩을 역산해 `left`를 트랜지션하면 measure 없이 픽셀 정확.

### 2026-07-20
**Focus**: 레인 선택 어포던스 + 상단 바 Export/New Project 버튼 (발견성 개선 3건)
- **레인 선택 핸들**: 기존 2px 바이올렛 인셋 엣지 → 10px 클릭 핸들로 확대 + 레인 고유색 반영(줌=바이올렛/트림=레드/주석·자막=시안/배속=앰버). 3단계 어포던스: 평소 18%·호버 45%+포인터 커서·선택 100%+글로우. 최초엔 레인 안 오버레이로 넣었다가 0:00 눈금·첫 블록과 겹치는 피드백 → **dnd-timeline 내장 row sidebar API**(`setSidebarRef`)로 재구현: 핸들 폭이 `sidebarWidth`에 반영돼 눈금자·플레이헤드·키프레임·시크·스냅이 전부 자동으로 10px 밀림(수동 보정 0줄)
- **Export Video 버튼**: 상단 바 우측 끝(비어있던 justify-between 공간)에 바이올렛 주 액션 버튼 + 글로우. 지금까지 Settings→Export 탭에 묻혀 찾기 어렵던 진입점을 노출. 기존 `handleOpenExportDialog` 그대로 호출, 라벨은 `settings:export.videoButton`(GIF 모드시 자동 전환) 재사용, 내보내는 중 비활성
- **New Project 버튼**: "Return to Recorder" 다음에 FilePlus 버튼 추가(Return|New|Load|Save 순). Electron 메뉴에만 있던 `handleNewProject` 노출, 라벨 `dialogs:unsavedChanges.newProject`(전 13로케일 존재) 재사용

**Learned**: dnd-timeline은 row sidebar 폭을 측정해 컨텍스트의 sidebarWidth로 흘려보내는데, 이 코드베이스의 시간축·플레이헤드·시크가 이미 전부 sidebarWidth를 계산에 넣고 있었음(지금까진 0) — 오버레이 대신 정식 사이드바로 넣으면 겹침이 구조적으로 사라지고 좌표 보정이 공짜. 기존 라벨(settings/dialogs 네임스페이스)을 재사용하면 13로케일 번역 추가 없이 버튼 발견성만 개선.

### 2026-07-20 (저녁 연속 세션)
**Focus**: 컴포저/타임라인 인터랙션 개선 + 효과 레인 + 프로젝트 로드 수정
- **컴포저 재구성**: ⋮ 빠른액션(Understand/Auto-edit)을 입력창 위 줄로 — 세션에서 안 눌린 것만 노출, 둘 다 쓰면 우측 ⋮로 접힘. 첨부 칩은 버튼 아래 줄. 우측 3버튼(⋮/📎/전송) gap 균등화. 상단 바 중앙에 **프로젝트명**(저장 전 "제목 없음", 저장 후 파일명)
- **타임라인 "@" 컨텍스트 주입**: 블록 호버 시 우상단 "@" 배지 → lane명+구간을 채팅 입력에 주입(+AI 탭 전환·포커스). 재생바 shift+드래그 구간선택도 임시 추가(두-핸들 방식으로 교체 예정)
- **비디오 효과 Effects 레인**: 툴바 Aperture 드롭다운(fadeIn/fadeOut/blur/dim) → 재생헤드에 블록 생성 → 새 퓨시아 레인. Item variant "effect"·glassFuchsia, add/select/드래그리사이즈/Delete를 speed 레인 패턴 그대로 복제. 14로케일. (효과 렌더 자체는 AI 유닛)
- **프로젝트 로드 수정**: Desktop 등 앱 폴더 밖 영상을 참조하는 프로젝트가 재시작 후 "Failed to load video"로 안 열리던 문제 — `getApprovedProjectSession`이 RECORDINGS_DIR/프로젝트폴더 안만 승인하던 것을, **사용자가 직접 연 프로젝트의 미디어는 실존·확장자 검증만으로 승인**하도록 완화

**Learned**: 새 타임라인 레인은 상수(ROW_ID)·TimelineRenderItem variant·outer/inner props·item mapping·Row·span-change 라우팅·delete-key·selection cleanup·Item variant·CSS glass·i18n까지 ~20개 지점을 speed 레인과 1:1로 복제하면 안전. 파일 접근 승인의 "crafted project 방어"는 사용자가 직접 연 자기 프로젝트엔 과했음(재시작 후 재임포트 불가) — 명시적 오픈은 동의로 간주.

## Pending
- [ ] **구간 선택 두-핸들 UX** (다음 세션): 재생바 shift+드래그를 제거하고, 눈금자/플레이헤드 쪽 "+" → 두 번째 핸들 생성 → 두 핸들 드래그로 range → "@"로 채팅 컨텍스트. 주입 채널(insertChatContext)은 이미 존재
- [ ] 효과 강도/램프 수동 슬라이더는 AI 유닛 Pending 참조(Setting 패널 인스펙터)
- [ ] 라이트 모드/추가 테마 변형 검토 ("테마들 여러가지 섞어줘"의 확장 — 테마 프리셋 시스템)
- [x] 트레이 아이콘(openscreen.png) 교체 (2026-07-17 리브랜딩 때 완료 — main.ts getTrayIcon("vibecut.png"))
- [x] 레인 점프 기능의 UI 아이콘/단축키 표기 (완료 — lib/shortcuts.ts FIXED_SHORTCUTS에 laneJump → KeyboardShortcutsHelp 렌더링 + shortcuts.json 14로케일 + 타임라인 팁 캐러셀)

## Notes
관련: [[2026-07-16-open-source-release-plan]] (브랜드 확정과 연동), [[2026-07-16-ai-editing-assistant]].
