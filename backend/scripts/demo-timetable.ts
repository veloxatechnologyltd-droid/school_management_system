// A published Term timetable for the Sunrise demo's 13 classes, plus a draft of the next version, so the Timetable page,
// printing and a teacher's "Today's lessons" have a real week to show. Used by both demo loaders.
// Nursery and KG: the class teacher with play-based labels. Basic 1–6: the class teacher teaches every subject.
// JHS 1–3: the three JHS teachers rotate across the three classes, so no teacher is in two rooms at once.
// Computing is in the ICT lab (Basic 4 to JHS 3) and JHS Science in the Science lab; subjects are offset per class so
// two classes never want a lab in the same period.
type Caller = { post: (route: string, body: Record<string, unknown>, key?: string) => Promise<any>; put: (route: string, body: Record<string, unknown>, key?: string) => Promise<any> };
const BELL = [['08:00', '08:40'], ['08:40', '09:20'], ['09:20', '10:00'], ['10:00', '10:30', 'Break'], ['10:30', '11:10'], ['11:10', '11:50'], ['11:50', '12:30'], ['12:30', '13:10', 'Lunch'], ['13:10', '13:50'], ['13:50', '14:30']]
  .map(([starts, ends, label]) => label ? { starts, ends, kind: 'break', label } : { starts, ends, kind: 'lesson' });
const LESSON_ROWS = BELL.flatMap((p, i) => p.kind === 'lesson' ? [i + 1] : []);
const EARLY = ['Circle time', 'Literacy', 'Numeracy', 'Free play', 'Story time', 'Creative play', 'Rest', 'Outdoor play'];

// subjects: the eight demo subjects in the loaders' order (English, Maths, Science, Social Studies, RME, Twi, Creative Arts, Computing).
export async function playTimetable(head: Caller, termId: string, classIds: string[], teacherIds: string[], subjects: string[]) {
  const ict = (await head.post('/timetable/rooms', { name: 'ICT lab' }, 'tt:room:ict')).id as string;
  const lab = (await head.post('/timetable/rooms', { name: 'Science lab' }, 'tt:room:science')).id as string;
  const draft = await head.post('/timetable/drafts', { termId }, `tt:draft:${termId}`);
  await head.put(`/timetable/${draft.id}/periods`, { periods: BELL }, `tt:bell:${termId}`);
  for (const [c, classId] of classIds.entries()) for (let d = 1; d <= 5; d++) for (const [k, period] of LESSON_ROWS.entries()) {
    const at = { classId, weekday: d, period };
    if (c < 4) { await head.put(`/timetable/${draft.id}/lessons`, { ...at, label: EARLY[(k + d) % EARLY.length], teacherMembershipId: teacherIds[c] }, `tt:${c}:${d}:${period}`); continue; }
    const s = (k + d + c) % 8;
    const teacher = c >= 10 ? teacherIds[10 + (c - 10 + k + d) % 3] : teacherIds[c];
    const room = s === 7 && c >= 7 ? ict : s === 2 && c >= 10 ? lab : undefined;
    await head.put(`/timetable/${draft.id}/lessons`, { ...at, subjectId: subjects[s], teacherMembershipId: teacher, ...(room ? { roomId: room } : {}) }, `tt:${c}:${d}:${period}`);
  }
  await head.post(`/timetable/${draft.id}/publish`, {}, `tt:publish:${termId}`);
  // The next version waits as a draft: JHS 3 gets an extra Mathematics period on Friday afternoon instead of Creative Arts.
  const next = await head.post('/timetable/drafts', { termId }, `tt:draft2:${termId}`);
  await head.put(`/timetable/${next.id}/lessons`, { classId: classIds[12], weekday: 5, period: LESSON_ROWS[7], subjectId: subjects[1], teacherMembershipId: teacherIds[10 + (2 + 7 + 5) % 3] }, `tt:draft2:change:${termId}`);
}
