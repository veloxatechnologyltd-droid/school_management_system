// Six applications at every stage for the Sunrise demo, so an application's own page has a story to show: entered at the
// front desk with the family's details, decided by the headteacher, with a few staff notes. Used by both demo loaders.
type Who = 'desk' | 'head';
type Poster = { post: (route: string, body: Record<string, unknown>, key?: string) => Promise<any> };
const APPLICANTS: { name: string; sex: 'female' | 'male'; dob: string; classIndex: number; guardian: [string, string, string];
  steps: [Who, string, string?][]; notes: [Who, string][] }[] = [
  { name: 'Abena Sarpong', sex: 'female', dob: '2020-03-14', classIndex: 4, guardian: ['Kwabena Sarpong', 'Father', '0244110201'], steps: [],
    notes: [['desk', 'Father asked about the fees; the fee sheet was sent to him on WhatsApp.']] },
  { name: 'Elikem Kpodo', sex: 'male', dob: '2017-06-02', classIndex: 7, guardian: ['Edem Kpodo', 'Mother', '0201345678'], steps: [['head', 'review']],
    notes: [['head', 'Ask the mother for his last report card from the Ho school before we decide.']] },
  { name: 'Fiifi Annan', sex: 'male', dob: '2014-01-23', classIndex: 10, guardian: ['Araba Annan', 'Mother', '0277889901'], steps: [['head', 'review'], ['head', 'offer']],
    notes: [['desk', 'Offer letter handed to the mother at the gate.']] },
  { name: 'Dzifa Amoah', sex: 'female', dob: '2015-09-30', classIndex: 9, guardian: ['Yaw Amoah', 'Father', '0546612345'],
    steps: [['head', 'review'], ['head', 'waitlist', 'Basic 6 is full this term; she is first in line for the next place.']], notes: [] },
  { name: 'Esi Quaye', sex: 'female', dob: '2022-02-11', classIndex: 2, guardian: ['Naa Quaye', 'Grandparent', '0302456789'], steps: [['head', 'review'], ['head', 'offer'], ['desk', 'accept']],
    notes: [['desk', 'Grandmother confirmed the place by phone; she will bring the birth certificate on the first day.']] },
  { name: 'Kojo Lartey', sex: 'male', dob: '2019-05-17', classIndex: 5, guardian: ['Comfort Lartey', 'Mother', '0209876543'],
    steps: [['head', 'review'], ['head', 'decline', 'The family moved to Kumasi before the start date.']], notes: [] },
];

// `number(i)` gives each applicant's admission number; keys make the hosted loader's requests safe to rerun.
export async function playApplications(as: (who: Who) => Promise<Poster> | Poster, classId: (index: number) => string, startDate: string, number: (i: number) => string) {
  for (const [i, a] of APPLICANTS.entries()) {
    const desk = await as('desk'), head = await as('head');
    const [guardianName, guardianRelationship, guardianPhone] = a.guardian;
    let row = await desk.post('/admissions', { fullName: a.name, dateOfBirth: a.dob, sex: a.sex, classId: classId(a.classIndex), startDate, admissionNumber: number(i), guardianName, guardianRelationship, guardianPhone }, `apply:${i}`);
    for (const [j, [who, action, reason]] of a.steps.entries()) row = await (who === 'desk' ? desk : head).post(`/admissions/${row.id}/transition`, { version: row.version, action, ...(reason ? { reason } : {}) }, `apply:${i}:${j}`);
    for (const [j, [who, note]] of a.notes.entries()) await (who === 'desk' ? desk : head).post(`/admissions/${row.id}/notes`, { note }, `apply:${i}:note:${j}`);
  }
}
