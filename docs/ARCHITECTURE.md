# Architecture

## 전체 파이프라인

### Realtime 전달 경로 (viewer 자막 표시까지)

```
[Behringer X32 Producer]
  → [UMC202HD] (USB audio interface)
  → [교회 PC Chrome /admin]
  → 브라우저에서 audio chunk를 WebSocket으로 전송
  → [Our WebSocket Server]
  → [Server-side Realtime STT Provider] (Korean)
  → STT final transcript
  → [Translation Service] (GPT)
  → 즉시 WebSocket broadcast
  → [/watch/[sessionCode] viewer 페이지]
```

**핵심 원칙: viewer 자막 전달은 DB 저장을 기다리지 않는다.**

### Async 저장/개선 경로

```
STT/Translation 결과
  → async persistence queue (background save)
  → [PostgreSQL]
  → 설교 후 리뷰
  → 용어집/STT 보정/스타일 가이드 개선
  → 향후 번역 품질 향상
```

- DB 저장 실패가 viewer 자막 전달을 차단하지 않는다.
- 비동기 저장에 대한 로깅 및 retry 처리는 추후 구현 예정.

## 오디오 입력

- 소스: Behringer X32 Producer (믹서)
- 인터페이스: Behringer UMC202HD (USB audio interface)
- 로컬 테스트 입력 디바이스명: `IN 1-2 BEHRINGER UMC 202 HD 192k`
- OBS와 Chrome이 동시에 같은 입력 사용 가능

## 파이프라인 단계별 설명

### 1. Audio Capture (브라우저)

- `/admin` (Live Translation Admin 콘솔) 에서 브라우저가 USB 오디오 인터페이스의 음성을 캡처
- 브라우저는 외부 STT provider에 직접 연결하지 않음
- 캡처한 audio chunk를 WebSocket으로 우리 서버에 전송
- 세션 QR 코드 + 접속 URL을 표시하여 viewer가 스캔/접속 가능

### 2. Speech-to-Text (서버)

- 서버가 OpenAI Realtime API (GA)에 WebSocket으로 연결하여 realtime 한국어 음성 인식 수행
- 연결: `wss://api.openai.com/v1/realtime?intent=transcription`
- 세션 타입: `transcription` (전사 전용)
- 전사 모델: `gpt-4o-transcribe`
- 오디오 포맷: PCM16 mono 24kHz (`audio/pcm`)
- turn_detection: `null` (수동 commit — RMS 기반 침묵 감지)
- Partial(중간) 결과: admin 페이지에만 표시
- Final 결과: 번역 트리거

#### RMS 기반 발화 감지 + 수동 commit

서버가 각 audio chunk의 RMS를 추적하여 발화/침묵을 판별하고, 침묵 지속 시 commit.

```
무음 chunk (RMS < 0.003) + 발화 감지 전 → pre-roll buffer에만 보관 (최근 500ms)
발화 감지 (RMS ≥ 0.003) → pre-roll flush + buffer에 append 시작
말 멈춤 후 침묵 1.5초 지속 → commit → final transcript 수신
```

- Pre-roll buffer (500ms): 말 시작 직전의 무음 chunk를 보관하여 첫 음절 잘림 방지
- 무음 환각(hallucination) 방지: speech 감지 전에는 OpenAI에 보내지 않음
- RMS threshold는 입력 장치에 따라 튜닝 필요 (노트북 내장 마이크: 0.003, UMC202HD: 재조정 예정)

### 3. Translation (GPT)

- API: OpenAI Responses API (`/v1/responses`)
- 모델: `gpt-4.1-mini`
- 입력: 한국어 final transcript
- 출력: Structured Outputs (JSON Schema, strict)로 3개 언어 번역
  - `en`: English
  - `zh-Hans`: Simplified Chinese / 简体中文
  - `zh-Hant`: Traditional Chinese / 繁體中文
- 번역 전 STT 보정 사전과 관련 용어집을 적용할 수 있음 (추후)
- Final 번역만 viewer에게 전달

### 4. WebSocket 배포

WebSocket 서버가 연결된 클라이언트를 role로 구분하여 결과를 배포:

| Role | 식별 | 수신 메시지 |
|------|------|------------|
| Admin | 첫 `audio.chunk`의 sessionCode | STT delta/final, translation completed/error, chunk ack |
| Viewer | `viewer.join` (sessionCode + language) | `subtitle.final` (선택 언어의 번역 텍스트만) |

- 한 sessionCode에 여러 viewer가 붙을 수 있음
- Viewer는 `viewer.changeLanguage`로 실시간 언어 변경 가능
- 번역 완료 시 같은 sessionCode의 모든 viewer에게 각자 선택한 언어로 broadcast

#### Stop 안전 종료

Admin이 Stop을 누르면 마지막 문장의 STT/번역/broadcast까지 보호:

```
audio.stop → flushAndClose(commit + transcript 대기)
→ pendingTranslations 완료 대기 (최대 3초)
→ audio.stop.ack → admin WS close
```

### 5. 비동기 저장 (PostgreSQL)

- 설교 세션, STT 결과, 번역 결과를 비동기로 PostgreSQL에 저장
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
    api/              # Next.js API routes
  components/         # React 컴포넌트
    admin/            # 관리자 페이지 컴포넌트
    viewer/           # 시청자 페이지 컴포넌트
  lib/                # 프론트/서버 공유 코드
    audio/            # 오디오 관련 유틸리티
    time/             # 시간 관련 유틸리티
    types/            # 공유 TypeScript 타입/인터페이스
    logger/           # 로깅 유틸리티
  server/             # 백엔드 전용 코드
    ws/               # WebSocket 서버
    openai/           # OpenAI Realtime STT 연동 + GPT 번역
    translation/      # (예정) 번역 관련 유틸리티
    session/          # 설교 세션 관리
    db/               # PostgreSQL 비동기 저장
```

### 분리 원칙

- `src/app`: Next.js App Router 기반 페이지, layout, route handler를 관리
- `src/components`: 브라우저 UI 컴포넌트. `admin/`과 `viewer/`로 역할 분리. 브라우저 API를 사용하는 컴포넌트는 `"use client"`를 명시
- `src/server`: Node.js 전용 코드. WebSocket(`ws/`), STT(`openai/`), 번역(`translation/`), 세션 관리(`session/`), DB 저장(`db/`)으로 분리
- `src/lib`: 프론트/서버에서 공유 가능한 유틸리티. 오디오(`audio/`), 시간(`time/`), 타입(`types/`), 로깅(`logger/`)으로 분리

추후 `apps/web` (프론트엔드)과 `apps/api` (백엔드)로 분리 가능.

## 배포

- 대상: AWS EC2 단일 인스턴스
- Next.js가 프론트엔드와 API routes 서빙
- 별도 프로세스로 WebSocket 서버 실행
- PostgreSQL은 같은 인스턴스 또는 managed service

## Latency Budget

Viewer 자막 표시까지의 목표 레이턴시 (realtime 전달 경로만):

| 단계 | 목표 | 차단 여부 |
|------|------|-----------|
| Audio capture + WebSocket 전송 | < 500ms | blocking |
| STT finalization | 1-3s | blocking |
| GPT translation | 1-2s | blocking |
| WebSocket broadcast to viewer | < 100ms | blocking |
| **합계 (viewer 자막까지)** | **< 5s** | |
| Async DB 저장 | 측정 대상 | **non-blocking** |

- Async DB 저장은 측정하되, viewer 자막 레이턴시에 포함하지 않는다.
- 실제 레이턴시는 개발 과정에서 단계별로 측정하여 DEV_LOG에 기록한다.
