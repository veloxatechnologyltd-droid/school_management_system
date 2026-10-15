import { PoolClient } from 'pg';
import { Actor } from '../../core/access';

// A class name belongs to a grade when it starts with the grade's words: "Basic 5A" is in "Basic 5", "Basic 50" is not.
export function gradeMatches(className: string, grade: string) {
  const c = className.trim().toLowerCase(), g = grade.trim().toLowerCase();
  if (!g || !c.startsWith(g)) return false;
  return !/\d/.test(c[g.length] ?? '');
}

// What a person may see and act on in the learning pages: the headteacher, everything; a teacher, the class levels of the classes they teach today.
export type Scope = { all: true } | { all: false; classes: string[] };
export async function scopeOf(client: PoolClient, actor: Actor): Promise<Scope> {
  if (actor.role === 'headteacher') return { all: true };
  const rows = (await client.query(`SELECT DISTINCT c.name FROM teaching_assignments t JOIN class_sections c ON c.school_id=t.school_id AND c.id=t.class_id
    WHERE t.school_id=$1 AND t.teacher_membership_id=$2 AND t.revoked_at IS NULL AND c.level IN ('Primary','JHS')
      AND t.start_date<=(now() AT TIME ZONE 'Africa/Accra')::date AND t.end_date>(now() AT TIME ZONE 'Africa/Accra')::date`,[actor.schoolId,actor.membershipId])).rows;
  return { all: false, classes: rows.map(r => r.name as string).sort() };
}
export const allows = (scope: Scope, grade: string) => scope.all || scope.classes.some(c => gradeMatches(c,grade));
// A topic that names no class level suits any class, so a teacher with a class of their own may see it.
export const allowsTopic = (scope: Scope, grade: string | null) => grade === null ? scope.all || scope.classes.length > 0 : allows(scope,grade);

// The class levels a person may approve a topic for when the topic names none. Primary and JHS only: that is where indicators are tagged.
export async function gradeChoices(client: PoolClient, schoolId: string, scope: Scope) {
  const all = (await client.query("SELECT DISTINCT name FROM class_sections WHERE school_id=$1 AND level IN ('Primary','JHS') ORDER BY name",[schoolId])).rows.map(r => r.name as string);
  return { schoolWide: all, mine: scope.all ? all : all.filter(name => scope.classes.includes(name)) };
}

export const accraToday = (client: PoolClient) => client.query("SELECT (now() AT TIME ZONE 'Africa/Accra')::date::text AS d").then(r => r.rows[0].d as string);
