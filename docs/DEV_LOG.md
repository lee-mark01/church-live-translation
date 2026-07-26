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

- [x] Admin 페이지 스켈레톤 구현
- [x] 브라우저 오디오 입력 장치 목록 조회
- [x] `IN 1-2 BEHRINGER UMC 202 HD 192k` 선택 및 레벨 미터 테스트
- [x] 오디오 chunk 생성 테스트
- [x] 오디오 chunk → WebSocket 서버 전송 테스트
- [x] STT provider 연결 테스트

---

## 2026-06-17 — 오디오 청크 생성 검증 완료

### 완료

- 디렉토리 구조 세분화 (components/admin·viewer, server/ws·openai·translation·session·db, lib/audio·time·types·logger)
- ARCHITECTURE.md, README.md 구조 반영 업데이트
- AudioWorklet 기반 오디오 청크 생성기 구현 (`public/audio-chunk-worklet.js`)
- 청크 테스트 UI 구현 (`src/components/admin/AudioChunkTest.tsx`, `/admin`)

### 오디오 청크 검증 결과

테스트 환경: 교회 PC, UMC202HD, Chrome

| 설정 | Expected Size | Actual Size | Chunk Interval | Sequence | 결과 |
|------|--------------|-------------|----------------|----------|------|
| 50ms | 2,400 bytes | 2,400 bytes | 50ms | 1→112 OK | PASS |
| 100ms | 4,800 bytes | 4,800 bytes | 100ms | 1→97 OK | PASS |
| 250ms | 12,000 bytes | 12,000 bytes | 250ms | 1→29 OK | PASS |

### 기술 결정

- **다운샘플링**: 48kHz → 24kHz (OpenAI Realtime API 입력 스펙에 맞춤)
- **다운샘플 방식**: 2:1 평균 `(sample[i] + sample[i+1]) / 2` — 단순 decimation(샘플 drop)보다 정보 보존에 유리
- **출력 포맷**: PCM16 mono 24kHz
- **48kHz 검증**: AudioContext가 48kHz가 아닌 경우 (예: 44.1kHz) 시작을 차단하고 에러 표시. 44100/24000 = 1.8375로 정수비가 아니어서 2:1 평균이 불가능하기 때문
- **AudioWorklet 사용**: 메인 스레드 블로킹 없이 실시간 오디오 처리

### 구현 파일

- `public/audio-chunk-worklet.js` — AudioWorklet 프로세서 (48kHz→24kHz 평균 다운샘플링 + PCM16 변환)
- `src/components/admin/AudioChunkTest.tsx` — 청크 테스트 UI (chunk count, size, interval, sequence 실시간 표시)
- `src/app/admin/page.tsx` — Admin 페이지 라우트

### 다음 단계

- [x] 오디오 chunk → WebSocket 서버 전송 테스트
- [ ] STT provider 연결 테스트

---

## 2026-06-17 — 오디오 청크 WebSocket 전송 검증 완료

### 완료

- 공유 메시지 타입 정의 (`src/lib/types/audio.ts`)
- WebSocket 서버 구현 (`src/server/ws/server.ts`) — chunk 수신, seq 검증, latency 로그, 주기적 stats 전송
- 클라이언트 WebSocket 전송 추가 — PCM16 → base64 인코딩 후 JSON 메시지로 전송
- Admin UI에 Server 섹션 추가 (connection, latency, dropped chunks, avg latency)

### 메시지 포맷

```json
{
  "type": "audio.chunk",
  "sessionCode": "TEST-001",
  "seq": 1,
  "capturedAt": 1780000000000,
  "chunkMs": 100,
  "format": "pcm16",
  "sampleRate": 24000,
  "channels": 1,
  "sizeBytes": 4800,
  "audio": "base64..."
}
```

### WebSocket 전송 검증 결과

테스트 환경: localhost (브라우저 → WS 서버 동일 머신)

