// The vault is deliberately client-side only: a list of drops you created,
// kept in localStorage together with their keys and owner tokens. The
// server never learns which drops belong to whom — ownership of a drop is
// just knowledge of its destroy token, and the ability to read replies is
// just possession of the key. Clearing your browser storage forgets them.

export interface VaultEntry {
  id: string;
  key: string; // base64url key material (URL fragment)
  destroyToken: string;
  label: string;
  createdAt: number;
  hasPassword: boolean;
  maxViews: number | null;
}

const KEY = 'wisp.vault.v1';

export function listVault(): VaultEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as VaultEntry[]) : [];
    return arr.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export function saveToVault(entry: VaultEntry) {
  const arr = listVault().filter((e) => e.id !== entry.id);
  arr.unshift(entry);
  localStorage.setItem(KEY, JSON.stringify(arr.slice(0, 200)));
}

export function removeFromVault(id: string) {
  localStorage.setItem(KEY, JSON.stringify(listVault().filter((e) => e.id !== id)));
}
