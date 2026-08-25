// 점수 공식과 반복 페널티. 공식을 바꾸면 tests/engine/parityVectors.json도
// 반드시 같이 갱신할 것.

export function getComboBonus(combo) {
  return combo > 1 ? (combo - 1) * 80 * (1 + combo * 0.15) : 0;
}

export function computePoints({
  len,
  combo,
  repeatMultiplier = 1,
  feverMultiplier = 1,
  lastSpurtMultiplier = 1
}) {
  const basePoints = Math.floor(len * 100 + getComboBonus(combo));
  return Math.round(basePoints * repeatMultiplier * feverMultiplier * lastSpurtMultiplier);
}

// 정방향/역방향을 같은 경로로 취급하는 정규화 서명
export function getPathSignature(cells) {
  const forward = cells.map(cell => `${cell.row}:${cell.col}`).join('|');
  const reverse = [...cells].reverse().map(cell => `${cell.row}:${cell.col}`).join('|');
  return forward < reverse ? forward : reverse;
}

export function getValueSignature(values) {
  return values.join(',');
}

// history: [{ pathSignature, valueSignature }] — 최근 성공 수열 목록
export function classifyRepeat(history, cells, values, multipliers) {
  const {
    pathScoreMultiplier,
    patternScoreMultiplier,
    pathTimeMultiplier,
    patternTimeMultiplier
  } = multipliers;

  const pathSignature = getPathSignature(cells);
  const valueSignature = getValueSignature(values);

  if (history.some(entry => entry.pathSignature === pathSignature)) {
    return { type: 'path', scoreMultiplier: pathScoreMultiplier, timeMultiplier: pathTimeMultiplier };
  }
  if (history.some(entry => entry.valueSignature === valueSignature)) {
    return { type: 'pattern', scoreMultiplier: patternScoreMultiplier, timeMultiplier: patternTimeMultiplier };
  }
  return { type: 'new', scoreMultiplier: 1, timeMultiplier: 1 };
}

export function pushHistory(history, entry, limit) {
  history.push(entry);
  if (history.length > limit) {
    history.shift();
  }
  return history;
}
