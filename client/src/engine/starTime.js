// 숫자·보드·수열 판정과 독립적인 보너스 상태. 시각(ms)과 설정은 호출자가 주입한다.
export function withStar(tile, spawnRate, rng = Math.random) {
  return { ...tile, isStar: tile.type === 'normal' && rng() < spawnRate };
}

export function createStarTime({ required, duration, extension, max }) {
  const state = { starCount: 0, isStarTime: false, starTimeRemaining: 0 };
  let endsAt = 0;

  function reset() {
    state.starCount = 0;
    state.isStarTime = false;
    state.starTimeRemaining = 0;
    endsAt = 0;
  }

  function sync(now) {
    if (state.isStarTime) {
      state.starTimeRemaining = Math.max(0, (endsAt - now) / 1000);
      if (state.starTimeRemaining === 0) reset();
    }
    return state;
  }

  // 유효 수열 하나에 별이 여러 개 있어도 한 번만 호출한다.
  function collect(hasStar, now) {
    sync(now);
    if (!hasStar) return null;
    if (state.isStarTime) {
      const added = Math.min(extension, Math.max(0, max - state.starTimeRemaining));
      endsAt += added * 1000;
      sync(now);
      return { type: 'extended', added };
    }
    state.starCount++;
    if (state.starCount < required) return { type: 'collected' };
    state.starCount = 0;
    state.isStarTime = true;
    endsAt = now + Math.min(duration, max) * 1000;
    sync(now);
    return { type: 'started' };
  }

  return { state, sync, collect, reset };
}
