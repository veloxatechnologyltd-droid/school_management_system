// Snapshot of the hosted Sunrise demo school, taken read-only on 16 Oct 2026.
// Sunrise is the demo school: the children are sample learners, every figure and answer comes from the live platform.
export const SNAPSHOT_DATE = '16 October 2026';

export const school = {
  name: 'Sunrise International School',
  learners: 190,
  classes: 13,
  term: 'Term 1, 2026/2027',
};

export const fees = {
  billed: 256240,
  collected: 145495,
  outstanding: 110745,
  unpaidInvoices: 105,
  invoices: 190,
  classes: [
    { name: 'JHS 2', collected: 65.6, owed: 9075 },
    { name: 'JHS 1', collected: 62.4, owed: 8975 },
    { name: 'Basic 6', collected: 56.3, owed: 9165 },
    { name: 'JHS 3', collected: 55.7, owed: 9900 },
    { name: 'Basic 3', collected: 23.5, owed: 17215 },
  ],
};

export const basic6 = [
  'Abena Antwi', 'Abigail Fosu', 'Daniel Ansah', 'Daniel Boateng', 'Emmanuel Frimpong', 'Esi Mensah', 'Grace Annan', 'Kwame Asante',
  'Michael Appiah', 'Nana Ama Ansah', 'Nana Kwame Danso', 'Priscilla Dogbe', 'Richard Agbeko', 'Richard Gyamfi', 'Yaw Ansah', 'Yaw Boakye',
];

// Basic 6 class average by week this term (all subjects), and Mathematics.
export const basic6Weeks = {
  labels: ['7 Sep', '14 Sep', '21 Sep', '28 Sep', '5 Oct', '12 Oct'],
  overall: [56.9, 58.3, 56.1, 58.2, 53.3, 53.9],
  maths: [43.9, 59.7, 45.1, 62.7, 42.7, 59.2],
};

export const kwame = {
  name: 'Kwame Asante',
  firstName: 'Kwame',
  className: 'Basic 6',
  maths: { labels: ['Apr', 'May', 'Jun', 'Jul', 'Sep', 'Oct'], values: [32.5, 36.6, 34.4, 45.6, 43.2, 65.8] },
  teacherTip: { teacher: 'Bright Amponsah', topic: 'Fractions', body: 'Fold a sheet of paper into halves, quarters and eighths with Kwame and ask which piece is bigger. A few minutes most evenings helps.' },
  headNote: { author: 'Samuel Owusu-Ansah, headteacher', body: 'Kwame has worked hard on fractions this term. Ten minutes of practice at home with the fraction strips on Tuesday and Thursday evenings will keep it going.' },
  familyNote: { author: 'Mrs. Grace Asante', body: 'Thank you. We practise at home on Tuesday evenings. He says the strips help. Please tell us if he needs anything else for Mathematics.' },
  practice: [
    { subject: 'Social Studies', topic: 'Map reading', level: 2, sessions: 2 },
    { subject: 'English', topic: 'Tenses and agreement', level: 2, sessions: 1 },
    { subject: 'Science', topic: 'Energy and its forms', level: 1, sessions: 1 },
  ],
  bill: { term: 'Term 1, 2026/2027', lines: [['Tuition', 1200], ['ICT levy', 80], ['PTA dues', 50]] as [string, number][], discount: ['Second-child discount', 50] as [string, number], paid: 640, balance: 640 },
  report: {
    term: 'Term 1, 2025/2026', className: 'Basic 5', average: 46, conduct: 'Very good', interest: 'Football',
    subjects: [
      ['Science', 48, 62, 57.8, '4'], ['Ghanaian Language (Twi)', 49, 50, 49.7, '6'], ['Creative Arts', 65, 43, 49.6, '6'],
      ['Mathematics', 44, 51, 48.9, '6'], ['Religious and Moral Education', 56, 42, 46.2, '6'], ['Computing', 49, 36, 39.9, '8'],
      ['English Language', 56, 31, 38.5, '8'], ['Social Studies', 36, 38, 37.4, '8'],
    ] as [string, number, number, number, string][],
  },
};

