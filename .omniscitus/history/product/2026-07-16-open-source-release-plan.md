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

## Pending
- [x] 브랜드명 확정: **Vibecut** (2026-07-16 — "바이브 편집", 말로 시키는 AI 편집이라는 차별점을 이름에 담음. CapCut 연상/상표 충돌은 공개 전 확인)
- [x] Vibecut 리브랜딩 적용 (2026-07-17): productName/appId(app.vibecut)/package명/창 타이틀/메뉴/트레이·로고 에셋/전 로케일 103곳 + LICENSE 저작권 줄 + README 재작성(AI 중심, OpenScreen 크레딧)
- [ ] 리브랜딩 후속: .openscreen 프로젝트 확장자(.vibecut 병행 지원), localStorage 키/OPENSCREEN_* env 정리, SettingsPanel의 버그리포트 링크(현재 upstream repo로 향함 — 자체 repo 생성 후 교체), 데모 GIF를 README에 추가
- [ ] 첫 릴리스 발행 시 README 정리: 다운로드 섹션의 "first packaged build is still on its way" 안내 문구 제거 (2026-07-17에 다운로드 버튼/미서명 경고 안내/Getting started 추가 — 버튼은 releases/latest로 연결, 릴리스 생성 전에는 404 대신 릴리스 목록으로 감). 릴리스 자산 파일명은 electron-builder artifactName 그대로여야 표의 파일명과 일치
- [ ] `npx license-checker`로 전체 의존성 라이선스 스윕
- [ ] 데모 영상: cinerec으로 cinerec 홍보 영상을 찍기 (AI 자동편집 사용 — 도그푸딩 스토리가 곧 마케팅)
- [x] 자체 git repo 분리 + GitHub 공개 (2026-07-17: https://github.com/DanialDaeHyunNam/vibecut — public, main 푸시 완료. shallow clone이라 `git fetch --unshallow upstream` 후 푸시. upstream 태그는 의도적으로 미푸시, upstream remote는 유지)
- [ ] 홍보: Show HN / Product Hunt / X·Threads 데모 클립 / GeekNews·disquiet(한국) / r/opensource / awesome-electron 류 리스트 PR
- [ ] 패키지 배포 단계에서 Agent SDK 동봉 약관 확인 (code.claude.com/docs/en/legal-and-compliance)
- [ ] Windows 스모크 테스트 (AI 패널·셀프뷰·SRT — Agent SDK는 win32 바이너리 내장 확인됨, 실기기 미검증)
- [x] 자체 앱 아이콘 제작 (2026-07-16, icons/cinerec-icon.svg + icns/ico/png 세트)
- [x] 브랜드 테마 교체 — 바이올렛 팔레트 (2026-07-16)

- [x] 랜딩페이지 (2026-07-17: https://vibecut-orcin.vercel.app — `site/` 단일 HTML, Vercel 프로젝트 `vibecut`(팀 dans-projects). daydreamvideo.com 참고: 히어로+CSS 에디터 목업+구독 3종+기능 그리드+미서명 경고 신뢰 섹션. 데모 영상 슬롯은 placeholder — B6 완료 시 `#demo` 섹션에 삽입. 배포: `vercel deploy --cwd site --prod --yes`)
- [ ] 구독 인증 약관 후속 조치 (2026-07-17 조사 — 정지 리스크 질문의 답): ① **Claude**: 현재(6/15 정책 일시중단 기준) 구독으로 Agent SDK/서드파티 앱 사용 허용·구독 한도 차감. 단 UI 프로바이더 라벨 "Claude Code"는 파트너 브랜딩 가이드라인 위반 — "Claude"/"Claude Agent"로 개명 필요 + Anthropic API key 대안 입력 추가 권장. 정책 유동적(2월 금지→5월 SDK 크레딧→6월 중단), support.claude.com/en/articles/15036540 주시 ② **Codex**: 공식 CLI 스폰이라 안전한 편, OpenAI는 서드파티에 가장 관대(자동화는 API key 권장이 공식 입장) ③ **Gemini (액션 필요)**: Google이 "서드파티 소프트웨어에서 Gemini CLI OAuth 사용"을 명시 금지(3/25 단속, 실제 유료 계정 정지 사례) + 6/18부로 개인 티어 Google 로그인 개편 — Gemini는 **AI Studio API key를 GEMINI_API_KEY로 CLI에 넘기는 방식**(구글 공식 권장 경로)으로 전환하고 oauth_creds 감지 제거/경고 필요
- [ ] Vercel Web Analytics 활성화 — 대시보드 → vibecut 프로젝트 → Analytics 탭 → Enable (스크립트 태그는 페이지에 이미 있음, API로는 enable 불가였음). 방문자 집계는 이걸로, 다운로드 집계는 GitHub release download_count로
- [ ] 커스텀 도메인 검토 — vibecut.vercel.app은 선점됨(현재 vibecut-orcin.vercel.app). vibecut.app 등 구매 시 Vercel 도메인 연결 + README/og:image URL 교체

## Notes
관련: [[2026-07-16-ai-editing-assistant]] (차별화 포인트), [[2026-07-14-cinerec-fork-bootstrap]] (MIT 포크 결정).
배포(노터라이즈) 항목은 부트스트랩 유닛 Pending과 이어짐.
