import type { Position, Range } from './types/index.js';

export function zeroPos(): Position {
  return { line: 1, column: 1, offset: 0 };
}

export function zeroRange(): Range {
  return { start: zeroPos(), end: zeroPos() };
}
