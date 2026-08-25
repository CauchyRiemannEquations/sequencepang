// 보드 DOM 렌더링. 타일 엘리먼트를 2차원 배열로 캐시해
// getElementById/querySelectorAll 루프를 제거한다.

const TILE_FALL_PX = 56; // 타일 한 칸 낙하 거리 (기존 renderGravityRefill과 동일)

export function createBoardView({ boardElement, boardWrapper, size, getDisplayValue, isBigNumberTile }) {
  let tileEls = [];

  function updateTileElement(tileElement, tileData) {
    tileElement.textContent = getDisplayValue(tileData);
    tileElement.classList.toggle('fever-tile', tileData?.type === 'fever');
    tileElement.classList.toggle('super-fever-tile', tileData?.type === 'fever' && tileData?.feverTier === 'super');
    tileElement.classList.toggle('big-number-tile', tileData?.type === 'normal' && isBigNumberTile(tileData));
    tileElement.dataset.tileType = tileData?.type || 'normal';
    tileElement.dataset.baseValue = tileData?.baseValue ?? '';
    tileElement.dataset.feverTier = tileData?.feverTier ?? '';
    tileElement.dataset.feverType = tileData?.feverType ?? '';
    tileElement.dataset.feverAmount = tileData?.feverAmount ?? '';
  }

  function build(boardData) {
    boardElement.innerHTML = '';
    tileEls = [];
    for (let r = 0; r < size; r++) {
      tileEls[r] = [];
      for (let c = 0; c < size; c++) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.dataset.row = r;
        tile.dataset.col = c;
        tile.id = `tile-${r}-${c}`;
        updateTileElement(tile, boardData[r][c]);
        boardElement.appendChild(tile);
        tileEls[r][c] = tile;
      }
    }
  }

  function getTileEl(row, col) {
    return tileEls[row]?.[col] || null;
  }

  function updateTile(row, col, tileData) {
    const tile = getTileEl(row, col);
    if (tile) updateTileElement(tile, tileData);
  }

  function renderAll(boardData) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        updateTile(r, c, boardData[r][c]);
      }
    }
  }

  // 중력 리필 후 표시값이 바뀐 타일에 낙하 애니메이션 (기존 로직 유지)
  function renderGravityRefill(boardData) {
    for (let c = 0; c < size; c++) {
      let newRowCount = 0;

      for (let r = 0; r < size; r++) {
        const tile = tileEls[r][c];
        if (tile.textContent != getDisplayValue(boardData[r][c]) || tile.dataset.tileType !== boardData[r][c]?.type) newRowCount++;
      }

      let newIdx = 0;
      for (let r = 0; r < size; r++) {
        const tile = tileEls[r][c];
        const tileData = boardData[r][c];
        const newVal = getDisplayValue(tileData);

        if (tile.textContent != newVal || tile.dataset.tileType !== tileData?.type) {
          updateTileElement(tile, tileData);

          const fallPx = (newRowCount - newIdx) * TILE_FALL_PX;
          tile.style.setProperty('--fall-from', `-${fallPx}px`);
          tile.style.animationDelay = `${newIdx * 30}ms`;
          tile.classList.remove('falling');
          tile.offsetHeight; // reflow로 애니메이션 재시동
          tile.classList.add('falling');
          setTimeout(() => {
            tile.classList.remove('falling');
            tile.style.animationDelay = '';
          }, 380 + newIdx * 30);
          newIdx++;
        }
        tile.classList.remove('selected', 'last-selected', 'matched', 'sequence-invalid', 'pang-burst');
        tile.classList.toggle('fever-tile', tileData?.type === 'fever');
        tile.classList.toggle('super-fever-tile', tileData?.type === 'fever' && tileData?.feverTier === 'super');
      }
    }
  }

  // 크로스팡/풀보드팡: 기준 칸에서 체비쇼프 거리 × staggerMs 딜레이로
  // 바깥으로 퍼지는 버스트. 전체 소요 시간(ms)을 반환한다.
  function triggerPangBurst(cells, originCell, { durationMs, staggerMs }) {
    let maxDelay = 0;
    cells.forEach(cell => {
      const tile = getTileEl(cell.row, cell.col);
      if (!tile) return;
      const dist = Math.max(Math.abs(cell.row - originCell.row), Math.abs(cell.col - originCell.col));
      const delay = dist * staggerMs;
      maxDelay = Math.max(maxDelay, delay);
      tile.style.animationDelay = `${delay}ms`;
      tile.classList.remove('pang-burst');
      void tile.offsetWidth;
      tile.classList.add('pang-burst');
    });
    return durationMs + maxDelay;
  }

  // 버스트 잔여 상태 정리 (collapse 직전 호출 — 낙하 애니메이션 딜레이와 충돌 방지)
  function clearPangBurst() {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const tile = tileEls[r]?.[c];
        if (!tile) continue;
        if (tile.classList.contains('pang-burst')) {
          tile.classList.remove('pang-burst');
          tile.style.animationDelay = '';
        }
      }
    }
  }

  // ── 보드 위 오버레이 연출 ──────────────────────────────

  function getTileCenterInWrapper(tileElement) {
    const rect = tileElement.getBoundingClientRect();
    const wrapperRect = boardWrapper.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 - wrapperRect.left,
      y: rect.top + rect.height / 2 - wrapperRect.top,
      wrapperWidth: wrapperRect.width
    };
  }

  function spawnFloatingScore(anchorTileEl, text, { fever = false } = {}) {
    const { x, y } = getTileCenterInWrapper(anchorTileEl);

    const floatSpan = document.createElement('span');
    floatSpan.className = 'floating-score';
    floatSpan.textContent = text;
    floatSpan.classList.toggle('fever-score', fever);
    floatSpan.style.left = `${x}px`;
    floatSpan.style.top = `${y}px`;

    boardWrapper.appendChild(floatSpan);
    setTimeout(() => {
      floatSpan.remove();
    }, 800);
  }

  function spawnSequenceHint(anchorTileEl, kind, ruleValue) {
    const { x, y, wrapperWidth } = getTileCenterInWrapper(anchorTileEl);
    const label = kind === 'GP' ? '등비수열' : '등차수열';
    const ruleName = kind === 'GP' ? '공비' : '공차';

    const hintSpan = document.createElement('span');
    hintSpan.className = 'sequence-hint';
    hintSpan.append(
      document.createTextNode(`${label} · ${ruleName} `),
      createRuleValueElement(ruleValue)
    );
    hintSpan.style.left = `${x}px`;
    hintSpan.style.top = `${y - 22}px`;

    boardWrapper.appendChild(hintSpan);
    const hintRect = hintSpan.getBoundingClientRect();
    const clampedX = Math.min(
      Math.max(x, hintRect.width / 2 + 8),
      wrapperWidth - hintRect.width / 2 - 8
    );
    hintSpan.style.left = `${clampedX}px`;

    setTimeout(() => {
      hintSpan.remove();
    }, 1150);
  }

  function createRuleValueElement(ruleValue) {
    if (typeof ruleValue === 'string') {
      return document.createTextNode(ruleValue);
    }

    if (ruleValue.type === 'text') {
      return document.createTextNode(ruleValue.value);
    }

    const fraction = document.createElement('span');
    fraction.className = 'sequence-fraction';

    const numerator = document.createElement('span');
    numerator.className = 'sequence-fraction-num';
    numerator.textContent = ruleValue.numerator;

    const bar = document.createElement('span');
    bar.className = 'sequence-fraction-bar';

    const denominator = document.createElement('span');
    denominator.className = 'sequence-fraction-den';
    denominator.textContent = ruleValue.denominator;

    fraction.append(numerator, bar, denominator);
    return fraction;
  }

  return {
    build,
    getTileEl,
    updateTile,
    renderAll,
    renderGravityRefill,
    triggerPangBurst,
    clearPangBurst,
    spawnFloatingScore,
    spawnSequenceHint,
    createRuleValueElement
  };
}
