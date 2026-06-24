import {
  BOARD_SIZE,
  MAX_TIME,
  TILE_NUMBER_MIN,
  TILE_NUMBER_MAX,
  ENABLE_BOSS_RAID,
  MAX_ROOM_PLAYERS,
  RAID_HP_PER_PLAYER,
  FEVER_TRIGGER_MIN_LENGTH,
  FEVER_DURATION_MS,
  FEVER_ROLLBACK_MS,
  FEVER_AMOUNTS
} from './gameConstants.js';
import { createSocketClient } from './socketClient.js';
import { renderLeaderboard } from './ui.js';

export function initGameApp() {
  // ----------------------------------------------------
  // 게임 엔진 상태 데이터
  // ----------------------------------------------------

  function getRandomNumber() {
    return Math.floor(Math.random() * (TILE_NUMBER_MAX - TILE_NUMBER_MIN + 1)) + TILE_NUMBER_MIN;
  }

  function createNormalTileData() {
    return {
      baseValue: getRandomNumber(),
      type: 'normal'
    };
  }

  function createFeverTileData() {
    return {
      baseValue: getRandomNumber(),
      type: 'fever',
      feverAmount: FEVER_AMOUNTS[Math.floor(Math.random() * FEVER_AMOUNTS.length)]
    };
  }

  function getDisplayValue(tileData) {
    if (!tileData) return '';
    if (tileData.type === 'fever') {
      return `+${tileData.feverAmount}`;
    }
    return tileData.baseValue + (fever.active ? fever.amount : 0);
  }

  function hasFeverTile() {
    return boardData.some(row => row.some(tileData => tileData?.type === 'fever'));
  }

  function updateTileElement(tileElement, tileData) {
    tileElement.textContent = getDisplayValue(tileData);
    tileElement.classList.toggle('fever-tile', tileData?.type === 'fever');
    tileElement.dataset.tileType = tileData?.type || 'normal';
    tileElement.dataset.baseValue = tileData?.baseValue ?? '';
    tileElement.dataset.feverAmount = tileData?.feverAmount ?? '';
  }

  function renderBoard() {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const tileElement = document.getElementById(`tile-${r}-${c}`);
        if (tileElement) {
          updateTileElement(tileElement, boardData[r][c]);
        }
      }
    }
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
  let pendingFeverSpawn = false;
  const fever = {
    active: false,
    ending: false,
    amount: 0,
    timeLeftMs: 0,
    timer: null
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
  const multiLobbyCard = document.getElementById('multi-lobby-card');
  const modeSelection = document.getElementById('mode-selection');
  const btnLobbyBack = document.getElementById('btn-lobby-back');
  const btnJoinRoom = document.getElementById('btn-join-room');
  const btnLobbyRaid = document.createElement('button');
  const lobbyNicknameInput = document.getElementById('lobby-nickname');
  const lobbyRoomIdInput = document.getElementById('lobby-room-id');
  const leaderboardPanel = document.getElementById('leaderboard-panel');
  const leaderboardList = document.getElementById('leaderboard-list');
  const roomBadge = document.getElementById('room-badge');
  const bossRaidPanel = document.getElementById('boss-raid-panel');
  const raidBossPortrait = document.getElementById('raid-boss-portrait');
  const raidBossTitle = document.getElementById('raid-boss-title');
  const raidBossHpFill = document.getElementById('raid-boss-hp-fill');
  const raidBossHpText = document.getElementById('raid-boss-hp-text');
  const raidTotalDamage = document.getElementById('raid-total-damage');
  const raidContributors = document.getElementById('raid-contributors');
  const raidDamagePop = document.getElementById('raid-damage-pop');
  const raidElapsedTime = document.getElementById('raid-elapsed-time');
  const raidParticipants = document.getElementById('raid-participants');

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

  btnLobbyRaid.className = 'btn-start';
  btnLobbyRaid.id = 'btn-lobby-raid';
  btnLobbyRaid.style.cssText = 'background: linear-gradient(135deg, #14532d 0%, #991b1b 100%); width: 100%;';
  btnLobbyPlay.insertAdjacentElement('afterend', btnLobbyRaid);
  btnLobbyRaid.hidden = !ENABLE_BOSS_RAID;

  bestScoreVal.textContent = bestScore;
  welcomeBestVal.textContent = bestScore;

  let raidPlayers = [];
  let lastRaidDamage = 0;
  let raidPlayerCount = 1;
  let raidBossMaxHp = RAID_HP_PER_PLAYER;
  let raidStartTime = 0;
  let raidElapsedMs = 0;
  let raidClearTime = null;
  let raidTimer = null;

  function formatRaidNumber(value) {
    return Math.max(0, Math.floor(value)).toLocaleString('ko-KR');
  }

  function formatRaidTime(ms) {
    const safeMs = Math.max(0, Math.floor(ms || 0));
    const totalTenths = Math.floor(safeMs / 100);
    const minutes = Math.floor(totalTenths / 600);
    const seconds = Math.floor((totalTenths % 600) / 10);
    const tenths = totalTenths % 10;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
  }

  function applyRaidConfig(config = {}) {
    const nextPlayerCount = Number(config.playerCount);
      raidPlayerCount = Math.max(1, Math.min(MAX_ROOM_PLAYERS, Number.isFinite(nextPlayerCount) ? nextPlayerCount : raidPlayerCount));
    const nextMaxHp = Number(config.maxHp);
    raidBossMaxHp = Math.max(RAID_HP_PER_PLAYER, Number.isFinite(nextMaxHp) ? nextMaxHp : raidPlayerCount * RAID_HP_PER_PLAYER);
  }

  function updateRaidClockUI(isCleared = false) {
    const label = isCleared ? '격파' : '경과';
    raidElapsedTime.textContent = `${label} ${formatRaidTime(raidElapsedMs)}`;
  }

  function startRaidClock() {
    stopRaidClock();
    raidStartTime = performance.now();
    raidElapsedMs = 0;
    updateRaidClockUI();
    raidTimer = setInterval(() => {
      raidElapsedMs = performance.now() - raidStartTime;
      updateRaidClockUI();
      tickComboTimer();
    }, 100);
  }

  function stopRaidClock() {
    if (raidTimer) {
      clearInterval(raidTimer);
      raidTimer = null;
    }
  }

  function updateFeverUI() {
    const isVisible = fever.active || fever.ending;
    feverPanel.classList.toggle('show', isVisible);
    gameContainer.classList.toggle('fever-active', fever.active);
    boardWrapper.classList.toggle('fever-active', fever.active);

    const percentage = fever.active
      ? Math.max(0, Math.min(100, (fever.timeLeftMs / FEVER_DURATION_MS) * 100))
      : 0;
    feverTimerFill.style.width = `${percentage}%`;
    feverTimerText.textContent = fever.active
      ? `피버 +${fever.amount} · ${(fever.timeLeftMs / 1000).toFixed(1)}s`
      : '피버 종료!';
  }

  function resetFeverState() {
    if (fever.timer) {
      clearInterval(fever.timer);
      fever.timer = null;
    }
    fever.active = false;
    fever.ending = false;
    fever.amount = 0;
    fever.timeLeftMs = 0;
    pendingFeverSpawn = false;
    boardWrapper.classList.remove('fever-active', 'fever-rollback');
    gameContainer.classList.remove('fever-active');
    feverNotice.classList.remove('show');
    updateFeverUI();
  }

  function showFeverNotice(message) {
    feverNotice.textContent = message;
    feverNotice.classList.remove('show');
    void feverNotice.offsetWidth;
    feverNotice.classList.add('show');
  }

  function startFeverMode(amount) {
    if (fever.active || fever.ending || isGameOver || !isGameActive) return;

    fever.active = true;
    fever.ending = false;
    fever.amount = amount;
    fever.timeLeftMs = FEVER_DURATION_MS;
    showFeverNotice(`피버 +${amount}!`);
    renderBoard();
    updateFeverUI();

    if (fever.timer) clearInterval(fever.timer);
    fever.timer = setInterval(() => {
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

    if (fever.timer) {
      clearInterval(fever.timer);
      fever.timer = null;
    }

    fever.active = false;
    fever.ending = true;
    fever.timeLeftMs = 0;
    isDragging = false;
    selectedTiles.forEach(t => t.element.classList.remove('selected', 'last-selected', 'matched'));
    selectedTiles = [];
    dragLine.setAttribute('d', '');
    dragLineGlow.setAttribute('d', '');

    showFeverNotice('피버 종료!');
    boardWrapper.classList.add('fever-rollback');
    renderBoard();
    updateFeverUI();

    setTimeout(() => {
      fever.ending = false;
      fever.amount = 0;
      boardWrapper.classList.remove('fever-rollback');
      feverNotice.classList.remove('show');
      updateFeverUI();
    }, FEVER_ROLLBACK_MS);
  }

  function maybeQueueFeverSpawn(len, allSame) {
    if (len < FEVER_TRIGGER_MIN_LENGTH) return;
    if (allSame || fever.active || fever.ending || pendingFeverSpawn || hasFeverTile()) return;

    pendingFeverSpawn = true;
  }

  function spawnQueuedFeverBlock() {
    if (!pendingFeverSpawn || fever.active || fever.ending || hasFeverTile()) {
      pendingFeverSpawn = false;
      return;
    }

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
      boardData[target.r][target.c] = createFeverTileData();
      showFeverNotice('피버 블록 등장!');
    }

    pendingFeverSpawn = false;
  }

  function getLocalRaidPlayers() {
    const nickname = currentNickname || '나';
    const others = raidPlayers.filter(player => player.nickname !== nickname);
    return [...others, { nickname, score }];
  }

  function resetRaidState() {
    raidPlayers = [{ nickname: currentNickname || '나', score: 0 }];
    lastRaidDamage = 0;
    raidClearTime = null;
    raidElapsedMs = 0;
    stopRaidClock();
    raidBossPortrait.classList.remove('defeated', 'hit');
    bossRaidPanel.classList.remove('hit');
    raidBossHpFill.classList.remove('hit');
    raidBossTitle.textContent = '가시 멜론 군주';
    updateRaidUI(raidPlayers, true);
    updateRaidClockUI();
  }

  function updateRaidUI(players = getLocalRaidPlayers(), skipHit = false) {
    raidPlayers = players.map(player => ({
      nickname: player.nickname || '???',
      score: Math.max(0, Number(player.score) || 0)
    }));

    const totalDamage = raidPlayers.reduce((sum, player) => sum + player.score, 0);
    const bossHp = Math.max(0, raidBossMaxHp - totalDamage);
    const hpPercent = (bossHp / raidBossMaxHp) * 100;
    const damageDelta = totalDamage - lastRaidDamage;
    const displayPlayerCount = Math.max(raidPlayerCount, raidPlayers.length);

    raidBossHpFill.style.width = `${hpPercent}%`;
    raidBossHpText.textContent = `${formatRaidNumber(bossHp)} / ${formatRaidNumber(raidBossMaxHp)}`;
    raidTotalDamage.textContent = `공동 피해 ${formatRaidNumber(totalDamage)}`;
      raidParticipants.textContent = `참여 ${displayPlayerCount}/${MAX_ROOM_PLAYERS}`;
    raidContributors.textContent = raidPlayers.length
      ? raidPlayers
          .slice()
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map(player => `${player.nickname} ${formatRaidNumber(player.score)}딜`)
          .join(' · ')
      : '참여자 없음';

    if (!skipHit && damageDelta > 0) {
      triggerRaidBossHit(damageDelta);
    }

    if (bossHp <= 0) {
      raidBossPortrait.classList.add('defeated');
      raidBossTitle.textContent = '가시 멜론 군주 격파!';
      triggerRaidClear();
    } else {
      raidBossPortrait.classList.remove('defeated');
      raidBossTitle.textContent = '가시 멜론 군주';
    }

    lastRaidDamage = totalDamage;
  }

  function triggerRaidBossHit(damage) {
    raidDamagePop.textContent = `-${formatRaidNumber(damage)}`;
    raidDamagePop.classList.remove('show');
    raidBossPortrait.classList.remove('hit');
    bossRaidPanel.classList.remove('hit');
    raidBossHpFill.classList.remove('hit');
    gameContainer.classList.remove('raid-impact');
    void raidDamagePop.offsetWidth;
    raidDamagePop.classList.add('show');
    raidBossPortrait.classList.add('hit');
    bossRaidPanel.classList.add('hit');
    raidBossHpFill.classList.add('hit');
    gameContainer.classList.add('raid-impact');
    setTimeout(() => {
      raidBossPortrait.classList.remove('hit');
      bossRaidPanel.classList.remove('hit');
      raidBossHpFill.classList.remove('hit');
      gameContainer.classList.remove('raid-impact');
    }, 380);
  }

  function triggerRaidClear() {
    if (raidClearTime !== null) return;
    raidClearTime = raidElapsedMs || Math.max(0, performance.now() - raidStartTime);
    raidElapsedMs = raidClearTime;
    stopRaidClock();
    updateRaidClockUI(true);

    isGameOver = true;
    isGameActive = false;
    isDragging = false;
    dragLine.setAttribute('d', '');
    dragLineGlow.setAttribute('d', '');
    selectedTiles.forEach(t => t.element.classList.remove('selected', 'last-selected'));

    gameOverTitle.textContent = '보스 격파!';
    gameOverDesc.textContent = `참여 ${Math.max(raidPlayerCount, raidPlayers.length)}명 · 공동 피해 ${formatRaidNumber(raidBossMaxHp)}`;
    resultLabel.textContent = '격파 시간';
    finalScoreText.textContent = formatRaidTime(raidClearTime);
    resultUnit.textContent = '';
    btnRetry.textContent = '🔄 대기실로 돌아가기';
    gameOverOverlay.classList.add('show');
  }

  function updateLobbyModeControls() {
    if (!ENABLE_BOSS_RAID) {
      btnLobbyRaid.hidden = true;
      return;
    }
    btnLobbyRaid.disabled = !currentIsHost;
    btnLobbyRaid.textContent = currentIsHost ? '⚔️ 보스레이드 시작 (방장)' : '⚔️ 보스레이드 대기중';
    btnLobbyRaid.title = currentIsHost ? '같은 방 모두를 보스레이드로 시작합니다.' : '보스레이드는 방장만 시작할 수 있습니다.';
    btnLobbyRaid.style.opacity = currentIsHost ? '1' : '0.48';
    btnLobbyRaid.style.cursor = currentIsHost ? 'pointer' : 'not-allowed';
  }

  // 1. 플레이 시작 (보드 생성 후 카운트다운 진입)
  function startGamePlay(mode = 'timeAttack') {
    currentGameMode = mode;
    const isRaidMode = currentGameMode === 'bossRaid';
    gameContainer.classList.toggle('raid-mode', isRaidMode);
    scoreLabel.textContent = isRaidMode ? '내 피해' : '현재 점수';
    if (isRaidMode) {
      leaderboardPanel.style.display = 'none';
    }
    welcomeOverlay.classList.add('hide');
    lobbyOverlay.classList.add('hide'); // 대기방도 확실하게 가림
    
    score = 0;
    combo = 0;
    maxCombo = 0;
    timeLeft = MAX_TIME;
    comboTimeLeft = 5.0; // 콤보 타임아웃 초기화
    isGameOver = false;
    isGameActive = false; // 카운트다운이 완전히 끝날 때까지 조작 제한
    selectedTiles = [];
    resetFeverState();

    // 멀티플레이 모드일 때 서버에 시작 점수(0점) 전송하여 대시보드 리셋
    if (isMultiplayMode && socket && socket.connected) {
      socket.emit('updateScore', { score: 0 });
    }
    
    scoreVal.textContent = '0';
    comboVal.textContent = '0';
    comboBadge.textContent = '🔥';
    comboBadge.style.display = 'none';
    gameOverOverlay.classList.remove('show');
    if (isRaidMode) {
      resetRaidState();
    }
    
    boardData = [];
    boardElement.innerHTML = '';
    
    for (let r = 0; r < BOARD_SIZE; r++) {
      boardData[r] = [];
      for (let c = 0; c < BOARD_SIZE; c++) {
        const tileData = createNormalTileData();
        boardData[r][c] = tileData;
        
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.dataset.row = r;
        tile.dataset.col = c;
        tile.id = `tile-${r}-${c}`;
        updateTileElement(tile, tileData);
        
        boardElement.appendChild(tile);
      }
    }

    if (gameTimer) clearInterval(gameTimer);
    stopRaidClock();
    updateTimerUI();
    dragLine.setAttribute('d', '');
    dragLineGlow.setAttribute('d', '');

    // 중앙 카운트다운 시퀀스 작동 후 타이머 및 드래그 가동
    startCountdownSequence(() => {
      isGameActive = true;
      if (isRaidMode) {
        startRaidClock();
      } else {
        gameTimer = setInterval(tickTimer, 100);
      }
    });
  }

  // 게임 시작 전 중앙 3, 2, 1 카운트다운 연출
  function startCountdownSequence(onComplete) {
    countdownOverlay.classList.add('show');
    
    const counts = ["3", "2", "1", "시작! 🍈"];
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
      
      // 귀엽고 아기자기한 비프음 소리 피드백
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        if (idx === counts.length - 1) {
          // "시작!" 일 때는 조금 더 산뜻하고 높은 화음
          oscillator.frequency.setValueAtTime(660, audioCtx.currentTime);
          gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
          gainNode.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
          oscillator.start();
          oscillator.stop(audioCtx.currentTime + 0.3);
        } else {
          // 일반 카운트는 뚜, 뚜, 뚜
          oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
          gainNode.gain.setValueAtTime(0.06, audioCtx.currentTime);
          gainNode.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
          oscillator.start();
          oscillator.stop(audioCtx.currentTime + 0.15);
        }
      } catch (e) {}

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
        comboVal.textContent = '0';
        comboBadge.style.display = 'none';
        comboBadge.textContent = '🔥';
        playComboExpireSound();
      } else {
        // 콤보 배지에 남은 시간 앙증맞게 시각화
        comboBadge.textContent = `🔥 ${comboTimeLeft.toFixed(1)}s`;
      }
    }
  }

  function playComboExpireSound() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(220, audioCtx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(110, audioCtx.currentTime + 0.16);
      gainNode.gain.setValueAtTime(0.04, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.16);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.16);
    } catch (e) {}
  }

  function updateTimerUI() {
    const percentage = (timeLeft / MAX_TIME) * 100;
    timerBar.style.width = `${percentage}%`;
    timerText.textContent = `${timeLeft.toFixed(1)}s`;

    if (timeLeft < 15) {
      timerBar.classList.add('warning');
    } else {
      timerBar.classList.remove('warning');
    }
  }


  function triggerGameOver() {
      isGameOver = true;
      isDragging = false;
      clearInterval(gameTimer);
      stopRaidClock();
      resetFeverState();

    dragLine.setAttribute('d', '');
    dragLineGlow.setAttribute('d', '');
    selectedTiles.forEach(t => t.element.classList.remove('selected', 'last-selected'));

    gameOverTitle.textContent = '타임 오버!';
    gameOverDesc.textContent = '수고하셨습니다. 당신의 기록은...';
    resultLabel.textContent = '최종 점수';
    finalScoreText.textContent = score;
    resultUnit.textContent = '점';

    // 멀티플레이 모드일 때 최종 점수 동기화 확인 사격 및 버튼 텍스트 대응
    if (isMultiplayMode) {
      if (socket && socket.connected) {
        socket.emit('updateScore', { score: score });
      }
      btnRetry.textContent = "🔄 대기실로 돌아가기";
    } else {
      btnRetry.textContent = "🔄 메인 화면으로 돌아가기";
    }

    gameOverOverlay.classList.add('show');
  }

  // 포인터 위치 타일
  function getTileAtPosition(x, y) {
    const tiles = document.querySelectorAll('.tile');
    let targetTile = null;

    tiles.forEach(tile => {
      const rect = tile.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      const dist = Math.hypot(x - centerX, y - centerY);
      const activeRadius = rect.width * 0.4;
      
      if (dist < activeRadius) {
        targetTile = tile;
      }
    });

    return targetTile;
  }

  function handleStart(clientX, clientY) {
    if (isGameOver || !isGameActive || fever.ending) return;
    const tile = getTileAtPosition(clientX, clientY);
    if (tile) {
      const r = parseInt(tile.dataset.row);
      const c = parseInt(tile.dataset.col);
      const tileData = boardData[r][c];
      if (tileData?.type === 'fever') {
        boardData[r][c] = createNormalTileData();
        updateTileElement(tile, boardData[r][c]);
        startFeverMode(tileData.feverAmount);
        return;
      }
    }

    isDragging = true;
    if (tile) {
      selectTile(tile);
    }
  }

  function handleMove(clientX, clientY) {
    if (!isDragging || isGameOver || !isGameActive || fever.ending) return;
    const tile = getTileAtPosition(clientX, clientY);
    if (!tile) {
      updateDragLine(clientX, clientY);
      return;
    }

    const r = parseInt(tile.dataset.row);
    const c = parseInt(tile.dataset.col);

    if (selectedTiles.length > 1) {
      const lastSecond = selectedTiles[selectedTiles.length - 2];
      if (lastSecond.row === r && lastSecond.col === c) {
        const popped = selectedTiles.pop();
        popped.element.classList.remove('selected', 'last-selected');
        
        if (selectedTiles.length > 0) {
          selectedTiles[selectedTiles.length - 1].element.classList.add('last-selected');
        }
        
        playAudioTick(true);
        updateDragLine(clientX, clientY);
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

    selectTile(tile);
    updateDragLine(clientX, clientY);
  }

  function handleEnd() {
    if (!isDragging) return;
    isDragging = false;

    if (selectedTiles.length >= 3) {
      evaluateSequence();
    } else {
      clearSelection();
    }
  }

  function selectTile(tileElement) {
    const r = parseInt(tileElement.dataset.row);
    const c = parseInt(tileElement.dataset.col);
    const tileData = boardData[r][c];
    if (!tileData || tileData.type === 'fever') return;
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

    playAudioTick(false);
  }

  function updateDragLine(currentX, currentY) {
    if (selectedTiles.length === 0) {
      dragLine.setAttribute('d', '');
      dragLineGlow.setAttribute('d', '');
      return;
    }

    const wrapperRect = boardWrapper.getBoundingClientRect();
    const points = [];

    selectedTiles.forEach((tile) => {
      const rect = tile.element.getBoundingClientRect();
      const x = rect.left + rect.width / 2 - wrapperRect.left;
      const y = rect.top + rect.height / 2 - wrapperRect.top;
      points.push({ x, y });
    });

    if (isDragging && currentX !== undefined && currentY !== undefined) {
      const localX = currentX - wrapperRect.left;
      const localY = currentY - wrapperRect.top;
      if (localX >= 0 && localX <= wrapperRect.width && localY >= 0 && localY <= wrapperRect.height) {
        points.push({ x: localX, y: localY });
      }
    }

    const pathData = buildCenteredDragPath(points);
    dragLine.setAttribute('d', pathData);
    dragLineGlow.setAttribute('d', pathData);
  }

  function buildCenteredDragPath(points) {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    let pathData = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      pathData += ` L ${points[i].x} ${points[i].y}`;
    }
    return pathData;
  }

  // 판정
  function evaluateSequence() {
    const values = selectedTiles.map(t => t.value);
    const len = values.length;

    let isAP = true;
    const diff = values[1] - values[0];
    for (let i = 1; i < len - 1; i++) {
      if (values[i + 1] - values[i] !== diff) {
        isAP = false;
        break;
      }
    }

    let isGP = true;
    const ratio = values[1] / values[0];
    for (let i = 1; i < len - 1; i++) {
      if (Math.abs((values[i + 1] / values[i]) - ratio) > 1e-9) {
        isGP = false;
        break;
      }
    }
    const allSame = values.every(value => value === values[0]);
    const sequenceKind = allSame || (!isAP && isGP) ? 'GP' : 'AP';
    const sequenceRule = sequenceKind === 'GP'
      ? (allSame ? '1' : formatRatioValue(values[1], values[0]))
      : formatDifferenceValue(diff);

    if (isAP || isGP) {
      combo++;
      if (combo > maxCombo) {
        maxCombo = combo;
      }

      // 콤보 제한 시간 5초 완전 충전 리셋
      comboTimeLeft = 5.0;

      // 콤보 점수 보너스 대폭 강화 (비선형 가중치 체감형 점수 부스팅)
      const comboBonus = combo > 1 ? (combo - 1) * 80 * (1 + (combo * 0.15)) : 0;
      const basePoints = Math.floor((len * 100) + comboBonus);
      const points = fever.active ? basePoints * 2 : basePoints;
      score += points;
      
      if (currentGameMode !== 'bossRaid' && score > bestScore) {
        bestScore = score;
        localStorage.setItem('seq_pang_best', bestScore);
        bestScoreVal.textContent = bestScore;
        welcomeBestVal.textContent = bestScore;
      }

      scoreVal.textContent = score;
      scoreVal.classList.add('pop');
      setTimeout(() => scoreVal.classList.remove('pop'), 150);

      // 멀티플레이 모드일 때 서버에 실시간 점수 업데이트 전송
      if (isMultiplayMode && socket && socket.connected) {
        socket.emit('updateScore', { score: score });
      }

      comboVal.textContent = combo;
      comboBadge.style.display = 'inline-block';
      comboBadge.textContent = `🔥 ${comboTimeLeft.toFixed(1)}s`;

      // ── 수열 종류·공차별 시간 보너스 ──────────────────────────
      let bonusTime = 0;
      if (sequenceKind === 'GP') {
        // 등비수열: 공비 클수록 어렵고 보너스 큼
        const activeRatio = allSame ? 1 : ratio;
        bonusTime = activeRatio >= 2 ? 1.2 : 0.9;
      } else {
        // 등차수열: 공차가 클수록 어렵고 보너스 큼
        const absDiff = Math.abs(diff);
        if (absDiff >= 4)      bonusTime = 1.2;
        else if (absDiff >= 2) bonusTime = 1.0;
        else                   bonusTime = 0.7; // 공차 1은 쉬움
      }
      
      // 콤보 계수 비례 추가 시간을 제거하고, 맞춤 고정 보너스(0.5초)만 가산
      bonusTime += 0.5;
      
      if (fever.active) {
        fever.timeLeftMs = Math.min(MAX_TIME * 1000, fever.timeLeftMs + (bonusTime * 1000));
        updateFeverUI();
      } else if (currentGameMode !== 'bossRaid') {
        timeLeft = Math.min(MAX_TIME, timeLeft + bonusTime);
        updateTimerUI();
      }

      spawnFloatingScore(points, fever.active ? 2 : 1);
      spawnSequenceHintRich(sequenceKind, sequenceRule);
      if (currentGameMode === 'bossRaid') {
        updateRaidUI(getLocalRaidPlayers());
      }
      maybeQueueFeverSpawn(len, allSame);

      selectedTiles.forEach(t => t.element.classList.add('matched'));
      setTimeout(() => {
        eliminateAndRefill();
      }, 350);

    } else {
      combo = 0;
      comboVal.textContent = combo;
      comboBadge.style.display = 'none';
      comboBadge.textContent = '🔥';

      if (currentGameMode !== 'bossRaid') {
        timeLeft = Math.max(0, timeLeft - 3.0); // 패널티 완화 -3초
        updateTimerUI();
      }

      triggerFailureShock();

      selectedTiles.forEach(t => {
        t.element.style.backgroundColor = '#fecaca';
      });
      setTimeout(() => {
        clearSelection();
      }, 300);
    }
  }

  function formatDifferenceValue(value) {
    return value > 0 ? `+${value}` : `${value}`;
  }

  function formatRatioValue(numerator, denominator) {
    if (numerator % denominator === 0) {
      return {
        type: 'text',
        value: `${numerator / denominator}`
      };
    }

    const divisor = getGcd(Math.abs(numerator), Math.abs(denominator));
    return {
      type: 'fraction',
      numerator: numerator / divisor,
      denominator: denominator / divisor
    };
  }

  function getGcd(a, b) {
    while (b !== 0) {
      const remainder = a % b;
      a = b;
      b = remainder;
    }
    return a || 1;
  }

  function spawnSequenceHint(kind, ruleValue) {
    const lastTile = selectedTiles[selectedTiles.length - 1].element;
    const rect = lastTile.getBoundingClientRect();
    const wrapperRect = boardWrapper.getBoundingClientRect();

    const x = rect.left + rect.width / 2 - wrapperRect.left;
    const y = rect.top + rect.height / 2 - wrapperRect.top - 22;
    const label = kind === 'GP' ? '등비수열' : '등차수열';
    const ruleName = kind === 'GP' ? '공비' : '공차';

    const hintSpan = document.createElement('span');
    hintSpan.className = 'sequence-hint';
    hintSpan.textContent = `${label} · ${ruleName} ${ruleValue}`;
    hintSpan.style.left = `${x}px`;
    hintSpan.style.top = `${y}px`;

    boardWrapper.appendChild(hintSpan);
    const hintRect = hintSpan.getBoundingClientRect();
    const clampedX = Math.min(
      Math.max(x, hintRect.width / 2 + 8),
      wrapperRect.width - hintRect.width / 2 - 8
    );
    hintSpan.style.left = `${clampedX}px`;

    setTimeout(() => {
      hintSpan.remove();
    }, 1150);
  }

  function spawnSequenceHintRich(kind, ruleValue) {
    const lastTile = selectedTiles[selectedTiles.length - 1].element;
    const rect = lastTile.getBoundingClientRect();
    const wrapperRect = boardWrapper.getBoundingClientRect();

    const x = rect.left + rect.width / 2 - wrapperRect.left;
    const y = rect.top + rect.height / 2 - wrapperRect.top - 22;
    const label = kind === 'GP' ? '등비수열' : '등차수열';
    const ruleName = kind === 'GP' ? '공비' : '공차';

    const hintSpan = document.createElement('span');
    hintSpan.className = 'sequence-hint';
    hintSpan.append(
      document.createTextNode(`${label} · ${ruleName} `),
      createRuleValueElement(ruleValue)
    );
    hintSpan.style.left = `${x}px`;
    hintSpan.style.top = `${y}px`;

    boardWrapper.appendChild(hintSpan);
    const hintRect = hintSpan.getBoundingClientRect();
    const clampedX = Math.min(
      Math.max(x, hintRect.width / 2 + 8),
      wrapperRect.width - hintRect.width / 2 - 8
    );
    hintSpan.style.left = `${clampedX}px`;

    setTimeout(() => {
      hintSpan.remove();
    }, 1150);
  }

  function createRuleValueElement(ruleValue) {
    if (typeof ruleValue === 'string') {
      return document.createTextNode(ruleValue);
    }

    if (ruleValue.type === 'text') {
      return document.createTextNode(ruleValue.value);
    }

    const fraction = document.createElement('span');
    fraction.className = 'sequence-fraction';

    const numerator = document.createElement('span');
    numerator.className = 'sequence-fraction-num';
    numerator.textContent = ruleValue.numerator;

    const bar = document.createElement('span');
    bar.className = 'sequence-fraction-bar';

    const denominator = document.createElement('span');
    denominator.className = 'sequence-fraction-den';
    denominator.textContent = ruleValue.denominator;

    fraction.append(numerator, bar, denominator);
    return fraction;
  }

  function spawnFloatingScore(scoreVal, multiplier = 1) {
    const lastTile = selectedTiles[selectedTiles.length - 1].element;
    const rect = lastTile.getBoundingClientRect();
    const wrapperRect = boardWrapper.getBoundingClientRect();

    const x = rect.left + rect.width / 2 - wrapperRect.left;
    const y = rect.top + rect.height / 2 - wrapperRect.top;

    const floatSpan = document.createElement('span');
    floatSpan.className = 'floating-score';
    floatSpan.textContent = multiplier > 1 ? `+${scoreVal} x${multiplier}` : `+${scoreVal}`;
    floatSpan.classList.toggle('fever-score', multiplier > 1);
    floatSpan.style.left = `${x}px`;
    floatSpan.style.top = `${y}px`;

    boardWrapper.appendChild(floatSpan);

    setTimeout(() => {
      floatSpan.remove();
    }, 800);
  }

  function triggerFailureShock() {
    timerContainer.classList.add('shake');
    boardWrapper.classList.add('shake');
    
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.frequency.setValueAtTime(140, audioCtx.currentTime);
      oscillator.frequency.linearRampToValueAtTime(70, audioCtx.currentTime + 0.25);
      gainNode.gain.setValueAtTime(0.18, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.25);
    } catch(e) {}

    setTimeout(() => {
      timerContainer.classList.remove('shake');
      boardWrapper.classList.remove('shake');
    }, 400);
  }

  function eliminateAndRefill() {
    selectedTiles.forEach(tile => {
      boardData[tile.row][tile.col] = null;
    });

    for (let c = 0; c < BOARD_SIZE; c++) {
      let tempCol = [];
      
      for (let r = BOARD_SIZE - 1; r >= 0; r--) {
        if (boardData[r][c] !== null) {
          tempCol.push(boardData[r][c]);
        }
      }
      
      const missingCount = BOARD_SIZE - tempCol.length;
      for (let i = 0; i < missingCount; i++) {
        tempCol.push(createNormalTileData());
      }
      
      tempCol.reverse();
      
      for (let r = 0; r < BOARD_SIZE; r++) {
        boardData[r][c] = tempCol[r];
      }
    }

    spawnQueuedFeverBlock();
    renderGravityRefill();
    clearSelection();
  }

  function renderGravityRefill() {
    // 열별로 빈칸 개수를 계산해 낙하 거리·딜레이 결정
    for (let c = 0; c < BOARD_SIZE; c++) {
      let newRowCount = 0; // 이 열에서 새로 생성된 타일 수

      // 먼저 몇 개가 새 값인지 파악 (renderGravity 직전 boardData 기준)
      for (let r = 0; r < BOARD_SIZE; r++) {
        const tile = document.getElementById(`tile-${r}-${c}`);
        if (tile.textContent != getDisplayValue(boardData[r][c]) || tile.dataset.tileType !== boardData[r][c]?.type) newRowCount++;
      }

      let newIdx = 0; // 위에서부터 새 타일 인덱스
      for (let r = 0; r < BOARD_SIZE; r++) {
        const tile = document.getElementById(`tile-${r}-${c}`);
        const tileData = boardData[r][c];
        const newVal = getDisplayValue(tileData);

        if (tile.textContent != newVal || tile.dataset.tileType !== tileData?.type) {
          updateTileElement(tile, tileData);

          // 낙하 거리: 빈칸 수만큼 위에서 떨어짐
          const fallPx = (newRowCount - newIdx) * 56; // 타일 한 칸 ≒ 56px
          tile.style.setProperty('--fall-from', `-${fallPx}px`);
          tile.style.animationDelay = `${newIdx * 30}ms`; // 순서대로 떨어짐
          tile.classList.remove('falling');
          tile.offsetHeight; // reflow
          tile.classList.add('falling');
          setTimeout(() => {
            tile.classList.remove('falling');
            tile.style.animationDelay = '';
          }, 380 + newIdx * 30);
          newIdx++;
        }
        tile.classList.remove('selected', 'last-selected', 'matched');
        tile.classList.toggle('fever-tile', tileData?.type === 'fever');
        tile.style.backgroundColor = '';
      }
    }
  }

  function clearSelection() {
    selectedTiles.forEach(t => {
      t.element.classList.remove('selected', 'last-selected', 'matched');
      t.element.style.backgroundColor = '';
    });
    selectedTiles = [];
    dragLine.setAttribute('d', '');
    dragLineGlow.setAttribute('d', '');
  }

  function playAudioTick(isBacktrack = false) {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      if (isBacktrack) {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(180, audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(90, audioCtx.currentTime + 0.08);
        gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.08);
      } else {
        oscillator.type = 'sine';
        const baseFreq = 400 + (selectedTiles.length * 65);
        oscillator.frequency.setValueAtTime(baseFreq, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.06, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.06);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.06);
      }
    } catch (e) {}
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
  updateLobbyModeControls();

  // 싱글 플레이 시작
  btnSingleStart.addEventListener('click', () => {
    isMultiplayMode = false;
    leaderboardPanel.style.display = 'none';
    startGamePlay('timeAttack');
  });

  // 멀티 대기방 화면으로 이동
  btnMultiLobby.addEventListener('click', () => {
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
  function initSocketConnection() {
    if (socket) return;

    socket = createSocketClient();

    socket.on('connect', () => {
      console.log("🟢 서버 연결 성공: ", socket.id);
    });

    socket.on('roomJoined', ({ roomId, nickname }) => {
      currentRoomId = roomId;
      currentNickname = nickname;
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
      currentIsHost = players.some(player => player.nickname === currentNickname && player.isHost);
      updateLobbyModeControls();
      players.forEach((p, index) => {
        const isMe = p.nickname === currentNickname;
        const rank = index + 1;
        
        // 랭킹 뱃지 이모지
        let rankEmoji = `<span>${rank}등</span>`;
        if (rank === 1) rankEmoji = `<span style="color: #f59e0b;">🏆 1등</span>`;
        else if (rank === 2) rankEmoji = `<span style="color: #cbd5e1;">🥈 2등</span>`;
        else if (rank === 3) rankEmoji = `<span style="color: #b45309;">🥉 3등</span>`;

        const pItem = document.createElement('div');
        pItem.className = `lobby-p-item ${isMe ? 'is-me' : ''}`;
        pItem.style.display = 'flex';
        pItem.style.justifyContent = 'space-between';
        pItem.style.alignItems = 'center';
        pItem.style.padding = '10px 14px';
        pItem.style.borderRadius = '12px';
        
        const crownHtml = p.isHost ? '<span class="host-crown">👑</span>' : '';
        const hostBadgeHtml = p.isHost ? '<span class="host-lbl" style="background:#f59e0b; color:#121e15; font-size:9px; padding:1px 5px; border-radius:6px; margin-left:6px;">방장</span>' : '';
        const meTagHtml = isMe ? ' <small style="font-size:11px; opacity:0.8; color: var(--accent-color);">(나)</small>' : '';
        
        pItem.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="lobby-rank-badge" style="font-family: 'Jua', sans-serif; font-size: 13px; min-width: 42px;">${rankEmoji}</span>
            <span class="lobby-p-name" style="font-size: 14px; font-weight: normal; color: ${isMe ? '#a3e635' : '#e2ebd5'};">
              ${crownHtml}${escapeHTML(p.nickname)}${meTagHtml}${hostBadgeHtml}
            </span>
          </div>
          <span class="lobby-p-score" style="font-family: 'Outfit', sans-serif; font-weight: 600; font-size: 14px; color: #a3e635;">
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

    socket.on('raidStart', (config = {}) => {
      if (!ENABLE_BOSS_RAID) return;
      applyRaidConfig(config);
      lobbyOverlay.classList.add('hide');
      leaderboardPanel.style.display = 'none';
      startGamePlay('bossRaid');
    });

    socket.on('gameStart', () => {
      lobbyOverlay.classList.add('hide');
      leaderboardPanel.style.display = 'block';
      startGamePlay('timeAttack');
    });

    socket.on('disconnect', () => {
      console.warn("🔴 서버 연결 종료");
    });
  }

  // 대기방 새로 만들기 클릭
  btnCreateRoom.addEventListener('click', () => {
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
    
    // 무작위 6자리 방 코드 생성 (알파벳 대문자만)
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let generatedRoomId = "";
    for (let i = 0; i < 6; i++) {
      generatedRoomId += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    isMultiplayMode = true;
    initSocketConnection();

    // 서버에 방 생성 및 입장 전송
    socket.emit('joinRoom', { roomId: generatedRoomId, nickname });
  });

  // 대기방 참여 버튼 클릭 (직접 코드 기입)
  btnJoinRoom.addEventListener('click', () => {
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
    initSocketConnection();

    // 서버에 방 입장 전송
    socket.emit('joinRoom', { roomId, nickname });
  });

  // 대기실에서 개별 플레이 시작 버튼 클릭 이벤트
  btnLobbyPlay.addEventListener('click', () => {
    lobbyOverlay.classList.add('hide'); // 대기실 닫기
    leaderboardPanel.style.display = 'block'; // 인게임 실시간 리더보드 노출
    startGamePlay('timeAttack'); // 게임 생성 및 3-2-1 카운트다운 시작!
  });

  btnLobbyRaid.addEventListener('click', () => {
    if (!ENABLE_BOSS_RAID) return;
    if (!currentIsHost) {
      alert('보스레이드는 방장만 시작할 수 있습니다!');
      return;
    }
    if (!socket || !socket.connected) {
      alert('서버 연결이 끊겼습니다. 방에 다시 입장해주세요!');
      return;
    }
    socket.emit('startRaid');
  });

  // 대기방 코드 클릭 시 클립보드 복사
  lobbyRoomBadge.addEventListener('click', () => {
    if (!currentRoomId) return;
    navigator.clipboard.writeText(currentRoomId).then(() => {
      const originalText = lobbyRoomBadge.textContent;
      lobbyRoomBadge.textContent = "📋 복사 완료!";
      lobbyRoomBadge.style.color = "#bef264";
      setTimeout(() => {
        lobbyRoomBadge.textContent = `방 코드: ${currentRoomId}`;
        lobbyRoomBadge.style.color = "";
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
    if (currentGameMode === 'bossRaid') {
      updateRaidUI(players);
      return;
    }

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
    
}
