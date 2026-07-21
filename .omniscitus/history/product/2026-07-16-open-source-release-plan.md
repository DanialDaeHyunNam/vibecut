# 오픈소스 공개 + 홍보 전략

**Participants**: Dan, claude

## Summary
cinerec을 자체 브랜드 오픈소스로 재공개하는 것의 라이선스 검토(가능) 및
공개·홍보 실행 계획. wrap-up 시점 질문 "오픈소스로 공개하고 추천하려면?"의 답.

## Context
- **Background**: AI 편집 어시스턴트까지 얹으면서 upstream 대비 차별화가 충분해짐 — "이쯤되면 새로 만들었다 해도 되지 않나"
- **Requirements**: MIT 의무 준수, upstream(EtienneLescot/openscreen) 개선사항 계속 수용 가능한 구조 유지
- **Decisions**: ① 재공개 가능 확정 — MIT 조건은 원저작자 고지(Siddharth Vaddem) + 라이선스 전문 유지뿐, 그 위에 자체 저작권 줄 추가 ② README에 "based on OpenScreen" 크레딧 명시(관례+upstream 머지 용이) ③ 자체 브랜드명 사용(혼동 방지)
- **Constraints**: `@anthropic-ai/claude-agent-sdk`는 MIT 아님(© Anthropic PBC, 약관 적용) — **소스 공개는 무관**(의존성 참조일 뿐), **패키징 앱(dmg) 배포 시** SDK+claude 바이너리(240MB) 동봉 약관 확인 필요. 대안: 첫 실행 시 다운로드

## Timeline

### 2026-07-16
**Focus**: 라이선스 검토 및 공개 전략 수립
- LICENSE(MIT, Siddharth Vaddem 2025) + Agent SDK LICENSE.md(Anthropic 약관) 실물 확인
- 공개 체크리스트와 홍보 채널 계획 수립 (Pending 참조)

**Learned**: 라이선스 리스크는 포크한 코드가 아니라 나중에 추가한 의존성에서 온다 — 공개 전 `npx license-checker`로 전체 의존성 스윕 필수.

### 2026-07-17
**Focus**: Vibecut 리브랜딩 적용 완료
- 브랜드명 Vibecut 확정(ask 선택) 후 전면 적용: productName/appId(app.vibecut)/package명/창 타이틀/메뉴/독/트레이·로고 에셋(public/vibecut.png)/전 로케일 사용자 문자열 103곳
- LICENSE에 "Copyright (c) 2026 DaeHyun Nam (Vibecut)" 추가 (원저작자 고지 보존), README를 AI 어시스턴트 중심으로 재작성 + OpenScreen 크레딧
- 단일 인스턴스 락 네임스페이스 분리 → 레거시 패키지 Openscreen.app이 더 이상 dev 실행을 차단하지 못함
- 데이터 호환을 위해 의도적 미변경: localStorage 키, OPENSCREEN_* env, .openscreen 확장자 (후속 pending 참조)

**Learned**: package name 변경은 Electron userData 경로를 옮긴다(설정 초기화) — 리브랜딩 커밋 메시지에 데이터 영향 명시가 필수. i18n 브랜드 치환은 JSON "값만" 워커로 돌려야 키 참조가 안 깨진다.

