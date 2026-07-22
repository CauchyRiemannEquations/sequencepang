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
export const SUPER_FEVER_TYPES = [
  { type: 'multiply', amount: 3, label: '×3', weight: 50 },
  { type: 'add', amount: 10, label: '+10', weight: 50 }
];

// 라스트팡: 남은 시간 5초 이하일 때 모든 점수 2배 (피버 배율과 중첩)
// 2026-07-27 00:00 KST(주간 랭킹 리셋 시각)부터 적용
export const LAST_SPURT_LAUNCH_AT_MS = Date.parse('2026-07-26T15:00:00.000Z');
export const LAST_SPURT_THRESHOLD_S = 5;
export const LAST_SPURT_SCORE_MULTIPLIER = 2;

export const RECENT_SEQUENCE_LIMIT = 5;
export const REPEATED_PATH_SCORE_MULTIPLIER = 0.2;
export const REPEATED_PATTERN_SCORE_MULTIPLIER = 0.5;
export const REPEATED_PATH_TIME_MULTIPLIER = 0;
export const REPEATED_PATTERN_TIME_MULTIPLIER = 0.5;
