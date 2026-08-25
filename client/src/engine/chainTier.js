// 연쇄 길이 티어: 3 팡 / 4 피버 / 5 슈퍼피버 / 6 크로스팡 / 7+ 풀보드팡.
// allSame(상수열)은 피버 규칙과 동일하게 티어에서 제외한다.

export function getChainTier(len, allSame) {
  if (allSame) return 'none';
  if (len >= 7) return 'full';
  if (len === 6) return 'cross';
  if (len === 5) return 'super';
  if (len === 4) return 'fever';
  return 'none';
}

// 크로스팡: 기준 칸의 행 + 열 전체 (자기 자신 제외) → size 6이면 10칸
export function getCrossCells(cell, size) {
  const cells = [];
  for (let c = 0; c < size; c++) {
    if (c !== cell.col) cells.push({ row: cell.row, col: c });
  }
  for (let r = 0; r < size; r++) {
    if (r !== cell.row) cells.push({ row: r, col: cell.col });
  }
  return cells;
}
