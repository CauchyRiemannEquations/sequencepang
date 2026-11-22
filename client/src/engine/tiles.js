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

// 피버 효과는 드래그 판정과 렌더링에 같은 값을 제공한다.
export function getDisplayValue(tileData, fever = null) {
  if (!tileData) return '';
  if (tileData.type === 'fever') return tileData.feverLabel;
  if (!fever || !fever.active) return tileData.baseValue;
  if (fever.type === 'negative') return fever.negativeValues.get(tileData) ?? tileData.baseValue;
  if (fever.type === 'add') return tileData.baseValue + fever.amount;
  if (fever.type === 'multiply') return tileData.baseValue * fever.amount;
  return tileData.baseValue;
}