| 항목 | 기대값 | 실측값 | 결과 |
|------|--------|--------|------|
| seq | 1→72 순차 | 1→72 순차 | PASS |
| sizeBytes | 4,800 | 4,800 | PASS |
| sampleRate | 24,000 | 24,000 | PASS |
| chunkMs | 100 | 100 | PASS |
| clientToServerMs | 수 ms~수십 ms | 1~5ms (대부분 1ms) | PASS |
| droppedChunks | 0 | 0 | PASS |

### 구현 파일

- `src/lib/types/audio.ts` — `AudioChunkMessage`, `AudioChunkAck`, `AudioChunkStats` 타입
- `src/server/ws/server.ts` — WebSocket 서버 (port 3001)
- `src/components/admin/AudioChunkTest.tsx` — WS 전송 + 서버 stats 표시 추가
- `package.json` — `dev:ws` 스크립트 추가

### 다음 단계

- [x] STT provider 연결 테스트 (OpenAI Realtime API)

---

## 2026-06-17 — OpenAI Realtime 전사 연동

### 완료

- OpenAI Realtime WebSocket 클라이언트 구현 (`src/server/openai/realtimeClient.ts`)
- WS 서버에서 수신한 audio chunk를 OpenAI `input_audio_buffer.append`로 전달
- OpenAI 전사 이벤트(delta/completed)를 브라우저로 릴레이
- Admin UI에 Korean STT 섹션 추가 (partial delta + final transcript 표시)
- Stats 개선: `AudioChunkStats` 별도 메시지 제거, `AudioChunkAck`에 `totalChunks`/`droppedChunks` 포함 (매 chunk마다 실시간 업데이트)

### 모델/세션 선택 과정

처음에는 일반 Realtime 대화 모델(`gpt-4o-realtime-preview-2024-12-17`)로 구현했으나, 리서치 결과 실시간 전사 전용 모델로 교체.

| 항목 | 초기 구현 | 최종 결정 |
|------|----------|----------|
| 모델 | `gpt-4o-realtime-preview-2024-12-17` | `gpt-realtime-whisper` |
| 세션 타입 | 일반 realtime 대화 | `transcription` |
| 전사 모델 | `whisper-1` | `gpt-realtime-whisper` |
| 오디오 포맷 설정 | `pcm16` (암묵적) | `audio/pcm`, rate `24000` (명시적) |
| 언어 | `ko` | `ko` |
| turn_detection | server VAD | `null` (수동 commit) |

**이유**: `gpt-realtime-whisper`는 실시간 전사 전용 모델로, streaming delta와 tunable latency를 지원. `gpt-4o-transcribe`는 정확도 중심의 비스트리밍/요청-응답형에 더 적합.

### 전사 이벤트

| 이벤트 | 용도 | UI 표시 |
|--------|------|---------|
| `conversation.item.input_audio_transcription.delta` | 중간 전사 조각 | 이탤릭 회색으로 누적 표시 |
| `conversation.item.input_audio_transcription.completed` | 최종 전사 | 번호 매겨서 확정 표시, partial 초기화 |

### 서버 → 브라우저 메시지 타입

- `stt.connection` — OpenAI 연결 상태 (`connected`/`disconnected`/`error`)
- `stt.transcript.delta` — partial 전사 조각
- `stt.transcript.final` — 최종 전사

### 구현 파일

- `src/server/openai/realtimeClient.ts` — OpenAI Realtime WebSocket 클라이언트 (신규)
- `src/server/ws/server.ts` — audio chunk → OpenAI 전달 + 전사 이벤트 릴레이
- `src/lib/types/audio.ts` — `SttTranscriptDelta`, `SttTranscriptFinal`, `SttConnectionStatus` 타입 추가, `AudioChunkStats` 제거
- `src/components/admin/AudioChunkTest.tsx` — STT 연결 상태 + Korean STT 섹션 추가

---

## 2026-06-18 — commit 전략 개선: RMS 기반 침묵 감지

### 문제

수동 commit 구조에서 최초 commit 전략은 "audio chunk가 안 들어오면 commit"이었으나, 마이크가 켜져 있으면 무음 chunk가 계속 전송되므로 commit timer가 계속 리셋되어 commit이 발생하지 않는 문제.

