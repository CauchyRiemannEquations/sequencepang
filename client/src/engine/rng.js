// 난수 생성기. 시드를 주면 재현 가능한 mulberry32, 없으면 Math.random 위임.
// 테스트에서 보드·타일 생성을 결정적으로 재현하기 위해 존재한다.
export function createRng(seed) {
  if (seed === undefined || seed === null) {
    return () => Math.random();
  }

  let state = seed >>> 0;
  return function mulberry32() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
