# 웹캠 셀프뷰 — 녹화 중 내 얼굴 플로팅 미리보기

**Participants**: Dan, claude

## Summary
웹캠을 켜면 화면 우하단에 원형 플로팅 미리보기 창이 떠서 녹화 중 자기 얼굴을 볼 수 있다.
`setContentProtection(true)`로 녹화 결과물에는 절대 찍히지 않는다 (Notes 창과 동일 패턴).

## Context
- **Background**: "PIP로 내 얼굴 보면서 서비스 소개 녹화하고 싶다" — OpenScreen은 웹캠을 별도 트랙으로 녹화만 하고 라이브 미리보기가 없었음 (Recorded/Screen Studio 대비 갭)
- **Requirements**: 녹화 중에도 보이되 캡처에는 미포함, 드래그 이동/리사이즈, 웹캠 토글과 연동
- **Decisions**: 기존 Notes 창의 contentProtection+alwaysOnTop 패턴 재사용; 미리보기용 저해상도 스트림을 별도로 열음(macOS는 동일 카메라 다중 접근 허용); windowType=webcam-preview 렌더러 라우팅
- **Constraints**: LaunchWindow의 webcamEnabled/webcamDeviceId 상태에 useEffect로 연동 — HUD 언마운트 시 자동 닫힘

## Timeline

### 2026-07-16
**Focus**: 셀프뷰 창 신규 구현
- electron/windows.ts `createWebcamPreviewWindow` (투명·프레임리스·200px, screen-saver 레벨 alwaysOnTop)
- electron/ipc/webcamPreview.ts 싱글턴 show/hide + 기기 변경 푸시
- WebcamPreviewWindow.tsx (미러 영상, -webkit-app-region 드래그, 호버 닫기)
- App.tsx/main.tsx 라우팅 + 투명 배경 처리, LaunchWindow 토글 연동

**Learned**: `setContentProtection`은 DRM용 API지만 화면 녹화 앱에서는 "자기 UI를 결과물에서 숨기는" 용도로 뒤집어 쓴다 — Screen Studio 시그니처 경험의 핵심 메커니즘.

## Pending
- [ ] 실기기 검증: 녹화 결과물에 미리보기 창이 안 찍히는지 확인 (ScreenCaptureKit 경로)
- [ ] 창 위치/크기 기억 (재실행 시 복원)

## Notes
관련: [[2026-07-16-ai-editing-assistant]] (같은 세션에서 병행 구현).