```
마이크 켜짐 → 말 안 해도 무음 chunk 계속 전송
→ appendAudio 계속 호출 → commit timer 리셋
→ commit 안 됨 → final transcript 안 나옴
```

### 해결

AudioWorklet에서 각 chunk의 RMS(Root Mean Square)를 계산하여 전송하고, 서버가 RMS 기반으로 "음성 침묵"을 감지하여 commit.

```
말하는 중: RMS ≥ 0.01 → silenceSinceMs = null
말 멈춤:   RMS < 0.01 → silenceSinceMs 기록
1초 지속:  checkSilence()에서 감지 → commit()
           → OpenAI completed 이벤트 → final transcript
```

### 기술 결정

| 항목 | 값 | 이유 |
|------|-----|------|
| RMS 임계값 | 0.01 | 일반 음성 ~0.01~0.1, 무음 ~0.001 이하 |
| 침묵 지속 시간 | 1000ms | 문장 사이 자연스러운 쉼 감지용 |
| 감지 방식 | 서버 100ms 간격 polling | chunk마다 RMS를 받아 상태 추적, 주기적으로 침묵 지속 여부 확인 |
| RMS 계산 위치 | AudioWorklet (브라우저) | float32 버퍼를 이미 갖고 있어 추가 비용 최소 |

### 변경 파일

- `public/audio-chunk-worklet.js` — `rms` 계산 추가 (float32 버퍼에서 `sqrt(mean(samples^2))`)
- `src/lib/types/audio.ts` — `AudioChunkMessage`에 `rms` 필드 추가
- `src/server/openai/realtimeClient.ts` — `appendAudio(base64, rms)`, RMS 기반 silence detection + auto-commit
- `src/server/ws/server.ts` — `msg.rms` 전달
- `src/components/admin/AudioChunkTest.tsx` — `rms` 전송 + UI에 RMS Level 행 표시 (≥ 0.01이면 초록)

### 다음 단계

- [x] OpenAI API 키로 실제 전사 테스트 (한국어 음성 → final transcript 확인)
- [x] commit 임계값(RMS, 침묵 시간) 실측 기반 튜닝

---

## 2026-06-18 — OpenAI Realtime STT 연동 성공

### 완료

- OpenAI Realtime API GA 마이그레이션 (Beta API 지원 종료 대응)
- transcription 전용 세션 연결 성공
- RMS 기반 발화 감지 로직 개선 (무음 환각 방지)
- `.env` 파일 기반 API 키 관리 (`--env-file`)

### OpenAI Realtime API 마이그레이션 과정

Beta API가 2026-05-12에 제거되면서 연결 방식을 GA로 전환해야 했음. 에러를 하나씩 좁혀가며 정확한 조합을 찾음.

| 시도 | URL | 헤더 | 이벤트 | 결과 |
|------|-----|------|--------|------|
| 1 | `?model=gpt-realtime-whisper` | `OpenAI-Beta: realtime=v1` | `session.update` | `beta_api_shape_disabled` |
| 2 | `?model=gpt-realtime-whisper` | Authorization만 | `session.update` | `invalid_model` (transcription model은 session model로 사용 불가) |
| 3 | `?model=gpt-realtime` | Authorization만 | `session.update` (transcription payload) | `transcription session update to realtime session not allowed` |
| 4 | `/transcription_sessions` | Authorization만 | `transcription_session.update` | 403 (존재하지 않는 endpoint) |
| 5 | `?intent=transcription` | `OpenAI-Beta: realtime=v1` | `session.update` | `beta_api_shape_disabled` |
| 6 | `?intent=transcription` | Authorization만 | `transcription_session.update` | `invalid_value` (GA에서 지원 안 함) |
| 7 | `?intent=transcription` | Authorization만 | `session.update` (flat payload) | `missing_required_parameter: session.type` |
| 8 | `?intent=transcription` | Authorization만 | `session.update` (flat + type) | `unknown_parameter: session.input_audio_format` |
| **9 (성공)** | **`?intent=transcription`** | **Authorization만** | **`session.update` (nested + type)** | **성공** |

