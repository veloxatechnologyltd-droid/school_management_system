// A search result hands its page what to show before navigating there: a search to fill in, or a receipt to open.
// The page takes it once when it opens; anything not taken is dropped at the next search.
export type Find = { page: string; text?: string; receiptId?: string };
let pending: Find | null = null;
export function findOn(find: Find) { pending = find; }
// Cleared a moment later rather than at once, so React's development double render reads the same value.
export function takeFind(page: string): Find | null {
  if (pending?.page !== page) return null;
  const find = pending; setTimeout(() => { if (pending === find) pending = null; }, 0); return find;
}
