# Church Live Translation

교회 실시간 설교 번역 자막 시스템.

한국어 설교 음성을 실시간으로 번역하여 외국인 성도에게 자막으로 제공한다.

## 주요 기능

- **실시간 번역 자막** — 한국어 설교를 영어/중국어 등으로 실시간 스트리밍 번역
- **관리자 수정** — 잘못 인식된 문장을 관리자가 수정하면 재번역 후 뷰어에 반영
- **다국어 지원** — 설정 파일 한 줄로 언어 추가 (13개 언어 지원)
- **세션 로그** — 설교별 원문/번역 기록 자동 저장
- **뷰어 UX** — 문장 단위 표시, 폰트 크기 조절, 화면 꺼짐 방지, 자동 재연결

## 지원 언어

`src/lib/languages.ts`에서 관리. 주석 해제만으로 추가 가능.

| 코드 | 언어 | 상태 |
|------|------|------|
| en | English | 활성 |
| zh | 中文 | 활성 |
| ja | 日本語 | 비활성 (주석) |
| id | Indonesia | 비활성 (주석) |

그 외 사용 가능: es, fr, de, it, pt, ru, ko, hi, vi

## 기술 스택

| 계층 | 기술 |
|------|------|
| Frontend | Next.js (App Router), React, TypeScript, Tailwind CSS |
| Backend | Standalone WebSocket server (`src/server`) |
| Translation | OpenAI `gpt-realtime-translate` (실시간 음성→번역) |
| Correction | OpenAI `gpt-4o-mini` (텍스트 재번역) |
| Deployment | 교회 PC 로컬 운영 (VPS 전환 가능) |

## 프로젝트 구조

```
src/
  app/              # Next.js 페이지
    admin/          # 관리자 콘솔
    watch/          # 시청자 자막 (/watch/[sessionCode])
  components/
    admin/          # 관리자 UI (AudioChunkTest)
    viewer/         # 시청자 UI (SubtitleViewer)
  lib/
    languages.ts    # 언어 설정 (이 파일 하나로 전체 언어 관리)
    types/          # 공유 타입
    audio/          # 오디오 유틸리티
  server/
    ws/             # WebSocket 서버
    openai/         # translateClient (실시간), retranslate (수정)
    session/        # 세션 로거
docs/               # 아키텍처, 개발 로그
logs/               # 세션 로그 (gitignore)
```

## 시작하기

### 필수 조건

- Node.js 18+
- OpenAI API 키

### 설치

```bash
git clone https://github.com/lee-mark01/church-live-translation.git
cd church-live-translation
npm install
```

`.env` 파일 생성:

```
OPENAI_API_KEY=sk-...
```

### 실행

**Windows (원클릭):**
```
start.bat 더블클릭
```

**수동 실행 (터미널 2개):**
```bash
npm run dev      # Next.js (localhost:3000)
npm run dev:ws   # WebSocket 서버 (localhost:3001)
```

### 접속

- 관리자: http://localhost:3000/admin
- 시청자: QR 코드 스캔 또는 http://localhost:3000/watch/{세션코드}

## 운영 흐름

1. 관리자가 `/admin`에서 **Start** → 마이크/오디오 입력 캡처 시작
2. 실시간 번역이 스트리밍으로 진행
3. 교인이 QR 스캔 → 언어 선택 → 자막 표시
4. 관리자가 오역 발견 → 문장 클릭 → 수정 → 자동 재번역 → 뷰어 반영
5. 설교 끝 → **Stop** → 세션 로그 저장 (`logs/{세션코드}.json`)

## 비용

- `gpt-realtime-translate`: $0.034/분/세션
- 2개 언어 × 1시간 설교 = **~$4/회**
- 월 4회 예배 기준: **~$16/월**
- 수정 재번역 (`gpt-4o-mini`): 건당 ~$0.0001 (무시 가능)

## 문서

- [Architecture](docs/ARCHITECTURE.md) — 시스템 아키텍처
- [Dev Log](docs/DEV_LOG.md) — 개발 기록

## 보안 정책

이 레포지토리는 public이다. 시크릿, API 키, 인증 정보, 실제 IP 주소, 교회 네트워크 정보, 실제 설교 녹음/녹취록은 저장하지 않는다. 민감한 값은 환경 변수를 사용한다.
