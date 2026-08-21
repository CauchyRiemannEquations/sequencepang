// 타일 생성. 숫자 범위는 풀(pool)로 주입받는다 — 일반(1~9), 하이퍼팡(1~12),
// 빅넘버(10~19)는 물론, 향후 음수 피버용 풀(min<0)도 같은 경로로 꽂을 수 있다.

export function createTilePool({ min, max }) {
  return { min, max };
}

export function createNormalTile(pool, rng = Math.random) {
  return {
    baseValue: Math.floor(rng() * (pool.max - pool.min + 1)) + pool.min,
    type: 'normal'
  };
}

export function pickWeighted(entries, rng = Math.random) {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let randomWeight = rng() * totalWeight;
  for (const entry of entries) {
    randomWeight -= entry.weight;
    if (randomWeight < 0) return entry;
  }
  return entries[entries.length - 1];
}

export function createFeverTile({ tier = 'normal', feverTypes, pool, rng = Math.random }) {
  const feverType = pickWeighted(feverTypes, rng);
  return {
    baseValue: createNormalTile(pool, rng).baseValue,
    type: 'fever',
    feverTier: tier,
    feverType: feverType.type,
    feverAmount: feverType.amount,
    feverLabel: feverType.label
  };
}

// 피버 중 타일 표시값 변환 (add/multiply). fever가 비활성이면 원본 그대로.
export function getDisplayValue(tileData, fever = null) {
  if (!tileData) return '';
  if (tileData.type === 'fever') return tileData.feverLabel;
  if (!fever || !fever.active) return tileData.baseValue;
  if (fever.type === 'add') return tileData.baseValue + fever.amount;
  if (fever.type === 'multiply') return tileData.baseValue * fever.amount;
  return tileData.baseValue;
}
