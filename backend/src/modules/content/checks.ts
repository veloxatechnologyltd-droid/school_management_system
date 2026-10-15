// The platform content library: what a question or parent guide must look like, and the automatic checks every version passes
// before a reviewer sees it. Blocking findings stop a submit; warnings are shown to the reviewer, who still reads everything.
// Limits below are working figures to tune once real reviewers have used them.
import { checkQuestion } from '../practice/questions';
import { labels } from '../ai/practice-questions-draft';

export type ContentKind = 'question' | 'guide';
export type Stage = 'lower_primary' | 'upper_primary' | 'jhs';
export interface QuestionBody { kind: 'choice' | 'number'; prompt: string; options: string[] | null; correctOption: number | null; answer: number | null; explanation: string | null }
export interface GuideBody { learning: string; example: string; mistakes: string[]; activity: string }
export type ContentBody = QuestionBody | GuideBody;
export interface Finding { code: string; message: string; blocking: boolean; related?: string[] }
export interface CheckReport { blocking: number; warnings: number; machineChecked: boolean; findings: Finding[] }
// Another version of the same indicator and kind that is still in play, for the duplicate check.
export interface Neighbour { itemId: string; text: string }

export const stageOf = (level: string): Stage => /^Basic [1-3]$/.test(level) ? 'lower_primary' : /^Basic [4-6]$/.test(level) ? 'upper_primary' : 'jhs';

const squash = (value: string) => value.replace(/\s+/g, ' ').trim();
const within = (value: unknown, min: number, max: number) => typeof value === 'string' && squash(value).length >= min && squash(value).length <= max;

// Control characters and lone surrogates have no place in wording and cannot be stored (PostgreSQL refuses \u0000 in jsonb).
// New lines and tabs are ordinary spacing and are kept apart from this.
const unprintable = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const hasUnprintable = (value: unknown): boolean => typeof value === 'string' ? unprintable.test(value) : Array.isArray(value) ? value.some(hasUnprintable) : value !== null && typeof value === 'object' ? Object.values(value).some(hasUnprintable) : false;

export type BodyCheck = { ok: true; body: ContentBody } | { ok: false; reason: string };
// Cleans a body to the stored shape. A question's difficulty lives on the item, not in the body.
export function checkBody(kind: ContentKind, level: number | null, raw: unknown): BodyCheck {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'bad_body' };
  if (hasUnprintable(raw)) return { ok: false, reason: 'bad_characters' };
  const b = raw as Record<string, unknown>;
  if (kind === 'question') {
    const one = checkQuestion({ ...b, level });
    if (!one.ok) return one;
    const { kind: type, prompt, options, correctOption, answer, explanation } = one.question;
    return { ok: true, body: { kind: type, prompt, options, correctOption, answer, explanation } };
  }
  if (!within(b.learning, 20, 600) || !within(b.example, 10, 600) || !within(b.activity, 10, 400)) return { ok: false, reason: 'bad_guide_text' };
  const mistakes = b.mistakes;
  if (!Array.isArray(mistakes) || mistakes.length < 1 || mistakes.length > 4 || !mistakes.every(m => within(m, 5, 200))) return { ok: false, reason: 'bad_mistakes' };
  return { ok: true, body: { learning: squash(b.learning as string), example: squash(b.example as string), mistakes: mistakes.map(m => squash(m as string)), activity: squash(b.activity as string) } };
}

export function bodyProblem(reason: string) {
  const level = reason.match(/^level_(\d)_needs/);
  if (level) return 'A question needs a difficulty from 1 to 3';
  return ({
    bad_body: 'The wording is missing',
    bad_characters: 'The wording contains a character that cannot be stored',
    bad_level: 'A question needs a difficulty from 1 to 3',
    bad_prompt: 'A question needs 5 to 200 characters of wording',
    bad_explanation: 'An explanation needs 3 to 200 characters, or leave it out',
    bad_options: 'A multiple-choice question needs 3 or 4 different options (never "all of the above")',
    bad_answer: 'A question needs one correct answer: pick the right option, or give a number',
    bad_kind: 'A question is either multiple choice or a number',
    bad_guide_text: 'A guide needs what the child is learning (20 to 600 characters), a worked example (10 to 600) and a home activity (10 to 400)',
    bad_mistakes: 'A guide needs 1 to 4 common mistakes, each 5 to 200 characters',
  } as Record<string, string>)[reason] ?? 'The wording could not be checked';
}

// What the child or parent reads, in the order they read it.
export function textOf(kind: ContentKind, body: ContentBody): string[] {
  if (kind === 'question') { const q = body as QuestionBody; return [q.prompt, ...(q.options ?? []), q.explanation ?? '']; }
  const g = body as GuideBody;
  return [g.learning, g.example, ...g.mistakes, g.activity];
}

