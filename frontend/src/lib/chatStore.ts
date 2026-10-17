import { useSyncExternalStore } from 'react';
import { request } from './api';

// Kobby AI conversations are kept in this browser, for the signed-in session only, so they survive leaving the page, a reload
// and a browser restart, but never reach the server and never outlive the sign-in:
//  - the storage key carries a hash of the session's CSRF token, so another account (or the same person after signing
//    in again) never sees them, and leftovers from other sessions are deleted the next time any chat opens;
//  - signing out, or opening the app with no valid session, deletes every saved chat;
//  - a conversation untouched for 12 hours (a session lasts 8) is dropped, and at most 30 are kept.
// A person can keep several conversations side by side (the list on the left of the page) and delete any of them.
export type Turn = { role: 'user' | 'assistant'; text: string };
type Reply = { runId: string; reply: string; people: Record<string, string>; tools: string[] };
export type Chat = { id: string; title: string; at: number; turns: Turn[]; people: Record<string, string>; used: Record<number, string[]>; draft: string; busy: boolean; error: string };
export type Workspace = { chats: Chat[]; activeId: string };

const PREFIX = 'ask:v2:';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_CHATS = 30;
const emptyChat = (): Chat => ({ id: crypto.randomUUID(), title: '', at: Date.now(), turns: [], people: {}, used: {}, draft: '', busy: false, error: '' });
const spaces = new Map<string, Workspace>();
const listeners = new Set<() => void>();
let generation = 0; // bumped by forgetChats so an answer that arrives after sign-out is dropped, not saved

// Not a security hash: it only keeps the CSRF token itself out of storage keys while staying unique per session.
function digest(text: string) {
  let a = 0xdeadbeef, b = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (b >>> 0).toString(36) + (a >>> 0).toString(36);
}
export const chatKey = (schoolId: string, csrfToken: string) => `${PREFIX}${digest(csrfToken)}:${schoolId}`;
const storage = () => { try { return window.localStorage; } catch { return null; } };

