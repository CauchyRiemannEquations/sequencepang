# 수열팡 (Sequence Pang)
https://sequencepang.onrender.com

6×6 보드의 숫자를 드래그해 등차수열·등비수열을 만드는 실시간 수학 퍼즐 게임입니다. Vite 기반 Vanilla JavaScript 클라이언트와 Express + Socket.IO 서버를 사용합니다.

## 주요 기능

- 1~9 숫자 타일과 30초 타임어택
- 3개 이상의 등차수열·등비수열 판정
- 콤보, 시간 보너스, 최고 점수
- 피버 블록과 10초 피버모드
- Socket.IO 기반 멀티 대기방과 실시간 순위
- Cloud Firestore 기반 전체 랭킹 TOP 10
- 보스레이드 코드는 유지하되 `ENABLE_BOSS_RAID = false`로 비활성화

## 프로젝트 구조

```text
client/
  public/
  src/
    gameConstants.js
    gameEngine.js
    main.js
    scoreClient.js
    socketClient.js
    style.css
    style.lovable.css
    ui.js
server/
  constants.js
  firestore.js
  roomStore.js
  scoreRoutes.js
  server.js
  socketHandlers.js
package.json
vite.config.js
```

## 로컬 실행

```powershell
npm.cmd install
npm.cmd run dev:server
npm.cmd run dev:client
```

- Node 서버: `http://localhost:3000`
- Vite 개발 서버: `http://localhost:5173`
- Vite는 `/api`와 `/socket.io` 요청을 Node 서버로 전달합니다.

## Firestore 랭킹 설정

1. [Firebase Console](https://console.firebase.google.com/)에서 프로젝트를 생성합니다.
2. **빌드 → Firestore Database → 데이터베이스 만들기**에서 Cloud Firestore를 활성화합니다.
3. **프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성**에서 서비스 계정 JSON 파일을 받습니다.
4. 키 파일은 저장소에 넣거나 GitHub에 올리지 않습니다.
5. 로컬 PowerShell에서는 서버 실행 전에 다음처럼 환경변수로 넣습니다.

```powershell
$env:FIREBASE_SERVICE_ACCOUNT_JSON = Get-Content 'C:\안전한-경로\serviceAccountKey.json' -Raw
npm.cmd run dev:server
```

`scores` 컬렉션은 첫 점수 등록 시 자동 생성됩니다. 저장 필드는 다음과 같습니다.

```text
nickname, score, maxCombo, mode, rankingSeason, createdAt, version
```

브라우저는 Firestore에 직접 접근하지 않습니다. 서버의 Firebase Admin SDK만 접근하므로 Firestore 보안 규칙은 클라이언트 접근을 막아도 됩니다.

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

## 점수 API

- `POST /api/scores`: 타임어택 종료 점수 저장
- `GET /api/leaderboard`: 점수 내림차순 TOP 10 조회

서버는 닉네임 1~10자, 0 이상의 안전한 정수 점수, 최대 콤보, 허용 모드를 검사합니다. 높은 점수 자체에는 별도 상한을 두지 않습니다. `createdAt`은 클라이언트 값을 사용하지 않고 Firestore 서버 타임스탬프로 기록합니다.

## 랭킹 시즌

기존 랭킹 기록은 삭제하지 않고 Firestore에 보존합니다. `2026-07-06 00:00 (Asia/Seoul)`부터 `rankingSeason: "2026-07-06"`인 새 점수만 전체 랭킹에 표시됩니다. 전환 시각과 시즌 이름은 `server/constants.js`의 `RANKING_RESET_AT_MS`, `RANKING_SEASON_ID`에서 관리합니다.

## Render 설정

현재 구성은 Render Web Service 하나가 프론트 빌드 결과와 API, Socket.IO를 함께 제공합니다.

- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Environment Variable:
  - Key: `FIREBASE_SERVICE_ACCOUNT_JSON`
  - Value: 서비스 계정 JSON 전체 내용

Render Dashboard에서 **sequencepang → Environment → Add Environment Variable**로 키를 추가한 뒤 저장하면 재배포가 시작됩니다. JSON을 한 줄로 붙여넣고 싶다면 로컬 PowerShell에서 다음 명령의 출력값을 사용합니다.

```powershell
Get-Content 'C:\안전한-경로\serviceAccountKey.json' -Raw | ConvertFrom-Json | ConvertTo-Json -Compress
```

환경변수가 없거나 잘못된 경우 게임 자체는 실행되지만 랭킹 API는 `503`을 반환합니다.

## 프로덕션 빌드

```powershell
npm.cmd run build
npm.cmd start
```

`server/server.js`가 `client/dist`를 정적 파일로 제공하고 SPA fallback을 처리합니다.
