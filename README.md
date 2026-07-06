# 수열팡 (Sequence Pang)

수열팡은 6x6 숫자 보드에서 인접한 타일을 드래그해 3개 이상의 등차수열 또는 등비수열을 만들고 점수를 얻는 실시간 수학 퍼즐 게임입니다.

- 숫자 범위: `1~9`
- 기본 제한 시간: `30초`
- 4개 이상 긴 수열 성공 시 피버 블록 등장
- 피버 종류: `+2`, `+3`, `×2`
- 전체 랭킹: 싱글 `timeAttack` 모드만 저장
- 멀티플레이: Socket.IO 기반 실시간 방/순위표 지원

기존 주소:
- [https://sequencepang.onrender.com](https://sequencepang.onrender.com)

## 프로젝트 구조

```text
client/
  public/
    apple-touch-icon.png
    icon-192.png
    icon-512.png
    manifest.webmanifest
    maskable-icon-512.png
    melon.png
    raid-boss-melon-king.png
    service-worker.js
    update-notes.md
  src/
    gameConstants.js
    gameEngine.js
    main.js
    menuBgm.js
    rankingHome.css
    rankingHome.js
    rankingResetNotice.css
    rankingResetNotice.js
    scoreClient.js
    sfxManager.js
    socketClient.js
    style.css
    style.lovable.css
    ui.js
    updateNotes.css
    updateNotes.js
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

## 로컬 개발

설치:

```powershell
npm.cmd install
```

개발 서버:

```powershell
npm.cmd run dev:server
npm.cmd run dev:client
```

- API/Socket 서버: `http://localhost:3000`
- Vite 개발 서버: `http://localhost:5173`
- 로컬에서는 `VITE_API_BASE_URL`, `VITE_SOCKET_URL` 없이도 기존처럼 동작합니다.

## 빌드

```powershell
npm.cmd run build
npm.cmd start
```

기본값에서는 `server/server.js`가 `client/dist`를 정적 서빙합니다.  
즉, `FRONTEND_REDIRECT_URL`을 넣지 않으면 이전 Render 단일 서버 구조로 그대로 동작합니다.

## 배포 구조

### 1. 정적 프론트

권장: Vercel

- Framework Preset: `Vite`
- Root Directory: 저장소 루트
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `client/dist`

루트의 `vercel.json`은 SPA 새로고침과 직접 경로 진입 시 항상 `index.html`로 진입하도록 설정합니다.

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

Vercel 환경변수:

```text
VITE_API_BASE_URL=https://sequencepang.onrender.com
VITE_SOCKET_URL=https://sequencepang.onrender.com
```

설명:

- `VITE_API_BASE_URL`은 `/api/scores`, `/api/game-session`, `/api/leaderboard` 요청의 기준 주소입니다.
- `VITE_SOCKET_URL`은 Socket.IO 연결과 `/socket.io/socket.io.js` 로딩 기준 주소입니다.
- 두 값이 비어 있으면 같은 도메인 기준 상대경로를 사용합니다.
- 두 값 모두 끝 슬래시를 자동 정리해서 중복 슬래시를 피합니다.

### 2. Render API 서버

기존 Render Web Service는 유지합니다.  
이 서버는 이제 실질적으로 다음만 담당합니다.

- `/api/*`
- `/socket.io/*`

환경변수:

```text
FIREBASE_SERVICE_ACCOUNT_JSON=기존 값 유지
FRONTEND_REDIRECT_URL=https://새로운-vercel-주소.vercel.app
FRONTEND_ORIGIN=https://새로운-vercel-주소.vercel.app
```

설명:

- `FRONTEND_REDIRECT_URL`이 있으면 Render는 일반 페이지 요청을 새 프론트 주소로 `302` 리다이렉트합니다.
- `/api/*`와 Socket.IO 연결은 리다이렉트하지 않습니다.
- `FRONTEND_ORIGIN`은 새 프론트 도메인의 CORS 허용용입니다.
- 개발 편의를 위해 `localhost:3000`, `localhost:5173`, `127.0.0.1` 계열은 함께 허용합니다.
- 나중에 더 엄격하게 운영하고 싶으면 `FRONTEND_ORIGIN`만 필요한 도메인으로 제한하면 됩니다.

여러 프론트 도메인을 허용하고 싶으면 `FRONTEND_ORIGIN`에 쉼표로 나눠 넣으면 됩니다.

```text
FRONTEND_ORIGIN=https://sequencepang.vercel.app,https://preview-sequencepang.vercel.app
```

## 서비스워커 캐시

서비스워커는 새 버전 캐시 이름을 사용하며, 내비게이션 요청은 네트워크 우선으로 처리합니다.

- `CACHE_NAME`을 올려 구버전 캐시를 교체합니다.
- `/` 또는 `index.html`을 코어 캐시에 고정하지 않습니다.
- 새 프론트 배포 후 구버전 HTML이 오래 남는 현상을 줄입니다.

## Firestore 설정

브라우저는 Firestore에 직접 접근하지 않습니다.  
서버의 Firebase Admin SDK만 점수 저장과 랭킹 조회를 수행합니다.

1. Firebase Console에서 프로젝트 생성
2. Cloud Firestore 활성화
3. 서비스 계정 키(JSON) 발급
4. Render 환경변수 `FIREBASE_SERVICE_ACCOUNT_JSON`에 JSON 전체를 저장

로컬 개발 예시:

```powershell
$env:FIREBASE_SERVICE_ACCOUNT_JSON = Get-Content 'C:\path\to\serviceAccountKey.json' -Raw
npm.cmd run dev:server
```

권장 Firestore 보안 규칙:

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

## API

- `POST /api/game-session`
- `POST /api/scores`
- `GET /api/leaderboard`

점수 저장 정책:

- 전체 랭킹은 싱글 `timeAttack` 모드만 저장
- 멀티 점수는 방 안 실시간 순위표에만 반영
- 서버가 게임 세션을 발급하고 제출 시 세션 유효성을 검증
- 랭킹은 현재 시즌 기준 `TOP 30` 반환

## 운영 메모

- `https://sequencepang.onrender.com`은 학생들에게 공유된 기존 링크이므로 유지합니다.
- 새 정적 프론트를 연결한 뒤에는 Render가 해당 링크 방문자를 새 프론트로 자연스럽게 넘겨줍니다.
- API 주소는 계속 Render를 사용하므로 기존 Firestore 데이터 구조는 그대로 유지됩니다.

## 배포 확인

- `https://sequencepang.onrender.com` 접속 시 Vercel 주소로 이동해야 합니다.
- `https://sequencepang.onrender.com/api/leaderboard`는 redirect되지 않고 JSON을 반환해야 합니다.
- Vercel 주소에서 게임 실행, 점수 저장, 랭킹 조회가 되어야 합니다.
- 멀티플레이 버튼을 눌렀을 때 Socket.IO 연결 오류가 없어야 합니다.
