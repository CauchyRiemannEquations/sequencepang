import { setSfxMuted, unlockSfx } from './sfxManager.js';

const MENU_BGM_PATH = '/bgm-menu.mp3';
const MUTED_KEY = 'sequencepang-bgm-muted';

let menuBgm = null;
let isUnlocked = false;
let isMuted = localStorage.getItem(MUTED_KEY) === 'true';
let isTemporarilyPaused = false;

function ensureMenuBgm() {
  if (menuBgm) return menuBgm;

  menuBgm = new Audio(MENU_BGM_PATH);
  menuBgm.loop = true;
  menuBgm.preload = 'auto';
  menuBgm.volume = 0.24;

  return menuBgm;
}

export async function playMenuBgm() {
  if (isMuted || isTemporarilyPaused) return;

  const bgm = ensureMenuBgm();

  try {
    await bgm.play();
  } catch (error) {
    console.warn('메뉴 BGM 재생 대기 중:', error.message);
  }
}

function pauseMenuBgmPlayback() {
  if (!menuBgm) return;
  menuBgm.pause();
}

export function pauseMenuBgm() {
  isTemporarilyPaused = true;
  pauseMenuBgmPlayback();
}

export function resumeMenuBgm() {
  isTemporarilyPaused = false;
  return playMenuBgm();
}

function updateMuteButton() {
  const button = document.getElementById('btn-bgm-toggle');
  if (!button) return;

  button.textContent = isMuted ? '🔇' : '🔊';
  button.title = isMuted ? '소리 켜기' : '소리 끄기';
  button.setAttribute('aria-label', isMuted ? '소리 켜기' : '소리 끄기');
}

function setMuted(value) {
  isMuted = Boolean(value);
  localStorage.setItem(MUTED_KEY, String(isMuted));
  setSfxMuted(isMuted);

  if (isMuted) {
    pauseMenuBgmPlayback();
  } else {
    unlockAudio();
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
      top: auto;
      right: auto;
      left: 12px;
      bottom: max(12px, env(safe-area-inset-bottom));
      z-index: 700;
      width: 38px;
      height: 38px;
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
  void unlockSfx();
  if (isUnlocked) {
    playMenuBgm();
    return;
  }

  isUnlocked = true;
  playMenuBgm();
}

function setupAutoUnlock() {
  const unlock = () => {
    unlockAudio();
  };

  // 첫 클릭/터치/키보드 입력 때 BGM 시작
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);

  // 버튼 클릭에서도 한 번 더 안전하게 시도
  document.addEventListener('click', unlock);
}

export function initMenuBgm() {
  setSfxMuted(isMuted);
  ensureMenuBgm();
  injectBgmStyle();
  createMuteButton();
  setupAutoUnlock();

  // 혹시 이전에 음소거가 아니었다면, 사용자의 첫 입력 이후 바로 재생되도록 준비
  updateMuteButton();
}
