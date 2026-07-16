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

## Pending
- [ ] 라이트 모드/추가 테마 변형 검토 ("테마들 여러가지 섞어줘"의 확장 — 테마 프리셋 시스템)
- [ ] 트레이 아이콘(openscreen.png) 교체 — 브랜드명 확정 후
- [ ] 레인 점프 기능의 UI 아이콘/단축키 표기 (KeyboardShortcutsHelp에 추가)

## Notes
관련: [[2026-07-16-open-source-release-plan]] (브랜드 확정과 연동), [[2026-07-16-ai-editing-assistant]].
