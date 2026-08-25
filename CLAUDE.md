# 시퀀스팡 개발 가이드 (Claude Code)

## 스택·원칙

- 플레인 JS ESM + Vite + 기존 CSS. TypeScript·프레임워크·번들 구조 변경 금지.
- **새 런타임 의존성 추가 금지.** 테스트는 Node 내장 `node --test`만 사용 (Node 18+).
- 사용자 노출 문자열은 한국어. 중앙 대형 팝업 금지(보드를 가려 유저 불만 이력) —
  알림은 `showInfoToast`(보드 상단 얇은 토스트)만 사용.
- `server/`는 원칙적으로 손대지 않음. 예외: `SCORE_VERSION` bump,
  `ANALYTICS_FIELDS` 화이트리스트 추가(없는 필드는 저장 시 버려짐).

## 디렉터리 구조

```text
client/src/
  engine/          ← 순수 게임 로직. document/window/localStorage/타이머/소켓 import 금지
    rng.js         createRng(seed?) — 시드 주입 시 mulberry32 재현 가능
    tiles.js       타일 풀 주입형 생성 (createTilePool/createNormalTile/createFeverTile/getDisplayValue)
    board.js       createBoard / isNeighbor(8방향) / collapseAndRefill(중력 리필)
    sequence.js    classifyChain(pending|valid|broken) / getTimeBonus / 기약분수 포맷
    scoring.js     computePoints / getPathSignature(정·역방향 동일) / classifyRepeat / pushHistory
    chainTier.js   getChainTier(3 팡/4 피버/5 슈퍼/6 크로스/7+ 풀보드, allSame 제외) / getCrossCells
  ui/              ← DOM 렌더링 전담
    boardView.js   타일 DOM 2차원 캐시, 낙하·버스트 연출, 플로팅 점수·규칙 힌트
    dragController.js  보드 지오메트리 1회 측정 → 좌표 산술 히트테스트, rAF 드래그 선
    hud.js         점수·콤보·타이머·피버 패널 표시
  gameEngine.js    조립·타이머·피버 타이머·소켓·오버레이 (게임 규칙 로직을 새로 넣지 말 것)
  gameConstants.js 튜닝 상수 전부. 엔진 모듈은 상수를 인자로 주입받는다
  haptics.js       진동 래퍼 (vibrate 미지원이면 noop, SFX 음소거와 연동)
  sfxManager.js    Web Audio 공용 컨텍스트. playSound(name, payload) — 새 AudioContext 생성 금지
tests/engine/      node --test. parityVectors.json = 점수·판정 기대값 고정
```

### engine/ 규칙

- `engine/` 안에서 `document`/`window`/`localStorage` 참조 0건이어야 한다
  (`grep -rn "document\|window\|localStorage" client/src/engine/`으로 확인).
- 상수는 항상 인자로 받는다. 테스트에서 값을 바꿔 주입할 수 있어야 한다.
- 드래그 중 실시간 판정과 손 뗄 때 판정은 **반드시 같은 `classifyChain`**을 쓴다.
  판정 로직을 다른 곳에 복제하지 말 것.

## 패리티 테스트 갱신 규칙

`tests/engine/parityVectors.json`은 점수·시간 보너스·판정·피버 표시값의 기대값을
고정한다. **점수·시간 공식을 바꾸면 이 벡터도 같은 커밋에서 갱신**하고, 갱신 근거를
커밋 메시지에 남긴다. 공식 위치:

- 점수: `engine/scoring.js` (`comboBonus = (combo-1)*80*(1+combo*0.15)`,
  `points = round(floor(len*100+comboBonus) × 반복 × 피버 × 라스트팡)`)
- 시간: `engine/sequence.js` `getTimeBonus` (GP 공비≥2 → 1.2 / 그 외 0.9,
  AP |d|≥4 → 1.2 / ≥2 → 1.0 / 그 외 0.7, +0.5 가산, 반복 배수 곱)

실행: `npm test` (= `node --test tests/engine/*.test.js` — 셸 glob이라 Node 18에서도 동작)

## 배포 체크리스트

1. `client/public/service-worker.js`의 `CACHE_NAME` bump (예: v15 → v16). **필수.**
2. `client/public/update-notes.md`에 날짜 + 한 줄 설명 추가 (아래에 append, 오래된 것부터).
3. 점수 공식·판정에 영향 주는 변경이면 `server/constants.js` `SCORE_VERSION` bump.
4. 새 분석 필드는 `server/scoreRoutes.js` `ANALYTICS_FIELDS`에 추가해야 저장된다.
5. `npm run build` + `npm test` 통과 확인.

## 음수 피버 확장 지점 (다음 업데이트 예정)

- 타일 숫자 풀이 주입형이라 `createTilePool({ min: -9, max: 9 })`처럼 음수 풀을
  만들어 `gameEngine.js`의 `createNormalTileData()` 분기에 꽂으면 된다
  (`normalTilePool`/`hyperTilePool`/`bigNumberTilePool` 참고).
- `classifyChain`은 0·음수 입력에서 예외가 없고, 0이 포함된 비상수열은 GP로
  인정하지 않는다(0÷0 우연 통과 차단). 관련 테스트: `tests/engine/sequence.test.js`,
  `tiles.test.js`의 음수 풀 케이스.
- 피버 타입은 `gameConstants.js`의 `FEVER_TYPES`/`SUPER_FEVER_TYPES` 배열에
  weight와 함께 추가한다.
