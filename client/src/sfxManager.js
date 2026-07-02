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
  '#btn-retry',
  '#score-submit-retry'
].join(',');

let audioContext = null;
let masterVolume = 0.62;
let muted = localStorage.getItem(MUTED_KEY) === 'true';
let initialized = false;
let lastTileSelectAt = 0;
let tilePitchIndex = 0;

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

function playTileSelect() {
  const now = performance.now();
  if (now - lastTileSelectAt < TILE_SELECT_THROTTLE_MS) return;
  lastTileSelectAt = now;

  const pitches = [620, 680, 740, 660];
  const frequency = pitches[tilePitchIndex % pitches.length];
  tilePitchIndex++;
  playTone(frequency, 0, 0.075, { type: 'sine', gain: 0.035, endFrequency: frequency * 1.06 });
}

function playSequenceSuccess() {
  [523.25, 659.25, 783.99].forEach((frequency, index) => {
    playTone(frequency, index * 0.095, 0.28, { type: 'triangle', gain: 0.085 });
  });
  playTone(1046.5, 0.31, 0.22, { type: 'sine', gain: 0.045 });
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

export function playSound(name) {
  if (muted || !soundPlayers[name]) return;

  try {
    void unlockSfx().then(() => {
      if (!muted) soundPlayers[name]();
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