### 최종 확정된 연결 방식

```
URL: wss://api.openai.com/v1/realtime?intent=transcription
Header: Authorization: Bearer ${OPENAI_API_KEY}
OpenAI-Beta 헤더: 사용하지 않음 (GA API)
```

session.update payload:

```json
{
  "type": "session.update",
  "session": {
    "type": "transcription",
    "audio": {
      "input": {
        "format": { "type": "audio/pcm", "rate": 24000 },
        "transcription": { "model": "gpt-4o-transcribe", "language": "ko" },
        "turn_detection": null
      }
    }
  }
}
```

| 항목 | 값 | 비고 |
|------|-----|------|
| 세션 모델 | URL에 명시하지 않음 | `?intent=transcription`으로 세션 종류 지정 |
| 전사 모델 | `gpt-4o-transcribe` | `gpt-realtime-whisper`는 URL model 자리에만 쓸 수 없고, 전사 모델로는 `gpt-4o-transcribe` 사용 |
| 오디오 포맷 | `audio/pcm`, 24000Hz | nested 구조 (`audio.input.format`) |
| turn_detection | `null` | 수동 commit (RMS 기반 침묵 감지) |
| 이벤트 타입 | `session.update` / `session.updated` | `transcription_session.*`은 GA에서 지원하지 않음 |

### 수신 이벤트

| 이벤트 | 용도 |
|--------|------|
| `session.created` | 세션 생성 확인 |
| `session.updated` | 세션 설정 완료 확인, `sessionReady = true` |
| `conversation.item.input_audio_transcription.delta` | 중간 전사 조각 |
| `conversation.item.input_audio_transcription.completed` | 최종 전사 |
| `input_audio_buffer.committed` | commit 확인 |

### RMS 기반 발화 감지 개선

이전 문제: 무음 chunk도 OpenAI에 append → 1초 뒤 commit → 환각 transcript 발생 ("그렇습니다.", "호랑이는 뛰어났다." 등)

해결: `hasSpeechInBuffer` 플래그 추가

```
무음 chunk + 말한 적 없음 → OpenAI에 보내지 않음 (skip)
말소리 감지 (RMS ≥ 0.01) → hasSpeechInBuffer = true, append 시작
말 멈춤 → 침묵 추적 시작
침묵 1초 지속 + hasSpeechInBuffer → commit
commit 후 → hasUncommittedAudio, hasSpeechInBuffer, silenceSinceMs 초기화
```

| 항목 | 값 |
|------|-----|
| SILENCE_RMS_THRESHOLD | 0.01 |
| SILENCE_DURATION_MS | 1000ms |
| sessionReady guard | session.updated 수신 전에는 append/commit 차단 |

### 환경 변수 설정

`.env` 파일을 프로젝트 루트에 생성하고 API 키를 넣음. `.gitignore`에 `.env*`가 이미 포함되어 있어 커밋되지 않음.

```
OPENAI_API_KEY=sk-...
```

`package.json`의 `dev:ws` 스크립트를 `node --env-file=.env`로 변경하여 자동 로드.

### 전사 검증 결과

테스트 환경: 교회 PC, UMC202HD, Chrome, localhost

| 항목 | 결과 |
|------|------|
| OpenAI 연결 | `session.created` → `session.updated` 정상 |
| 무음 시 commit | 발생하지 않음 (hasSpeechInBuffer guard) |
| 발화 시 전사 | "안녕하세요. 오늘은 테스트입니다." 정확 전사 |
| 침묵 후 commit | 1014ms 후 자동 commit, final transcript 수신 |
| dropped chunks | 0 |

### 구현 파일

