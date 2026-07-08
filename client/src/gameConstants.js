export const BOARD_SIZE = 6;
export const MAX_TIME = 30.0;
export const MIN_SEQUENCE_LENGTH = 3;
export const TILE_NUMBER_MIN = 1;
export const TILE_NUMBER_MAX = 9;

export const MAX_ROOM_PLAYERS = 30;

export const FEVER_TRIGGER_MIN_LENGTH = 4;
export const FEVER_DURATION_MS = 10000;
export const FEVER_ROLLBACK_MS = 1500;
export const FEVER_SCORE_MULTIPLIER = 1.5;
export const FEVER_TYPES = [
  { type: 'add', amount: 2, label: '+2', weight: 40 },
  { type: 'add', amount: 3, label: '+3', weight: 40 },
  { type: 'multiply', amount: 2, label: '×2', weight: 20 }
];

export const RECENT_SEQUENCE_LIMIT = 5;
export const REPEATED_PATH_SCORE_MULTIPLIER = 0.2;
export const REPEATED_PATTERN_SCORE_MULTIPLIER = 0.5;
export const REPEATED_PATH_TIME_MULTIPLIER = 0;
export const REPEATED_PATTERN_TIME_MULTIPLIER = 0.5;
