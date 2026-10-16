// The child a parent last looked at, kept for this browser tab so every page of the family area opens on the same child.
// A convenience only: blocked or empty storage just means the first child is chosen.
const key = (schoolId: string) => `family-child:${schoolId}`;
export const recallChild = (schoolId: string) => { try { return sessionStorage.getItem(key(schoolId)) ?? ''; } catch { return ''; } };
export const rememberChild = (schoolId: string, childId: string) => { try { sessionStorage.setItem(key(schoolId), childId); } catch { /* storage unavailable */ } };
