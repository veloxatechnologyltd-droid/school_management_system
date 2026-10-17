// Words and pictures for the sign-in and register pages.
// The screenshots are real pages of the Sunrise demo school (sample learners), captured by scripts/capture-auth-shots.mjs.
// The specification rows describe what is built and deployed today, from docs/ARCHITECTURE.md, docs/DEPLOYMENT.md and the code;
// anything that is a target, optional or not built yet carries its own tag, so the page never promises more than the system does.

export type Shot = { file: string; alt: string; phone?: boolean };
const desktop = (file: string, alt: string): Shot => ({ file, alt });
const phone = (file: string, alt: string): Shot => ({ file, alt, phone: true });

export const shots = {
  home: desktop('head-home', "The headteacher's Home page: learners, classes and teachers at a glance, and today's open items with a button for each."),
  fees: desktop('head-fees', 'The Fees page: billed, collected and still owed for the term, then collection class by class.'),
  attendance: desktop('head-attendance', 'The Attendance page: one dated register per class.'),
  reportCards: desktop('head-reportcards', 'The Assessment page on Report cards: terminal results and published report cards for a class.'),
  learners: desktop('head-learners', 'The Learners page: the learner roll with search, import from CSV, admissions and year-end promotion.'),
  progress: desktop('head-progress', 'The Progress page: class exercises, homework and tests followed week by week.'),
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
  { id: 'progress', label: 'Progress', icon: 'insights', shot: shots.progress, title: 'See a class week by week, not once a term.', text: 'Record class exercises, homework and tests as they happen and follow each class and learner.', points: ['Trends, gaps and support plans', 'Learners who need help are flagged early', 'Home practice results sit beside class work'] },
];

export const roles = [
  { icon: 'space_dashboard', name: 'Headteacher', text: "Today's open items, registers, fees, report cards, staff accounts and who can see what.", first: 'Home' },
  { icon: 'groups', name: 'Teacher', text: 'Your own classes only: take the register, enter scores, choose what your class practises.', first: 'My classes' },
  { icon: 'receipt_long', name: 'Accounts', text: 'Fee items, bills, payments and receipts. Nothing else is shown.', first: 'Fees' },
  { icon: 'directions_walk', name: 'Front desk', text: 'The learner roll and pickup: who may collect each child.', first: 'Pickup' },
  { icon: 'family_restroom', name: 'Parent', text: "Your child's progress, report cards, fees, notices and practice, on your own phone.", first: 'Home' },
];

export const help = [
  { icon: 'lock_reset', title: 'Forgot your password?', text: 'Ask your school administrator to reset it. They give you a temporary password, and you choose your own at your next sign-in.' },
  { icon: 'key', title: 'First time here?', text: 'Use the email or phone number your school registered for you, and the temporary password they gave you. You will be asked to choose your own (at least 12 characters).' },
  { icon: 'phonelink_lock', title: 'Asked for a code?', text: 'If your school requires two-step sign-in, enter the 6-digit code from your authenticator app after your password. Lost your phone? Use a recovery code.' },
];

export const strip = [
  { icon: 'shield_lock', title: 'Each school sealed off', text: "The database itself refuses to show one school's records to another." },
  { icon: 'verified_user', title: 'Teachers approve what children see', text: 'The AI drafts; a teacher or the head reads and approves.' },
  { icon: 'smartphone', title: 'Made for the phone in your hand', text: 'Large buttons and plain words, at the front desk or in class.' },
  { icon: 'payments', title: 'Made for Ghana', text: 'GH₵ to the pesewa, GES grading bands, Africa/Accra time.' },
];

