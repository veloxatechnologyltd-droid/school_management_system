// Pictures for the sign-in, register and home pages, and the product tour shown on the home page.
// The screenshots are real pages of the Sunrise demo school (sample learners), captured by scripts/capture-auth-shots.mjs.

export type Shot = { file: string; alt: string; phone?: boolean };
const desktop = (file: string, alt: string): Shot => ({ file, alt });
const phone = (file: string, alt: string): Shot => ({ file, alt, phone: true });

export const shots = {
  home: desktop('head-home', "The headteacher's Home page: learners, classes and teachers at a glance, and today's open items with a button for each."),
  fees: desktop('head-fees', 'The Fees page: billed, collected and still owed for the term, then collection class by class.'),
  attendance: desktop('head-attendance', 'The Attendance page: one dated register per class.'),
  reportCards: desktop('head-reportcards', 'The Assessment page on Report cards: terminal results and published report cards for a class.'),
  learners: desktop('head-learners', 'The Learners page: the learner roll with search, import from CSV, admissions and year-end promotion.'),
  progress: desktop('head-progress', 'The Performance page: each subject followed week by week, with gaps, support plans and home practice a tab away.'),
  ask: desktop('head-ask', 'Ask: plain-language questions about the school, answered from its own records.'),
  notices: desktop('head-notices', 'The Notices page: a message drafted, approved by the head and sent to families.'),
  parentHome: phone('parent-home', "A parent's phone: the Home page for their child."),
  parentLearn: phone('parent-learn', "A parent's phone: Learn at home, practice and lessons on topics the school is teaching."),
  parentProgress: phone('parent-progress', "A parent's phone: the Progress page for their child."),
  parentReports: phone('parent-reports', "A parent's phone: published report cards."),
};

export type TourItem = { id: string; label: string; icon: string; shot: Shot; title: string; text: string; points: string[] };
export const tour: TourItem[] = [
  { id: 'home', label: 'Home', icon: 'space_dashboard', shot: shots.home, title: 'Open the day and see what needs you.', text: "The head's Home lists today's open items, most urgent first, each with the button that deals with it.", points: ['Learners who have been absent three or more days', "This week's fees against the same week last term", 'Support reviews that are due'] },
  { id: 'attendance', label: 'Registers', icon: 'event_available', shot: shots.attendance, title: 'One dated register for every class.', text: 'Teachers mark present, absent or late. The head sees which registers are still open. Once submitted, a change needs a reason.', points: ['Draft, submit, lock', 'Corrections keep the original and the reason', 'Repeated absence is flagged for follow-up'] },
  { id: 'fees', label: 'Fees', icon: 'receipt_long', shot: shots.fees, title: 'Know what is owed before the PTA asks.', text: 'Billed, collected and outstanding for the term, then class by class with the lowest collection first.', points: ['Numbered receipts, amounts kept to the pesewa', 'Payments are reversed with a reason, never deleted', 'Families see their own statement'] },
  { id: 'reports', label: 'Report cards', icon: 'description', shot: shots.reportCards, title: 'Report cards, published once and kept as issued.', text: "Preview a class's terminal results, publish them, and print every card for the term. Publishing locks the scores and shows the reports to guardians.", points: ['GES 1 to 9 bands, or your own policy', 'Published reports are kept as issued', 'A correction is a new revision, with a reason'] },
  { id: 'ask', label: 'Ask', icon: 'forum', shot: shots.ask, title: 'Ask your school a question in plain words.', text: "Ask reads your school's own records and answers with the numbers behind it. Try a question, or follow up on the last answer.", points: ["Limited to what the signed-in person may see", 'It only reads: it cannot change a record', "Learner names from your records are not sent to the AI provider"] },
  { id: 'notices', label: 'Notices', icon: 'campaign', shot: shots.notices, title: 'One notice to every family, once you approve it.', text: 'Draft a short message, approve it, and it reaches the guardians who have a verified contact right. The office sees how many it reached.', points: ['Nothing is sent until the head approves it', 'Only verified guardians receive a notice', 'Families with no phone number still get it in the app'] },
  { id: 'learners', label: 'Learners', icon: 'groups', shot: shots.learners, title: 'Every learner, with their whole history.', text: 'The roll, admissions and year-end promotion in one place. Bring existing class lists in from a CSV file.', points: ['Import with a preview and duplicate review', 'Class history keeps every move and withdrawal', 'Guardian rights are verified by the head'] },
  { id: 'progress', label: 'Performance', icon: 'insights', shot: shots.progress, title: 'See a class week by week, not once a term.', text: 'Record class exercises, homework and tests as they happen and follow each class and learner.', points: ['Trends, gaps and support plans', 'Learners who need help are flagged early', 'Home practice results sit beside class work'] },
];
