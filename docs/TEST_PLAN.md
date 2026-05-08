# Test Plan

교회 실시간 번역 자막 시스템의 테스트 전략. 각 개발 단계마다 테스트, 레이턴시 측정, 사람 리뷰를 거친 후 다음 단계로 넘어간다.

## 테스트 원칙

1. **단계별 진행**: 각 파이프라인 단계를 독립적으로 테스트한 후 통합
2. **측정 가능**: 모든 단계에서 레이턴시 기록
3. **사람 리뷰**: 번역 품질은 자동 테스트가 아닌 사람이 확인
4. **재현 가능**: 테스트 조건과 결과를 DEV_LOG.md에 기록
5. **레포 내 실제 데이터 금지**: public repository에는 실제 설교 녹음, 녹취록, 번역 로그를 커밋하지 않는다. 로컬/DB 테스트 데이터는 별도 보안 환경에서 관리한다.

---

## Stage 1: Audio Input Verification

`/admin` 페이지에서 오디오 입력이 정상적으로 동작하는지 확인. 서버 전송은 이 단계에 포함하지 않는다.

### 테스트

- [ ] 브라우저에서 오디오 입력 디바이스 목록 조회 가능
- [ ] 올바른 디바이스 (`IN 1-2 BEHRINGER UMC 202 HD 192k`) 선택 가능
- [ ] `getUserMedia`로 오디오 스트림 연결 성공
- [ ] 레벨 미터가 입력 음성에 반응
- [ ] X32에서 목사님 마이크 mute 시 레벨 미터가 멈춤
- [ ] OBS 동시 실행 중에도 오디오 캡처 정상 작동
- [ ] 30분 연속 캡처 안정성 확인 (스트림 끊김, 에러 없음)

### 측정

- 오디오 캡처 시작 레이턴시
- Audio buffer 크기 및 sample rate

---

## Stage 2: Audio Chunk Streaming (브라우저 → 서버)

브라우저에서 캡처한 오디오를 chunk 단위로 WebSocket 서버에 전송하는 단계.

### 테스트

- [ ] Audio chunk가 정상적으로 생성됨
- [ ] Chunk 생성 주기가 기록됨 (interval, chunk size)
- [ ] WebSocket으로 서버에 chunk 전송 성공
- [ ] 서버에서 chunk 수신 시각이 기록됨

### 측정

- Chunk 생성 주기 및 크기
- 브라우저 → WebSocket 서버 전송 레이턴시
- 서버 수신 시각과 브라우저 전송 시각 차이

---

## Stage 3: Speech-to-Text (서버 측)

STT provider는 미확정. 첫 번째 후보는 OpenAI Realtime Transcription.

### 테스트

- [ ] 서버가 STT provider에 audio stream을 전달
- [ ] Partial(중간) 결과가 수신됨
- [ ] Final 결과가 수신됨
- [ ] 한국어 설교 스타일 음성에 대한 인식 정확도 확인 (사람 리뷰)

### 측정

- 음성 → partial 결과 수신 시간
- 음성 → final 결과 수신 시간
- STT 정확도 (사람 리뷰 기반)

---

## Stage 4: Translation (GPT)

### 테스트

- [ ] 한국어 final transcript가 GPT API에 전달됨
- [ ] `en` (English) 번역 반환
- [ ] `zh-Hans` (简体中文) 번역 반환
- [ ] `zh-Hant` (繁體中文) 번역 반환
- [ ] 교회/설교 맥락에 적합한 번역인지 확인 (사람 리뷰)

### 측정

- GPT API 응답 시간 (번역 요청당)
- 번역 품질 평가 (사람 리뷰)

---

## Stage 5: WebSocket 배포

### 테스트

- [ ] WebSocket 서버 시작 및 연결 수락
- [ ] Admin 클라이언트가 모든 데이터 수신 (partial, final, 번역)
- [ ] Viewer 클라이언트가 final 번역만 수신
- [ ] Viewer가 선택한 언어만 수신
- [ ] 다수 동시 접속 viewer 지원

### 측정

- WebSocket 메시지 전달 레이턴시
- 1시간 세션 동안 연결 안정성

---

## Stage 6: End-to-End (Realtime 전달 경로)

### 테스트

- [ ] 전체 파이프라인: audio → STT → translation → viewer 자막 표시
- [ ] Admin 페이지에서 모든 단계 realtime 표시
- [ ] Viewer 페이지에서 깨끗한 final 자막만 표시
- [ ] 네트워크 중단 시 graceful 처리
- [ ] STT/GPT API 에러 시 복구

### 측정

- 전체 end-to-end 레이턴시 (audio → viewer 자막 표시)
- 목표: 5초 이내
- 설교 전체 시간(30-60분) 동안 안정성

### Realtime 경로 확인 사항

- [ ] Viewer 자막 전달이 DB 저장 완료를 기다리지 않음
- [ ] DB 저장 실패 시에도 viewer 자막이 정상 전달됨

---

## Stage 7: Async 저장 및 리뷰

### 테스트

- [ ] 설교 세션이 PostgreSQL에 비동기 저장됨
- [ ] STT 결과 및 번역이 세션별로 저장됨
- [ ] 과거 세션을 admin에서 리뷰 가능
- [ ] DB 저장 실패 시 로그가 남고 retry 가능
- [ ] 실제 설교 데이터는 레포에 커밋되지 않음

### 측정

- Async DB 저장 소요 시간
- 저장 실패율 및 retry 성공률

---

## 테스트 환경

| 항목 | 값 |
|------|------|
| 오디오 소스 | Behringer X32 Producer → UMC202HD |
| 입력 디바이스 | `IN 1-2 BEHRINGER UMC 202 HD 192k` |
| 브라우저 | Chrome (최신) |
| OS | Windows (교회 PC) |
| 서버 | 로컬 개발 → AWS EC2 |
