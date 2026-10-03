# 시퀀스팡(Sequence Pang)

시퀀스팡(구 수열팡)은 6x6 숫자 보드에서 인접한 타일을 드래그해 3개 이상의 등차수열 또는 등비수열을 만들며 점수를 얻는 실시간 수학 퍼즐 게임입니다.

- 숫자 범위: `1~9`
- STAR TIME: 별 숫자를 포함한 유효 수열 5회 성공 시 8초간 점수 ×2·콤보 만료 보류. 추가 별은 +1초, 최대 남은 시간 15초. [밸런스 및 검증 기록](docs/star-time.md)
- 기본 제한 시간: `30초`
- 4개 이상 긴 수열 성공 시 피버 블록 등장 (기본 8초, 점수 ×1.5)
- 피버 종류: `+2`, `+3`, `×2`
- 5개 이상 긴 수열 성공 시 슈퍼피버 블록 등장 (기본 10초, 점수 ×2)
- 슈퍼피버 종류: `×3`(보드 3배 변신), `빅넘버`(새 타일이 10~19로 등장, 종료 시 원상복구)
- 크로스팡/풀보드팡: `6연쇄`는 마지막 타일의 행+열 추가 제거, `7연쇄+`는 보드 전체 재생성 (추가 1칸당 +40점, 시간 보너스)
- 라스트팡: 남은 시간이 처음 `5초` 아래로 내려가면 발동, 이후 게임 종료까지 모든 점수 ×2 유지 (피버 배율과 중첩)
- 하이퍼팡: 한 판 `1,000,000점` 돌파 시 보드가 새로 생성되고 숫자 범위가 `1~12`로 확장 (+5초, 황금 테마)
- 어제의 1등 도전: 메인 화면에 어제 일간 1등 기록 표시, 게임 중 돌파 시 연출
- 오늘 내 순위: 점수 등록 후 오늘 순위와 TOP 30까지 남은 점수 안내
- 공개 랭킹: `오늘 랭킹`, `주간 랭킹`
- 멀티플레이: Firebase RTDB 기반 실시간 방/순위표 지원

운영 프론트: https://sequencepang.vercel.app

## Firebase 백엔드

- Vercel: 기존 Vite 프론트.
- Cloud Functions v2 `api`: 기존 Express 점수/랭킹 API와 인증된 방 제어 API.
- 기존 Firestore: `scores`, `suspicious_scores`를 그대로 사용. 점수 공식·시즌·문서 필드 유지.
- Firestore `game_sessions`: token hash, Auth UID, 시작/만료 시각, 1회 소비 transaction.
- Realtime Database: 서버가 관리하는 방/참가자/방장/라운드와 본인 점수/presence.
- Anonymous Auth: 사용자별 RTDB 쓰기 권한과 API 인증.
- Presence trigger: 방장 위임. Scheduled cleanup: 연결 유예 후 빈 방/단기 문서 정리.

전체 기능 대응표, 보안 규칙 설명, 환경변수, 배포·롤백 절차와 운영 상태는
[Firebase 이전 문서](docs/firebase-migration.md)에 있습니다.

## 설치와 로컬 개발

```sh
npm ci
npm ci --prefix functions
npm run emulators
```

별도 터미널에서 `client/.env.local`에 `VITE_USE_FIREBASE_EMULATORS=true`를 넣고:

```sh
npm run dev:client
```

- 프론트: http://localhost:5173
- Emulator UI: http://127.0.0.1:4000
- 로컬 프로젝트 `demo-sequencepang`은 Emulator용 가상 ID이며 새 Firebase 프로젝트를 생성하지 않습니다.
- Emulator의 Functions 리전은 `us-central1`입니다. 운영 리전/RTDB URL은 기존 프로젝트에서 확인합니다.
- Java 17+ 및 Node 22+가 필요합니다. Firebase CLI 14.27.0을 고정했으며 차후 CLI 15로 올릴 때 Java 21+도 준비합니다.

## 검증

```sh
npm test
npm run test:backend
npm run test:emulators
npx playwright install chromium
npm run test:browser
npm run build
```

브라우저 테스트는 격리된 Emulator에서 실제 싱글 플레이/점수 제출과 브라우저 두 개의 방 입장,
동시 시작, 점수 동기화, 네트워크 재접속, 방장 위임, 빈 방 정리를 확인합니다.
기존 UI·계산 로직을 수정하지 않고 모바일 390×844 화면도 검사합니다.

제한된 실행 환경에서 Unix socket을 사용할 수 없는 경우에만
`SEQUENCEPANG_EMULATOR_TCP=true`를 사용합니다. 테스트 전용 loopback adapter이며 운영 코드에는 영향을 주지 않습니다.

## 운영 배포

새 프로젝트를 만들지 마세요. 기존 Firestore가 있는 프로젝트의 ID와 Web Config를 확인하고
`client/.env.example`, `functions/.env.example`에 따라 설정합니다.
`.firebaserc`는 프로젝트 ID 확인 전까지 의도적으로 빈 상태입니다.

```sh
npx firebase login
npm run deploy:firebase -- <기존-project-id>
```

이 명령은 Functions/규칙/인덱스를 배포합니다. 기존 프로젝트의 다른 앱이 규칙/인덱스를 공유한다면
먼저 현재 설정과 병합한 뒤 실행하세요. 랭킹 데이터 복사·삭제·초기화는 필요 없습니다.
Vercel preview 및 production 검증을 모두 통과하기 전까지 기존 운영 백엔드를 삭제하지 마세요.

## 점수 API

모든 `/api` 요청은 `Authorization: Bearer <Firebase ID token>`이 필요합니다.

| Method | Path | 기능 |
|---|---|---|
| POST | /api/game-session | 인증된 세션 발급 |
| POST | /api/scores | 검증 및 1회성 점수 저장/오늘 내 순위 |
| GET | /api/leaderboard?period=daily\|weekly\|season | 호환 랭킹 |
| GET | /api/yesterday-top | 어제 1등 |
| POST | /api/rooms/join | 원자적 방 생성/입장 |
| POST | /api/rooms/start | 방장만 새 라운드 시작 |
| POST | /api/rooms/leave | 퇴장/방장 위임/빈 방 삭제 |

공개 랭킹은 오늘/주간 TOP 30이며 KST 자정·월요일 경계를 유지합니다.
이전 playerId가 있는 기록은 playerId로 먼저 중복 제거하고 닉네임으로 다시 중복 제거합니다.
옛 필드 없는 기록도 기존 보충 조회로 계속 표시합니다.
멀티플레이 점수는 공개 Firestore 랭킹에 저장하지 않습니다.