- `src/server/openai/realtimeClient.ts` — OpenAI Realtime WebSocket 클라이언트 (GA API, transcription session, RMS 발화 감지)
- `src/server/ws/server.ts` — audio chunk → OpenAI 전달 + 전사 이벤트 릴레이
- `src/lib/types/audio.ts` — 메시지 타입 정의
- `src/components/admin/AudioChunkTest.tsx` — Admin UI (오디오/WS/STT 상태 표시)
- `package.json` — `dev:ws` 스크립트 `--env-file=.env` 적용

### 다음 단계

- [x] GPT 번역 연동 (한국어 → en, zh-Hans, zh-Hant)
- [x] Viewer 페이지 (`/watch/[sessionCode]`) 자막 표시
- [x] Stop 안전 종료

---

## 2026-06-18 — 번역 파이프라인 + Viewer Broadcast + Stop 안전 종료

### 완료

- GPT 번역 파이프라인 구현 (Korean → en, zh-Hans, zh-Hant)
- Viewer broadcast 구현 (`/watch/[sessionCode]`)
- Stop 안전 종료 구현 (마지막 문장 유실 방지)
- Pre-roll buffer 추가 (첫 음절 잘림 방지)
- RMS threshold 조정 (노트북 내장 마이크 대응)

### 번역 파이프라인

Korean final transcript가 들어올 때마다 OpenAI Responses API로 3개 언어 번역을 생성.

| 항목 | 값 |
|------|-----|
| API | OpenAI Responses API (`/v1/responses`) |
| 모델 | `gpt-4.1-mini` |
| 출력 | Structured Outputs (JSON Schema, strict) |
| 번역 대상 | en, zhHans, zhHant |

번역 프롬프트: 교회 설교 자막 번역 전문가 역할, 성경 참조/이름/톤/의미 보존.

#### 번역 검증 결과

| 입력 | en | zhHans | zhHant |
|------|-----|--------|--------|
| "어, 마이크 테스트" | "Uh, microphone test" | "呃，麦克风测试" | "呃，麥克風測試" |
| "마이크 테스트입니다." | "This is a microphone test." | — | — |

### Viewer Broadcast

WebSocket 서버에서 admin/viewer client role을 구분하고, 번역 완료 시 같은 sessionCode의 viewer에게 선택한 언어의 자막만 broadcast.

#### Client Role 구분

| Role | 식별 방법 | 수신 메시지 |
|------|----------|------------|
| admin | 첫 `audio.chunk` 메시지의 sessionCode | STT delta/final, translation completed/error, chunk ack |
| viewer | `viewer.join` 메시지 (sessionCode + language) | `subtitle.final` (선택 언어의 번역 텍스트만) |

#### Viewer 메시지 타입

```json
{
  "type": "subtitle.final",
  "sourceText": "마이크 테스트입니다.",
  "language": "en",
  "text": "This is a microphone test.",
  "createdAt": 1750000000000
}
```

#### Viewer UI

- `/watch/[sessionCode]` 라우트
- 언어 선택: English / 简体中文 / 繁體中文
- 최신 자막 크게, 이전 자막 히스토리 작게
- 검은 배경 + 흰 자막
- `viewer.changeLanguage`로 실시간 언어 변경 지원

### Stop 안전 종료

이전 문제: Stop을 빨리 누르면 마지막 문장의 STT/번역이 완료되기 전에 WebSocket이 닫혀 유실됨.

해결: `audio.stop` → `flushAndClose` → 번역 완료 대기 → `audio.stop.ack` → close

```
Stop 클릭
→ 브라우저 오디오 캡처 즉시 중단
→ audio.stop 메시지 전송
→ 서버: 남은 audio buffer commit
→ OpenAI transcript_final 대기 (최대 2초)
→ pendingTranslations 완료 대기 (최대 3초)
→ translation.completed + viewer broadcast 완료
→ audio.stop.ack 전송
→ 클라이언트: WS close
```

#### 검증 결과 (안전 종료 로그)

```
[ws] admin requested safe stop
[openai] flushAndClose: committing remaining audio
[openai] transcript final: "마이크 테스트입니다."
[ws] waiting for 1 pending translation(s)
[translation] done: "마이크 테스트입니다." → en="This is a microphone test."
[ws] broadcast to 1 viewer(s) in session=TEST-001
[ws] safe stop complete, sent ack
[ws] admin disconnected
```

