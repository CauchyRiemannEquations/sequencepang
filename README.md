# 수열팡(Sequence Pang)

수열팡은 6x6 숫자 보드에서 인접한 타일을 드래그해 3개 이상의 등차수열 또는 등비수열을 만들며 점수를 얻는 실시간 수학 퍼즐 게임입니다.

- 숫자 범위: `1~9`
- 기본 제한 시간: `30초`
- 4개 이상 긴 수열 성공 시 피버 블록 등장 (기본 8초, 점수 ×1.5)
- 피버 종류: `+2`, `+3`, `×2`
- 5개 이상 긴 수열 성공 시 슈퍼피버 블록 등장 (기본 10초, 점수 ×2)
- 슈퍼피버 종류: `×3`, `+10`
- 라스트팡: 남은 시간 `5초` 이하일 때 모든 점수 ×2 (피버 배율과 중첩)
- 공개 랭킹: `오늘 랭킹`, `주간 랭킹`
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
즉 `FRONTEND_REDIRECT_URL`이 비어 있으면 이전 Render 단일 서버 구조로 그대로 동작합니다.

## 배포 구조

### 1. 정적 프론트
권장: Vercel

- Framework Preset: `Vite`
- Root Directory: 저장소 루트
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `client/dist`

루트의 `vercel.json`은 SPA 새로고침과 직접 경로 진입 모두 `index.html`로 진입하도록 설정합니다.

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
- 값이 비어 있으면 같은 도메인 기준 상대경로를 사용합니다.
- 두 값 모두 뒤의 슬래시는 자동 정리되어 중복 슬래시를 피합니다.

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
- `FRONTEND_ORIGIN`은 새 프론트 도메인의 CORS 허용값입니다.
- 개발 편의를 위해 `localhost:3000`, `localhost:5173`, `127.0.0.1` 계열은 함께 허용합니다.
- 운영에서 더 엄격하게 묶고 싶으면 `FRONTEND_ORIGIN`만 필요한 도메인으로 제한하면 됩니다.

여러 프론트 도메인을 허용하고 싶으면 `FRONTEND_ORIGIN`에 쉼표로 나눠 넣으면 됩니다.

```text
FRONTEND_ORIGIN=https://sequencepang.vercel.app,https://preview-sequencepang.vercel.app
```

## 서비스워커 캐시

서비스워커는 새 버전 캐시 이름을 사용하고, 네비게이션 요청은 네트워크 우선으로 처리합니다.

- `CACHE_NAME`을 올려 구버전 캐시를 교체합니다.
- `/` 또는 `index.html`을 코어 캐시에 고정하지 않습니다.
- 새 프론트 배포 후 구버전 HTML이 오래 남지 않게 합니다.

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

점수 저장/조회 정책:

- 전체 랭킹은 싱글 `timeAttack` 모드만 대상입니다.
- 멀티 점수는 방 안 실시간 순위표에만 반영됩니다.
- 서버가 게임 세션을 발급하고 제출 전 세션 유효성을 검증합니다.
- 공개 UI는 오늘 랭킹과 주간 랭킹만 제공합니다.
- 시즌 필드는 내부 호환성을 위해 유지하지만 공개 UI에서는 시즌 랭킹을 숨깁니다.

## 공개 랭킹 정책

- 기본 공개 랭킹은 오늘 랭킹 TOP 30입니다.
- 오늘 랭킹은 매일 `00:00 KST` 기준으로 자동 전환됩니다.
- 주간 랭킹은 매주 월요일 `00:00 KST` 기준으로 자동 전환됩니다.
- 점수 데이터와 `rankingSeason` 필드는 삭제하지 않습니다.
- 같은 플레이어는 랭킹에 한 번만 표시됩니다.
- `playerId`가 있으면 `playerId` 기준으로, 없으면 닉네임 기준으로 최고 점수 1개만 남깁니다.
- 일간/주간 랭킹은 기능 배포 이후 저장된 점수부터 가장 정확하게 반영됩니다.

## Firestore 읽기 최적화

- `daily` 조회는 현재 시즌 + 오늘 날짜 + `timeAttack` 문서만 읽습니다.
- `weekly` 조회는 현재 시즌 + 현재 주차 + `timeAttack` 문서만 읽습니다.
- `season` API는 호환성을 위해 남겨두되, 읽기 수를 제한합니다.
- 랭킹 응답은 `period + 날짜/주차 + 시즌` 조합 기준으로 `30초` 캐시됩니다.
- 점수 저장이 성공하면 랭킹 캐시는 즉시 비웁니다.

필요할 수 있는 Firestore 복합 인덱스 예시:

```text
scores: rankingSeason ASC, rankingDay ASC, mode ASC, score DESC
scores: rankingSeason ASC, rankingWeek ASC, mode ASC, score DESC
scores: rankingSeason ASC, mode ASC, score DESC
```

## 배포 확인

- `https://sequencepang.onrender.com` 접속 시 Vercel 주소로 이동해야 합니다.
- `https://sequencepang.onrender.com/api/leaderboard`는 redirect되지 않고 JSON을 반환해야 합니다.
- Vercel 주소에서 게임 실행, 점수 저장, 랭킹 조회가 되어야 합니다.
- 멀티플레이 버튼 클릭 시 Socket.IO 연결 오류가 없어야 합니다.
