# Dev Log

단계별 개발 진행 상황, 결정 사항, 발견 내용을 기록한다.

---

## 2026-05-09 — 프로젝트 초기화

### 완료

- Next.js 프로젝트 생성 (TypeScript, App Router, Tailwind CSS, ESLint)
- `src/` 디렉토리 구조, `@/*` import alias 사용
- 추가 패키지 설치: `ws`, `qrcode.react`, `lucide-react`, `tsx`, `@types/ws`
- 프로젝트 문서 작성: README, ARCHITECTURE, DEV_LOG, TEST_PLAN

### 결정 사항

- 단일 레포 구조 (프론트엔드 + 백엔드를 하나의 Next.js 프로젝트에)
- 프론트엔드 코드: `src/app`, `src/components`
- 백엔드/서버 코드: `src/server`
- 공유 타입: `src/lib`
- 추후 `apps/web` + `apps/api`로 분리 가능하도록 설계
- Public 레포: 시크릿, 실제 녹취록, 실제 녹음 파일 커밋 금지

### 아키텍처 결정

- **STT provider 미확정**: 첫 번째 후보는 OpenAI Realtime Transcription
- **브라우저 → 서버 → STT**: 브라우저가 외부 STT에 직접 연결하지 않음. 브라우저는 audio chunk를 우리 WebSocket 서버로 전송하고, 서버가 STT provider에 연결
- **Realtime 전달 경로와 async 저장 경로 분리**: viewer 자막 전달은 DB 저장을 기다리지 않음
- **MVP 범위**: 실시간 번역 자막만. TTS/speech-to-speech는 추후 검토
- **Viewer 라우트**: `/watch/[sessionCode]`
- **Admin 라우트**: `/admin`

### 오디오 셋업 확인

- Behringer X32 Producer → UMC202HD → USB → 교회 PC
- 로컬 테스트 입력 디바이스: `IN 1-2 BEHRINGER UMC 202 HD 192k`
- OBS와 Chrome 동시 입력 사용 가능 확인

### 다음 단계

- [ ] Admin 페이지 스켈레톤 구현
- [ ] 브라우저 오디오 입력 장치 목록 조회
- [ ] `IN 1-2 BEHRINGER UMC 202 HD 192k` 선택 및 레벨 미터 테스트
- [ ] 오디오 chunk 생성 테스트
- [ ] 오디오 chunk → WebSocket 서버 전송 테스트
- [ ] STT provider 연결 테스트