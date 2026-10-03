// 보드 DOM 렌더링. 타일 엘리먼트를 2차원 배열로 캐시해
// getElementById/querySelectorAll 루프를 제거한다.

const TILE_FALL_PX = 56; // 타일 한 칸 낙하 거리 (기존 renderGravityRefill과 동일)

export function createBoardView({ boardElement, boardWrapper, size, getDisplayValue, isBigNumberTile }) {
  let tileEls = [];
  let pangLayer = null;

  function updateTileElement(tileElement, tileData) {
    tileElement.textContent = getDisplayValue(tileData);
    tileElement.classList.toggle('fever-tile', tileData?.type === 'fever');
    tileElement.classList.toggle('super-fever-tile', tileData?.type === 'fever' && tileData?.feverTier === 'super');
    tileElement.classList.toggle('big-number-tile', tileData?.type === 'normal' && isBigNumberTile(tileData));
    tileElement.classList.toggle('star-number', !!tileData?.isStar);
    tileElement.dataset.isStar = String(!!tileData?.isStar);
    tileElement.setAttribute('aria-label', `${tileData?.isStar ? '별 숫자 ' : ''}${getDisplayValue(tileData)}`);
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
  function renderGravityRefill(boardData, { spawned = [] } = {}) {
    // 같은 숫자로 리필되어도 새로 생긴 타일은 반드시 내려오게 한다.
    const spawnedKeys = new Set(spawned.map(({ row, col }) => `${row}:${col}`));
    for (let c = 0; c < size; c++) {
      let newRowCount = 0;

      for (let r = 0; r < size; r++) {
        const tile = tileEls[r][c];
        if (spawnedKeys.has(`${r}:${c}`) || tile.textContent != getDisplayValue(boardData[r][c]) || tile.dataset.tileType !== boardData[r][c]?.type) newRowCount++;
      }

      let newIdx = 0;
      for (let r = 0; r < size; r++) {
        const tile = tileEls[r][c];
        const tileData = boardData[r][c];
        const newVal = getDisplayValue(tileData);

        if (spawnedKeys.has(`${r}:${c}`) || tile.textContent != newVal || tile.dataset.tileType !== tileData?.type) {
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
        } else {
          // 같은 숫자/타입이 내려와도 별 메타데이터는 반드시 갱신한다.
          updateTileElement(tile, tileData);
        }
        tile.classList.remove('selected', 'last-selected', 'matched', 'sequence-invalid', 'pang-burst');
        tile.classList.toggle('fever-tile', tileData?.type === 'fever');
        tile.classList.toggle('super-fever-tile', tileData?.type === 'fever' && tileData?.feverTier === 'super');
      }
    }
  }

  // 크로스는 마지막 타일에서 십자로 퍼지고, 풀보드는 전판이 동시에 터진다.
  function triggerPangBurst(cells, originCell, {
    tier = 'cross', label, extraPoints = 0, durationMs, staggerMs, settleMs = 0
  }) {
    clearPangBurst();
    const originTile = getTileEl(originCell.row, originCell.col);
    if (!originTile) return 0;
    const tierClass = tier === 'full' ? 'full' : 'cross';
    const origin = tierClass === 'full'
      ? { x: boardWrapper.clientWidth / 2, y: boardWrapper.clientHeight / 2 }
      : getTileCenterInWrapper(originTile);
    boardWrapper.classList.add('pang-cinematic', `pang-cinematic--${tierClass}`);
    boardWrapper.style.setProperty('--pang-origin-x', `${origin.x}px`);
    boardWrapper.style.setProperty('--pang-origin-y', `${origin.y}px`);

    const layer = document.createElement('div');
    layer.className = `pang-cinematic-layer pang-cinematic-layer--${tierClass}`;
    layer.setAttribute('aria-hidden', 'true');
    for (const name of ['flash', 'shockwave', 'core', 'ray-horizontal', 'ray-vertical']) {
      const effect = document.createElement('span');
      effect.className = `pang-${name}`;
      layer.appendChild(effect);
    }
    const copy = document.createElement('span');
    copy.className = 'pang-cinematic-copy';
    const title = document.createElement('strong');
    title.className = 'pang-cinematic-title';
    title.textContent = label || (tierClass === 'full' ? '풀보드팡!' : '크로스팡!');
    copy.appendChild(title);
    if (extraPoints > 0) {
      const bonus = document.createElement('small');
      bonus.className = 'pang-cinematic-bonus';
      bonus.textContent = `+${extraPoints.toLocaleString('ko-KR')}`;
      copy.appendChild(bonus);
    }
    layer.appendChild(copy);
    boardWrapper.appendChild(layer);
    pangLayer = layer;

    let maxDelay = 0;
    cells.forEach(cell => {
      const tile = getTileEl(cell.row, cell.col);
      if (!tile) return;
      const rowDelta = cell.row - (tierClass === 'full' ? (size - 1) / 2 : originCell.row);
      const colDelta = cell.col - (tierClass === 'full' ? (size - 1) / 2 : originCell.col);
      const distance = Math.max(Math.abs(rowDelta), Math.abs(colDelta));
      const delay = tierClass === 'full' ? 0 : distance * staggerMs;
      maxDelay = Math.max(maxDelay, delay);
      // 기존 낙하의 animationDelay가 폭발 타이밍을 덮지 않게 한다.
      tile.style.animationDelay = '';
      tile.style.setProperty('--pang-delay', delay + 'ms');
      tile.style.setProperty('--pang-duration', durationMs + 'ms');
      tile.style.setProperty('--pang-dx', `${colDelta * 14}px`);
      tile.style.setProperty('--pang-dy', `${rowDelta * 14}px`);
      tile.style.setProperty('--pang-rotation', `${((cell.row + cell.col) % 2 ? 1 : -1) * 18}deg`);
      tile.classList.add('pang-burst', `pang-${tierClass}-target`);
    });
    const sceneMs = durationMs + maxDelay + settleMs;
    boardWrapper.style.setProperty('--pang-scene-duration', `${sceneMs}ms`);
    return sceneMs;
  }

  function clearPangBurst() {
    pangLayer?.remove();
    pangLayer = null;
    boardWrapper.classList.remove('pang-cinematic', 'pang-cinematic--cross', 'pang-cinematic--full');
    for (const name of ['--pang-origin-x', '--pang-origin-y', '--pang-scene-duration']) {
      boardWrapper.style.removeProperty(name);
    }
    for (const row of tileEls) {
      for (const tile of row) {
        tile.classList.remove('pang-burst', 'pang-cross-target', 'pang-full-target');
        tile.style.animationDelay = '';
        tile.style.removeProperty('--pang-delay');
        tile.style.removeProperty('--pang-duration');
        tile.style.removeProperty('--pang-dx');
        tile.style.removeProperty('--pang-dy');
        tile.style.removeProperty('--pang-rotation');
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