translation done → broadcast → safe stop ack → admin disconnected 순서 확인.

### Pre-roll Buffer

말 시작 직전의 무음 chunk를 보관하여 첫 음절 잘림 방지.

| 항목 | 값 |
|------|-----|
| PRE_ROLL_MS | 500ms |
| PRE_ROLL_CHUNKS | 5 (100ms × 5) |
| 동작 | 무음 중 최근 5개 chunk 보관 → speech 감지 시 flush 후 append |

### RMS Threshold 조정

노트북 내장 마이크 테스트에서 말할 때 RMS가 0.005 수준으로 낮아 threshold 하향 조정.

| 항목 | 이전 | 변경 | 비고 |
|------|------|------|------|
| SPEECH_RMS_THRESHOLD | 0.01 | 0.003 | 교회 UMC202HD에서는 재조정 필요 |
| SILENCE_RMS_THRESHOLD | 0.01 | 0.003 | 동일 |
| SILENCE_DURATION_MS | 1000 | 1500 | 설교 중간 쉼 대응 |

### 구현 파일

- `src/server/openai/translator.ts` — 신규: OpenAI Responses API 번역 (Structured Outputs)
- `src/server/ws/server.ts` — admin/viewer role 분리, viewer broadcast, audio.stop 안전 종료, pendingTranslations
- `src/server/openai/realtimeClient.ts` — `flushAndClose()` 추가, pre-roll buffer, RMS threshold 조정
- `src/lib/types/audio.ts` — `TranslationCompleted`, `TranslationError`, `ViewerJoin`, `ViewerChangeLanguage`, `SubtitleFinal`, `AudioStop`, `AudioStopAck` 타입 추가
- `src/components/admin/AudioChunkTest.tsx` — Transcript & Translation 카드 UI, Stop 안전 종료 (audio.stop → ack 대기)
- `src/components/viewer/SubtitleViewer.tsx` — 신규: viewer 자막 화면
- `src/app/watch/[sessionCode]/page.tsx` — 신규: viewer 라우트

### 다음 단계

- [x] viewer UI를 실제 예배 자막 화면으로 개선
- [x] admin UI를 운영자 콘솔로 정리
- [x] sessionCode/QR 안내 추가

---

## 2026-06-18 — Viewer UI 개선 + QR 안내 + Admin 콘솔화

### 완료

- Viewer UI를 실제 예배 자막 화면으로 개선
- Admin에 세션 QR 코드 + 접속 URL 안내 추가
- Admin UI를 운영자 콘솔 형태로 재구성
- Hydration mismatch 수정

### Viewer UI 개선

`/watch/[sessionCode]` 페이지를 실제 교회 예배에서 사용할 수 있는 자막 화면으로 개선.

| 항목 | 이전 | 변경 |
|------|------|------|
| 최신 자막 크기 | `text-3xl` 고정 | `text-2xl` → `text-5xl` 반응형 |
| 히스토리 | 전체 표시 | 최대 4개, 점진적 fade (`zinc-500` → `zinc-700`) |
| 레이아웃 | `min-h-screen` | `min-h-dvh` (모바일 주소바 대응) |
| 여백 | `p-6` 고정 | `px-5 pb-10` → `px-24` 반응형 |
| 헤더 | border + 큰 텍스트 | 최소화: 상태 점 + sessionCode 작게, 언어 버튼 `rounded-full` |
| 대기 메시지 | 밝은 텍스트 | 어두운 톤 (`zinc-700`/`zinc-800`) |

### QR 코드 + 접속 URL 안내

Admin 페이지 상단에 세션 안내 카드 추가.

