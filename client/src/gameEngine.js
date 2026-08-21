import {
  BOARD_SIZE,
  MAX_TIME,
  TILE_NUMBER_MIN,
  TILE_NUMBER_MAX,
  MAX_ROOM_PLAYERS,
  FEVER_TRIGGER_MIN_LENGTH,
  SUPER_FEVER_TRIGGER_MIN_LENGTH,
  SUPER_FEVER_LAUNCH_AT_MS,
  FEVER_DURATION_MS,
  SUPER_FEVER_DURATION_MS,
  PRE_LAUNCH_FEVER_DURATION_MS,
  PRE_LAUNCH_FEVER_TIME_BONUS_RATE,
  FEVER_ROLLBACK_MS,
  FEVER_SCORE_MULTIPLIER,
  SUPER_FEVER_SCORE_MULTIPLIER,
  FEVER_TIME_BONUS_RATE,
  FEVER_TYPES,
  SUPER_FEVER_TYPES,
  BIG_NUMBER_TILE_MIN,
  BIG_NUMBER_TILE_MAX,
  HYPER_PANG_SCORE_THRESHOLD,
  HYPER_PANG_TILE_MAX,
  HYPER_PANG_TIME_BONUS_S,
  LAST_SPURT_LAUNCH_AT_MS,
  LAST_SPURT_THRESHOLD_S,
  LAST_SPURT_SCORE_MULTIPLIER,
  CROSS_PANG_POINTS_PER_TILE,
  CROSS_PANG_TIME_BONUS_S,
  FULL_PANG_TIME_BONUS_S,
  CROSS_PANG_LABEL,
  FULL_PANG_LABEL,
  PANG_BURST_MS,
  PANG_BURST_STAGGER_MS,
  RECENT_SEQUENCE_LIMIT,
  REPEATED_PATH_SCORE_MULTIPLIER,
  REPEATED_PATTERN_SCORE_MULTIPLIER,
  REPEATED_PATH_TIME_MULTIPLIER,
  REPEATED_PATTERN_TIME_MULTIPLIER
} from './gameConstants.js';
import { createSocketClient } from './socketClient.js';
import { createGameSession, fetchLeaderboard, fetchYesterdayTop, submitScore } from './scoreClient.js';
import { renderGlobalLeaderboard, renderLeaderboard } from './ui.js';
import { playSound } from './sfxManager.js';
import { pauseMenuBgm, resumeMenuBgm } from './menuBgm.js';
import {
  createTilePool,
  createNormalTile,
  createFeverTile,
  getDisplayValue as getTileDisplayValue
} from './engine/tiles.js';
import { createBoard, collapseAndRefill } from './engine/board.js';
import { classifyChain, getTimeBonus } from './engine/sequence.js';
import { getChainTier, getCrossCells } from './engine/chainTier.js';
import {
  computePoints,
  getPathSignature,
  getValueSignature,
  classifyRepeat,
  pushHistory
} from './engine/scoring.js';
import { createBoardView } from './ui/boardView.js';
import { createDragController } from './ui/dragController.js';
import { createHud } from './ui/hud.js';