export const notice = { title: 'PTA general meeting', body: 'The PTA general meeting is on Saturday 17 October at 9:00 am in the school hall. We will discuss the Term 1 budget and the school library.' };

export type Question = { prompt: string; options?: string[]; correct?: number; answer?: number; why: string };
// Fractions question bank for Basic 6: drafted by Claude, edited and approved by the headteacher on 15 Oct 2026.
export const fractions: Question[][] = [
  [
    { prompt: 'What is 1/4 + 2/4?', options: ['3/4', '3/8', '2/4', '1/4'], correct: 0, why: 'Add the tops: 1 + 2 = 3. The bottom stays 4.' },
    { prompt: 'Which fraction is the same as one half?', options: ['1/3', '2/4', '2/3', '1/4'], correct: 1, why: '2/4 is 2 of 4 equal parts, which is half.' },
    { prompt: 'In the fraction 3/5, what is the denominator?', options: ['3', '8', '5', '15'], correct: 2, why: 'The denominator is the bottom number: it says how many equal parts.' },
    { prompt: 'What is 2/7 + 3/7? Type the top number of the answer (the bottom stays 7).', answer: 5, why: '2 + 3 = 5, so the answer is 5/7.' },
    { prompt: 'Which is bigger, 1/2 or 1/4?', options: ['1/2', '1/4', 'They are equal', 'You cannot tell'], correct: 0, why: 'A half is bigger than a quarter.' },
  ],
  [
    { prompt: 'Ama has 24 mangoes and sells 1/3 of them. How many does she sell?', answer: 8, why: '24 divided by 3 is 8.' },
    { prompt: 'What is 3/8 + 4/8?', options: ['7/16', '1/8', '7/8', '12/8'], correct: 2, why: '3 + 4 = 7 eighths.' },
    { prompt: 'Which fraction is the smallest?', options: ['3/4', '1/2', '2/3', '1/4'], correct: 3, why: 'A quarter is smaller than a half, two thirds and three quarters.' },
    { prompt: 'Kojo ate 2/9 of a loaf and Esi ate 4/9. How many ninths did they eat altogether?', answer: 6, why: '2 + 4 = 6 ninths.' },
    { prompt: 'What is 7/8 - 3/8?', options: ['10/8', '4/8', '4/16', '3/8'], correct: 1, why: '7 - 3 = 4 eighths.' },
  ],
  [
    { prompt: 'What is 1/2 + 1/4 as a decimal?', answer: 0.75, why: '1/2 is 0.5 and 1/4 is 0.25, so 0.75.' },
    { prompt: 'Yaw reads 2/5 of a 100-page book on Monday and 1/5 on Tuesday. How many pages are left?', answer: 40, why: '3/5 of 100 is 60 pages read, so 40 are left.' },
    { prompt: 'Which fraction equals 0.25?', options: ['1/4', '1/5', '2/5', '1/2'], correct: 0, why: '1 divided by 4 is 0.25.' },
    { prompt: 'A trotro carries 36 passengers and 2/3 are adults. How many are children?', answer: 12, why: '1/3 of 36 is 12 children.' },
    { prompt: 'Which statement is correct?', options: ['1/3 + 1/3 = 2/6', '1/3 + 1/3 = 1/6', '1/3 + 1/3 = 2/3', '1/3 + 1/3 = 1/3'], correct: 2, why: 'Add the tops and keep the bottom: 1 + 1 = 2 thirds.' },
  ],
];

