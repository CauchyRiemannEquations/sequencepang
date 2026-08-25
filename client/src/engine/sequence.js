// 수열 판정. 드래그 중 실시간 판정과 손 뗄 때 판정이 반드시 같은 함수를
// 쓰도록 여기 한 곳에만 둔다 (불일치 원천 차단).

// values → { state: 'pending'|'valid'|'broken', kind: 'AP'|'GP'|null,
//            allSame, diff, ratio, ruleLabel }
// 기존 evaluateSequence의 판정 로직과 동일. 추가 규칙 하나:
// 0이 포함된 비상수열은 GP로 인정하지 않는다 (0÷0=NaN 우연 통과 차단,
// 향후 음수 피버 타일 풀 대비).
export function classifyChain(values) {
  const len = values.length;
  const allSame = len > 0 && values.every(value => value === values[0]);

  if (len < 3) {
    return { state: 'pending', kind: null, allSame, diff: null, ratio: null, ruleLabel: null };
  }

  let isAP = true;
  const diff = values[1] - values[0];
  for (let i = 1; i < len - 1; i++) {
    if (values[i + 1] - values[i] !== diff) {
      isAP = false;
      break;
    }
  }

  let isGP = true;
  const ratio = values[1] / values[0];
  if (!allSame && values.some(value => value === 0)) {
    isGP = false;
  } else {
    for (let i = 1; i < len - 1; i++) {
      if (Math.abs((values[i + 1] / values[i]) - ratio) > 1e-9) {
        isGP = false;
        break;
      }
    }
  }

  if (!isAP && !isGP) {
    return { state: 'broken', kind: null, allSame, diff, ratio, ruleLabel: null };
  }

  const kind = allSame || (!isAP && isGP) ? 'GP' : 'AP';
  const ruleLabel = kind === 'GP'
    ? (allSame ? '1' : formatRatioValue(values[1], values[0]))
    : formatDifferenceValue(diff);

  return { state: 'valid', kind, allSame, diff, ratio, ruleLabel };
}

// 성공 시 시간 보너스 (+0.5 고정 가산 포함, 반복 페널티 배수 적용).
// 피버 중 50% 가산 규칙(FEVER_TIME_BONUS_RATE)은 호출부 몫.
export function getTimeBonus({ kind, diff, ratio, allSame, repeatTimeMultiplier = 1 }) {
  let bonusTime;
  if (kind === 'GP') {
    const activeRatio = allSame ? 1 : ratio;
    bonusTime = activeRatio >= 2 ? 1.2 : 0.9;
  } else {
    const absDiff = Math.abs(diff);
    if (absDiff >= 4) bonusTime = 1.2;
    else if (absDiff >= 2) bonusTime = 1.0;
    else bonusTime = 0.7;
  }
  return (bonusTime + 0.5) * repeatTimeMultiplier;
}

export function formatDifferenceValue(value) {
  return value > 0 ? `+${value}` : `${value}`;
}

// 기약분수 표기. 정수로 나누어떨어지면 text, 아니면 fraction 객체.
export function formatRatioValue(numerator, denominator) {
  if (numerator % denominator === 0) {
    return {
      type: 'text',
      value: `${numerator / denominator}`
    };
  }

  const divisor = getGcd(Math.abs(numerator), Math.abs(denominator));
  return {
    type: 'fraction',
    numerator: numerator / divisor,
    denominator: denominator / divisor
  };
}

export function getGcd(a, b) {
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1;
}
