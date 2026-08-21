import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, isNeighbor, collapseAndRefill } from '../../client/src/engine/board.js';
import { createTilePool, createNormalTile } from '../../client/src/engine/tiles.js';
import { createRng } from '../../client/src/engine/rng.js';

const SIZE = 6;

function makeBoard(seed = 42) {
  const rng = createRng(seed);
  const pool = createTilePool({ min: 1, max: 9 });
  let id = 0;
  // 상대 순서 검증을 위해 타일마다 고유 id 부여
  return createBoard(SIZE, () => ({ ...createNormalTile(pool, rng), id: id++ }));
}

test('createBoard: size×size, null 없음', () => {
  const board = makeBoard();
  assert.equal(board.length, SIZE);
  for (const row of board) {
    assert.equal(row.length, SIZE);
    for (const tile of row) {
      assert.ok(tile);
      assert.ok(tile.baseValue >= 1 && tile.baseValue <= 9);
    }
  }
});

test('isNeighbor: 8방향 인접, 자기 자신 제외', () => {
  const center = { row: 2, col: 2 };
  assert.ok(isNeighbor(center, { row: 1, col: 1 }));
  assert.ok(isNeighbor(center, { row: 1, col: 2 }));
  assert.ok(isNeighbor(center, { row: 3, col: 3 }));
  assert.ok(isNeighbor(center, { row: 2, col: 3 }));
  assert.ok(!isNeighbor(center, { row: 2, col: 2 }));
  assert.ok(!isNeighbor(center, { row: 0, col: 2 }));
  assert.ok(!isNeighbor(center, { row: 4, col: 4 }));
});

test('collapseAndRefill: 열마다 6칸, null 없음, spawned 개수 = 제거 수', () => {
  const board = makeBoard();
  const removed = [
    { row: 2, col: 1 },
    { row: 3, col: 1 },
    { row: 5, col: 4 },
    { row: 0, col: 0 }
  ];
  const rng = createRng(7);
  const pool = createTilePool({ min: 1, max: 9 });
  const { board: next, spawned } = collapseAndRefill(board, removed, () => createNormalTile(pool, rng));

  assert.equal(next.length, SIZE);
  for (let c = 0; c < SIZE; c++) {
    for (let r = 0; r < SIZE; r++) {
      assert.ok(next[r][c], `(${r},${c})가 비어 있음`);
    }
  }
  assert.equal(spawned.length, removed.length);
});

test('collapseAndRefill: 기존 타일 상대 순서 유지 + 새 타일은 맨 위', () => {
  const board = makeBoard();
  const col = 2;
  const removed = [
    { row: 1, col },
    { row: 3, col }
  ];
  const survivorIds = [];
  for (let r = 0; r < SIZE; r++) {
    if (r !== 1 && r !== 3) survivorIds.push(board[r][col].id);
  }

  const rng = createRng(7);
  const pool = createTilePool({ min: 1, max: 9 });
  const { board: next, spawned } = collapseAndRefill(board, removed, () => createNormalTile(pool, rng));

  // 새 타일 2개가 위(0~1행), 생존 타일 4개가 아래(2~5행)에 기존 순서 그대로
  const afterIds = [];
  for (let r = 0; r < SIZE; r++) {
    if (next[r][col].id !== undefined) afterIds.push(next[r][col].id);
  }
  assert.deepEqual(afterIds, survivorIds);
  assert.equal(next[0][col].id, undefined);
  assert.equal(next[1][col].id, undefined);
  assert.deepEqual(
    spawned.filter(s => s.col === col).map(s => s.row).sort(),
    [0, 1]
  );

  // 원본 보드는 변경하지 않는다
  assert.ok(board[1][col]);
  assert.ok(board[3][col]);
});

test('collapseAndRefill: fallRows는 열의 제거 수에서 위에서부터 감소', () => {
  const board = makeBoard();
  const col = 0;
  const removed = [
    { row: 0, col },
    { row: 2, col },
    { row: 4, col }
  ];
  const rng = createRng(9);
  const pool = createTilePool({ min: 1, max: 9 });
  const { spawned } = collapseAndRefill(board, removed, () => createNormalTile(pool, rng));

  const colSpawned = spawned
    .filter(s => s.col === col)
    .sort((a, b) => a.row - b.row);
  assert.deepEqual(
    colSpawned.map(s => ({ row: s.row, fallRows: s.fallRows })),
    [
      { row: 0, fallRows: 3 },
      { row: 1, fallRows: 2 },
      { row: 2, fallRows: 1 }
    ]
  );
});

test('collapseAndRefill: 전판 제거(풀보드팡)에도 null 없이 재생성', () => {
  const board = makeBoard();
  const removed = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      removed.push({ row: r, col: c });
    }
  }
  const rng = createRng(11);
  const pool = createTilePool({ min: 1, max: 9 });
  const { board: next, spawned } = collapseAndRefill(board, removed, () => createNormalTile(pool, rng));

  assert.equal(spawned.length, SIZE * SIZE);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      assert.ok(next[r][c]);
      assert.equal(next[r][c].id, undefined);
    }
  }
});
