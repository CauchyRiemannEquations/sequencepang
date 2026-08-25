import { vibrateFor } from './haptics.js';

const MUTED_KEY = 'sequencepang-bgm-muted';
const TILE_SELECT_THROTTLE_MS = 45;
const BUTTON_SOUND_SELECTOR = [
  '#btn-single-start',
  '#btn-multi-lobby',
  '#btn-create-room',
  '#btn-join-room',
  '#btn-lobby-play',
  '#btn-lobby-back',
  '#btn-lobby-exit',
  '#btn-show-ranking',
  '#btn-ranking-close',
  '#update-notes-button',
  '.update-notes-close',
  '.update-notes-confirm',
  '.ranking-reset-notice-close',
  '.ranking-reset-notice-dismiss',
  '#btn-retry',
  '#score-submit-retry'
].join(',');

let audioContext = null;
let masterVolume = 1.0;
let muted = localStorage.getItem(MUTED_KEY) === 'true';
let initialized = false;
let lastTileSelectAt = 0;

const TILE_SELECT_BASE_FREQUENCY = 523.25; // C5
const TILE_SELECT_MAX_STEP = 14;

// 콤보 구간별 성공 화음 루트 이조 (반음 수): 1~2 C5 / 3~5 D5 / 6~9 E5 / 10~14 G5 / 15+ C6
function getSuccessRootSemitones(combo) {
  if (combo >= 15) return 12;
  if (combo >= 10) return 7;
  if (combo >= 6) return 4;
  if (combo >= 3) return 2;
  return 0;
}

function semitoneRatio(semitones) {
  return Math.pow(2, semitones / 12);
}

function getAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContext = new AudioContextClass();
  }
  return audioContext;
}

function playTone(frequency, startOffset, duration, options = {}) {
  const context = getAudioContext();
  if (!context) return;

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const startTime = context.currentTime + startOffset;
  const endTime = startTime + duration;
  const peak = (options.gain ?? 0.08) * masterVolume;

  oscillator.type = options.type || 'sine';
  oscillator.frequency.setValueAtTime(frequency, startTime);
  if (options.endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, endTime);
  }

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), startTime + Math.min(0.018, duration * 0.25));
  gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startTime);
  oscillator.stop(endTime + 0.01);
}

function playButtonTap() {
  playTone(520, 0, 0.065, { type: 'sine', gain: 0.055, endFrequency: 620 });
}

// 드래그 순서(step)에 따라 C5에서 반음씩 상행 — 드래그 시작마다 step 0부터 리셋
function playTileSelect(payload) {
  const now = performance.now();
  if (now - lastTileSelectAt < TILE_SELECT_THROTTLE_MS) return;
  lastTileSelectAt = now;

  const step = Math.max(0, Math.min(payload?.step ?? 0, TILE_SELECT_MAX_STEP));
  const frequency = TILE_SELECT_BASE_FREQUENCY * semitoneRatio(step);
  playTone(frequency, 0, 0.075, { type: 'sine', gain: 0.035, endFrequency: frequency * 1.06 });
}

// 콤보 구간별로 화음 루트를 이조. len >= 5면 끝에 5도 위 장식음 추가
function playSequenceSuccess(payload) {
  const ratio = semitoneRatio(getSuccessRootSemitones(payload?.combo ?? 1));
  [523.25, 659.25, 783.99].forEach((frequency, index) => {
    playTone(frequency * ratio, index * 0.095, 0.28, { type: 'triangle', gain: 0.085 });
  });
  playTone(1046.5 * ratio, 0.31, 0.22, { type: 'sine', gain: 0.045 });
  if ((payload?.len ?? 0) >= 5) {
    playTone(1046.5 * ratio * semitoneRatio(7), 0.5, 0.2, { type: 'sine', gain: 0.04 });
  }
}

function playSequenceFail() {
  playTone(392, 0, 0.22, { type: 'sine', gain: 0.065, endFrequency: 293.66 });
  playTone(261.63, 0.13, 0.24, { type: 'triangle', gain: 0.04, endFrequency: 220 });
}

function playFeverStart() {
  [392, 493.88, 587.33, 783.99, 987.77].forEach((frequency, index) => {
    playTone(frequency, index * 0.105, 0.32, { type: 'triangle', gain: 0.075 });
  });
  [1174.66, 1318.51, 1567.98].forEach((frequency, index) => {
    playTone(frequency, 0.48 + index * 0.12, 0.24, { type: 'sine', gain: 0.035 });
  });
}

