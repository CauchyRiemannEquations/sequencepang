// 진동 래퍼. navigator.vibrate가 없는 환경(iOS Safari)에서는 noop.
// 별도 토글 없이 SFX 음소거와 연동 — sfxManager.playSound가 음소거 확인 후 호출한다.

const HAPTIC_PATTERNS = {
  tileSelect: 8,
  chainLock: 12,
  sequenceSuccess: 25,
  sequenceFail: [30, 40, 30],
  feverStart: [40, 60, 40, 60, 80],
  crossPang: [60, 30, 60],
  fullPang: [80, 40, 80, 40, 120]
};

export function vibrate(pattern) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch (_error) {
    // 진동 실패는 게임 진행에 영향을 주지 않는다.
  }
}

// 사운드 큐 이름과 같은 키로 진동 패턴을 찾는다. 매핑 없으면 무시.
export function vibrateFor(soundName) {
  const pattern = HAPTIC_PATTERNS[soundName];
  if (pattern !== undefined) vibrate(pattern);
}
