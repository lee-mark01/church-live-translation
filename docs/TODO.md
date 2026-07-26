# TODO

## 진행 예정

### TTS 음성 출력 (탈부착식)

관리자가 ON/OFF 선택 가능한 실시간 음성 번역 출력 기능.

**개요:**
- OFF (기본): 텍스트 자막만, $4/hr
- ON: 텍스트 + 음성 스트리밍, $16/hr (2개 언어 기준)

**구현 계획:**

1. **관리자 UI** (`AudioChunkTest.tsx`)
   - Start 버튼 옆에 "음성 출력" 토글 스위치 추가
   - 토글 상태를 첫 `audio.chunk` 또는 별도 메시지로 서버에 전달
   - ON 상태일 때 비용 경고 표시 ("음성 출력 활성화 시 추가 비용 ~$12/hr")

2. **메시지 타입** (`audio.ts`)
   ```typescript
   // 관리자 → 서버: 세션 설정
   interface SessionConfig {
     type: 'session.config';
     audioOutput: boolean; // TTS on/off
   }

   // 서버 → 뷰어: 세션 정보 (음성 가능 여부 알림)
   interface SessionInfo {
     type: 'session.info';
     audioAvailable: boolean;
   }

   // 서버 → 뷰어: 음성 데이터
   interface AudioDelta {
     type: 'audio.output.delta';
     audio: string; // base64 PCM16 24kHz
   }
   ```

3. **TranslateClient** (`translateClient.ts`)
   - 생성자에 `audioOutput: boolean` 파라미터 추가
   - `session.update`에서 modalities 설정:
     - `audioOutput: false` → `modalities: ["text"]`
     - `audioOutput: true` → `modalities: ["text", "audio"]`
   - 음성 ON일 때 `response.audio.delta` 이벤트 → `audio_delta` emit

4. **WS 서버** (`server.ts`)
   - `session.config` 수신 시 `audioOutput` 플래그 저장
   - `startTranslateSession(lang, audioOutput)` 호출
   - 음성 delta 수신 → 해당 언어 뷰어에게 `audio.output.delta` 브로드캐스트
   - `session.info` 메시지로 뷰어에게 음성 가능 여부 알림

5. **뷰어 UI** (`SubtitleViewer.tsx`)
   - `session.info`로 `audioAvailable` 수신
   - `audioAvailable`이면 헤드폰 아이콘 버튼 표시
   - 버튼 터치 → Web Audio API로 PCM16 스트림 재생 시작/중지
   - 재생 중이면 아이콘 활성 상태 표시

6. **대역폭 최적화** (후순위)
   - PCM16 24kHz = 384kbps/인
   - 필요시 서버에서 Opus 인코딩 (32-64kbps/인)

**참고:**
- gpt-realtime-translate 음성 출력: $0.20/min/session
- 2개 언어 × 60분 = $24/hr (음성 추가분만)
- 뷰어 측 이어폰 필수 → 안내 메시지 필요

---

## 미해결 (Known Issues)

### 토스트 스크롤 이동 미작동
- 뷰어에서 수정 토스트 터치 시 해당 문장으로 스크롤 이동 안 됨
- `scrollToSentence`의 `getBoundingClientRect` 계산 확인 필요
- flex spacer + overflow-y-auto 컨테이너 내 스크롤 계산 이슈 추정

### 관리자 수정 기능 개선
- 현재 문장 경계 감지가 마침표(`.!?`) 기반 → API가 마침표 없이 문장을 끝내면 감지 실패
- 번역 문장과 한국어 문장의 순서 매칭이 항상 1:1 보장 안 될 수 있음

---

## 완료

- [x] gpt-realtime-translate 파이프라인 전환
- [x] 뷰어 전체 리디자인 (문장 분리, wake lock, 폰트 조절, 자동 숨김)
- [x] 언어 설정 1파일 관리 (languages.ts)
- [x] 언어 전환 시 히스토리 유지
- [x] 세션 로거 (logs/{sessionCode}.json)
- [x] 관리자 문장 수정 → 재번역 → 뷰어 반영
- [x] 수정 시 뷰어 토스트 알림 + 노란색 하이라이트
- [x] start.bat 원클릭 실행
- [x] hydration mismatch 수정
- [x] sessionCode dependency 수정 (뷰어 자막 전달)