- QR 코드: `qrcode.react` (`QRCodeSVG`) — `/watch/TEST-001` URL 인코딩
- Session Code: `TEST-001` 표시
- Viewer URL: `http://localhost:3000/watch/TEST-001` 표시
- Copy URL 버튼 (clipboard 복사 + "Copied!" 피드백)
- 안내 문구: "외국인 성도/방문자는 QR 코드를 스캔해 자막 페이지에 접속할 수 있습니다."

#### Hydration mismatch 수정

초기 구현에서 `typeof window !== 'undefined'`로 렌더 중에 URL을 분기하여 hydration mismatch 발생.

```
서버: /watch/TEST-001
클라이언트: http://localhost:3000/watch/TEST-001
→ QRCodeSVG + 텍스트가 달라져서 hydration error
```

수정: `useState` 초기값을 상대 경로로 두고, `useEffect`에서 `window.location.origin` 포함 URL로 업데이트.

### Admin UI 콘솔화

`/admin` 페이지를 개발 테스트 화면에서 운영자 콘솔로 재구성.

| 섹션 | 이전 | 변경 |
|------|------|------|
| 제목 | "Audio Chunk Test" | "Live Translation Admin" + 부제 |
| 세션 | — | Session 카드 (QR + URL + Copy) |
| 컨트롤 | 버튼 + 텍스트 | Controls 카드: Start/Stop + Badge + RMS 바 + Viewers placeholder |
| 상태 표시 | 텍스트 (`WS Off`) | Badge 컴포넌트 (점 + 라벨, 색상 구분) |
| RMS | 숫자만 | 시각적 바 + 숫자 (speech threshold 이상이면 초록) |
| 전사/번역 | 그대로 | Transcript & Translation 카드 |
| 개발 통계 | Client + Server 2개 섹션 | Developer Diagnostics (접기/펼치기, 기본 닫힘) |

#### 새 UI 컴포넌트

- `Badge`: 상태 표시 (Running/Stopped, WS, STT) — 점 + 라벨, active 시 초록
- RMS 레벨 바: 실시간 시각화, `currentRms * 500`% 너비, speech threshold 이상이면 초록
- Developer Diagnostics 토글: 개발 통계를 숨길 수 있음 (운영 시 불필요)
- Viewers: — (placeholder, 서버 연동은 다음 단계)

### 변경 파일

- `src/components/viewer/SubtitleViewer.tsx` — 자막 크기 반응형, 히스토리 fade, `min-h-dvh`, 헤더 최소화
- `src/components/admin/AudioChunkTest.tsx` — 콘솔 레이아웃, QR 카드, Badge, RMS 바, Diagnostics 접기, hydration 수정
- `src/app/watch/[sessionCode]/page.tsx` — 변경 없음

### 다음 단계

- [x] 실제 설교 음성으로 E2E 테스트
- [x] gpt-realtime-translate 전환

---

## 2026-07-26 — gpt-realtime-translate 전환 + E2E 테스트

### 문제

유튜브 설교 영상으로 테스트 시, 연속 발화에서 RMS 기반 침묵 감지가 commit을 발생시키지 못해 transcript가 생성되지 않는 치명적 문제 발견.

```
설교자가 쉬지 않고 말함 → RMS가 0.003 이하로 1.5초 안 내려감
→ commit 안 됨 → transcript 없음 → 번역 없음 → 자막 없음
```

### 해결: gpt-realtime-translate 전환

리서치 결과, OpenAI가 2026-05-07에 출시한 `gpt-realtime-translate` 모델이 이 문제를 근본적으로 해결:

- STT + 번역을 하나의 API가 처리 (일체형)
- 세그멘테이션을 모델이 자동으로 처리 → 수동 commit 불필요
- 스트리밍 delta 출력 → 실시간 자막

| 항목 | 이전 (v1) | 전환 후 (v2) |
|------|-----------|-------------|
| STT | gpt-4o-transcribe + RMS 침묵감지 + 수동 commit | gpt-realtime-whisper (내장, 자동) |
| 번역 | gpt-4.1-mini Responses API 별도 호출 | gpt-realtime-translate 내장 |
| 세그멘테이션 | RMS + 1.5초 침묵 → commit | 모델 자동 |
| 엔드포인트 | `wss://.../realtime?intent=transcription` | `wss://.../realtime/translations?model=gpt-realtime-translate` |
| 가격 | STT + 번역 각각 | $0.034/분 (세션당) |

