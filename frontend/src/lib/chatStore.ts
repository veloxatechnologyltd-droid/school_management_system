import { useSyncExternalStore } from 'react';
import { request } from './api';

// The Ask conversation is kept in this browser, for the signed-in session only, so it survives leaving the page, a reload
// and a browser restart, but never reaches the server and never outlives the sign-in:
//  - the storage key carries a hash of the session's CSRF token, so another account (or the same person after signing
//    in again) never sees it, and leftovers from other sessions are deleted the next time any chat opens;
//  - signing out, or opening the app with no valid session, deletes every saved chat;
//  - a chat older than 12 hours (a session lasts 8) is dropped.
export type Turn = { role: 'user' | 'assistant'; text: string };
type Reply = { runId: string; reply: string; people: Record<string, string>; tools: string[] };
export type Chat = { turns: Turn[]; people: Record<string, string>; used: Record<number, string[]>; draft: string; busy: boolean; error: string };

const PREFIX = 'ask:v1:';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const empty = (): Chat => ({ turns: [], people: {}, used: {}, draft: '', busy: false, error: '' });
const chats = new Map<string, Chat>();
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
  const session = key.slice(0, key.lastIndexOf(':') + 1); // "ask:v1:<session hash>:" (a school id has no colon)
  try { for (const name of Object.keys(store)) if (name.startsWith(PREFIX) && !name.startsWith(session)) store.removeItem(name); } catch { /* storage unavailable */ }
}
function load(key: string): Chat {
  const store = storage(); dropOtherSessions(key);
  try {
    const saved = JSON.parse(store?.getItem(key) ?? 'null') as { at: number; turns: Turn[]; people: Record<string, string>; used: Record<number, string[]>; draft: string } | null;
    if (!saved) return empty();
    if (Date.now() - saved.at > MAX_AGE_MS || !Array.isArray(saved.turns)) { store?.removeItem(key); return empty(); }
    return { ...empty(), turns: saved.turns.filter(t => (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string'), people: saved.people ?? {}, used: saved.used ?? {}, draft: typeof saved.draft === 'string' ? saved.draft : '' };
  } catch { return empty(); }
}
function save(key: string, chat: Chat) {
  try {
    if (!chat.turns.length && !chat.draft) storage()?.removeItem(key);
    else storage()?.setItem(key, JSON.stringify({ at: Date.now(), turns: chat.turns, people: chat.people, used: chat.used, draft: chat.draft }));
  } catch { /* storage full or blocked: the chat still works for this page view */ }
}
export function getChat(key: string): Chat { let chat = chats.get(key); if (!chat) { chat = load(key); chats.set(key, chat); } return chat; }
function update(key: string, patch: Partial<Chat>) { const next = { ...getChat(key), ...patch }; chats.set(key, next); save(key, next); listeners.forEach(l => l()); }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export const useChat = (key: string) => useSyncExternalStore(subscribe, () => getChat(key));
export const setDraft = (key: string, draft: string) => update(key, { draft });
export const startOver = (key: string) => { if (!getChat(key).busy) update(key, { ...empty() }); };
// Every saved chat is deleted: on sign-out, and whenever the app opens with no valid session.
export function forgetChats() {
  generation++; chats.clear();
  const store = storage();
  try { if (store) for (const name of Object.keys(store)) if (name.startsWith(PREFIX)) store.removeItem(name); } catch { /* storage unavailable */ }
  listeners.forEach(l => l());
}

// Sends a question with the earlier turns. This runs here, not in the page, so an answer that arrives after the person
// has moved to another page is still saved and is there when they come back.
export async function ask(key: string, schoolId: string, csrfToken: string, question: string) {
  const text = question.trim(), before = getChat(key);
  if (!text || before.busy) return;
  const started = generation;
  // Keep the last 9 exchanges so the request stays within the 20-message limit.
  const history = [...before.turns, { role: 'user' as const, text }].slice(-19);
  update(key, { turns: [...before.turns, { role: 'user', text }], draft: '', busy: true, error: '' });
  try {
    const r = await request<Reply>(`/schools/${schoolId}/assistant/chat`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ messages: history }) });
    if (started !== generation) return;
    const now = getChat(key);
    update(key, { people: { ...now.people, ...r.people }, used: { ...now.used, [before.turns.length + 1]: r.tools }, turns: [...now.turns, { role: 'assistant', text: r.reply }], busy: false });
  } catch (e) {
    if (started !== generation) return;
    const status = (e as { status?: number }).status ?? 0;
    const error = status === 0 ? 'Connection problem. Check your internet connection and ask again.' : status >= 502 ? 'The assistant could not get an answer just now. Wait a moment and ask again.' : (e as Error).message;
    update(key, { turns: before.turns, draft: text, error, busy: false });
  }
}