export function initGameApp() {
  // ----------------------------------------------------
  // 게임 엔진 상태 데이터
  // ----------------------------------------------------

  // 타일 숫자 풀 — 향후 음수 피버는 여기 풀 하나 추가로 대응한다
  const normalTilePool = createTilePool({ min: TILE_NUMBER_MIN, max: TILE_NUMBER_MAX });
  const hyperTilePool = createTilePool({ min: TILE_NUMBER_MIN, max: HYPER_PANG_TILE_MAX });
  const bigNumberTilePool = createTilePool({ min: BIG_NUMBER_TILE_MIN, max: BIG_NUMBER_TILE_MAX });

  function getCurrentTilePool() {
    return hyperPangActive ? hyperTilePool : normalTilePool;
  }

  function getCurrentTileMax() {
    return getCurrentTilePool().max;
  }

  // 빅넘버 피버 발동 즉시 보드의 일반 타일 일부를 10~19로 교체
  function seedBigNumberTiles(count = 12) {
    const candidates = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (boardData[r][c]?.type === 'normal') {
          candidates.push({ r, c });
        }
      }
    }

    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    candidates.slice(0, count).forEach(({ r, c }) => {
      boardData[r][c] = createNormalTile(bigNumberTilePool);
    });
  }

  function createNormalTileData() {
    // 빅넘버 슈퍼피버 중에는 새 타일이 10~19 원본 숫자로 등장
    const useBigNumber = fever.active && fever.type === 'bigNumber';
    return createNormalTile(useBigNumber ? bigNumberTilePool : getCurrentTilePool());
  }

  // 개발 모드에서 ?feverTest=1 을 붙이면 적용 시각 전에도 이벤트를 미리 체험 가능
  const isFeverTestMode = import.meta.env.DEV
    && new URLSearchParams(window.location.search).has('feverTest');

  function isSuperFeverLive() {
    return isFeverTestMode || Date.now() >= SUPER_FEVER_LAUNCH_AT_MS;
  }

  function isLastSpurtLive() {
    return isFeverTestMode || Date.now() >= LAST_SPURT_LAUNCH_AT_MS;
  }

  function getNormalFeverDurationMs() {
    return isSuperFeverLive() ? FEVER_DURATION_MS : PRE_LAUNCH_FEVER_DURATION_MS;
  }

  function getFeverTimeBonusRate() {
    return isSuperFeverLive() ? FEVER_TIME_BONUS_RATE : PRE_LAUNCH_FEVER_TIME_BONUS_RATE;
  }

  function createFeverTileData(tier = 'normal') {
    return createFeverTile({
      tier,
      feverTypes: tier === 'super' ? SUPER_FEVER_TYPES : FEVER_TYPES,
      pool: getCurrentTilePool()
    });
  }

  function getDisplayValue(tileData) {
    return getTileDisplayValue(tileData, fever);
  }

  function hasFeverTile() {
    return boardData.some(row => row.some(tileData => tileData?.type === 'fever'));
  }

  function renderBoard() {
    boardView.renderAll(boardData);
  }

  let boardData = [];
  let selectedTiles = [];
  let isDragging = false;
  let isGameOver = false;
  let isGameActive = false;

  let score = 0;
  let bestScore = parseInt(localStorage.getItem('seq_pang_best') || '0');
  let combo = 0;
  let maxCombo = 0;
  let timeLeft = MAX_TIME;
  let comboTimeLeft = 5.0; // 콤보 제한 시간 (5초) 추적 변수
  let gameTimer = null;
  let scoreSubmitted = false;
  let currentGameSession = null;
  let singleSessionStartedAt = 0;
  let pendingFeverSpawn = null; // null | 'normal' | 'super'
  let recentSuccessfulSequences = [];
  let clearCount = 0;
  let feverClearCount = 0;
  let repeatedPathCount = 0;
  let repeatedValuePatternCount = 0;
  let crossPangCount = 0;
  let fullPangCount = 0;
  let maxChainLength = 0;
  let lastSpurtEngaged = false; // 라스트팡은 한 번 발동하면 그 판이 끝날 때까지 유지
  let yesterdayTop = null;
  let beatYesterdayAnnounced = false;
  let hyperPangTriggered = false;
  let hyperPangActive = false;
  let hyperPangPaused = false;
  const fever = {
    active: false,
    ending: false,
    tier: 'normal',
    type: null,
    amount: 0,
    label: '',
    scoreMultiplier: FEVER_SCORE_MULTIPLIER,
    durationMs: FEVER_DURATION_MS,
    timeLeftMs: 0,
    timer: null,
    rollbackTimer: null
  };

  // DOM 캐싱
  const boardElement = document.getElementById('board');
  const boardWrapper = document.getElementById('board-wrapper');
  const gameContainer = document.querySelector('.game-container');
  const timerContainer = document.getElementById('timer-container');
  const timerBar = document.getElementById('timer-bar');
  const timerText = document.getElementById('timer-text');
  const feverPanel = document.getElementById('fever-panel');
  const feverTimerFill = document.getElementById('fever-timer-fill');
  const feverTimerText = document.getElementById('fever-timer-text');
  const feverNotice = document.getElementById('fever-notice');

  const scoreVal = document.getElementById('score-val');
  const bestScoreVal = document.getElementById('best-score-val');
  const comboVal = document.getElementById('combo-val');
  const comboBadge = document.getElementById('combo-badge');
  const dragLine = document.getElementById('drag-line');
  const dragLineGlow = document.getElementById('drag-line-glow');
  const scoreLabel = document.getElementById('score-label');

  const welcomeOverlay = document.getElementById('welcome-overlay');
  const btnSingleStart = document.getElementById('btn-single-start');
  const btnMultiLobby = document.getElementById('btn-multi-lobby');
  const playerNicknameInput = document.getElementById('player-nickname');
  const multiLobbyCard = document.getElementById('multi-lobby-card');
  const modeSelection = document.getElementById('mode-selection');
  const btnLobbyBack = document.getElementById('btn-lobby-back');
  const btnJoinRoom = document.getElementById('btn-join-room');
  const lobbyNicknameInput = document.getElementById('lobby-nickname');
  const lobbyRoomIdInput = document.getElementById('lobby-room-id');
  const leaderboardPanel = document.getElementById('leaderboard-panel');
  const leaderboardList = document.getElementById('leaderboard-list');
  const roomBadge = document.getElementById('room-badge');

  const lobbyOverlay = document.getElementById('lobby-overlay');
  const lobbyRoomBadge = document.getElementById('lobby-room-badge');
  const lobbyPList = document.getElementById('lobby-p-list');
  const lobbyWaitingInfo = document.getElementById('lobby-waiting-info');
  const btnCreateRoom = document.getElementById('btn-create-room');
  const btnLobbyPlay = document.getElementById('btn-lobby-play');
  const btnLobbyExit = document.getElementById('btn-lobby-exit');
  const countdownOverlay = document.getElementById('countdown-overlay');
  const countdownText = document.getElementById('countdown-text');

  const gameOverOverlay = document.getElementById('gameover-overlay');
  const gameOverTitle = document.getElementById('gameover-title');
  const gameOverDesc = document.getElementById('gameover-desc');
  const resultLabel = document.getElementById('result-label');
  const finalScoreText = document.getElementById('final-score');
  const resultUnit = document.getElementById('result-unit');
  const btnRetry = document.getElementById('btn-retry');
  const welcomeBestVal = document.getElementById('welcome-best-val');
  const globalRanking = document.getElementById('global-ranking');
  const globalRankingList = document.getElementById('global-ranking-list');
  const scoreSubmitStatus = document.getElementById('score-submit-status');
  const scoreSubmitRetry = document.getElementById('score-submit-retry');
  const globalRankingHeading = globalRanking?.querySelector('.global-ranking-heading strong') || null;

  // 보드 뷰(타일 DOM 캐시) · 드래그 컨트롤러(히트테스트/드래그 선) · HUD
  const boardView = createBoardView({
    boardElement,
    boardWrapper,
    size: BOARD_SIZE,
    getDisplayValue,
    isBigNumberTile: tileData => tileData?.baseValue > getCurrentTileMax()
  });

  const dragController = createDragController({
    boardWrapper,
    dragLine,
    dragLineGlow,
    size: BOARD_SIZE,
    getTileEl: (row, col) => boardView.getTileEl(row, col)
  });

  const hud = createHud({
    scoreVal,
    bestScoreVal,
    welcomeBestVal,
    comboVal,
    comboBadge,
    timerContainer,
    timerBar,
    timerText,
    feverPanel,
    feverTimerFill,
    feverTimerText
  });

  // 보드 지오메트리는 레이아웃이 바뀔 때만 다시 잰다 (매 move마다 rect 계산 금지)
  window.addEventListener('resize', () => dragController.measure());
  window.addEventListener('orientationchange', () => dragController.measure());
  window.addEventListener('scroll', () => dragController.measure(), { passive: true });

  hud.setBestScore(bestScore);
  const savedNickname = localStorage.getItem('seq_pang_nickname') || '';
  playerNicknameInput.value = savedNickname;
  lobbyNicknameInput.value = savedNickname;

  function updateFeverUI() {
    const isVisible = fever.active || fever.ending;
    const isSuperActive = fever.active && fever.tier === 'super';
    gameContainer.classList.toggle('fever-active', fever.active);
    gameContainer.classList.toggle('super-fever-active', isSuperActive);
    boardWrapper.classList.toggle('fever-active', fever.active);
    boardWrapper.classList.toggle('super-fever-active', isSuperActive);

    const percentage = fever.active
      ? Math.max(0, Math.min(100, (fever.timeLeftMs / fever.durationMs) * 100))
      : 0;
    const feverName = fever.tier === 'super' ? '슈퍼피버' : '피버';
    hud.setFeverPanel({
      visible: isVisible,
      superActive: isSuperActive,
      percentage,
      text: fever.active
        ? `${feverName} ${fever.label} · ${(fever.timeLeftMs / 1000).toFixed(1)}s · 점수 ×${fever.scoreMultiplier}`
        : '피버 종료!'
    });
  }

  function resetFeverState() {
    if (fever.timer) {
      clearInterval(fever.timer);
      fever.timer = null;
    }
    if (fever.rollbackTimer) {
      clearTimeout(fever.rollbackTimer);
      fever.rollbackTimer = null;
    }
    fever.active = false;
    fever.ending = false;
    fever.tier = 'normal';
    fever.type = null;
    fever.amount = 0;
    fever.label = '';
    fever.scoreMultiplier = FEVER_SCORE_MULTIPLIER;
    fever.durationMs = FEVER_DURATION_MS;
    fever.timeLeftMs = 0;
    pendingFeverSpawn = null;
    boardWrapper.classList.remove('fever-active', 'super-fever-active', 'fever-rollback');
    gameContainer.classList.remove('fever-active', 'super-fever-active');
    feverPanel.classList.remove('super-fever');
    feverNotice.classList.remove('show');
    updateFeverUI();
  }

  // ── 하이퍼팡: 한 판 100만점 돌파 시 숫자 범위 1~12 확장 ──
  function maybeTriggerHyperPang() {
    if (hyperPangTriggered || isGameOver || !isGameActive) return;
    if (score < HYPER_PANG_SCORE_THRESHOLD) return;

    hyperPangTriggered = true;
    hyperPangPaused = true;
    isGameActive = false; // 타이머·조작 정지 (모달 + 카운트다운 동안)
    isDragging = false;
    clearSelection();
    showHyperPangModal();
  }

  function showHyperPangModal() {
    const overlay = document.createElement('div');
    overlay.className = 'hyper-pang-overlay';

    const modal = document.createElement('section');
    modal.className = 'hyper-pang-modal';

    const title = document.createElement('h2');
    title.textContent = '하이퍼팡 돌입!';

    const copy = document.createElement('p');
    copy.className = 'hyper-pang-copy';
    copy.innerHTML = '<strong>1,000,000점</strong> 돌파!<br>이제부터 숫자 범위가 <strong>1~12</strong>로 확장됩니다.<br>보너스 <strong>+5초</strong>!';

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'hyper-pang-confirm';
    confirmButton.textContent = '알겠어요!';
    confirmButton.addEventListener('click', () => {
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), 180);
      beginHyperPang();
    });

    modal.append(title, copy, confirmButton);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.classList.add('is-open');
      confirmButton.focus();
    });
    playSound('feverStart');
  }

  function beginHyperPang() {
    hyperPangActive = true;
    gameContainer.classList.add('hyper-pang');
    boardWrapper.classList.add('hyper-pang');

    // 보드 전체를 1~12 범위로 새로 생성 (제2막)
    boardData = createBoard(BOARD_SIZE, createNormalTileData);
    renderBoard();
    clearSelection();

    timeLeft = Math.min(MAX_TIME, timeLeft + HYPER_PANG_TIME_BONUS_S);
    updateTimerUI();

    startCountdownSequence(() => {
      hyperPangPaused = false;
      isGameActive = true;
    });
  }

  // 플레이를 가리지 않는 정보성 알림: 보드 상단의 얇은 토스트
  // (중앙 대형 공지는 보드를 가려 유저 불만이 있었음 — 피버 상태 변화 전용으로만 사용)
  const infoToast = document.createElement('div');
  infoToast.className = 'game-toast';
  boardWrapper.appendChild(infoToast);
  let infoToastTimer = null;

  function showInfoToast(message, variant = '', durationMs = 1500) {
    infoToast.textContent = message;
    infoToast.className = `game-toast${variant ? ` game-toast--${variant}` : ''}`;
    void infoToast.offsetWidth;
    infoToast.classList.add('show');
    if (infoToastTimer) clearTimeout(infoToastTimer);
    infoToastTimer = setTimeout(() => {
      infoToast.classList.remove('show');
      infoToastTimer = null;
    }, durationMs);
  }

  // ── 드래그 중 실시간 판정선 ──────────────────────────────
  // 계산은 선택 타일 집합이 바뀔 때만(추가/백트래킹). pointer move마다 하지 않는다.
  // 손 뗄 때 판정(evaluateSequence)과 같은 classifyChain을 사용해 불일치를 차단한다.
  const chainRuleBadge = document.createElement('div');
  chainRuleBadge.className = 'chain-rule-badge';
  boardWrapper.appendChild(chainRuleBadge);
  let chainState = 'pending';
  let chainBadgeHideTimer = null;
  let chainBrokenShakeTimer = null;

  function formatChainBadgeText(chain) {
    if (chain.kind === 'AP') {
      return `공차 ${String(chain.ruleLabel).replace('-', '−')}`;
    }
    if (chain.allSame) return '공비 ×1';
    const label = chain.ruleLabel;
    if (typeof label === 'object' && label.type === 'fraction') {
      return `공비 ${label.numerator}/${label.denominator}`;
    }
    const value = typeof label === 'object' ? label.value : label;
    return `공비 ×${value}`;
  }

  function positionChainBadge() {
    const center = dragController.getLastCellCenterLocal();
    if (!center) return;
    const { width: wrapperWidth } = dragController.getWrapperSize();
    chainRuleBadge.style.top = `${center.y - 22}px`;
    chainRuleBadge.style.left = `${center.x}px`;
    // 좌우 클램프 — 배지 폭 측정은 선택 변경 시 1회뿐이라 부담 없음
    const badgeWidth = chainRuleBadge.offsetWidth;
    const clampedX = Math.min(
      Math.max(center.x, badgeWidth / 2 + 8),
      wrapperWidth - badgeWidth / 2 - 8
    );
    chainRuleBadge.style.left = `${clampedX}px`;
  }

  function hideChainBadge() {
    if (chainBadgeHideTimer) {
      clearTimeout(chainBadgeHideTimer);
      chainBadgeHideTimer = null;
    }
    chainRuleBadge.classList.remove('show', 'is-broken');
  }

  function resetChainFeedback() {
    chainState = 'pending';
    delete boardWrapper.dataset.chainState;
    hideChainBadge();
  }

  function updateChainFeedback() {
    if (selectedTiles.length === 0) {
      resetChainFeedback();
      return;
    }

    const chain = classifyChain(selectedTiles.map(t => t.value));
    const previousState = chainState;
    chainState = chain.state;
    boardWrapper.dataset.chainState = chain.state;

    if (chain.state === 'valid') {
      if (previousState !== 'valid') playSound('chainLock');
      if (chainBadgeHideTimer) {
        clearTimeout(chainBadgeHideTimer);
        chainBadgeHideTimer = null;
      }
      chainRuleBadge.classList.remove('is-broken');
      chainRuleBadge.textContent = formatChainBadgeText(chain);
      chainRuleBadge.classList.add('show');
      positionChainBadge();
      return;
    }

    if (chain.state === 'broken') {
      if (previousState === 'valid') {
        playSound('chainBreak');
        // 배지는 ✕로 바꿔 0.3초 후 숨김
        chainRuleBadge.classList.add('is-broken');
        chainRuleBadge.textContent = '✕';
        positionChainBadge();
        if (chainBadgeHideTimer) clearTimeout(chainBadgeHideTimer);
        chainBadgeHideTimer = setTimeout(() => {
          hideChainBadge();
        }, 300);
      } else {
        hideChainBadge();
      }
      const lastTile = selectedTiles[selectedTiles.length - 1]?.element;
      if (lastTile) {
        lastTile.classList.remove('chain-broken');
        void lastTile.offsetWidth;
        lastTile.classList.add('chain-broken');
        if (chainBrokenShakeTimer) clearTimeout(chainBrokenShakeTimer);
        chainBrokenShakeTimer = setTimeout(() => {
          lastTile.classList.remove('chain-broken');
          chainBrokenShakeTimer = null;
        }, 120);
      }
      return;
    }

    hideChainBadge();
  }

  function showFeverNotice(message) {
    feverNotice.textContent = message;
    feverNotice.classList.remove('show');
    void feverNotice.offsetWidth;
    feverNotice.classList.add('show');
  }

  function startFeverMode(type, amount, label, tier = 'normal') {
    if (fever.active || fever.ending || isGameOver || !isGameActive) return;

    if (fever.rollbackTimer) {
      clearTimeout(fever.rollbackTimer);
      fever.rollbackTimer = null;
    }
    boardWrapper.classList.remove('fever-rollback');
    fever.active = true;
    fever.ending = false;
    fever.tier = tier;
    fever.type = type;
    fever.amount = amount;
    fever.label = label;
    fever.scoreMultiplier = tier === 'super' ? SUPER_FEVER_SCORE_MULTIPLIER : FEVER_SCORE_MULTIPLIER;
    fever.durationMs = tier === 'super' ? SUPER_FEVER_DURATION_MS : getNormalFeverDurationMs();
    fever.timeLeftMs = fever.durationMs;
    if (tier === 'super') {
      showFeverNotice(`슈퍼피버 ${label}!`);
    }
    // 빅넘버는 리필만 기다리면 조합할 재료가 늦게 모이므로 발동 즉시 일부 타일을 교체
    if (type === 'bigNumber') {
      seedBigNumberTiles();
    }
    playSound('feverStart');
    renderBoard();
    updateFeverUI();

    if (fever.timer) clearInterval(fever.timer);
    fever.timer = setInterval(() => {
      if (hyperPangPaused) return; // 하이퍼팡 안내 중에는 피버 시간도 정지
      fever.timeLeftMs -= 100;
      if (fever.timeLeftMs <= 0) {
        finishFeverMode();
        return;
      }
      updateFeverUI();
    }, 100);
  }

  function finishFeverMode() {
    if (!fever.active) return;
    const wasBigNumber = fever.type === 'bigNumber';

    if (fever.timer) {
      clearInterval(fever.timer);
      fever.timer = null;
    }

    fever.active = false;
    fever.ending = false;
    fever.tier = 'normal';
    fever.type = null;
    fever.amount = 0;
    fever.label = '';
    fever.scoreMultiplier = FEVER_SCORE_MULTIPLIER;
    fever.durationMs = FEVER_DURATION_MS;
    fever.timeLeftMs = 0;
    isDragging = false;
    selectedTiles.forEach(t => t.element.classList.remove('selected', 'last-selected', 'matched'));
    selectedTiles = [];
    dragController.clear();
    resetChainFeedback();

    // 빅넘버 피버가 남긴 10 이상 타일은 롤백 연출과 함께 1~9로 원상복구
    if (wasBigNumber) {
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const tileData = boardData[r][c];
          if (tileData?.type === 'normal' && tileData.baseValue > getCurrentTileMax()) {
            boardData[r][c] = createNormalTile(getCurrentTilePool());
          }
        }
      }
    }

    showFeverNotice('피버 종료!');
    boardWrapper.classList.add('fever-rollback');
    renderBoard();
    updateFeverUI();

    fever.rollbackTimer = setTimeout(() => {
      boardWrapper.classList.remove('fever-rollback');
      feverNotice.classList.remove('show');
      fever.rollbackTimer = null;
    }, FEVER_ROLLBACK_MS);
  }

  function maybeQueueFeverSpawn(len, allSame) {
    if (len < FEVER_TRIGGER_MIN_LENGTH) return;
    if (allSame || fever.active || fever.ending || hasFeverTile()) return;

    const tier = isSuperFeverLive() && len >= SUPER_FEVER_TRIGGER_MIN_LENGTH ? 'super' : 'normal';
    // 이미 슈퍼피버가 대기 중이면 하향하지 않음
    if (pendingFeverSpawn === 'super') return;
    pendingFeverSpawn = tier;
  }

  function spawnQueuedFeverBlock() {
    if (!pendingFeverSpawn || fever.active || fever.ending || hasFeverTile()) {
      pendingFeverSpawn = null;
      return;
    }
    const tier = pendingFeverSpawn;

    const candidates = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (boardData[r][c]?.type === 'normal') {
          candidates.push({ r, c });
        }
      }
    }

    if (candidates.length > 0) {
      const target = candidates[Math.floor(Math.random() * candidates.length)];
      boardData[target.r][target.c] = createFeverTileData(tier);
      showFeverNotice(tier === 'super' ? '슈퍼피버 블록 등장!' : '피버 블록 등장!');
    }

    pendingFeverSpawn = null;
  }

  function updateLobbyModeControls() {
    btnLobbyPlay.disabled = !currentIsHost;
    btnLobbyPlay.textContent = currentIsHost
      ? '시퀀스팡 플레이 시작 (방장)'
      : '방장이 시작할 때까지 기다리는 중';
    btnLobbyPlay.title = currentIsHost
      ? '모든 참가자의 게임을 동시에 시작합니다.'
      : '게임은 방장만 시작할 수 있습니다.';
  }

  // 1. 플레이 시작 (보드 생성 후 카운트다운 진입)
  function startGamePlay(mode = 'timeAttack') {
    currentGameMode = mode;
    scoreLabel.textContent = '현재 점수';
    welcomeOverlay.classList.add('hide');
    lobbyOverlay.classList.add('hide'); // 대기방도 확실하게 가림
    
    score = 0;
    combo = 0;
    maxCombo = 0;
    scoreSubmitted = false;
    timeLeft = MAX_TIME;
    comboTimeLeft = 5.0; // 콤보 타임아웃 초기화
    recentSuccessfulSequences = [];
    clearCount = 0;
    feverClearCount = 0;
    repeatedPathCount = 0;
    repeatedValuePatternCount = 0;
    crossPangCount = 0;
    fullPangCount = 0;
    maxChainLength = 0;
    lastSpurtEngaged = false;
    beatYesterdayAnnounced = false;
    hyperPangTriggered = false;
    hyperPangActive = false;
    hyperPangPaused = false;
    gameContainer.classList.remove('hyper-pang');
    boardWrapper.classList.remove('hyper-pang');
    isGameOver = false;
    isGameActive = false; // 카운트다운이 완전히 끝날 때까지 조작 제한
    selectedTiles = [];
    resetChainFeedback();
    resetFeverState();

    // 멀티플레이 모드일 때 서버에 시작 점수(0점) 전송하여 대시보드 리셋
    if (isMultiplayMode && socket && socket.connected) {
      socket.emit('updateScore', { score: 0 });
    }
    
    hud.setScore('0');
    hud.clearCombo();
    gameOverOverlay.classList.remove('show');
    globalRanking.hidden = true;
    scoreSubmitRetry.hidden = true;

    boardData = createBoard(BOARD_SIZE, createNormalTileData);
    boardView.build(boardData);
    dragController.measure();

    if (gameTimer) clearInterval(gameTimer);
    updateTimerUI();
    dragController.clear();

    // 중앙 카운트다운 시퀀스 작동 후 타이머 및 드래그 가동
    gameContainer.classList.add('game-active');
    pauseMenuBgm();
    startCountdownSequence(() => {
      isGameActive = true;
      gameTimer = setInterval(tickTimer, 100);
    });
  }

  // 게임 시작 전 중앙 3, 2, 1 카운트다운 연출
  function startCountdownSequence(onComplete) {
    countdownOverlay.classList.add('show');
    
    const counts = ["3", "2", "1", "시작!"];
    let idx = 0;

    function nextCount() {
      if (idx >= counts.length) {
        countdownOverlay.classList.remove('show');
        countdownText.classList.remove('pop');
        if (onComplete) onComplete();
        return;
      }

      countdownText.textContent = counts[idx];
      countdownText.classList.remove('pop');
      
      // 리플로우 강제 트리거하여 CSS 트랜지션 강제 재시동
      countdownText.offsetHeight; 
      
      countdownText.classList.add('pop');
      
      playSound(idx === counts.length - 1 ? 'countdownGo' : 'countdownTick');

      idx++;
      setTimeout(nextCount, 1000);
    }

    nextCount();
  }

  function tickTimer() {
    if (isGameOver || !isGameActive) return;
    if (fever.active || fever.ending) return;

    timeLeft -= 0.1;
    if (timeLeft <= 0) {
      timeLeft = 0;
      triggerGameOver();
    }
    updateTimerUI();

    tickComboTimer();
  }

  function tickComboTimer() {
    if (isGameOver || !isGameActive) return;

    if (combo > 0) {
      comboTimeLeft -= 0.1;
      if (comboTimeLeft <= 0) {
        combo = 0;
        hud.clearCombo();
        // sfxManager 공용 AudioContext 사용 — 호출마다 새 컨텍스트를 만들지 않는다
        playSound('comboExpire');
      } else {
        // 콤보 배지에 남은 시간 앙증맞게 시각화
        hud.setComboSeconds(comboTimeLeft);
      }
    }
  }

  function isLastSpurtActive() {
    return lastSpurtEngaged && isGameActive && !isGameOver;
  }

  function updateTimerUI() {
    hud.setTimer(timeLeft, MAX_TIME);

    // 라스트팡: 5초 아래로 처음 내려가는 순간 발동, 이후 시간이 연장돼도 판이 끝날 때까지 유지
    if (!lastSpurtEngaged
      && isLastSpurtLive()
      && isGameActive
      && !isGameOver
      && timeLeft > 0
      && timeLeft <= LAST_SPURT_THRESHOLD_S) {
      lastSpurtEngaged = true;
      showInfoToast('라스트팡! 점수 ×2', 'last', 2000);
    }

    const lastSpurt = isLastSpurtActive();
    hud.setLastSpurt(lastSpurt);
    gameContainer.classList.toggle('last-spurt', lastSpurt);
  }


  function triggerGameOver() {
      isGameOver = true;
      gameContainer.classList.remove('game-active', 'last-spurt');
      timerContainer.classList.remove('last-spurt');
      playSound('gameOver');
      isDragging = false;
      clearInterval(gameTimer);
      resetFeverState();

    dragController.clear();
    resetChainFeedback();
    selectedTiles.forEach(t => t.element.classList.remove('selected', 'last-selected'));

    gameOverTitle.textContent = '타임 오버!';
    gameOverDesc.textContent = '수고하셨습니다. 당신의 기록은...';
    resultLabel.textContent = '최종 점수';
    finalScoreText.textContent = score;
    resultUnit.textContent = '점';

    // 멀티플레이 모드일 때 최종 점수 동기화 확인 사격 및 버튼 텍스트 대응
    if (isMultiplayMode) {
      globalRanking.hidden = true;
      gameOverDesc.textContent = '멀티 모드 점수는 방 안 순위표에만 표시됩니다.';
      if (socket && socket.connected) {
        socket.emit('updateScore', { score: score });
      }
      btnRetry.textContent = "대기실로 돌아가기";
    } else {
      btnRetry.textContent = "메인 화면으로 돌아가기";
    }

    gameOverOverlay.classList.add('show');
    if (currentGameMode === 'timeAttack' && !isMultiplayMode) {
      saveFinalScoreAndLoadLeaderboard();
    }
  }

  function setScoreSubmitStatus(message, state = '') {
    scoreSubmitStatus.textContent = message;
    scoreSubmitStatus.dataset.state = state;
  }

  function buildRankResultMessage(dailyRank) {
    if (!dailyRank?.rank) return '등록 완료!';

    if (dailyRank.rank <= 30) {
      return `등록 완료! 오늘 ${dailyRank.rank}위`;
    }

    const cutoff = dailyRank.top30Cutoff;
    if (Number.isFinite(cutoff) && cutoff >= score) {
      const gap = cutoff - score + 1;
      return `오늘 ${dailyRank.rank}위 · 30위까지 ${gap.toLocaleString('ko-KR')}점!`;
    }

    return `등록 완료! 오늘 ${dailyRank.rank}위`;
  }

  async function loadYesterdayTopBanner() {
    const banner = document.getElementById('yesterday-top-banner');
    const bannerText = document.getElementById('yesterday-top-text');
    if (!banner || !bannerText) return;

    try {
      const response = await fetchYesterdayTop();
      if (response?.top?.nickname && Number.isFinite(response.top.score)) {
        yesterdayTop = response.top;
        bannerText.textContent = `${yesterdayTop.nickname} · ${yesterdayTop.score.toLocaleString('ko-KR')}점 넘어보세요!`;
        banner.hidden = false;
      } else {
        banner.hidden = true;
      }
    } catch {
      banner.hidden = true;
    }
  }

  async function loadGlobalLeaderboard(period = currentGameOverRankingPeriod) {
    currentGameOverRankingPeriod = period === 'weekly' ? 'weekly' : 'daily';
    updateGameOverRankingHeader();

    try {
      const response = await fetchLeaderboard(currentGameOverRankingPeriod);
      updateGameOverRankingHeader(response);
      const { leaders = [] } = response;
      renderGlobalLeaderboard(globalRankingList, leaders);
    } catch (error) {
      globalRankingList.innerHTML = '';
      const errorItem = document.createElement('li');
      errorItem.className = 'global-rank-empty';
      errorItem.textContent = error.message;
      globalRankingList.appendChild(errorItem);
    }
  }

  async function saveFinalScoreAndLoadLeaderboard() {
    if (isMultiplayMode) return;

    globalRanking.hidden = false;
    scoreSubmitRetry.hidden = true;
    const nickname = (currentNickname || playerNicknameInput.value).trim();

    if (Array.from(nickname).length < 1 || Array.from(nickname).length > 10) {
      setScoreSubmitStatus('닉네임을 확인해주세요.', 'error');
      scoreSubmitRetry.hidden = false;
      await loadGlobalLeaderboard();
      return;
    }

    if (scoreSubmitted) {
      await loadGlobalLeaderboard();
      return;
    }

    if (!currentGameSession || !singleSessionStartedAt) {
      setScoreSubmitStatus('점수 기록을 확인할 수 없습니다.', 'error');
      await loadGlobalLeaderboard();
      return;
    }

    setScoreSubmitStatus('점수 등록 중...', 'loading');
    try {
      const submitResult = await submitScore({
        nickname,
        playerId,
        score,
        maxCombo,
        mode: 'timeAttack',
        gameSessionId: currentGameSession.gameSessionId,
        sessionToken: currentGameSession.sessionToken,
        playDurationMs: Math.max(1, Math.round(performance.now() - singleSessionStartedAt)),
        clearCount,
        feverClearCount,
        repeatedPathCount,
        repeatedValuePatternCount,
        crossPangCount,
        fullPangCount,
        maxChainLength
      });
      scoreSubmitted = true;
      setScoreSubmitStatus(buildRankResultMessage(submitResult?.dailyRank), 'success');
    } catch (error) {
      setScoreSubmitStatus(error.message, 'error');
      scoreSubmitRetry.hidden = false;
    }
    await loadGlobalLeaderboard();
  }

  function handleStart(clientX, clientY) {
    if (isGameOver || !isGameActive || fever.ending) return;
    const cell = dragController.getCellAtPoint(clientX, clientY);
    if (cell) {
      const { row: r, col: c } = cell;
      const tileData = boardData[r][c];
      if (tileData?.type === 'fever') {
        boardData[r][c] = createNormalTileData();
        boardView.updateTile(r, c, boardData[r][c]);
        startFeverMode(tileData.feverType, tileData.feverAmount, tileData.feverLabel, tileData.feverTier || 'normal');
        return;
      }
    }

    isDragging = true;
    if (cell) {
      selectTile(cell.row, cell.col);
    }
  }

  function handleMove(clientX, clientY) {
    if (!isDragging || isGameOver || !isGameActive || fever.ending) return;
    const cell = dragController.getCellAtPoint(clientX, clientY);
    dragController.setPointer(clientX, clientY);
    if (!cell) return;

    const { row: r, col: c } = cell;

    if (selectedTiles.length > 1) {
      const lastSecond = selectedTiles[selectedTiles.length - 2];
      if (lastSecond.row === r && lastSecond.col === c) {
        const popped = selectedTiles.pop();
        popped.element.classList.remove('selected', 'last-selected');

        if (selectedTiles.length > 0) {
          selectedTiles[selectedTiles.length - 1].element.classList.add('last-selected');
        }

        dragController.setSelection(selectedTiles);
        updateChainFeedback();
        return;
      }
    }

    const isAlreadySelected = selectedTiles.some(t => t.row === r && t.col === c);
    if (isAlreadySelected) return;

    if (selectedTiles.length > 0) {
      const last = selectedTiles[selectedTiles.length - 1];
      const rowDiff = Math.abs(last.row - r);
      const colDiff = Math.abs(last.col - c);

      const isNeighbor = rowDiff <= 1 && colDiff <= 1 && !(rowDiff === 0 && colDiff === 0);
      if (!isNeighbor) return;
    }

    selectTile(r, c);
  }

  function handleEnd() {
    if (!isDragging) return;
    isDragging = false;
    dragController.clearPointer();

    if (selectedTiles.length >= 3) {
      evaluateSequence();
    } else {
      clearSelection();
    }
  }

  function selectTile(r, c) {
    const tileData = boardData[r][c];
    const tileElement = boardView.getTileEl(r, c);
    if (!tileData || !tileElement || tileData.type === 'fever') return;
    const val = getDisplayValue(tileData);

    if (selectedTiles.length > 0) {
      selectedTiles[selectedTiles.length - 1].element.classList.remove('last-selected');
    }

    tileElement.classList.add('selected', 'last-selected');
    selectedTiles.push({
      row: r,
      col: c,
      value: val,
      element: tileElement
    });

    dragController.setSelection(selectedTiles);
    updateChainFeedback();
    playSound('tileSelect');
  }

  // 반복 페널티 배수 — 엔진에 상수 주입
  const repeatMultipliers = {
    pathScoreMultiplier: REPEATED_PATH_SCORE_MULTIPLIER,
    patternScoreMultiplier: REPEATED_PATTERN_SCORE_MULTIPLIER,
    pathTimeMultiplier: REPEATED_PATH_TIME_MULTIPLIER,
    patternTimeMultiplier: REPEATED_PATTERN_TIME_MULTIPLIER
  };

  // 판정 — 드래그 중 실시간 판정과 동일한 classifyChain을 사용한다
  function evaluateSequence() {
    const values = selectedTiles.map(t => t.value);
    const len = values.length;
    const chain = classifyChain(values);

    if (chain.state === 'valid') {
      playSound('sequenceSuccess');
      const repeatResult = classifyRepeat(recentSuccessfulSequences, selectedTiles, values, repeatMultipliers);
      clearCount++;
      if (fever.active) feverClearCount++;
      if (repeatResult.type === 'path') repeatedPathCount++;
      if (repeatResult.type === 'pattern') repeatedValuePatternCount++;
      maxChainLength = Math.max(maxChainLength, len);
      pushHistory(recentSuccessfulSequences, {
        pathSignature: getPathSignature(selectedTiles),
        valueSignature: getValueSignature(values)
      }, RECENT_SEQUENCE_LIMIT);

      combo++;
      if (combo > maxCombo) {
        maxCombo = combo;
      }

      // 콤보 제한 시간 5초 완전 충전 리셋
      comboTimeLeft = 5.0;

      const feverMultiplier = fever.active ? fever.scoreMultiplier : 1;
      const lastSpurtMultiplier = isLastSpurtActive() ? LAST_SPURT_SCORE_MULTIPLIER : 1;
      const totalMultiplier = feverMultiplier * lastSpurtMultiplier;
      const points = computePoints({
        len,
        combo,
        repeatMultiplier: repeatResult.scoreMultiplier,
        feverMultiplier,
        lastSpurtMultiplier
      });

      // ── 6·7연쇄 티어: 크로스팡(십자 추가 제거) / 풀보드팡(전판 재생성) ──
      // 추가 제거 타일은 콤보·반복 기록·maxChainLength에 영향 없음(수열 1개로만 카운트).
      const chainTier = getChainTier(len, chain.allSame);
      const lastCell = selectedTiles[selectedTiles.length - 1];
      let pangExtraCells = [];
      let pangExtraPoints = 0;
      if (chainTier === 'cross' || chainTier === 'full') {
        const selectedKeys = new Set(selectedTiles.map(t => `${t.row}:${t.col}`));
        const candidateCells = [];
        if (chainTier === 'cross') {
          candidateCells.push(...getCrossCells(lastCell, BOARD_SIZE));
        } else {
          for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
              candidateCells.push({ row: r, col: c });
            }
          }
        }
        // 연쇄 타일·피버 블록은 추가 제거에서 제외 (피버 블록 보존)
        pangExtraCells = candidateCells.filter(cell =>
          !selectedKeys.has(`${cell.row}:${cell.col}`)
          && boardData[cell.row][cell.col]?.type !== 'fever');
        pangExtraPoints = Math.round(pangExtraCells.length * CROSS_PANG_POINTS_PER_TILE * totalMultiplier);

        if (chainTier === 'cross') {
          crossPangCount++;
          showInfoToast(CROSS_PANG_LABEL, 'cross');
          playSound('crossPang');
        } else {
          fullPangCount++;
          showInfoToast(FULL_PANG_LABEL, 'full');
          playSound('fullPang');
        }
      }

      score += points + pangExtraPoints;

      // 어제의 1등 기록 돌파 연출 (싱글 타임어택만)
      if (!isMultiplayMode && currentGameMode === 'timeAttack'
        && yesterdayTop?.score != null && !beatYesterdayAnnounced && score > yesterdayTop.score) {
        beatYesterdayAnnounced = true;
        showInfoToast('어제의 1등을 넘었어요!');
      }

      maybeTriggerHyperPang();
      
      if (score > bestScore) {
        bestScore = score;
        localStorage.setItem('seq_pang_best', bestScore);
        hud.setBestScore(bestScore);
      }

      hud.setScore(score, { pop: true });

      // 멀티플레이 모드일 때 서버에 실시간 점수 업데이트 전송
      if (isMultiplayMode && socket && socket.connected) {
        socket.emit('updateScore', { score: score });
      }

      hud.setCombo(combo, comboTimeLeft);

      // ── 수열 종류·공차별 시간 보너스 (+0.5 고정 가산, 반복 페널티 포함) ──
      const bonusTime = getTimeBonus({
        kind: chain.kind,
        diff: chain.diff,
        ratio: chain.ratio,
        allSame: chain.allSame,
        repeatTimeMultiplier: repeatResult.timeMultiplier
      });

      // 티어 시간 보너스도 피버 중에는 기존 50% 규칙으로 피버 시간에 가산
      const tierTimeBonus = chainTier === 'cross' ? CROSS_PANG_TIME_BONUS_S
        : chainTier === 'full' ? FULL_PANG_TIME_BONUS_S : 0;
      const totalTimeBonus = bonusTime + tierTimeBonus;

      if (fever.active) {
        fever.timeLeftMs = Math.min(MAX_TIME * 1000, fever.timeLeftMs + (totalTimeBonus * 1000 * getFeverTimeBonusRate()));
        updateFeverUI();
      } else {
        timeLeft = Math.min(MAX_TIME, timeLeft + totalTimeBonus);
        updateTimerUI();
      }

      spawnFloatingScore(points, totalMultiplier, repeatResult.type);
      boardView.spawnSequenceHint(lastCell.element, chain.kind, chain.ruleLabel);
      maybeQueueFeverSpawn(len, chain.allSame);

      if (pangExtraCells.length > 0) {
        const pangLabel = chainTier === 'cross' ? '크로스' : '풀보드';
        setTimeout(() => {
          boardView.spawnFloatingScore(
            lastCell.element,
            `+${pangExtraPoints.toLocaleString('ko-KR')} · ${pangLabel}`,
            { fever: true }
          );
        }, 150);
      }

      selectedTiles.forEach(t => t.element.classList.add('matched'));
      if (pangExtraCells.length > 0) {
        // 연쇄 matched(350ms) → 십자/전판 pang-burst(바깥으로 퍼짐) → collapse + 낙하
        const removedCells = [
          ...selectedTiles.map(t => ({ row: t.row, col: t.col })),
          ...pangExtraCells
        ];
        const origin = { row: lastCell.row, col: lastCell.col };
        setTimeout(() => {
          const burstMs = boardView.triggerPangBurst(pangExtraCells, origin, {
            durationMs: PANG_BURST_MS,
            staggerMs: PANG_BURST_STAGGER_MS
          });
          setTimeout(() => {
            eliminateAndRefill(removedCells);
          }, burstMs);
        }, 350);
      } else {
        setTimeout(() => {
          eliminateAndRefill();
        }, 350);
      }

    } else {
      playSound('sequenceFail');
      combo = 0;
      hud.clearCombo();
      timeLeft = Math.max(0, timeLeft - 3.0);
      updateTimerUI();

      triggerFailureShock();

      selectedTiles.forEach(t => t.element.classList.add('sequence-invalid'));
      setTimeout(() => {
        clearSelection();
      }, 300);
    }
  }

  function spawnFloatingScore(points, multiplier = 1, repeatType = 'new') {
    const lastTile = selectedTiles[selectedTiles.length - 1].element;
    const multiplierLabel = multiplier > 1 ? ` ×${multiplier}` : '';
    const repeatLabel = repeatType === 'path' ? ' · 반복 경로' : repeatType === 'pattern' ? ' · 반복 수열' : '';
    boardView.spawnFloatingScore(lastTile, `+${points}${multiplierLabel}${repeatLabel}`, { fever: multiplier > 1 });
  }

  function triggerFailureShock() {
    timerContainer.classList.add('shake');
    boardWrapper.classList.add('shake');

    setTimeout(() => {
      timerContainer.classList.remove('shake');
      boardWrapper.classList.remove('shake');
    }, 400);
  }

  function eliminateAndRefill(removedCells = selectedTiles) {
    const { board: nextBoard } = collapseAndRefill(boardData, removedCells, createNormalTileData);
    boardData = nextBoard;

    spawnQueuedFeverBlock();
    boardView.clearPangBurst();
    boardView.renderGravityRefill(boardData);
    clearSelection();
  }

  function clearSelection() {
    selectedTiles.forEach(t => {
      t.element.classList.remove('selected', 'last-selected', 'matched', 'sequence-invalid');
    });
    selectedTiles = [];
    dragController.clear();
    resetChainFeedback();
  }

  // ----------------------------------------------------
  // 5. 이벤트 바인딩
  // ----------------------------------------------------
  boardWrapper.addEventListener('mousedown', (e) => {
    e.preventDefault();
    handleStart(e.clientX, e.clientY);
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    e.preventDefault();
    handleMove(e.clientX, e.clientY);
  });

  window.addEventListener('mouseup', (e) => {
    handleEnd();
  });

  boardWrapper.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    handleStart(touch.clientX, touch.clientY);
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const touch = e.touches[0];
    handleMove(touch.clientX, touch.clientY);
  }, { passive: false });

  window.addEventListener('touchend', (e) => {
    handleEnd();
  });

  // ----------------------------------------------------
  // 실시간 멀티플레이어 소켓 로직 연동
  // ----------------------------------------------------
  let socket = null;
  let isMultiplayMode = false;
  let currentRoomId = "";
  let currentNickname = "";
  let currentIsHost = false;
  let currentGameMode = 'timeAttack';
  let currentGameOverRankingPeriod = 'daily';
  const playerId = getOrCreatePlayerId();
  updateLobbyModeControls();
  setupGameOverRankingControls();
  updateGameOverRankingHeader();
  loadYesterdayTopBanner();

  function getOrCreatePlayerId() {
    const storageKey = 'seq_pang_player_id';
    const savedPlayerId = localStorage.getItem(storageKey);
    if (savedPlayerId) return savedPlayerId;

    const nextPlayerId = `player_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(storageKey, nextPlayerId);
    return nextPlayerId;
  }

  function getGameOverRankingTitle(period = currentGameOverRankingPeriod) {
    if (period === 'weekly') return '주간 랭킹 TOP 30';
    return '오늘 랭킹 TOP 30';
  }

  function formatWeekRange(weekStart) {
    if (!weekStart) return '';

    const startDate = new Date(`${weekStart}T00:00:00+09:00`);
    if (Number.isNaN(startDate.getTime())) return weekStart;

    const endDate = new Date(startDate.getTime());
    endDate.setDate(endDate.getDate() + 6);

    const endYear = endDate.getFullYear();
    const endMonth = String(endDate.getMonth() + 1).padStart(2, '0');
    const endDay = String(endDate.getDate()).padStart(2, '0');

    return `${weekStart} ~ ${endYear}-${endMonth}-${endDay}`;
  }

  function getGameOverRankingMeta(response = null, period = currentGameOverRankingPeriod) {
    if (period === 'daily') {
      return response?.rankingDay || '';
    }
    return response?.rankingWeekStart ? formatWeekRange(response.rankingWeekStart) : '';
  }

  function updateGameOverRankingHeader(response = null) {
    if (globalRankingHeading) {
      globalRankingHeading.textContent = getGameOverRankingTitle();
    }

    const metaElement = document.getElementById('global-ranking-meta');
    const dailyButton = document.getElementById('btn-global-ranking-daily');
    const weeklyButton = document.getElementById('btn-global-ranking-weekly');

    if (metaElement) {
      metaElement.textContent = getGameOverRankingMeta(response);
    }
    if (dailyButton) {
      dailyButton.dataset.active = String(currentGameOverRankingPeriod === 'daily');
    }
    if (weeklyButton) {
      weeklyButton.dataset.active = String(currentGameOverRankingPeriod === 'weekly');
    }
  }

  function setupGameOverRankingControls() {
    if (!globalRanking || document.getElementById('global-ranking-meta')) return;

    const tabs = document.createElement('div');
    tabs.className = 'ranking-period-tabs';
    tabs.innerHTML = `
      <button type="button" class="ranking-period-tab" id="btn-global-ranking-daily" data-period="daily" data-active="true">오늘 랭킹</button>
      <button type="button" class="ranking-period-tab" id="btn-global-ranking-weekly" data-period="weekly" data-active="false">주간 랭킹</button>
    `;

    const meta = document.createElement('p');
    meta.className = 'ranking-period-meta';
    meta.id = 'global-ranking-meta';

    globalRanking.insertBefore(tabs, globalRankingList);
    globalRanking.insertBefore(meta, globalRankingList);
  }

  function rememberNickname(nickname) {
    currentNickname = nickname;
    playerNicknameInput.value = nickname;
    lobbyNicknameInput.value = nickname;
    localStorage.setItem('seq_pang_nickname', nickname);
  }

  // 싱글 플레이 시작
  btnSingleStart.addEventListener('click', async () => {
    const nickname = playerNicknameInput.value.trim();
    if (Array.from(nickname).length < 1 || Array.from(nickname).length > 10) {
      alert('랭킹에 사용할 닉네임을 1~10자로 입력해주세요!');
      playerNicknameInput.focus();
      return;
    }
    rememberNickname(nickname);
    isMultiplayMode = false;
    leaderboardPanel.style.display = 'none';
    btnSingleStart.disabled = true;
    try {
      currentGameSession = await createGameSession(nickname);
      singleSessionStartedAt = performance.now();
      startGamePlay('timeAttack');
    } catch (error) {
      currentGameSession = null;
      singleSessionStartedAt = 0;
      alert(error?.message?.includes('닉네임')
        ? error.message
        : '게임 세션을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      btnSingleStart.disabled = false;
    }
  });

  // 멀티 대기방 화면으로 이동
  btnMultiLobby.addEventListener('click', () => {
    if (playerNicknameInput.value.trim()) {
      lobbyNicknameInput.value = playerNicknameInput.value.trim();
    }
    modeSelection.style.display = 'none';
    multiLobbyCard.style.display = 'flex';
    lobbyNicknameInput.focus();
  });

  // 모드 선택으로 돌아가기
  btnLobbyBack.addEventListener('click', () => {
    multiLobbyCard.style.display = 'none';
    modeSelection.style.display = 'flex';
  });

  // 실시간 소켓 연결 및 리스너 등록
  async function initSocketConnection() {
    if (socket) return socket;

    socket = await createSocketClient();

    socket.on('connect', () => {
      console.log("🟢 서버 연결 성공: ", socket.id);
    });

    socket.on('roomJoined', ({ roomId, nickname }) => {
      currentRoomId = roomId;
      rememberNickname(nickname);
      currentIsHost = false;
      updateLobbyModeControls();

      // UI 전환: 대기방 카드 닫고, 대기방 오버레이 열기
      multiLobbyCard.style.display = 'none';
      modeSelection.style.display = 'flex'; // 다음 재방문을 위해 초기화
      roomBadge.textContent = `방 코드: ${roomId}`;
      lobbyRoomBadge.textContent = `방 코드: ${roomId}`;
      
      // 웰컴 오버레이를 완전히 가림 (relative 레이아웃 겹침 차단)
      welcomeOverlay.classList.add('hide');
      
      lobbyOverlay.classList.remove('hide');
      leaderboardPanel.style.display = 'none'; // 대기 중에는 인게임 리더보드 숨김
    });

    // 대기방 인원 변동 수신 (점수 및 실시간 랭킹 순위표 포함)
    socket.on('lobbyUpdate', ({ players, hostId }) => {
      lobbyPList.innerHTML = '';
      currentIsHost = socket?.id === hostId;
      updateLobbyModeControls();
      lobbyWaitingInfo.textContent = currentIsHost
        ? `현재 ${players.length}/${MAX_ROOM_PLAYERS}명 · 준비되면 전체 게임을 시작하세요.`
        : `현재 ${players.length}/${MAX_ROOM_PLAYERS}명 · 방장이 시작할 때까지 기다리는 중입니다.`;
      players.forEach((p, index) => {
        const isMe = p.nickname === currentNickname;
        const rank = index + 1;
        
        // 랭킹 뱃지 이모지
        let rankEmoji = `<span>${rank}등</span>`;
        if (rank === 1) rankEmoji = '<span class="rank-tone rank-tone-gold">🏆 1등</span>';
        else if (rank === 2) rankEmoji = '<span class="rank-tone rank-tone-silver">🥈 2등</span>';
        else if (rank === 3) rankEmoji = '<span class="rank-tone rank-tone-bronze">🥉 3등</span>';

        const pItem = document.createElement('div');
        pItem.className = `lobby-p-item ${isMe ? 'is-me' : ''}`;
        
        const crownHtml = p.isHost ? '<span class="host-crown">👑</span>' : '';
        const hostBadgeHtml = p.isHost ? '<span class="host-lbl">방장</span>' : '';
        const meTagHtml = isMe ? ' <small class="me-tag">(나)</small>' : '';
        
        pItem.innerHTML = `
          <div class="lobby-player-meta">
            <span class="lobby-rank-badge">${rankEmoji}</span>
            <span class="lobby-p-name">
              ${crownHtml}${escapeHTML(p.nickname)}${meTagHtml}${hostBadgeHtml}
            </span>
          </div>
          <span class="lobby-p-score">
            ${(p.score || 0).toLocaleString()}점
          </span>
        `;
        lobbyPList.appendChild(pItem);
      });
    });

    socket.on('errorMsg', (msg) => {
      alert(`⚠️ 오류: ${msg}`);
      if (socket) {
        socket.disconnect();
        socket = null;
      }
      lobbyOverlay.classList.add('hide');
      isMultiplayMode = false;
      currentIsHost = false;
      updateLobbyModeControls();
    });

    socket.on('leaderboardUpdate', (players) => {
      updateLeaderboardUI(players);
    });

    socket.on('gameStart', () => {
      lobbyOverlay.classList.add('hide');
      leaderboardPanel.style.display = 'block';
      startGamePlay('timeAttack');
    });

    socket.on('disconnect', () => {
      console.warn("🔴 서버 연결 종료");
    });
    return socket;
  }

  // 대기방 새로 만들기 클릭
  btnCreateRoom.addEventListener('click', async () => {
    const nickname = lobbyNicknameInput.value.trim();
    if (!nickname) {
      alert("닉네임을 입력해주세요!");
      lobbyNicknameInput.focus();
      return;
    }
    if (/\s/.test(nickname)) {
      alert("닉네임에 공백은 사용할 수 없습니다!");
      lobbyNicknameInput.focus();
      return;
    }
    rememberNickname(nickname);
    
    // 무작위 6자리 방 코드 생성 (알파벳 대문자만)
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let generatedRoomId = "";
    for (let i = 0; i < 6; i++) {
      generatedRoomId += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    isMultiplayMode = true;
    currentGameSession = null;
    singleSessionStartedAt = 0;
    try {
      await initSocketConnection();
    } catch (error) {
      socket = null;
      alert('?좑툘 ?곌껐???쒖옉?섏? 紐삵뻽?듬땲?? ?좎떆 ???ㅼ떆 ?쒕룄?댁＜?몄슂.');
      return;
    }

    // 서버에 방 생성 및 입장 전송
    socket.emit('joinRoom', { roomId: generatedRoomId, nickname });
  });

  // 대기방 참여 버튼 클릭 (직접 코드 기입)
  btnJoinRoom.addEventListener('click', async () => {
    const nickname = lobbyNicknameInput.value.trim();
    const roomId = lobbyRoomIdInput.value.trim().toUpperCase();

    if (!nickname) {
      alert("닉네임을 입력해주세요!");
      lobbyNicknameInput.focus();
      return;
    }
    if (/\s/.test(nickname)) {
      alert("닉네임에 공백은 사용할 수 없습니다!");
      lobbyNicknameInput.focus();
      return;
    }
    rememberNickname(nickname);
    if (!roomId) {
      alert("방 코드를 입력해주세요!");
      lobbyRoomIdInput.focus();
      return;
    }
    if (roomId.length !== 6 || !/^[A-Z]{6}$/.test(roomId)) {
      alert("방 코드는 영어 알파벳 6자리여야 합니다!");
      lobbyRoomIdInput.focus();
      return;
    }

    isMultiplayMode = true;
    currentGameSession = null;
    singleSessionStartedAt = 0;
    try {
      await initSocketConnection();
    } catch (error) {
      socket = null;
      alert('?좑툘 ?곌껐???쒖옉?섏? 紐삵뻽?듬땲?? ?좎떆 ???ㅼ떆 ?쒕룄?댁＜?몄슂.');
      return;
    }

    // 서버에 방 입장 전송
    socket.emit('joinRoom', { roomId, nickname });
  });

  // 대기실에서 방장이 전체 플레이어의 게임을 동시에 시작
  btnLobbyPlay.addEventListener('click', () => {
    if (!currentIsHost) return;
    if (!socket || !socket.connected) {
      alert('서버 연결이 끊겼습니다. 방에 다시 입장해주세요!');
      return;
    }
    btnLobbyPlay.disabled = true;
    btnLobbyPlay.textContent = '⏳ 게임 시작 신호 전송 중...';
    socket.emit('startGame');
  });

  // 대기방 코드 클릭 시 클립보드 복사
  lobbyRoomBadge.addEventListener('click', () => {
    if (!currentRoomId) return;
    navigator.clipboard.writeText(currentRoomId).then(() => {
      const originalText = lobbyRoomBadge.textContent;
      lobbyRoomBadge.textContent = "📋 복사 완료!";
      lobbyRoomBadge.classList.add('is-copied');
      setTimeout(() => {
        lobbyRoomBadge.textContent = `방 코드: ${currentRoomId}`;
        lobbyRoomBadge.classList.remove('is-copied');
      }, 1200);
    }).catch(err => {
      console.error("복사 실패: ", err);
    });
  });

  // 대기방 나가기 버튼 클릭 이벤트
  btnLobbyExit.addEventListener('click', () => {
    lobbyOverlay.classList.add('hide');
    welcomeOverlay.classList.remove('hide');
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    isMultiplayMode = false;
    currentIsHost = false;
    updateLobbyModeControls();
    leaderboardPanel.style.display = 'none';
  });

  // 실시간 리더보드 드로잉 렌더링
  function updateLeaderboardUI(players) {
    leaderboardList.innerHTML = '';
    renderLeaderboard(leaderboardList, players, currentNickname);
  }

  function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
      tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[tag] || tag)
    );
  }

  btnRetry.addEventListener('click', () => {
    isGameActive = false;
    void resumeMenuBgm();
    gameOverOverlay.classList.remove('show');

    if (isMultiplayMode) {
      // 멀티플레이 모드인 경우, 소켓 끊지 않고 대기방으로 유턴!
      lobbyOverlay.classList.remove('hide');
      leaderboardPanel.style.display = 'none'; // 대기방에서는 리더보드 가림
      
      // 내 게임 화면 점수 및 상태 초기화
      score = 0;
      combo = 0;
      maxCombo = 0;
      scoreVal.textContent = '0';
      comboVal.textContent = '0';
      comboBadge.style.display = 'none';
      
      // 대기실 복귀 즉시 최신 대기방 정보(점수/참여자 목록) 재조회 요청!
      if (socket && socket.connected) {
        socket.emit('requestLobbyUpdate');
      }
      // 내 점수를 유지하여 대기방 순위표에 뽐낼 수 있도록 하며, 0점 리셋은 다음 게임 플레이 시작 버튼을 누를 때 수행합니다.
    } else {
      // 싱글플레이 모드인 경우, 웰컴 메인 화면으로 귀환
      welcomeOverlay.classList.remove('hide');
    }
  });

  scoreSubmitRetry.addEventListener('click', () => {
    saveFinalScoreAndLoadLeaderboard();
  });

  document.addEventListener('click', event => {
    if (!event.target?.id) return;

    if (event.target.id === 'btn-global-ranking-daily') {
      loadGlobalLeaderboard('daily');
    }

    if (event.target.id === 'btn-global-ranking-weekly') {
      loadGlobalLeaderboard('weekly');
    }
  });
    
}
