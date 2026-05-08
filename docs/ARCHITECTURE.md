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

- `/admin` 페이지에서 브라우저가 USB 오디오 인터페이스의 음성을 캡처
- 브라우저는 외부 STT provider에 직접 연결하지 않음
- 캡처한 audio chunk를 WebSocket으로 우리 서버에 전송

### 2. Speech-to-Text (서버)

- 서버가 STT provider에 연결하여 realtime 한국어 음성 인식 수행
- STT provider는 미확정 (첫 번째 후보: OpenAI Realtime Transcription)
- Partial(중간) 결과: admin 페이지에만 표시
- Final 결과: 번역 트리거

### 3. Translation (GPT)

- 입력: 한국어 final transcript
- 번역 전 STT 보정 사전과 관련 용어집을 적용할 수 있음
- 번역 요청에는 전체 용어집이 아닌, 현재 문장과 관련된 용어만 포함하는 것을 원칙으로 함
- 출력: 3개 언어 번역
  - `en`: English
  - `zh-Hans`: Simplified Chinese / 简体中文
  - `zh-Hant`: Traditional Chinese / 繁體中文
- Final 번역만 viewer에게 전달

### 4. WebSocket 배포

WebSocket 서버가 연결된 클라이언트에 결과를 배포:
- **Admin (`/admin`)**: audio 입력 상태, 한국어 partial STT, 한국어 final STT, 번역 결과
- **Viewer (`/watch/[sessionCode]`)**: 선택한 언어의 final 번역 자막만 수신

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
  components/         # 공유 React 컴포넌트
  lib/                # 공유 타입, 상수, 유틸리티
    types.ts          # 공유 TypeScript 인터페이스
  server/             # 백엔드 전용 코드
    ws-server.ts      # WebSocket 서버
    audio-relay.ts    # 브라우저에서 받은 audio chunk 검증/전달 처리
    stt.ts            # STT provider 연동
    translate.ts      # GPT 번역 연동
```

### 분리 원칙

- `src/app`: Next.js App Router 기반 페이지, layout, route handler를 관리
- `src/components`: 주로 브라우저 UI 컴포넌트. 브라우저 API를 사용하는 컴포넌트는 `"use client"`를 명시
- `src/server`: Node.js 전용 코드 (WebSocket, STT provider 연동, 번역 orchestration, DB 저장)
- `src/lib`: 프론트/서버에서 공유 가능한 타입, 상수, 순수 유틸리티

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
