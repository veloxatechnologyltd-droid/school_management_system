// A learning note says how to help a student, not who they are or what is happening at home. These checks keep it that way, so the wording is safe
// wherever it may one day be used. The word lists are a working figure: a note they wrongly refuse can be reworded, and the message names the word.
// Notes are kept as written and cannot be erased, so the lists lean towards refusing; they stop what a careless teacher writes by accident, not a determined one.
const edge = '[\\p{L}\\p{M}\\p{N}]';
const words = (alternatives: string) => new RegExp(`(?<!${edge})(?:${alternatives})(?!${edge})`,'iu');

const health = words(['sick\\w*','unwell','malaria','fever','ill','illness','diseases?','hospital\\w*','clinic','doctors?','medic\\w*','allerg\\w*','asthma\\w*','epilep\\w*','seiz\\w*','diabet\\w*',
  'hiv','disabilit\\w*','disabled','depress\\w*','anxi\\w*','trauma\\w*','abus\\w*','pregnan\\w*','bereave\\w*','death','died','dead','orphan\\w*','violen\\w*','beaten',
  'stomach\\w*','headaches?','cough\\w*','typhoid','cancer','surgery','injur\\w*','glasses','eyesight','deaf','blind','stammer\\w*','stutter\\w*',
  'hearing (?:loss|problems?|impair\\w*|difficult\\w*|is poor)','hard of hearing',
  'mental(?:ly)?\\s+(?:health|ill\\w*|disorder\\w*|condition|state|problems?|challeng\\w*|handicap\\w*|retard\\w*)'].join('|'));
const family = words(['famil(?:y|ies)','mothers?','fathers?','mum','mummy','mom','dad','daddy','parents?','grand(?:mother|father|ma|pa|parents?)','aunt\\w*','uncle','step(?:mother|father|parents?|brother|sister)','siblings?',
  'divorc\\w*','hungry','hunger','poverty','breakfast','fees?','afford\\w*'].join('|'));
const labels = words(['autis\\w*','adhd','dyslex\\w*','disorder\\w*','diagnos(?:is|es|ed|ing)','syndrome','retard\\w*','slow (?:learner|child|pupil|student|kid)s?','lazy','naughty','backward'].join('|'));
const aids = /(?<![\p{L}\p{M}\p{N}])AIDS(?![\p{L}\p{M}\p{N}])/u; // capitals only: "teaching aids" is ordinary

// The same text with look-alikes folded and invisible characters removed, so a name cannot be hidden inside one.
const invisible = new RegExp(`[${[0xAD,0x200B,0x200C,0x200D,0x2060,0xFEFF].map(code => String.fromCharCode(code)).join('')}]`,'g');
const clean = (text: string) => text.normalize('NFKC').replace(invisible,'');
const squash = (text: string) => clean(text).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');

// Returns what to tell the teacher, or null when the note is fine.
export function checkLearningNote(note: string, learner: { full_name: string; admission_number: string }): string | null {
  const text = clean(note);
  const names = [...new Set(clean(learner.full_name).split(/[^\p{L}\p{M}]+/u).filter(part => [...part].length >= 3))];
  // An admission number of a few characters is an ordinary number ("12", "101"), so only a longer one is looked for, in any spelling of its separators.
  const admission = squash(learner.admission_number);
  if (names.some(name => new RegExp(`(?<!${edge})${name}(?!${edge})`,'iu').test(text)) || (admission.length >= 5 && squash(note).includes(admission)))
    return "Leave the student's name and admission number out of a learning note: it says how to help, not who.";
  const matched = health.exec(text)?.[0] ?? aids.exec(text)?.[0] ?? family.exec(text)?.[0];
  if (matched) return `Health, family and home matters do not belong in a learning note ("${matched}"). Use a school note for those.`;
  const label = labels.exec(text)?.[0];
  if (label) return `Leave out labels and diagnoses ("${label}"). Say what helps instead, for example "needs short instructions".`;
  return null;
}
