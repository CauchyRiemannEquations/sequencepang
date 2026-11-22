// 표시값을 타일 객체에 대응시켜 낙하 후에도 같은 숫자를 유지한다.
// 원래 숫자와 별은 건드리지 않으므로 피버가 끝나면 즉시 복원된다.
export function rollNegativeFeverValue(baseValue, rng = Math.random) {
  const roll = rng();
  if (roll < 0.05) return 0;
  return roll < 0.35 ? -baseValue : baseValue;
}

export function createNegativeFeverValues(board, origin, rng = Math.random) {
  const values = new WeakMap();
  for (const row of board) {
    for (const tile of row) {
      values.set(tile, rollNegativeFeverValue(tile.baseValue, rng));
    }
  }

  // 누른 블록을 지나는 한 줄에는 즉시 쓸 수 있는 혼합 부호 수열을 둔다.
  // 가로·세로 방향과 숫자 순서를 바꿔 가장자리에서도 같은 규칙을 적용한다.
  const step = board[origin.row][origin.col].baseValue;
  const sequence = rng() < 0.5 ? [-step, 0, step] : [1, -2, 4, -8];
  if (rng() < 0.5) sequence.reverse();
  const horizontal = rng() < 0.5;
  const axis = horizontal ? origin.col : origin.row;
  const size = horizontal ? board[origin.row].length : board.length;
  const start = Math.min(Math.max(0, axis - 1), size - sequence.length);
  sequence.forEach((value, offset) => {
    const tile = horizontal ? board[origin.row][start + offset] : board[start + offset][origin.col];
    values.set(tile, value);
  });
  return values;
}
