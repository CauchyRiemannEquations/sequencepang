// 보드 자료구조와 중력 리필. DOM 없음 — 렌더링은 ui/boardView.js 담당.

export function createBoard(size, tileFactory) {
  const board = [];
  for (let r = 0; r < size; r++) {
    board[r] = [];
    for (let c = 0; c < size; c++) {
      board[r][c] = tileFactory(r, c);
    }
  }
  return board;
}

// 8방향 인접 (자기 자신 제외) — handleMove의 rowDiff<=1 && colDiff<=1 규칙과 동일
export function isNeighbor(a, b) {
  const rowDiff = Math.abs(a.row - b.row);
  const colDiff = Math.abs(a.col - b.col);
  return rowDiff <= 1 && colDiff <= 1 && !(rowDiff === 0 && colDiff === 0);
}

// removedCells 자리를 비우고 열별로 아래로 무너뜨린 뒤 위를 새 타일로 채운다.
// 기존 eliminateAndRefill과 동일한 순서(아래→위 수집, 새 타일은 맨 위)로
// 기존 타일의 상대 순서를 유지한다.
// spawned의 fallRows: 해당 새 타일이 몇 칸 위에서 떨어져 내려오는지.
export function collapseAndRefill(board, removedCells, tileFactory) {
  const size = board.length;
  const next = board.map(row => row.slice());

  for (const { row, col } of removedCells) {
    next[row][col] = null;
  }

  const spawned = [];
  for (let c = 0; c < size; c++) {
    const column = [];
    for (let r = size - 1; r >= 0; r--) {
      if (next[r][c] !== null && next[r][c] !== undefined) {
        column.push(next[r][c]);
      }
    }

    const missingCount = size - column.length;
    for (let i = 0; i < missingCount; i++) {
      column.push(tileFactory());
    }

    column.reverse();
    for (let r = 0; r < size; r++) {
      next[r][c] = column[r];
    }
    for (let r = 0; r < missingCount; r++) {
      spawned.push({ row: r, col: c, fallRows: missingCount - r });
    }
  }

  return { board: next, spawned };
}
