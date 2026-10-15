import { LEVEL_COUNT } from './questions';

// Home practice rules chosen by Evans (2026-10-15). A session is 5 questions at the child's level on one topic.
export const SESSION_SIZE = 5;
export const UP_AT = 4;            // 4 or 5 correct moves up a level
export const WEAK_AT_MOST = 2;     // 2 or fewer correct is a weak session; two weak sessions in a row at one level move down
export const TOPICS_OFFERED = 3;   // a child is offered their weakest few topics that have approved questions
export const SESSIONS_PER_TOPIC_PER_DAY = 2; // spaces practice out, and stops a child re-running the same few questions to climb

export type Outcome = 'up' | 'stay' | 'down' | 'done';
// previous: the child's last completed session on this topic, if any. A child starts at Level 1 and never goes below it.
export function afterSession(level: number, correct: number, previous: { level: number; correct: number } | null): { outcome: Outcome; levelAfter: number } {
  if (correct >= UP_AT) return level >= LEVEL_COUNT ? { outcome: 'done', levelAfter: level } : { outcome: 'up', levelAfter: level + 1 };
  if (correct <= WEAK_AT_MOST && previous && previous.level === level && previous.correct <= WEAK_AT_MOST && level > 1) return { outcome: 'down', levelAfter: level - 1 };
  return { outcome: 'stay', levelAfter: level };
}

// A typed number: digits with an optional minus and decimal point; spaces and thousands commas are ignored ("1,200" is 1200).
export function parseNumber(text: string): number | null {
  const clean = text.trim().replace(/\s+/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(clean)) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}
export const sameNumber = (given: number, answer: number) => Math.abs(given - answer) <= 1e-9 * Math.max(1, Math.abs(answer));
