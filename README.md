# 🍈 수열팡 (Sequence Pang)

등차수열과 등비수열을 드래그로 연결해 점수와 피해를 쌓는 웹 기반 수학 퍼즐 게임입니다. 싱글 타임어택, 실시간 멀티 대기방, 리더보드, 보스레이드를 지원합니다.

## 주요 기능

- **싱글 플레이**: 6x6 보드에서 30초 타임어택으로 최고 점수를 겨룹니다.
- **수열 판정**: 3개 이상의 숫자가 등차수열 또는 등비수열이면 매칭됩니다.
- **숫자 범위**: 타일 숫자는 코드 기준 `1~9` 범위에서 생성됩니다.
- **멀티플레이**: Socket.IO 기반 방 생성/입장, 방장 표시, 실시간 리더보드를 지원합니다.
- **피버모드**: 길이 4 이상의 유효 수열 성공 시 피버 블록이 등장하며, 발동 중 표시값이 증가하고 점수가 2배가 됩니다.
- **보스레이드**: 서버/클라이언트 로직은 남아 있지만 현재 `ENABLE_BOSS_RAID = false` 플래그로 비활성화되어 있습니다.

## 프로젝트 구조

```bash
.
├── client/
│   ├── index.html
│   ├── public/
│   │   ├── melon.png
│   │   └── raid-boss-melon-king.png
│   ├── src/
│   │   ├── gameConstants.js
│   │   ├── gameEngine.js
│   │   ├── main.js
│   │   ├── socketClient.js
│   │   ├── style.css
│   │   └── ui.js
├── server/
│   ├── constants.js
│   ├── roomStore.js
│   ├── server.js
│   └── socketHandlers.js
├── package.json
├── vite.config.js
└── README.md
```

## 실행 방법

```bash
npm install
npm run dev:server
npm run dev:client
```

- 서버: `http://localhost:3000`
- Vite 클라이언트: `http://localhost:5173`
- 개발 중 Socket.IO 요청은 Vite 프록시를 통해 Node 서버로 전달됩니다.

### Windows PowerShell에서 `npm install`이 막힐 때

PowerShell 실행 정책 때문에 `npm.ps1`이 차단되면 아래처럼 `.cmd`를 붙여 실행하세요.

```bash
npm.cmd install
npm.cmd run dev:server
npm.cmd run dev:client
npm.cmd run build
```

또는 PowerShell 대신 명령 프롬프트(cmd)나 Git Bash에서 기존 `npm install` 명령을 사용해도 됩니다.

## 배포

Render Web Service 하나에서 Node 서버가 빌드된 클라이언트를 서빙합니다.

```bash
npm install
npm run build
npm start
```

`server/server.js`는 production에서 `client/dist`를 정적 파일로 서빙하고, SPA fallback으로 `client/dist/index.html`을 반환합니다.

## 기술 스택

- **Frontend**: Vite + Vanilla JavaScript + CSS
- **Backend**: Node.js + Express + Socket.IO
- **State**: 서버 메모리 기반 방/점수 상태