### 2026-07-19
**Focus**: 공개 repo·랜딩페이지·다운로드/약관·라이선스 스윕
- **B1 공개 repo**: github.com/DanialDaeHyunNam/vibecut (public) 생성·main 푸시. shallow clone이라 `git fetch --unshallow upstream` 후 성공, upstream 태그 미푸시·remote 유지
- **랜딩페이지**(https://vibecut-orcin.vercel.app, `site/` 단일 HTML): daydreamvideo.com 참고 — 히어로+CSS 에디터 목업+구독 3종+기능 그리드+Made with Vibecut 쇼케이스(SHOWCASE 배열)+미서명 경고 신뢰 섹션. **한/영 i18n 토글**(영어=마크업, 한국어=사전, localStorage). 다운로드 버튼→GitHub releases/latest, 클릭 시 **OS 경고 재현 모달**(Gatekeeper/SmartScreen)로 사전 안내
- **라이선스 스윕(B3)**: `npx license-checker` — GPL/AGPL 없음, MIT 470 등 전부 무해. mediabunny(MPL-2.0 파일단위)·gsap(무료화) 판정, 루트 package.json UNLICENSED→"license":"MIT". Agent SDK(Anthropic 약관)만 B4로 이월
- **정책 킬스위치 운영법 확립**: `site/provider-policy.json` 편집+`vercel deploy`로 약관 변경 시 전 앱 대응(운영 런북 기록)
- **B6 데모 촬영 방식 결정**: HUD↔에디터 단일 윈도우 스왑이라 동시 불가 → macOS Cmd+Shift+5 영역 녹화→Import Video 우회(단, 임포트본은 클릭 텔레메트리 없어 자동 줌 미동작). 동시 사용 아키텍처 변경은 릴리스 후 보류

**Learned**: 정적 파일(랜딩) 배포 인프라를 정책 매니페스트 호스팅에 재활용하면 데스크톱 앱에 재배포 없는 킬스위치를 공짜로 얻는다. 라이선스 리스크는 포크 코드가 아니라 나중에 얹은 의존성에서 오므로 공개 전 스윕이 필수(예상대로 GPL 계열 0). 스크린 레코더의 자기 UI 녹화는 구조적 제약(단일 윈도우) — 데모는 OS 네이티브 캡처 우회가 표준.

### 2026-07-21
**Focus**: 랜딩 "살아있는 데모" 재구축 + 공개 전 점검 + **v1.7.0/v1.7.1 첫 공개 릴리즈(서명·공증)**
- **랜딩 v3**: 히어로 목업을 실제 에디터 1:1 레플리카로(상단바·재생 필·타임라인 툴바·5레인 컬러 핸들·AI 레일) + 시나리오 루프 애니메이션(타이핑→툴 칩→레인 블록 팝→재생·오토줌·인라인 컬러 자막). Electron 오프스크린 캡처로 검증 반복. **B6 데모 영상 완성**: Vibecut로 만든 28s 프로모를 37MB→4MB(1080p30 CRF26 faststart) 재인코딩+포스터로 쇼케이스 등록(자동재생 muted loop). 3열 footer(프로젝트/팔로우), sitemap/robots/OG/canonical. Vercel 배포 ×3
- **공개 전 스윕**: 시크릿 0·LICENSE 듀얼 카피라이트 유지 ✓·CLAUDE.md 개인 인증서 식별자 제네릭화. contributors 112명 = git 히스토리 유지 포크의 관례(Brave/VSCodium 동례)로 유지 결정. omniscitus 필수화는 비추천(기여 장벽) — "권장 + 메인테이너 /blueprint-sync" 모델 제안
- **문서 갱신**: CLAUDE.md AI 섹션 전면(멀티 프로바이더 실동작·자막 시스템·대화 3중 지속성), ARCHITECTURE.md에 순수 헬퍼 패턴·자막 1080p 규약·채팅 지속성 계층 추가
- **v1.7.0**: 태그 CI 경로 채택(로컬은 Windows WGC 헬퍼 빌드 불가). CI 리브랜딩 잔재 수정(아티팩트 글롭·DMG명 Openscreen→Vibecut, winget/homebrew 자동 트리거 비활성), 발행 토큰 폴백(github.token). 첫 발행은 아티팩트 수동 업로드로
- **v1.7.1 서명·공증 7차전**: Apple Developer(iOS 가입) 계정으로 Developer ID Application 인증서 발급 가이드 → 시크릿 6종 → ①CSC_NAME 접두사(eb는 무접두사/raw codesign은 풀네임 — 상충을 워크플로에서 접두사 부착으로 해소) ②키체인 가시성(러너에서 명시 경로 조회만 성공) ③CSC_LINK 정식 경로+adhoc 차단 게이트 ④진단 계측(env 길이·identity 조회·DEBUG) → **진범: 시크릿 p12가 옛 Apple Development 인증서**(진단 로그로 확정) ⑤올바른 p12 교체 → 서명 성공 ⑥게이트 버그(-dv는 Authority 미출력→-dvv) 수정 → **전 잡 성공, spctl 검증 포함 자동 발행**. 랜딩 경고 안내를 Windows 전용으로 교체·배포
- 설치 용량 1.19GB 정상 판정(Claude 바이너리 240MB+Electron+Whisper 번들)

**Learned**: 서명 실패 5연속의 교훈 — "1 valid identities found"는 **어떤** identity인지 봐야 한다(진단 스텝이 곧바로 진범을 찍음). CI 반복 대신 처음부터 계측(env 길이·identity 덤프·DEBUG)을 넣는 게 총비용이 싸다. electron-builder(무접두사)와 raw codesign(공통명 접두사 매칭)의 CSC_NAME 요구가 다르므로 한 시크릿을 양쪽에 쓰려면 워크플로에서 변환해야 한다. 포크의 릴리즈 CI는 브랜딩 문자열이 아티팩트 글롭·재패킹 스텝·패키지 채널에 숨어 있어 태그 한 번 태워보기 전엔 안 드러난다.

## Pending
- [ ] **Agent SDK 동봉 재배포 약관 확인 (B4 — 우선순위 상승)**: v1.7.1부터 claude 바이너리(240MB)가 실제로 배포되기 시작함. code.claude.com/docs/en/legal-and-compliance 확인 필요
- [ ] mac DMG 실설치 확인(사용자 진행 중 — 용량 확인함, 무경고 오픈 여부 확인 대기) + Windows Setup 실기기 스모크
- [x] 브랜드명 확정: **Vibecut** (2026-07-16 — "바이브 편집", 말로 시키는 AI 편집이라는 차별점을 이름에 담음. CapCut 연상/상표 충돌은 공개 전 확인)
- [x] Vibecut 리브랜딩 적용 (2026-07-17): productName/appId(app.vibecut)/package명/창 타이틀/메뉴/트레이·로고 에셋/전 로케일 103곳 + LICENSE 저작권 줄 + README 재작성(AI 중심, OpenScreen 크레딧)
- [ ] 리브랜딩 후속: .openscreen 프로젝트 확장자(.vibecut 병행 지원), localStorage 키/OPENSCREEN_* env 정리, SettingsPanel의 버그리포트 링크(현재 upstream repo로 향함 — 자체 repo 생성 후 교체), 데모 GIF를 README에 추가
- [x] 첫 릴리스 발행 시 README 정리 (2026-07-21 v1.7.1 발행과 함께 문구 제거): 다운로드 섹션의 "first packaged build is still on its way" 안내 문구 제거 (2026-07-17에 다운로드 버튼/미서명 경고 안내/Getting started 추가 — 버튼은 releases/latest로 연결, 릴리스 생성 전에는 404 대신 릴리스 목록으로 감). 릴리스 자산 파일명은 electron-builder artifactName 그대로여야 표의 파일명과 일치
- [x] `npx license-checker` 의존성 스윕 (2026-07-17): GPL/AGPL 없음 ✅. 결과: MIT 470·ISC 21·BSD 18·Apache 17 등 전부 무해. 플래그 항목 판정 — mediabunny(MPL-2.0: 파일단위 약한 카피레프트, 미수정 사용이라 문제없음), gsap(Custom: Webflow 인수 후 상업 포함 전면 무료), web-demuxer/flatbuffers(휴리스틱 별표, 실제 MIT/Apache-2.0), 루트 package.json UNLICENSED→"license": "MIT" 수정 완료. **Agent SDK(Anthropic 약관)만 남은 쟁점 — B4 패키징 때 동봉 재배포 약관 확인**
- [x] 데모 영상(B6) (2026-07-21 완성 — Vibecut 도그푸딩 프로모 28s, 랜딩 쇼케이스 자동재생 게시): cinerec으로 cinerec 홍보 영상을 찍기 (AI 자동편집 사용 — 도그푸딩 스토리가 곧 마케팅). **촬영 방식 결정(2026-07-19)**: Vibecut은 HUD(녹화 툴바)↔에디터가 단일 메인 윈도우를 번갈아 쓰는 구조라(`switch-to-editor`가 HUD를 닫음) + 단일 인스턴스 락 → 한 인스턴스로 "녹화 중 + 에디터 사용" 동시 불가. **권장: macOS Cmd+Shift+5로 에디터 사용 화면을 영역 녹화 → Vibecut에 Import Video로 불러와 편집**(EditorEmptyState "Import Video File…", showOpenDialog 이미 지원). **주의**: 임포트한 macOS 녹화본은 Vibecut 네이티브 클릭 텔레메트리가 없어 자동 줌이 안 뜸 → 수동 줌 또는 AI(프레임 비전)로 배치. 문서: docs/ai-providers.md
- [ ] (보류, 릴리스 후) 녹화+에디터 동시 사용 지원 검토 — 단일 윈도우 HUD↔에디터 스왑 + 단일 인스턴스 락을 풀어야 하는 실제 아키텍처 변경. 일반 사용자는 거의 불필요하나 셀프-도그푸딩 녹화엔 유용. 릴리스 전엔 리스크가 커서 보류, B6는 위 Cmd+Shift+5 우회로 해결
- [x] 자체 git repo 분리 + GitHub 공개 (2026-07-17: https://github.com/DanialDaeHyunNam/vibecut — public, main 푸시 완료. shallow clone이라 `git fetch --unshallow upstream` 후 푸시. upstream 태그는 의도적으로 미푸시, upstream remote는 유지)
- [ ] 홍보: Show HN / Product Hunt / X·Threads 데모 클립 / GeekNews·disquiet(한국) / r/opensource / awesome-electron 류 리스트 PR
- [ ] 패키지 배포 단계에서 Agent SDK 동봉 약관 확인 (code.claude.com/docs/en/legal-and-compliance)
- [ ] Windows 스모크 테스트 (AI 패널·셀프뷰·SRT — Agent SDK는 win32 바이너리 내장 확인됨, 실기기 미검증)
- [x] 자체 앱 아이콘 제작 (2026-07-16, icons/cinerec-icon.svg + icns/ico/png 세트)
- [x] 브랜드 테마 교체 — 바이올렛 팔레트 (2026-07-16)

- [x] 랜딩페이지 (2026-07-17: https://vibecut-orcin.vercel.app — `site/` 단일 HTML, Vercel 프로젝트 `vibecut`(팀 dans-projects). daydreamvideo.com 참고: 히어로+CSS 에디터 목업+구독 3종+기능 그리드+미서명 경고 신뢰 섹션. 데모 영상 슬롯은 placeholder — B6 완료 시 `#demo` 섹션에 삽입. 배포: `vercel deploy --cwd site --prod --yes`)
- [x] 구독 인증 약관 후속 조치 완료 (2026-07-17 조사→구현): ① **Claude**: 라벨 "Claude Code"→"Claude" 개명(브랜딩 가이드 준수), Anthropic API key 대안 입력 추가(SDK env 옵션으로 주입). 정책 유동적(2월 금지→5월 SDK 크레딧→6/15 일시중단, 현재 구독 허용·한도 차감) — **공개 전 support.claude.com/en/articles/15036540 재확인 필요** ② **Codex**: 변경 없음(공식 CLI+ChatGPT 로그인, OPENAI_API_KEY 이미 지원) ③ **Gemini**: Google 로그인 감지 전면 제거, AI Studio API key 필수(requiresApiKey, GEMINI_API_KEY 주입 — Google 명시 금지("서드파티 SW의 Gemini CLI OAuth", 계정 정지 사례) 대응). UI: 피커 하단 범용 API key 행 + 게이트에서도 피커 노출. 로케일 13종/README/ARCHITECTURE/랜딩 반영
- [ ] Vercel Web Analytics 활성화 — 대시보드 → vibecut 프로젝트 → Analytics 탭 → Enable (스크립트 태그는 페이지에 이미 있음, API로는 enable 불가였음). 방문자 집계는 이걸로, 다운로드 집계는 GitHub release download_count로
- [ ] 커스텀 도메인 검토 — vibecut.vercel.app은 선점됨(현재 vibecut-orcin.vercel.app). vibecut.app 등 구매 시 Vercel 도메인 연결 + README/og:image URL 교체

- [x] 원격 정책 매니페스트(킬스위치) 구축 (2026-07-17): `site/provider-policy.json` → 앱이 하루 1회 fetch(userData 캐시, fail-open). **운영법**: 제공사 약관 변경 감지 시 JSON에서 해당 프로바이더를 `"notice"`(+message {en,ko,...}, link) 또는 `"disabled"`로 바꾸고 `vercel deploy --cwd site --prod --yes` — 설치된 전 앱이 24시간 내 반응(notice=호박색 배너, disabled=게이트+API key 안내). 구독 프로바이더(Claude/ChatGPT) 첫 사용 시 1회 고지 카드. 프라이버시 공개는 README/랜딩에 명시

## Notes
관련: [[2026-07-16-ai-editing-assistant]] (차별화 포인트), [[2026-07-14-cinerec-fork-bootstrap]] (MIT 포크 결정).
배포(노터라이즈) 항목은 부트스트랩 유닛 Pending과 이어짐.
