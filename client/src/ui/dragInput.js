// Keep the initiating finger authoritative; an interrupted gesture never scores.
export function bindDragInput({ boardWrapper, eventTarget, start, move, end, cancel }) {
  let touchId = null;
  let mouseActive = false;
  boardWrapper.addEventListener('mousedown', event => {
    if (event.button !== 0 || touchId !== null || mouseActive) return;
    event.preventDefault();
    mouseActive = true;
    start(event.clientX, event.clientY);
  });
  eventTarget.addEventListener('mousemove', event => {
    if (!mouseActive) return;
    event.preventDefault();
    move(event.clientX, event.clientY);
  });
  eventTarget.addEventListener('mouseup', event => {
    if (!mouseActive || event.button !== 0) return;
    mouseActive = false;
    end();
  });
  boardWrapper.addEventListener('touchstart', event => {
    event.preventDefault();
    if (touchId !== null || mouseActive) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    touchId = touch.identifier;
    start(touch.clientX, touch.clientY);
  }, { passive: false });
  eventTarget.addEventListener('touchmove', event => {
    if (touchId === null) return;
    const touch = Array.from(event.touches).find(item => item.identifier === touchId);
    if (!touch) return;
    event.preventDefault();
    move(touch.clientX, touch.clientY);
  }, { passive: false });
  for (const type of ['touchend', 'touchcancel']) {
    eventTarget.addEventListener(type, event => {
      if (touchId === null || !Array.from(event.changedTouches).some(touch => touch.identifier === touchId)) return;
      touchId = null;
      if (type === 'touchcancel') cancel();
      else end();
    });
  }
  const interrupt = () => {
    if (touchId === null && !mouseActive) return;
    touchId = null;
    mouseActive = false;
    cancel();
  };
  eventTarget.addEventListener('blur', interrupt);
  eventTarget.addEventListener('orientationchange', interrupt);
}
