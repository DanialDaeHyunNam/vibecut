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

## Pending
- [x] 브랜드명 확정: **Vibecut** (2026-07-16 — "바이브 편집", 말로 시키는 AI 편집이라는 차별점을 이름에 담음. CapCut 연상/상표 충돌은 공개 전 확인)
- [x] Vibecut 리브랜딩 적용 (2026-07-17): productName/appId(app.vibecut)/package명/창 타이틀/메뉴/트레이·로고 에셋/전 로케일 103곳 + LICENSE 저작권 줄 + README 재작성(AI 중심, OpenScreen 크레딧)
- [ ] 리브랜딩 후속: .openscreen 프로젝트 확장자(.vibecut 병행 지원), localStorage 키/OPENSCREEN_* env 정리, SettingsPanel의 버그리포트 링크(현재 upstream repo로 향함 — 자체 repo 생성 후 교체), 데모 GIF를 README에 추가
- [ ] `npx license-checker`로 전체 의존성 라이선스 스윕
- [ ] 데모 영상: cinerec으로 cinerec 홍보 영상을 찍기 (AI 자동편집 사용 — 도그푸딩 스토리가 곧 마케팅)
- [ ] 자체 git repo 분리 + GitHub 공개 (card-news 전례 따름)
- [ ] 홍보: Show HN / Product Hunt / X·Threads 데모 클립 / GeekNews·disquiet(한국) / r/opensource / awesome-electron 류 리스트 PR
- [ ] 패키지 배포 단계에서 Agent SDK 동봉 약관 확인 (code.claude.com/docs/en/legal-and-compliance)
- [ ] Windows 스모크 테스트 (AI 패널·셀프뷰·SRT — Agent SDK는 win32 바이너리 내장 확인됨, 실기기 미검증)
- [x] 자체 앱 아이콘 제작 (2026-07-16, icons/cinerec-icon.svg + icns/ico/png 세트)
- [x] 브랜드 테마 교체 — 바이올렛 팔레트 (2026-07-16)

## Notes
관련: [[2026-07-16-ai-editing-assistant]] (차별화 포인트), [[2026-07-14-cinerec-fork-bootstrap]] (MIT 포크 결정).
배포(노터라이즈) 항목은 부트스트랩 유닛 Pending과 이어짐.
