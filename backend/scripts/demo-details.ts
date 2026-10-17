// Optional details for the Sunrise demo's students and staff, so their pages show a full record and a thin one side by side:
// most students have an address and an emergency contact, some a previous school, a blood group or (rarely) a health note,
// and a few have nothing at all. Religion and health are left empty for many, as they are optional. Used by the local loader.
type Putter = { call: (method: 'PUT', path: string, body?: Record<string, unknown>) => Promise<any> };
const hash = (text: string) => [...text].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
const pick = <T,>(key: string, list: readonly T[]) => list[hash(key) % list.length]!;
const areas = ['Millennium City', 'Kasoa Zongo', 'Ofaakor', 'Opeikuma', 'Akweley', 'Nyanyano', 'Winneba Road', 'Buduburam'];
const schools = ['Little Angels School', 'Grace Preparatory', 'St. Mary\'s Basic', 'Bright Stars Academy', 'Kasoa Presby Primary'];
const health = ['Allergic to groundnuts', 'Mild asthma; inhaler kept in the class bag', 'Sickle cell trait; needs plenty of water', 'Allergic to penicillin', 'Wears glasses; sits at the front'];
const relatives = [['Kojo', 'Uncle'], ['Esi', 'Aunt'], ['Yaw', 'Brother'], ['Ama', 'Grandmother'], ['Kwabena', 'Uncle'], ['Akua', 'Aunt']] as const;
const phone = (key: string) => `02${pick(`${key}a`, ['4', '0', '6', '7'])}${String(hash(`${key}b`) % 10_000_000).padStart(7, '0')}`;
const surname = (name: string) => name.trim().split(/\s+/).slice(-1)[0]!;

export function learnerDetails(name: string, guardian?: string) {
  const b = hash(name) % 100;
  if (b >= 94) return null; // a few students have nothing recorded
  const [first, relation] = pick(`${name}r`, relatives);
  return {
    nationality: b >= 90 ? pick(name, ['Nigerian', 'Togolese']) : 'Ghanaian',
    religion: b < 55 ? 'Christian' : b < 70 ? 'Muslim' : b < 72 ? 'Traditional' : b < 75 ? 'Other' : '',
    homeAddress: b < 90 ? `House ${1 + hash(`${name}h`) % 80}, ${pick(`${name}a`, areas)}, Kasoa` : '',
    previousSchool: hash(`${name}p`) % 100 < 40 ? pick(`${name}s`, schools) : '',
    bloodGroup: hash(`${name}g`) % 100 < 45 ? pick(`${name}x`, ['O+', 'O+', 'A+', 'B+', 'AB+', 'O-', 'A-']) : '',
    healthNotes: hash(`${name}n`) % 100 < 8 ? pick(`${name}m`, health) : '',
    ...(hash(`${name}e`) % 100 < 80 ? { emergencyName: `${first} ${guardian ? surname(guardian) : surname(name)}`, emergencyRelationship: relation, emergencyPhone: phone(name) } : {}),
  };
}

export function staffDetails(index: number, name: string, role: string) {
  const joined = `${2012 + hash(name) % 14}-${String(1 + hash(`${name}m`) % 12).padStart(2, '0')}-0${1 + hash(`${name}d`) % 8}`;
  const teacher = role === 'teacher';
  const [first, relation] = pick(`${name}r`, [['Efua', 'Spouse'], ['Kojo', 'Brother'], ['Abena', 'Sister'], ['Yaa', 'Mother']] as const);
  return {
    jobTitle: ({ headteacher: 'Headteacher', accountant: 'School accountant', frontdesk: 'Front desk officer' } as Record<string, string>)[role] ?? (index % 3 === 0 ? 'Class teacher' : 'Subject teacher'),
    staffNumber: `SIS-${teacher ? 'T' : 'A'}-${String(index + 1).padStart(3, '0')}`,
    employmentType: hash(`${name}t`) % 10 === 0 ? 'Part time' : 'Full time',
    dateJoined: joined,
    qualification: teacher ? pick(name, ['B.Ed. Basic Education', 'Dip. Education', 'B.Sc. Mathematics Education', 'B.A. English with Education', 'Cert. A']) : role === 'accountant' ? 'HND Accounting' : role === 'headteacher' ? 'M.Ed. Educational Leadership' : 'Diploma in Secretarial Studies',
    ...(teacher ? { licenceNumber: `NTC-${2016 + hash(name) % 9}-0${String(1000 + hash(`${name}l`) % 8999)}`, subjects: pick(`${name}u`, ['Mathematics, Science', 'English Language, Social Studies', 'All subjects (lower primary)', 'Creative Arts, Computing', 'Religious and Moral Education, Ghanaian Language']) } : {}),
    homeAddress: `House ${1 + hash(`${name}h`) % 60}, ${pick(`${name}a`, areas)}, Kasoa`,
    emergencyName: `${first} ${surname(name)}`, emergencyRelationship: relation, emergencyPhone: phone(name),
  };
}

export async function playDetails(head: Putter, learners: { id: string; name: string; guardian?: string }[], staff: { membershipId: string; name: string; role: string }[]) {
  const jobs: (() => Promise<unknown>)[] = [];
  for (const l of learners) { const d = learnerDetails(l.name, l.guardian); if (d) jobs.push(() => head.call('PUT', `/learners/${l.id}/details`, { version: 0, ...d })); }
  staff.forEach((s, i) => jobs.push(() => head.call('PUT', `/accounts/${s.membershipId}/details`, { version: 0, ...staffDetails(i, s.name, s.role) })));
  for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8).map(job => job()));
  return jobs.length;
}