function dropOtherSessions(key: string) {
  const store = storage(); if (!store) return;
  const session = key.slice(0, key.lastIndexOf(':') + 1); // "ask:v2:<session hash>:" (a school id has no colon)
  try { for (const name of Object.keys(store)) if (name.startsWith('ask:') && !name.startsWith(session)) store.removeItem(name); } catch { /* storage unavailable */ }
}
type Saved = Pick<Chat, 'id' | 'title' | 'at' | 'turns' | 'people' | 'used' | 'draft'>;
function load(key: string): Workspace {
  const store = storage(); dropOtherSessions(key);
  const fresh = (): Workspace => { const chat = emptyChat(); return { chats: [chat], activeId: chat.id }; };
  try {
    const saved = JSON.parse(store?.getItem(key) ?? 'null') as { activeId?: string; chats?: Saved[] } | null;
    if (!saved || !Array.isArray(saved.chats)) return fresh();
    const chats = saved.chats.filter(c => c && typeof c.id === 'string' && Array.isArray(c.turns) && typeof c.at === 'number' && Date.now() - c.at <= MAX_AGE_MS).map((c): Chat => ({
      id: c.id, title: typeof c.title === 'string' ? c.title : '', at: c.at, people: c.people ?? {}, used: c.used ?? {}, draft: typeof c.draft === 'string' ? c.draft : '', busy: false, error: '',
      turns: c.turns.filter(t => (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string') }));
    if (!chats.length) { store?.removeItem(key); return fresh(); }
    return { chats, activeId: chats.some(c => c.id === saved.activeId) ? saved.activeId! : [...chats].sort((a, b) => b.at - a.at)[0]!.id };
  } catch { return fresh(); }
}
function save(key: string, space: Workspace) {
  try {
    const kept = space.chats.filter(c => c.turns.length || c.draft);
    if (!kept.length) storage()?.removeItem(key);
    else storage()?.setItem(key, JSON.stringify({ activeId: space.activeId, chats: kept.map(({ id, title, at, turns, people, used, draft }): Saved => ({ id, title, at, turns, people, used, draft })) }));
  } catch { /* storage full or blocked: the chats still work for this page view */ }
}
export function getWorkspace(key: string): Workspace { let space = spaces.get(key); if (!space) { space = load(key); spaces.set(key, space); } return space; }
function commit(key: string, next: Workspace) { spaces.set(key, next); save(key, next); listeners.forEach(l => l()); }
function patch(key: string, id: string, change: Partial<Chat>) { const space = getWorkspace(key); if (space.chats.some(c => c.id === id)) commit(key, { ...space, chats: space.chats.map(c => c.id === id ? { ...c, ...change } : c) }); }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export const useWorkspace = (key: string) => useSyncExternalStore(subscribe, () => getWorkspace(key));
export const activeChat = (space: Workspace): Chat => space.chats.find(c => c.id === space.activeId) ?? space.chats[0]!;
export const setDraft = (key: string, draft: string) => patch(key, activeChat(getWorkspace(key)).id, { draft });
export const openChat = (key: string, id: string) => { const space = getWorkspace(key); if (space.chats.some(c => c.id === id) && id !== space.activeId) commit(key, { ...space, activeId: id }); };
// A new conversation; if the one open is still empty it is reused rather than piling up blanks.
export function newChat(key: string) {
  const space = getWorkspace(key), open = activeChat(space);
  if (!open.turns.length) return;
  const chat = emptyChat();
  const kept = space.chats.filter(c => c.turns.length).sort((a, b) => b.at - a.at).slice(0, MAX_CHATS - 1);
  commit(key, { chats: [chat, ...kept], activeId: chat.id });
}
export function deleteChat(key: string, id: string) {
  const space = getWorkspace(key), target = space.chats.find(c => c.id === id);
  if (!target || target.busy) return;
  const rest = space.chats.filter(c => c.id !== id);
  if (id !== space.activeId) return commit(key, { ...space, chats: rest });
  const next = [...rest].sort((a, b) => b.at - a.at).find(c => c.turns.length) ?? emptyChat();
  commit(key, { chats: rest.some(c => c.id === next.id) ? rest : [next, ...rest], activeId: next.id });
}
// Every saved chat is deleted: on sign-out, and whenever the app opens with no valid session.
export function forgetChats() {
  generation++; spaces.clear();
  const store = storage();
  try { if (store) for (const name of Object.keys(store)) if (name.startsWith('ask:')) store.removeItem(name); } catch { /* storage unavailable */ }
  listeners.forEach(l => l());
}

const titleOf = (question: string) => { const line = question.replace(/\s+/g, ' ').trim(); return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line; };

// Sends a question, with the earlier turns, in the open conversation. This runs here, not in the page, so an answer that arrives
// after the person has moved to another page or another conversation is still saved in the one it belongs to.
export async function ask(key: string, schoolId: string, csrfToken: string, question: string) {
  const text = question.trim(), before = activeChat(getWorkspace(key)), id = before.id;
  if (!text || before.busy) return;
  const started = generation;
  // Keep the last 9 exchanges so the request stays within the 20-message limit.
  const history = [...before.turns, { role: 'user' as const, text }].slice(-19);
  patch(key, id, { turns: [...before.turns, { role: 'user', text }], title: before.title || titleOf(text), at: Date.now(), draft: '', busy: true, error: '' });
  const current = () => getWorkspace(key).chats.find(c => c.id === id);
  try {
    const r = await request<Reply>(`/schools/${schoolId}/assistant/chat`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ messages: history }) });
    const now = current();
    if (started !== generation || !now) return;
    patch(key, id, { people: { ...now.people, ...r.people }, used: { ...now.used, [before.turns.length + 1]: r.tools }, turns: [...now.turns, { role: 'assistant', text: r.reply }], at: Date.now(), busy: false });
  } catch (e) {
    if (started !== generation || !current()) return;
    const status = (e as { status?: number }).status ?? 0;
    const error = status === 0 ? 'Connection problem. Check your internet connection and ask again.' : status >= 502 ? 'Kobby AI could not get an answer just now. Wait a moment and ask again.' : (e as Error).message;
    patch(key, id, { turns: before.turns, title: before.title, draft: text, error, busy: false });
  }
}
