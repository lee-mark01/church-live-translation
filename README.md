# Church Live Translation

교회 실시간 설교 번역 자막 시스템.

한국어 설교 음성을 캡처하여 실시간으로 텍스트 변환(STT) 및 번역 후, 방문 외국인 성도에게 자막으로 제공한다.

## MVP 범위

- 실시간 번역 자막 제공만 포함
- TTS(음성 합성), speech-to-speech는 현재 범위 밖 (추후 검토)

## 핵심 설계 원칙

실시간 자막 전달 경로와 저장/검토 경로를 분리한다.  
번역 결과는 성도 화면에 WebSocket으로 즉시 송출하고, PostgreSQL 저장은 비동기로 처리하여 DB 저장 지연이나 실패가 자막 표시를 막지 않도록 한다.

## 지원 언어

| 코드 | 언어 |
|------|------|
| en | English |
| zh-Hans | Simplified Chinese / 简体中文 |
| zh-Hant | Traditional Chinese / 繁體中文 |

## 기술 스택

| 계층 | 기술 |
|------|------|
| Frontend | Next.js (App Router), React, TypeScript, Tailwind CSS |
| Backend | Next.js API Routes + standalone WebSocket server (`src/server`) |
| STT | OpenAI Realtime API (GA) — `gpt-4o-transcribe`, transcription session |
| Translation | OpenAI Responses API — `gpt-4.1-mini`, Structured Outputs |
| Database | PostgreSQL |
| Deployment | AWS EC2 |

## 프로젝트 구조

```
src/
  app/           # Next.js 페이지 및 라우트 (프론트엔드 + API routes)
    admin/       # 관리자 페이지
    watch/       # 시청자 자막 페이지 (/watch/[sessionCode])
  components/    # React 컴포넌트
    admin/       # 관리자 페이지 컴포넌트
    viewer/      # 시청자 페이지 컴포넌트
  lib/           # 프론트/서버 공유 코드
    audio/       # 오디오 유틸리티
    time/        # 시간 유틸리티
    types/       # 공유 타입/인터페이스
    logger/      # 로깅 유틸리티
  server/        # 백엔드 전용 코드
    ws/          # WebSocket 서버
    openai/      # STT 연동
    translation/ # 번역 연동
    session/     # 세션 관리
    db/          # DB 저장
docs/            # 아키텍처, 개발 로그, 테스트 계획
public/          # 정적 파일
```

현재는 단일 레포 구조. 추후 필요 시 `apps/web`과 `apps/api`로 분리 가능하도록 설계.

## 시작하기

```bash
npm install
```

`.env` 파일을 프로젝트 루트에 생성:

```
OPENAI_API_KEY=sk-...
```

서버 실행 (터미널 2개):

```bash
npm run dev      # Next.js 프론트엔드 (localhost:3000)
npm run dev:ws   # WebSocket 서버 (localhost:3001)
```

- 관리자 콘솔: http://localhost:3000/admin (QR 코드 + Start/Stop + STT + 번역)
- 시청자 자막: http://localhost:3000/watch/TEST-001 (또는 admin QR 스캔)

## 오디오 셋업

Behringer X32 Producer 믹서에서 Behringer UMC202HD USB 오디오 인터페이스를 통해 교회 PC로 입력. OBS와 Chrome이 동시에 같은 입력을 사용 가능.

## 문서

- [Architecture](docs/ARCHITECTURE.md) — 시스템 아키텍처
- [Dev Log](docs/DEV_LOG.md) — 개발 기록
- [Test Plan](docs/TEST_PLAN.md) — 테스트 계획

## 보안 정책

이 레포지토리는 public이다. 시크릿, API 키, 인증 정보, 실제 IP 주소, 교회 네트워크 정보, 실제 설교 녹음/녹취록은 저장하지 않는다. 민감한 값은 환경 변수 또는 placeholder를 사용한다.
