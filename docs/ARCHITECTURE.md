# Architecture

## 전체 파이프라인

### Realtime 전달 경로 (viewer 자막 표시까지)

```
[Behringer X32 Producer]
  → [UMC202HD] (USB audio interface)
  → [교회 PC Chrome /admin]
  → 브라우저에서 audio chunk를 WebSocket으로 전송
  → [Our WebSocket Server]
  → [OpenAI gpt-realtime-translate] (한국어 음성 → 번역 텍스트 스트리밍)
  → 즉시 WebSocket broadcast
  → [/watch/[sessionCode] viewer 페이지]
```

**핵심 원칙: viewer 자막 전달은 DB 저장을 기다리지 않는다.**

### Async 저장/개선 경로

```
Translation 결과
  → async persistence queue (background save)
  → [PostgreSQL]
  → 설교 후 리뷰
  → 용어집/스타일 가이드 개선
  → 향후 번역 품질 향상
```

- DB 저장 실패가 viewer 자막 전달을 차단하지 않는다.
- 비동기 저장에 대한 로깅 및 retry 처리는 추후 구현 예정.

## 오디오 입력

- 소스: Behringer X32 Producer (믹서)
- 인터페이스: Behringer UMC202HD (USB audio interface)
- 로컬 테스트 입력 디바이스명: `IN 1-2 BEHRINGER UMC 202 HD 192k`
- 유튜브 테스트: VB-Audio Virtual Cable (CABLE Output)
- OBS와 Chrome이 동시에 같은 입력 사용 가능

## 파이프라인 단계별 설명

### 1. Audio Capture (브라우저)

- `/admin` (Live Translation Admin 콘솔) 에서 브라우저가 오디오를 캡처
- 캡처한 audio chunk를 WebSocket으로 우리 서버에 전송
- AudioWorklet: 48kHz → 24kHz PCM16 mono 다운샘플링 (100ms chunks)
- 세션 QR 코드 + 접속 URL을 표시하여 viewer가 스캔/접속 가능

### 2. Translation (서버 — gpt-realtime-translate)

서버가 OpenAI `gpt-realtime-translate` API에 WebSocket으로 연결하여 실시간 번역 수행.

- 연결: `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate`
- 오디오 포맷: PCM16 mono 24kHz
- 입력 언어: 자동 감지 (한국어)
- 출력 언어: `en` (영어), `zh` (중국어) — 언어당 별도 세션
- 내장 STT (gpt-realtime-whisper) + 번역 일체형
- **세그멘테이션 자동** — 수동 commit 불필요, 모델이 의미 단위로 자체 판단
- noise_reduction: near_field (마이크 직접 입력)

#### 이전 방식과의 차이

| 항목 | 이전 (v1) | 현재 (v2) |
|------|-----------|-----------|
| STT | gpt-4o-transcribe + 수동 commit | gpt-realtime-whisper (내장) |
| 세그멘테이션 | RMS 침묵감지 + 수동 commit | 모델 자동 |
| 번역 | gpt-4.1-mini 별도 호출 | gpt-realtime-translate 내장 |
| 파이프라인 | STT → 번역 → broadcast (직렬) | 오디오 → 번역 스트리밍 (단일) |
| 레이턴시 | STT 대기 + 번역 대기 | 스트리밍 delta |

### 3. WebSocket 배포

WebSocket 서버가 연결된 클라이언트를 role로 구분하여 결과를 배포:

| Role | 식별 | 수신 메시지 |
|------|------|------------|
| Admin | 첫 `audio.chunk`의 sessionCode | transcript.delta, translation.delta, chunk ack |
| Viewer | `viewer.join` (sessionCode + language) | `subtitle.delta` (선택 언어의 번역 텍스트 스트리밍) |

- 한 sessionCode에 여러 viewer가 붙을 수 있음
- Viewer는 `viewer.changeLanguage`로 실시간 언어 변경 가능
- 번역 delta가 올 때마다 해당 언어의 viewer에게 즉시 broadcast

#### Stop 안전 종료

Admin이 Stop을 누르면:

```
audio.stop → 모든 translate 세션 disconnect
→ audio.stop.ack → admin WS close
```

### 4. 비동기 저장 (PostgreSQL)

- 세션, 번역 결과를 비동기로 PostgreSQL에 저장
- 용도: 설교 후 리뷰, 디버깅, 레이턴시 분석, 번역 품질 개선
- Realtime 전달 경로와 완전히 분리됨
- 실제 설교 데이터는 레포에 커밋하지 않음

## 소스 코드 구조

```
src/
  app/                # Next.js App Router
    page.tsx          # 랜딩 페이지
    admin/            # 관리자 대시보드
    watch/
      [sessionCode]/  # 시청자 자막 페이지
  components/         # React 컴포넌트
    admin/            # 관리자 페이지 컴포넌트
    viewer/           # 시청자 페이지 컴포넌트
  lib/                # 프론트/서버 공유 코드
    types/            # 공유 TypeScript 타입/인터페이스
  server/             # 백엔드 전용 코드
    ws/               # WebSocket 서버
    openai/           # OpenAI gpt-realtime-translate 연동
    session/          # (예정) 설교 세션 관리
    db/               # (예정) PostgreSQL 비동기 저장
```

## 비용

| 모델 | 가격 | 1시간 설교 |
|------|------|-----------|
| gpt-realtime-translate | $0.034/분 | $2.04 |
| gpt-realtime-whisper (소스 자막) | $0.017/분 | $1.02 |
| 영어+중국어 동시 (세션 2개) | $0.068/분 | $4.08 |

## 배포

- 대상: AWS EC2 단일 인스턴스
- Next.js가 프론트엔드 서빙
- 별도 프로세스로 WebSocket 서버 실행
- PostgreSQL은 같은 인스턴스 또는 managed service

## Latency Budget

gpt-realtime-translate는 스트리밍 delta 출력이므로 체감 레이턴시가 크게 개선됨:

| 단계 | 예상 | 비고 |
|------|------|------|
| Audio capture + WS 전송 | < 200ms | 100ms chunk + 네트워크 |
| 모델 처리 + 첫 delta | 1-3s | 의미 단위 대기 후 출력 시작 |
| WS broadcast to viewer | < 50ms | |
| **체감 (첫 자막)** | **1-3s** | 이후 스트리밍으로 계속 갱신 |