function playGameOver() {
  [659.25, 523.25, 440, 329.63].forEach((frequency, index) => {
    playTone(frequency, index * 0.2, 0.42, { type: index < 2 ? 'triangle' : 'sine', gain: 0.065 });
  });
  playTone(261.63, 0.78, 0.45, { type: 'sine', gain: 0.045 });
}

function playComboExpire() {
  playTone(220, 0, 0.16, { type: 'triangle', gain: 0.04, endFrequency: 110 });
}

// 판정선 pending→valid 전환 순간의 잠금음 (작게)
function playChainLock() {
  playTone(880, 0, 0.04, { type: 'sine', gain: 0.03 });
}

// 판정선 valid→broken 전환음 — 기존 실패음보다 훨씬 작게
function playChainBreak() {
  playTone(180, 0, 0.06, { type: 'sine', gain: 0.025 });
}

// 크로스팡: 300→1200Hz 상행 스윕 180ms + 화음
function playCrossPang() {
  playTone(300, 0, 0.18, { type: 'sine', gain: 0.07, endFrequency: 1200 });
  [659.25, 830.61, 987.77].forEach((frequency, index) => {
    playTone(frequency, 0.14 + index * 0.07, 0.24, { type: 'triangle', gain: 0.075 });
  });
}

// 풀보드팡: 스윕 + 화음 2회 + 저음 타격 1회
function playFullPang() {
  playTone(300, 0, 0.18, { type: 'sine', gain: 0.08, endFrequency: 1200 });
  [523.25, 659.25, 783.99].forEach((frequency, index) => {
    playTone(frequency, 0.14 + index * 0.07, 0.24, { type: 'triangle', gain: 0.08 });
  });
  [659.25, 830.61, 1046.5].forEach((frequency, index) => {
    playTone(frequency, 0.42 + index * 0.07, 0.26, { type: 'triangle', gain: 0.07 });
  });
  playTone(98, 0.16, 0.3, { type: 'triangle', gain: 0.09, endFrequency: 65 });
}

function playCountdownTick() {
  playTone(440, 0, 0.13, { type: 'triangle', gain: 0.11, endFrequency: 500 });
}

function playCountdownGo() {
  playTone(659.25, 0, 0.24, { type: 'triangle', gain: 0.12 });
  playTone(783.99, 0.07, 0.28, { type: 'sine', gain: 0.1 });
  playTone(1046.5, 0.14, 0.32, { type: 'triangle', gain: 0.09 });
}

const soundPlayers = {
  buttonTap: playButtonTap,
  tileSelect: playTileSelect,
  sequenceSuccess: playSequenceSuccess,
  sequenceFail: playSequenceFail,
  comboExpire: playComboExpire,
  chainLock: playChainLock,
  chainBreak: playChainBreak,
  crossPang: playCrossPang,
  fullPang: playFullPang,
  feverStart: playFeverStart,
  gameOver: playGameOver,
  countdownTick: playCountdownTick,
  countdownGo: playCountdownGo
};

export function unlockSfx() {
  try {
    const context = getAudioContext();
    if (!context || context.state === 'running') return Promise.resolve();
    return context.resume().catch(() => {});
  } catch (_error) {
    return Promise.resolve();
  }
}

// payload는 큐별 추가 정보(타일 step, 콤보 등). 기존 playSound(name) 호출과 하위 호환.
export function playSound(name, payload) {
  if (muted || !soundPlayers[name]) return;

  // 진동은 SFX 음소거와 연동 — 음소거면 위 early return으로 함께 꺼진다
  vibrateFor(name);

  try {
    void unlockSfx().then(() => {
      if (!muted) soundPlayers[name](payload);
    }).catch(() => {});
  } catch (_error) {
    // 효과음 실패는 게임 진행에 영향을 주지 않는다.
  }
}

export function setSfxMuted(value) {
  muted = Boolean(value);
  localStorage.setItem(MUTED_KEY, String(muted));
}

export function toggleSfxMuted() {
  setSfxMuted(!muted);
  return muted;
}

export function isSfxMuted() {
  return muted;
}

export function setSfxVolume(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return;
  masterVolume = Math.max(0, Math.min(1, numericValue));
}

export function initSfx() {
  if (initialized) return;
  initialized = true;

  const unlock = () => {
    void unlockSfx();
  };
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true });

  document.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest(BUTTON_SOUND_SELECTOR) : null;
    if (button && !button.disabled) playSound('buttonTap');
  });
}
