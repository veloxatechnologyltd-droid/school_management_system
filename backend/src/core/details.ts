import { BadRequestException, ConflictException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { normalizeGhanaPhone } from '../modules/notices/sms.provider';

// Optional details about a person (a student's, a staff member's). Everything is optional and the form sends the whole record,
// so a field left empty is cleared. Values are checked here with plain-language messages before the database's own checks.
export type Rule = { label: string; min: number; max: number };
export const clean = (value?: string | null) => { const text = (value ?? '').trim(); return text === '' ? null : text; };
export function cleanValues(rules: Record<string, Rule>, input: Record<string, string | undefined>) {
  const out: Record<string, string | null> = {};
  for (const [column, rule] of Object.entries(rules)) {
    const value = clean(input[column]);
    if (value !== null && (value.length < rule.min || value.length > rule.max)) throw new BadRequestException(`${rule.label} must be ${rule.min} to ${rule.max} characters`);
    out[column] = value;
  }
  return out;
}
export function cleanPhone(value?: string) {
  const text = clean(value);
  if (text === null) return null;
  const phone = normalizeGhanaPhone(text);
  if (!phone) throw new BadRequestException('Enter a Ghana mobile number such as 024 123 4567');
  return phone;
}
// A contact needs a name before it can have a relationship or a number.
export function needContactName(values: Record<string, string | null>) {
  if (!values.emergency_name && (values.emergency_relationship || values.emergency_phone)) throw new BadRequestException('Add the emergency contact\'s name');
}

// Saves the whole record with a version check. Returns the new version and the names of the columns that changed; a record
// that was never saved has version 0, and saving nothing leaves it unsaved.
export async function storeDetails(client: PoolClient, table: 'learner_details' | 'staff_details', key: 'learner_id' | 'membership_id', schoolId: string, keyId: string, version: number,
  values: Record<string, string | null>, dates: string[] = []) {
  const columns = Object.keys(values);
  const select = columns.map(c => dates.includes(c) ? `${c}::text AS ${c}` : c).join(',');
  const row = (await client.query(`SELECT ${select},version FROM ${table} WHERE school_id=$1 AND ${key}=$2 FOR UPDATE`, [schoolId, keyId])).rows[0] as Record<string, string | number | null> | undefined;
  if ((row?.version ?? 0) !== version) throw new ConflictException('These details changed since you opened them. Reload and try again');
  const changed = columns.filter(c => (row?.[c] ?? null) !== values[c]);
  if (!changed.length) return { version, changed };
  if (!row) {
    await client.query(`INSERT INTO ${table}(school_id,${key},${columns.join(',')}) VALUES($1,$2,${columns.map((_, i) => `$${i + 3}`).join(',')})`, [schoolId, keyId, ...columns.map(c => values[c])]);
    return { version: 1, changed };
  }
  await client.query(`UPDATE ${table} SET ${columns.map((c, i) => `${c}=$${i + 3}`).join(',')},version=version+1,updated_at=clock_timestamp() WHERE school_id=$1 AND ${key}=$2`, [schoolId, keyId, ...columns.map(c => values[c])]);
  return { version: version + 1, changed };
}
