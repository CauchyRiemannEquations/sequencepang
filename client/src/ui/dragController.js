// 포인터 히트테스트 + 드래그 선 렌더링.
// 성능 원칙:
// - 보드 지오메트리(셀 중심·간격·wrapper rect)는 measure() 시점에 1회만 계산.
//   pointer move마다 getBoundingClientRect를 부르지 않는다.
// - 히트 판정은 좌표 산술로 (row, col)을 구한 뒤
//   "중심 거리 < 셀 너비 × 0.4" 규칙(기존 손맛)을 그대로 적용.
// - 선 d 갱신은 requestAnimationFrame으로 프레임당 1회로 합침.

const ACTIVE_RADIUS_RATIO = 0.4;

export function createDragController({ boardWrapper, dragLine, dragLineGlow, size, getTileEl }) {
  let measured = false;
  let originX = 0; // 타일 (0,0) 중심의 클라이언트 좌표
  let originY = 0;
  let stepX = 0;   // 인접 셀 중심 간 간격
  let stepY = 0;
  let cellWidth = 0;
  let wrapperLeft = 0;
  let wrapperTop = 0;
  let wrapperWidth = 0;
  let wrapperHeight = 0;

  // 드래그 선 상태 — 셀 목록만 캐시하고 좌표는 프레임에서 산술로 도출
  let pathCells = [];
  let pointerPoint = null; // { x, y } (wrapper 로컬 좌표)
  let rafId = 0;

  function measure() {
    const firstTile = getTileEl(0, 0);
    const lastTile = getTileEl(size - 1, size - 1);
    if (!firstTile || !lastTile) {
      measured = false;
      return false;
    }

    const firstRect = firstTile.getBoundingClientRect();
    const lastRect = lastTile.getBoundingClientRect();
    const wrapperRect = boardWrapper.getBoundingClientRect();
    if (firstRect.width === 0) {
      measured = false;
      return false;
    }

    cellWidth = firstRect.width;
    originX = firstRect.left + firstRect.width / 2;
    originY = firstRect.top + firstRect.height / 2;
    stepX = size > 1 ? (lastRect.left - firstRect.left) / (size - 1) : firstRect.width;
    stepY = size > 1 ? (lastRect.top - firstRect.top) / (size - 1) : firstRect.height;
    wrapperLeft = wrapperRect.left;
    wrapperTop = wrapperRect.top;
    wrapperWidth = wrapperRect.width;
    wrapperHeight = wrapperRect.height;
    measured = stepX > 0 && stepY > 0;
    return measured;
  }

  // 레이아웃이 바뀐 뒤(스크롤/리사이즈 등) 다음 히트테스트에서 지연 재측정
  function invalidate() {
    measured = false;
  }

  function getCellAtPoint(clientX, clientY) {
    if (!measured && !measure()) return null;

    const col = Math.round((clientX - originX) / stepX);
    const row = Math.round((clientY - originY) / stepY);
    if (row < 0 || row >= size || col < 0 || col >= size) return null;

    const centerX = originX + col * stepX;
    const centerY = originY + row * stepY;
    const dist = Math.hypot(clientX - centerX, clientY - centerY);
    if (dist >= cellWidth * ACTIVE_RADIUS_RATIO) return null;

    return { row, col };
  }

  function getCellCenterLocal(row, col) {
    return {
      x: originX + col * stepX - wrapperLeft,
      y: originY + row * stepY - wrapperTop
    };
  }

  function renderLine() {
    rafId = 0;

    if (pathCells.length === 0) {
      dragLine.setAttribute('d', '');
      dragLineGlow.setAttribute('d', '');
      return;
    }

    const points = pathCells.map(cell => getCellCenterLocal(cell.row, cell.col));
    if (pointerPoint) {
      points.push(pointerPoint);
    }

    let pathData = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      pathData += ` L ${points[i].x} ${points[i].y}`;
    }
    dragLine.setAttribute('d', pathData);
    dragLineGlow.setAttribute('d', pathData);
  }

  function scheduleRender() {
    if (!rafId) {
      rafId = requestAnimationFrame(renderLine);
    }
  }

  // 선택 타일 목록이 바뀔 때 호출 (추가/백트래킹)
  function setSelection(cells) {
    pathCells = cells.map(cell => ({ row: cell.row, col: cell.col }));
    scheduleRender();
  }

  // 드래그 중 포인터 위치 갱신 — wrapper 밖이면 마지막 타일까지만 그린다 (기존 동작)
  function setPointer(clientX, clientY) {
    const localX = clientX - wrapperLeft;
    const localY = clientY - wrapperTop;
    pointerPoint = (localX >= 0 && localX <= wrapperWidth && localY >= 0 && localY <= wrapperHeight)
      ? { x: localX, y: localY }
      : null;
    scheduleRender();
  }

  function clearPointer() {
    pointerPoint = null;
    scheduleRender();
  }

  function clear() {
    pathCells = [];
    pointerPoint = null;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    dragLine.setAttribute('d', '');
    dragLineGlow.setAttribute('d', '');
  }

  function getLastCellCenterLocal() {
    if (pathCells.length === 0) return null;
    const last = pathCells[pathCells.length - 1];
    return getCellCenterLocal(last.row, last.col);
  }

  return {
    measure,
    invalidate,
    getCellAtPoint,
    getCellCenterLocal,
    getLastCellCenterLocal,
    setSelection,
    setPointer,
    clearPointer,
    clear,
    getWrapperSize: () => ({ width: wrapperWidth, height: wrapperHeight })
  };
}
