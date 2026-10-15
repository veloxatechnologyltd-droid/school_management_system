// Home-practice questions: three levels of multiple-choice or short number questions the platform can mark itself.
// One checker serves both the AI draft and the set a teacher approves, so nothing unchecked is ever stored.
export const LEVEL_COUNT = 3, MIN_PER_LEVEL = 5, MAX_PER_LEVEL = 8;
export type QuestionKind = 'choice' | 'number';
export interface BankQuestion { level: number; kind: QuestionKind; prompt: string; options: string[] | null; correctOption: number | null; answer: number | null; explanation: string | null }
export type QuestionsCheck = { ok: true; questions: BankQuestion[] } | { ok: false; reason: string };

const squash = (value: string) => value.replace(/\s+/g, ' ').trim();
const text = (value: unknown, min: number, max: number) => typeof value === 'string' && squash(value).length >= min && squash(value).length <= max;
// "All of the above" and "none of the above" make a choice ambiguous when options are shuffled.
const catchAll = /\b(all|none|both)\s+of\s+(the\s+)?(above|these)\b/i;

export type QuestionCheck = { ok: true; question: BankQuestion } | { ok: false; reason: string };
// One question on its own: the platform content library holds questions singly, a school's set holds them in levels.
export function checkQuestion(item: unknown): QuestionCheck {
  if (!item || typeof item !== 'object') return { ok: false, reason: 'bad_question' };
  const q = item as Record<string, unknown>;
  if (!Number.isInteger(q.level) || (q.level as number) < 1 || (q.level as number) > LEVEL_COUNT) return { ok: false, reason: 'bad_level' };
  if (!text(q.prompt, 5, 200)) return { ok: false, reason: 'bad_prompt' };
  const explanation = q.explanation === undefined || q.explanation === null || q.explanation === '' ? null : text(q.explanation, 3, 200) ? squash(q.explanation as string) : undefined;
  if (explanation === undefined) return { ok: false, reason: 'bad_explanation' };
  const base = { level: q.level as number, prompt: squash(q.prompt as string), explanation };
  if (q.kind === 'choice') {
    const options = q.options;
    if (!Array.isArray(options) || options.length < 3 || options.length > 4 || !options.every(o => text(o, 1, 80))) return { ok: false, reason: 'bad_options' };
    const clean = options.map(o => squash(o as string));
    // Options differing only in capital letters or punctuation are allowed: that is what a capital-letter question tests.
    if (new Set(clean).size !== clean.length || clean.some(o => catchAll.test(o))) return { ok: false, reason: 'bad_options' };
    if (!Number.isInteger(q.correctOption) || (q.correctOption as number) < 0 || (q.correctOption as number) >= clean.length) return { ok: false, reason: 'bad_answer' };
    return { ok: true, question: { ...base, kind: 'choice', options: clean, correctOption: q.correctOption as number, answer: null } };
  }
  if (q.kind === 'number') {
    const answer = q.answer;
    if (typeof answer !== 'number' || !Number.isFinite(answer) || Math.abs(answer) > 1e9 || Number(answer.toFixed(6)) !== answer) return { ok: false, reason: 'bad_answer' };
    return { ok: true, question: { ...base, kind: 'number', options: null, correctOption: null, answer } };
  }
  return { ok: false, reason: 'bad_kind' };
}

export function checkQuestions(raw: unknown): QuestionsCheck {
  if (!Array.isArray(raw)) return { ok: false, reason: 'not_a_list' };
  const questions: BankQuestion[] = [];
  for (const item of raw) {
    const one = checkQuestion(item);
    if (!one.ok) return one;
    questions.push(one.question);
  }
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const n = questions.filter(q => q.level === level).length;
    if (n < MIN_PER_LEVEL || n > MAX_PER_LEVEL) return { ok: false, reason: `level_${level}_needs_${MIN_PER_LEVEL}_to_${MAX_PER_LEVEL}` };
  }
  if (new Set(questions.map(q => q.prompt.toLowerCase())).size !== questions.length) return { ok: false, reason: 'repeated_question' };
  return { ok: true, questions };
}

// Questions in level order, each keeping the order they were written in within the level.
export const inOrder = (questions: BankQuestion[]) => [...questions].sort((a, b) => a.level - b.level);

// What to tell a teacher when a set cannot be approved.
export function questionsProblem(reason: string) {
  const level = reason.match(/^level_(\d)_needs/);
  if (level) return `Level ${level[1]} needs ${MIN_PER_LEVEL} to ${MAX_PER_LEVEL} questions`;
  return ({
    bad_level: 'Each question needs a level from 1 to 3',
    bad_prompt: 'Each question needs 5 to 200 characters of wording',
    bad_explanation: 'An explanation needs 3 to 200 characters, or leave it out',
    bad_options: 'A multiple-choice question needs 3 or 4 different options (never "all of the above")',
    bad_answer: 'Each question needs one correct answer: pick the right option, or give a number',
    bad_kind: 'A question is either multiple choice or a number',
    repeated_question: 'The same question appears twice',
  } as Record<string, string>)[reason] ?? 'The questions could not be checked';
}