// Ask: real answers from the platform's assistant (Claude) on the demo school, 15 Oct 2026.
// The assistant sees pseudonyms only; names are put back on screen, as in the app.
export type AskItem = { who: string; q: string; secs: number; a: string };
export const ask: AskItem[] = [
  { who: 'Headteacher', q: 'How much in fees is outstanding?', secs: 17.6, a:
`**GH₵110,745** in Term 1 fees is still outstanding. That's 43.2% of the GH₵256,240 billed, so the school has collected 56.8% so far.

**Basic 3 has the biggest gap.** It has collected only 23.5% (GH₵5,295 of GH₵22,510). It owes GH₵17,215, and 15 of its 17 invoices are unpaid or part-paid. Every other class has collected between 55.7% and 65.6%.

| Class | Outstanding | Collected |
|---|---|---|
| Basic 3 | GH₵17,215 | 23.5% |
| JHS 3 | GH₵9,900 | 55.7% |
| Basic 6 | GH₵9,165 | 56.3% |
| JHS 2 | GH₵9,075 | 65.6% |

Basic 3 is so far behind every other class that it's worth checking first. The invoices may not have been sent out or recorded properly, rather than families simply not paying.` },
  { who: 'Headteacher', q: 'What is the performance of Basic 6?', secs: 19.5, a:
`Basic 6 is just above the 50% pass line this term, but it dipped in the week of 5 October to **53.3%**, its lowest week so far. Mathematics is the weakest subject, and 10 of the 16 learners are flagged in at least one subject.

| Subject | Term | Week of 5 Oct |
|---|---|---|
| Science | 60.2% | 55.0% |
| English Language | 60.0% | 53.4% |
| Social Studies | 55.2% | 61.9% |
| Mathematics | 50.8% | 42.7% |

**Learners to watch most**
- Richard Agbeko: below 50% in all four subjects. Maths fell from 30% to 10.8%.
- Grace Annan: below 50% in all four subjects.
- Yaw Boakye: English fell from 61.3% to 41.8%.

If you like, I can check which Maths topics are weakest and suggest steps to take this week.` },
  { who: 'Headteacher', q: 'What can we do about it?', secs: 21.7, a:
`Attendance isn't the problem here: Basic 6 attended 97.8% of days over the last three weeks. The gaps are in two topics, Fractions and Map reading.

| Topic | Class avg | Below 50% |
|---|---|---|
| Maths: Fractions | 43.9% | 10 of 16 |
| Social Studies: Map reading | 46.8% | 9 of 16 |

**The one-to-one Fractions plan for Kwame Asante** is up 21 points, from 37.5% to 58.5%. So close individual help is working.

**Steps for this week**
1. **Review the Fractions plan now.** Reteach in small groups of 3 or 4 using real objects like paper strips or oranges.
2. **Give the weakest learners one-to-one time**, the way it worked for Kwame Asante.
3. **Print short practice sheets** and record the marks as a class assessment, so you can tell next week whether the new approach is working.
4. **Contact the family of Nana Kwame Danso.** This learner was absent 3 times and is below 50% in four topics.` },
  { who: 'Headteacher', q: 'How did JHS 3 do in the mocks?', secs: 13.1, a:
`JHS 3 improved between the two mocks. The class average rose from 63.5% to **68.6%**, and the number of learners needing support fell from 5 to 3. All 14 learners sat both rounds.

| Round | Date | Average | Need support |
|---|---|---|---|
| Mock 1 | 23 Sep | 63.5% | 5 |
| Mock 2 | 8 Oct | 68.6% | 3 |

Computing and RME each come up for two of the three learners who need support, so those are good subjects for small-group revision. These results are a school check on progress, not a prediction of BECE grades.` },
  { who: 'Headteacher', q: 'Who has been absent most last week?', secs: 12.2, a:
`Only one Basic 6 learner missed school last week (Monday 5 to Friday 9 October): Richard Agbeko, absent for 1 day, on Tuesday 6 October.

- Registers submitted: 5 of 5 days
- Attendance rate: 98.8%
- Late arrivals: 0

One missed day doesn't explain this learner's very low marks, so the one-to-one help I suggested earlier is still the most useful step.` },
];
