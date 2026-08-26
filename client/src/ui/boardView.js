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

  // 크로스팡/풀보드팡 필살기 연출.
  // 타이틀·빔·충격파·입자와 타일 연쇄 폭발을 한 타임라인으로 묶고 전체 소요 시간을 반환한다.
  function triggerPangBurst(cells, originCell, {
    tier = 'cross',
    label = tier === 'full' ? '풀보드팡!' : '크로스팡!',
    extraPoints = 0,
    durationMs,
    staggerMs
  }) {
    clearPangBurst();

    const originTile = getTileEl(originCell.row, originCell.col);
    if (!originTile) return durationMs;
    const { x, y } = getTileCenterInWrapper(originTile);
    const tierClass = tier === 'full' ? 'full' : 'cross';

    boardWrapper.classList.add('pang-cinematic', `pang-cinematic--${tierClass}`);
    boardWrapper.style.setProperty('--pang-origin-x', `${x}px`);
    boardWrapper.style.setProperty('--pang-origin-y', `${y}px`);
    originTile.classList.add('pang-origin');

    const layer = document.createElement('div');
    layer.className = `pang-cinematic-layer pang-cinematic-layer--${tierClass}`;
    layer.setAttribute('aria-hidden', 'true');

    const flash = document.createElement('span');
    flash.className = 'pang-screen-flash';
    const shockwave = document.createElement('span');
    shockwave.className = 'pang-shockwave';
    const core = document.createElement('span');
    core.className = 'pang-energy-core';
    const horizontalRay = document.createElement('span');
    horizontalRay.className = 'pang-ray pang-ray--horizontal';
    const verticalRay = document.createElement('span');
    verticalRay.className = 'pang-ray pang-ray--vertical';

    const titleWrap = document.createElement('span');
    titleWrap.className = 'pang-cinematic-copy';
    const title = document.createElement('strong');
    title.className = 'pang-cinematic-title';
    title.textContent = label;
    const subtitle = document.createElement('small');
    subtitle.className = 'pang-cinematic-subtitle';
    subtitle.textContent = extraPoints > 0
      ? `보너스 +${extraPoints.toLocaleString('ko-KR')}`
      : (tierClass === 'full' ? '보드 전체 재생성' : '가로 · 세로 싹쓸이');
    titleWrap.append(title, subtitle);

    const particles = document.createElement('span');
    particles.className = 'pang-particles';
    const particleCount = tierClass === 'full' ? 32 : 22;
    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement('i');
      const angle = (Math.PI * 2 * i) / particleCount;
      const distance = (tierClass === 'full' ? 150 : 105) + (i % 4) * 18;
      particle.style.setProperty('--particle-x', `${Math.cos(angle) * distance}px`);
      particle.style.setProperty('--particle-y', `${Math.sin(angle) * distance}px`);
      particle.style.setProperty('--particle-delay', `${(i % 7) * 18}ms`);
      particle.style.setProperty('--particle-size', `${3 + (i % 4)}px`);
      particles.appendChild(particle);
    }

    layer.append(flash, shockwave, core, horizontalRay, verticalRay, particles, titleWrap);
    boardWrapper.appendChild(layer);
    pangLayer = layer;

    let maxDelay = 0;
    cells.forEach(cell => {
      const tile = getTileEl(cell.row, cell.col);
      if (!tile) return;
      const rowDelta = cell.row - originCell.row;
      const colDelta = cell.col - originCell.col;
      const dist = Math.max(Math.abs(rowDelta), Math.abs(colDelta));
      const delay = dist * staggerMs;
      maxDelay = Math.max(maxDelay, delay);
      tile.style.setProperty('--pang-delay', `${delay}ms`);
      const directionScale = tierClass === 'full' ? 22 : 16;
      const rotation = ((cell.row * 7 + cell.col * 11) % 2 ? 1 : -1) * (10 + dist * 7);
      tile.style.setProperty('--pang-dx', `${colDelta * 8}px`);
      tile.style.setProperty('--pang-dy', `${rowDelta * 8}px`);
      tile.style.setProperty('--pang-dx-far', `${colDelta * directionScale}px`);
      tile.style.setProperty('--pang-dy-far', `${rowDelta * directionScale}px`);
      tile.style.setProperty('--pang-rot', `${rotation}deg`);
      tile.style.setProperty('--pang-rot-far', `${rotation * 2}deg`);
      tile.classList.add('pang-burst', `pang-${tierClass}-target`);
    });

    requestAnimationFrame(() => layer.classList.add('show'));
    return durationMs + maxDelay + (tierClass === 'full' ? 430 : 280);
  }

  // 연출 잔여 상태 정리 (collapse 직전 호출 — 낙하 애니메이션과 충돌 방지)
  function clearPangBurst() {
    pangLayer?.remove();
    pangLayer = null;
    boardWrapper.classList.remove('pang-cinematic', 'pang-cinematic--cross', 'pang-cinematic--full');
    boardWrapper.style.removeProperty('--pang-origin-x');
    boardWrapper.style.removeProperty('--pang-origin-y');

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const tile = tileEls[r]?.[c];
        if (!tile) continue;
        tile.classList.remove('pang-burst', 'pang-cross-target', 'pang-full-target', 'pang-origin');
        tile.style.animationDelay = '';
        tile.style.removeProperty('--pang-delay');
        tile.style.removeProperty('--pang-dx');
        tile.style.removeProperty('--pang-dy');
        tile.style.removeProperty('--pang-dx-far');
        tile.style.removeProperty('--pang-dy-far');
        tile.style.removeProperty('--pang-rot');
        tile.style.removeProperty('--pang-rot-far');
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