// ---- Arithmetic: when the whole question is a sum ("What is 12 + 7?"), the computer works out the answer itself.
// Anything wordier (a story problem) is left to the reviewer, because guessing which numbers matter would flag good questions.
// A slash is not read as division: in a primary school it is usually a fraction (1/4 + 2/4), so division is written with ÷.
const lead = /^(what is|what's|find|work out|calculate|solve|simplify|evaluate)\s*:?\s*/i;
export function arithmeticOf(prompt: string): number | null {
  const s = squash(prompt).replace(lead, '').replace(/[?=\s]+$/, '').replace(/[−–]/g, '-').replace(/×/g, '*').replace(/([\d)])\s*x\s*(?=[\d(])/gi, '$1*');
  if (!/^[\d\s.+\-*÷()]+$/.test(s) || !/[\d)]\s*[+\-*÷]\s*[\d(]/.test(s) || s.length > 80) return null;
  let at = 0;
  const peek = () => { while (s[at] === ' ') at++; return s[at]; };
  const number = (): number => {
    const c = peek();
    if (c === '(') { at++; const v = sum(); if (peek() !== ')') throw new Error('x'); at++; return v; }
    if (c === '-') { at++; return -number(); }
    const m = /^\d+(\.\d+)?/.exec(s.slice(at)); if (!m) throw new Error('x');
    at += m[0].length; return Number(m[0]);
  };
  const product = (): number => { let v = number(); for (let c = peek(); c === '*' || c === '÷'; c = peek()) { at++; const r = number(); if (c === '÷' && r === 0) throw new Error('x'); v = c === '*' ? v * r : v / r; } return v; };
  const sum = (): number => { let v = product(); for (let c = peek(); c === '+' || c === '-'; c = peek()) { at++; const r = product(); v = c === '+' ? v + r : v - r; } return v; };
  try { const value = sum(); return at >= s.length && Number.isFinite(value) ? Number(value.toFixed(6)) : null; } catch { return null; }
}
// "1,200", "GH₵5.50", "12 cm" read as numbers; fractions and words do not.
export function numericOption(option: string): number | null {
  const m = /^\s*(?:GH₵|₵)?\s*(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*[A-Za-z%]*\s*$/.exec(option);
  return m ? Number(m[1]!.replace(/,/g, '')) : null;
}

// ---- Duplicates and reading level.
// Wording as compared for repeats: capitals, spacing and sentence punctuation do not matter, but the operation (+ − × ÷), a decimal point
// and letters such as ɔ and ɛ do, so "12 + 7" and "12 − 7" are different questions.
const key = (text: string) => text.toLowerCase().replace(/[−–]/g, '-').replace(/[^\p{L}\p{N}+\-*×÷/=<>%.]/gu, ' ').replace(/\.+(?=\s|$)/g, '').replace(/\s+/g, ' ').trim();
const words = (text: string) => new Set(key(text).split(' ').filter(Boolean));
const overlap = (a: Set<string>, b: Set<string>) => { let both = 0; for (const w of a) if (b.has(w)) both++; return both / (a.size + b.size - both || 1); };
export const NEAR_DUPLICATE = 0.8;
// Longest sentence average (words) and the share of long words (9+ letters) each stage may use.
export const READING_LIMITS: Record<Stage, { sentence: number; long: number }> = { lower_primary: { sentence: 10, long: 0.08 }, upper_primary: { sentence: 16, long: 0.12 }, jhs: { sentence: 24, long: 0.18 } };
export function readingLevel(text: string) {
  const sentences = text.split(/[.?!]+/).map(s => s.trim()).filter(Boolean);
  const all = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return { sentence: all.length / (sentences.length || 1), long: all.length ? all.filter(w => w.length >= 9).length / all.length : 0 };
}

export function runChecks(kind: ContentKind, stage: Stage, body: ContentBody, neighbours: Neighbour[]): CheckReport {
  const findings: Finding[] = [];
  const add = (code: string, message: string, blocking: boolean, related?: string[]) => findings.push({ code, message, blocking, ...(related ? { related } : {}) });
  const parts = textOf(kind, body);
  if (parts.some(p => labels.test(p))) add('labelling_language', 'Wording that labels or diagnoses a child (a learning difficulty or disorder) has no place in practice content', true);

  let machineChecked = false;
  if (kind === 'question') {
    const q = body as QuestionBody;
    const expected = arithmeticOf(q.prompt);
    if (expected !== null) {
      // An answer written in words ("nineteen") cannot be compared, so it is left to the reviewer.
      const given = q.kind === 'number' ? q.answer : numericOption(q.options![q.correctOption!]!);
      if (given !== null) {
        machineChecked = true;
        if (Math.abs(given - expected) > 1e-6) add('wrong_answer', `The question works out to ${expected}, not ${given}`, true);
        else if (q.kind === 'choice' && q.options!.some((o, i) => i !== q.correctOption && numericOption(o) !== null && Math.abs(numericOption(o)! - expected) <= 1e-6)) add('two_right_answers', `Two options both equal ${expected}`, true);
      }
    }
  }

  // Duplicates are judged on the wording a child sees first: a question's prompt, a guide's opening line.
  const lead0 = kind === 'question' ? (body as QuestionBody).prompt : (body as GuideBody).learning;
  const mine = key(lead0), mineWords = words(lead0);
  const exact = neighbours.filter(n => key(n.text) === mine).map(n => n.itemId);
  if (exact.length) add('duplicate', 'The same wording is already in the library for this indicator', true, exact);
  else {
    const near = neighbours.filter(n => overlap(mineWords, words(n.text)) >= NEAR_DUPLICATE).map(n => n.itemId);
    if (near.length) add('near_duplicate', 'Very close to wording already in the library for this indicator', false, near);
  }

  // The stage limits are for what a child reads; a parent guide is written for an adult.
  if (kind === 'question') {
    const reading = readingLevel([(body as QuestionBody).prompt, (body as QuestionBody).explanation ?? ''].join('. '));
    const limit = READING_LIMITS[stage];
    if (reading.sentence > limit.sentence) add('reading_level', `Sentences average ${reading.sentence.toFixed(0)} words; this stage reads best at ${limit.sentence} or fewer`, false);
    else if (reading.long > limit.long) add('reading_level', `${Math.round(reading.long * 100)}% of the words are long (9+ letters); this stage reads best at ${Math.round(limit.long * 100)}% or fewer`, false);
  }

  return { blocking: findings.filter(f => f.blocking).length, warnings: findings.filter(f => !f.blocking).length, machineChecked, findings };
}
