import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getChainTier, getCrossCells } from '../../client/src/engine/chainTier.js';
import { createBoard, collapseAndRefill } from '../../client/src/engine/board.js';
import { createTilePool, createNormalTile } from '../../client/src/engine/tiles.js';
import { createRng } from '../../client/src/engine/rng.js';

const SIZE = 6;

function makeBoard(seed) {
  const rng = createRng(seed);
  const pool = createTilePool({ min: 1, max: 9 });
  return createBoard(SIZE, () => createNormalTile(pool, rng));
}

// 크로스팡: 연쇄 6개 + 마지막 타일의 행·열(연쇄·피버 제외) 제거 → 보드 무결성
test('크로스팡 제거: 연쇄+십자 제거 후 null 없음, 피버 블록 보존', () => {
  const board = makeBoard(21);
  const feverTile = { baseValue: 5, type: 'fever', feverTier: 'super', feverType: 'multiply', feverAmount: 3, feverLabel: '×3' };
  board[2][4] = feverTile; // 마지막 타일 (2,3)의 같은 행에 피버 블록

  const chainCells = [
    { row: 0, col: 0 }, { row: 1, col: 1 }, { row: 2, col: 2 },
    { row: 3, col: 3 }, { row: 3, col: 2 }, { row: 2, col: 3 }
  ];
  const lastCell = chainCells[chainCells.length - 1];
  assert.equal(getChainTier(chainCells.length, false), 'cross');

  const selectedKeys = new Set(chainCells.map(cell => `${cell.row}:${cell.col}`));
  const extraCells = getCrossCells(lastCell, SIZE).filter(cell =>
    !selectedKeys.has(`${cell.row}:${cell.col}`)
    && board[cell.row][cell.col]?.type !== 'fever');

  // 십자 10칸 중 연쇄에 속한 (2,2)·(3,3) 2칸과 피버 (2,4) 1칸 제외 → 7칸
  assert.equal(extraCells.length, 7);

  const rng = createRng(22);
  const pool = createTilePool({ min: 1, max: 9 });
  const { board: next, spawned } = collapseAndRefill(
    board,
    [...chainCells, ...extraCells],
    () => createNormalTile(pool, rng)
  );

  assert.equal(spawned.length, chainCells.length + extraCells.length);
  let feverCount = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      assert.ok(next[r][c], `(${r},${c})가 비어 있음`);
      if (next[r][c].type === 'fever') feverCount++;
    }
  }
  // 피버 블록은 제거되지 않고 낙하로 위치만 바뀔 수 있다
  assert.equal(feverCount, 1);
});

// 풀보드팡: 피버 블록 제외 전 타일 재생성 → null 없음 + 피버 보존
test('풀보드팡 재생성: 피버 블록 제외 전판 재생성 후 null 없음', () => {
  const board = makeBoard(31);
  const feverTile = { baseValue: 7, type: 'fever', feverTier: 'normal', feverType: 'add', feverAmount: 2, feverLabel: '+2' };
  board[1][5] = feverTile;

  // 빅넘버 피버에서 1·4·7·10·13·16·19 같은 공차 3 체인 = 7연쇄
  assert.equal(getChainTier(7, false), 'full');

  const removed = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c].type !== 'fever') removed.push({ row: r, col: c });
    }
  }
  assert.equal(removed.length, SIZE * SIZE - 1);

  const rng = createRng(32);
  const pool = createTilePool({ min: 1, max: 9 });
  const { board: next, spawned } = collapseAndRefill(board, removed, () => createNormalTile(pool, rng));

  assert.equal(spawned.length, removed.length);
  let feverCount = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      assert.ok(next[r][c], `(${r},${c})가 비어 있음`);
      if (next[r][c].type === 'fever') feverCount++;
    }
  }
  assert.equal(feverCount, 1);
  // 피버 블록은 해당 열의 맨 아래로 낙하
  assert.equal(next[SIZE - 1][5].type, 'fever');
});
