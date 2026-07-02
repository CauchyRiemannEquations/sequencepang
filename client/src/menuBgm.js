const MENU_BGM_PATH = '/audio/bgm-menu.mp3';
const MUTED_KEY = 'sequencepang-bgm-muted';

let menuBgm = null;
let isUnlocked = false;
let isMuted = localStorage.getItem(MUTED_KEY) === 'true';

function ensureMenuBgm() {
  if (menuBgm) return menuBgm;

  menuBgm = new Audio(MENU_BGM_PATH);
  menuBgm.loop = true;
  menuBgm.preload = 'auto';
  menuBgm.volume = 0.24;

  return menuBgm;
}

async function playMenuBgm() {
  if (isMuted) return;

  const bgm = ensureMenuBgm();

  try {
    await bgm.play();
  } catch (error) {
    console.warn('메뉴 BGM 재생 대기 중:', error.message);
  }
}

function pauseMenuBgm() {
  if (!menuBgm) return;
  menuBgm.pause();
}

function stopMenuBgm() {
  if (!menuBgm) return;
  menuBgm.pause();
  menuBgm.currentTime = 0;
}

function updateMuteButton() {
  const button = document.getElementById('btn-bgm-toggle');
  if (!button) return;

  button.textContent = isMuted ? '🔇' : '🔊';
  button.title = isMuted ? 'BGM 켜기' : 'BGM 끄기';
  button.setAttribute('aria-label', isMuted ? 'BGM 켜기' : 'BGM 끄기');
}

function setMuted(value) {
  isMuted = Boolean(value);
  localStorage.setItem(MUTED_KEY, String(isMuted));

  if (isMuted) {
    pauseMenuBgm();
  } else {
    playMenuBgm();
  }

  updateMuteButton();
}

function toggleMuted() {
  setMuted(!isMuted);
}

function createMuteButton() {
  if (document.getElementById('btn-bgm-toggle')) return;

  const gameContainer = document.getElementById('game-container');
  if (!gameContainer) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'btn-bgm-toggle';
  button.className = 'bgm-toggle-button';

  button.addEventListener('click', event => {
    event.stopPropagation();
    unlockAudio();
    toggleMuted();
  });

  gameContainer.appendChild(button);
  updateMuteButton();
}

function injectBgmStyle() {
  if (document.getElementById('bgm-style')) return;

  const style = document.createElement('style');
  style.id = 'bgm-style';
  style.textContent = `
    .bgm-toggle-button {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 700;
      width: 36px;
      height: 36px;
      border: 1px solid rgba(163, 230, 53, 0.28);
      border-radius: 999px;
      background: rgba(15, 36, 23, 0.5);
      color: #ecfccb;
      font-size: 17px;
      cursor: pointer;
      backdrop-filter: blur(8px);
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.18);
      transition: transform 0.15s ease, background 0.15s ease;
    }

    .bgm-toggle-button:hover {
      transform: translateY(-1px);
      background: rgba(22, 101, 52, 0.65);
    }
  `;

  document.head.appendChild(style);
}

function unlockAudio() {
  if (isUnlocked) return;

  isUnlocked = true;
  playMenuBgm();
}

function setupAutoUnlock() {
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });
}

function setupBgmSceneEvents() {
  document.addEventListener('click', event => {
    const startGameButton = event.target.closest(
      '#btn-single-start, #btn-lobby-play, #btn-lobby-raid'
    );

    if (startGameButton) {
      stopMenuBgm();
      return;
    }

    const menuLikeButton = event.target.closest(
      '#btn-multi-lobby, #btn-show-ranking, #btn-update-notes-open'
    );

    if (menuLikeButton) {
      playMenuBgm();
    }
  });
}

export function initMenuBgm() {
  ensureMenuBgm();
  injectBgmStyle();
  createMuteButton();
  setupAutoUnlock();
  setupBgmSceneEvents();
}
