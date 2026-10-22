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

  const master = document.getElementById('sound-master');
  if (master) master.checked = !isMuted;
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

function createMuteButton() {
  if (document.getElementById('btn-bgm-toggle')) return;

  const links = document.getElementById('welcome-links-row');
  if (!links) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'btn-bgm-toggle';
  button.className = 'bgm-toggle-button';
  button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 5-6 4H2v6h3l6 4V5Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.08M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>소리 설정';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', 'sound-settings');

  const dialog = document.createElement('dialog');
  dialog.id = 'sound-settings';
  dialog.className = 'sound-dialog';
  dialog.setAttribute('aria-labelledby', 'sound-title');
  dialog.innerHTML = '<h2 id="sound-title">소리 설정</h2><label class="sound-toggle"><span>소리 켜기</span><input id="sound-master" type="checkbox"></label><p>배경음악과 게임 효과음을 함께 켜거나 꺼요.</p><button class="sound-done" type="button">완료</button>';
  dialog.querySelector('#sound-master').addEventListener('change', event => setMuted(!event.target.checked));
  dialog.querySelector('.sound-done').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => button.focus());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  document.body.appendChild(dialog);

  button.addEventListener('click', event => {
    event.stopPropagation();
    updateMuteButton();
    dialog.showModal();
  });

  links.appendChild(button);
  updateMuteButton();
}

function injectBgmStyle() {
  if (document.getElementById('bgm-style')) return;

  const style = document.createElement('style');
  style.id = 'bgm-style';
  style.textContent = `
    .sound-dialog { box-sizing: border-box; width: min(360px, calc(100vw - 28px)); max-height: calc(100dvh - 28px); overflow: auto; padding: 24px; border: 1px solid #dbe8c8; border-radius: 24px; background: #fff8e6; color: #244c3b; font-family: 'Jua', sans-serif; }
    .sound-dialog::backdrop { background: #012b2cbb; }
    .sound-dialog h2 { margin: 0 0 16px; font-size: 27px; font-weight: normal; }
    .sound-dialog p { margin: 16px 0; font-size: 14px; line-height: 1.6; color: #53674e; }
    .sound-toggle { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 48px; padding: 8px 12px; border-radius: 14px; background: #e1f1d8; font-size: 19px; cursor: pointer; }
    .sound-toggle input { width: 26px; height: 26px; accent-color: #197f62; }
    .sound-done { width: 100%; min-height: 44px; border: 0; border-radius: 14px; color: #fff8dc; background: #16775f; font: 18px 'Jua', sans-serif; cursor: pointer; }
    .sound-dialog :focus-visible { outline: 3px solid #197f62; outline-offset: 3px; }
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
