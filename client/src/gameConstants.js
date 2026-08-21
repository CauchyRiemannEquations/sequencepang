export const BOARD_SIZE = 6;
export const MAX_TIME = 30.0;
export const MIN_SEQUENCE_LENGTH = 3;
export const TILE_NUMBER_MIN = 1;
export const TILE_NUMBER_MAX = 9;

export const MAX_ROOM_PLAYERS = 30;

export const FEVER_TRIGGER_MIN_LENGTH = 4;
export const SUPER_FEVER_TRIGGER_MIN_LENGTH = 5;
// 슈퍼피버·피버 시간 개편은 2026-07-22 00:00 KST(일간 랭킹 리셋 시각)부터 적용
export const SUPER_FEVER_LAUNCH_AT_MS = Date.parse('2026-07-21T15:00:00.000Z');
export const FEVER_DURATION_MS = 8000;
export const SUPER_FEVER_DURATION_MS = 10000;
export const PRE_LAUNCH_FEVER_DURATION_MS = 10000;
export const PRE_LAUNCH_FEVER_TIME_BONUS_RATE = 1;
export const FEVER_ROLLBACK_MS = 1500;
export const FEVER_SCORE_MULTIPLIER = 1.5;
export const SUPER_FEVER_SCORE_MULTIPLIER = 2;
// 피버 중 수열 성공 시간 보너스는 절반만 피버 시간에 가산
export const FEVER_TIME_BONUS_RATE = 0.5;
export const FEVER_TYPES = [
  { type: 'add', amount: 2, label: '+2', weight: 40 },
  { type: 'add', amount: 3, label: '+3', weight: 40 },
  { type: 'multiply', amount: 2, label: '×2', weight: 20 }
];
// bigNumber: 보드 변환 대신 새로 채워지는 타일이 10~19 원본 숫자로 등장
export const SUPER_FEVER_TYPES = [
  { type: 'multiply', amount: 3, label: '×3', weight: 50 },
  { type: 'bigNumber', amount: 0, label: '10+', weight: 50 }
];
export const BIG_NUMBER_TILE_MIN = 10;
export const BIG_NUMBER_TILE_MAX = 19;

// 라스트팡: 남은 시간 5초 이하일 때 모든 점수 2배 (피버 배율과 중첩)
// 2026-07-27 00:00 KST(주간 랭킹 리셋 시각)부터 적용
export const LAST_SPURT_LAUNCH_AT_MS = Date.parse('2026-07-26T15:00:00.000Z');
export const LAST_SPURT_THRESHOLD_S = 5;
export const LAST_SPURT_SCORE_MULTIPLIER = 2;

// 하이퍼팡: 한 판 점수가 기준을 넘으면 보드가 새로 생성되고 숫자 범위가 1~12로 확장
export const HYPER_PANG_SCORE_THRESHOLD = 1000000;
export const HYPER_PANG_TILE_MAX = 12;
export const HYPER_PANG_TIME_BONUS_S = 5;

// 연쇄 티어 확장: 6연쇄 크로스팡 / 7+연쇄 풀보드팡 (튜닝 예정 — 이름은 임시라 문자열도 상수)
// allSame 연쇄는 피버 규칙과 동일하게 제외. 기존 피버 블록 대기와 함께 동작한다.
export const CROSS_PANG_MIN_LENGTH = 6;
export const FULL_PANG_MIN_LENGTH = 7;
export const CROSS_PANG_POINTS_PER_TILE = 40;
export const CROSS_PANG_TIME_BONUS_S = 1.0;
export const FULL_PANG_TIME_BONUS_S = 3.0;
export const CROSS_PANG_LABEL = '크로스팡!';
export const FULL_PANG_LABEL = '풀보드팡!';
export const PANG_BURST_MS = 120;
export const PANG_BURST_STAGGER_MS = 25;

// 0초 도달 시 드래그 유예: 3타일 이상 드래그 중이면 최대 1초 안에 마무리 허용
export const TIMEOUT_GRACE_MS = 1000;

export const RECENT_SEQUENCE_LIMIT = 5;
export const REPEATED_PATH_SCORE_MULTIPLIER = 0.2;
export const REPEATED_PATTERN_SCORE_MULTIPLIER = 0.5;
export const REPEATED_PATH_TIME_MULTIPLIER = 0;
export const REPEATED_PATTERN_TIME_MULTIPLIER = 0.5;