### 코드 변경

| 파일 | 변경 |
|------|------|
| `src/server/openai/translateClient.ts` | **신규** — gpt-realtime-translate WebSocket 클라이언트 |
| `src/server/openai/realtimeClient.ts` | **삭제** — RMS/commit 로직 제거 |
| `src/server/openai/translator.ts` | **삭제** — 별도 번역 불필요 |
| `src/server/ws/server.ts` | **재작성** — translate 세션 관리, delta broadcast |
| `src/lib/types/audio.ts` | **재작성** — 스트리밍 delta 타입, ViewerLanguage를 en/zh로 단순화 |
| `src/components/admin/AudioChunkTest.tsx` | **재작성** — 실시간 스트리밍 표시, 레이턴시 측정 |
| `src/components/viewer/SubtitleViewer.tsx` | **재작성** — delta 누적 표시 |
| `docs/ARCHITECTURE.md` | **재작성** — 새 파이프라인 문서화 |

### API 이벤트 확정 (실제 테스트로 검증)

| 용도 | 이벤트 |
|------|--------|
| 오디오 전송 | `session.input_audio_buffer.append` |
| 번역 수신 | `session.output_transcript.delta` |
| 원본 전사 수신 | `session.input_transcript.delta` |
| 세션 설정 | `session.update` |
| 종료 | `session.close` |

※ `input_audio_buffer.append` (session prefix 없음)은 거부됨 → `session.input_audio_buffer.append` 사용

### 세션 설정 (지원 파라미터 전수 조사 완료)

```json
{
  "type": "session.update",
  "session": {
    "audio": {
      "input": {
        "transcription": { "model": "gpt-realtime-whisper" },
        "noise_reduction": { "type": "near_field" }
      },
      "output": { "language": "en" }
    }
  }
}
```

**미지원 확인된 파라미터** (Unknown parameter 에러):
- `transcription.language` — translate 세션에서 미지원 (자동 감지)
- `transcription.delay` — translate 세션에서 미지원
- `instructions` — translate 세션에서 미지원

### E2E 테스트 결과 (유튜브 설교)

테스트 환경: VB-Audio Virtual Cable, 유튜브 설교 영상

| 항목 | 결과 |
|------|------|
| 연결 | EN/ZH 세션 동시 연결 성공 |
| 레이턴시 (스트리밍) | EN 49ms, ZH 42ms |
| 한국어 전사 | 대체로 정확. 일부 오류: "거룩하신"→"걸어가신", "열왕기하"→"열한기하" |
| 영어 번역 | 자연스럽고 대체로 정확. "거룩하신"→"risen" 오역 (holy가 맞음) |
| 중국어 번역 | 출력 확인. "奉复活主耶稣基督的名" (동일 오역) |
| 열왕기하 번역 | "2 Kings" 정확 (STT 오류에도 번역이 보정) |
| 연속 발화 | 문제 없음 — 모델이 자동으로 세그멘테이션 |

### 번역 품질 이슈

`gpt-realtime-translate`는 instructions/용어집/delay 파라미터를 지원하지 않아 번역 품질 튜닝 불가.

알려진 오역:
- "거룩하신 주 예수 그리스도" → "the risen Lord Jesus Christ" (risen ≠ holy)

### 비용

| 구성 | 분당 | 시간당 |
|------|------|--------|
| EN 1세션 | $0.034 | $2.04 |
| EN+ZH 2세션 | $0.068 | $4.08 |

### 다음 단계

- [ ] 세션 관리 (자동 sessionCode 생성) — TEST-001 하드코딩 제거
- [ ] PostgreSQL 비동기 저장
- [ ] (추후) 관리자 교정 기능: Admin이 한국어 전사 오류 수정 → 재번역 → viewer에 교정본 push + 색깔 표시