export const modules = [
  { icon: 'groups', title: 'People', items: ['Admissions and enrolment, with a dated history of every class move', 'Learners and guardians, with rights the head verifies: academic, billing, pickup, contact', 'Staff accounts by role: headteacher, teacher, accountant, front desk', 'Pickup: who may collect each child, with exceptions the head reviews'] },
  { icon: 'school', title: 'Teaching', items: ['Attendance registers: draft, submit, lock, and corrections with a reason', 'Class scores that add up to continuous assessment with your own weighting', 'Terminal results and report cards on GES 1 to 9 bands or your own policy', 'JHS mocks, topics, support plans, and early years observations and reports'] },
  { icon: 'receipt_long', title: 'Money', items: ['Fee items, bills and numbered receipts', 'Payments reversed with a reason, never erased', 'Amounts kept to the pesewa', 'Statements families can read, and notices the head approves'] },
  { icon: 'family_restroom', title: 'Families and learning', items: ['Report cards, fee statements and notices on the parent\'s own phone', 'Practice and short lessons on topics the school is teaching, approved by teachers', 'No learner logins: children use the family\'s phone and account', 'Practice results sit beside class work and never change a mark'] },
  { icon: 'forum', title: 'Assistant', items: ['Ask: plain-language questions answered from your own records', 'It reads only; it cannot change a record', 'It answers inside what each person may see', 'Off until the head switches it on, with a monthly limit'] },
];

export type Tag = 'Live' | 'Optional' | 'Target' | 'Before real records' | 'Not yet';
export const production: { group: string; icon: string; rows: { tag: Tag; title: string; text: string }[] }[] = [
  { group: 'Platform', icon: 'cloud', rows: [
    { tag: 'Live', title: 'Hosting', text: 'Web app on Vercel, API on Render, PostgreSQL on Supabase. Everything travels over HTTPS with HSTS, and the database connection uses TLS.' },
    { tag: 'Live', title: 'Devices', text: 'Any current browser, no app to install. Pages are built for a phone first, with touch targets of 44 px or more.' },
    { tag: 'Live', title: 'Time and money', text: 'Times kept in UTC and shown in Africa/Accra. Money is stored as whole pesewas; grades use exact decimals.' },
  ] },
  { group: 'Security', icon: 'shield_lock', rows: [
    { tag: 'Live', title: 'School isolation', text: "Every record carries its school. PostgreSQL row-level security is enforced, and the app connects as a restricted role that is not the owner and cannot bypass it. Tested with more than one school." },
    { tag: 'Live', title: 'Passwords', text: 'Salted scrypt hashes, at least 12 characters, and a temporary password must be replaced at first sign-in. Ten failed attempts lock an email for 15 minutes.' },
    { tag: 'Live', title: 'Sessions', text: 'HttpOnly, SameSite=Strict, Secure cookies that last 8 hours. Every change needs a CSRF token. Sign-in and sign-up attempts are rate limited.' },
    { tag: 'Optional', title: 'Two-step sign-in', text: 'Authenticator-app codes (TOTP) with recovery codes are built and can be required for staff roles. Pilot schools start with it off.' },
    { tag: 'Live', title: 'Roles and scope', text: 'A teacher sees only classes assigned to them, a parent only their own children, accounts only fees. Access is checked on every request.' },
  ] },
  { group: 'Data and privacy', icon: 'database', rows: [
    { tag: 'Live', title: 'History kept', text: 'Enrolments, scores, payments and published reports keep their history. A correction is a new entry with a name and a reason.' },
    { tag: 'Live', title: 'Audit trail', text: 'School detail changes, exports and platform support access are logged, and the head can read the activity log.' },
    { tag: 'Live', title: 'AI guardrails', text: "Children's names are replaced before anything is sent to the AI. It never publishes marks, posts money or sends messages. Nothing reaches a child until a teacher or the head approves it." },
    { tag: 'Before real records', title: 'Data protection', text: "Built with Ghana's Data Protection Act, 2012 (Act 843) in mind. Before real learner records are loaded, the school and Veloxa complete a data-protection checklist: registration with the Data Protection Commission, a controller and processor agreement, and guardian notices." },
  ] },
  { group: 'Reliability and limits', icon: 'monitoring', rows: [
    { tag: 'Target', title: 'Recovery', text: 'We aim to lose at most 1 hour of records and be back within 4 hours, and we rehearse a restore before a school goes live. These are targets, not a guarantee.' },
    { tag: 'Live', title: 'Health and logs', text: 'The API reports its own database and migration readiness. Each request is logged with an ID, route, status and time, and never with child data.' },
    { tag: 'Not yet', title: 'Mobile money', text: 'Your accountant records payments. Collecting fees through mobile money is not built yet.' },
    { tag: 'Not yet', title: 'SMS and offline', text: 'Notices appear in the app; SMS is off. There is no offline mode, so keep the paper register for days the network is down.' },
  ] },
];
