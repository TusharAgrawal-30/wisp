'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { decryptJson, fromB64Url, type EncryptedPayload } from '@/lib/crypto';
import { listVault, removeFromVault, type VaultEntry } from '@/lib/vault';
import { Rise } from '@/components/fx';

interface OwnerView {
  alive: boolean;
  views: number | null;
  maxViews: number | null;
  expiresAt: number | null;
  events: { type: string; at: number }[];
  replies: { blob: string; created_at: number }[];
}

interface CardState {
  entry: VaultEntry;
  view?: OwnerView;
  decryptedReplies?: { text: string; at: number }[];
  error?: string;
  open: boolean;
}

const EVENT_LABELS: Record<string, string> = {
  created: 'sealed',
  read: 'read',
  burned: 'burned out',
  expired: 'expired',
  destroyed: 'destroyed by you',
  reply: 'reply received',
};

function timeAgo(t: number): string {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function statusOf(view?: OwnerView): { cls: string; label: string } {
  if (!view) return { cls: 'gone', label: 'checking…' };
  if (view.alive) return { cls: 'live', label: 'live' };
  const types = view.events.map((e) => e.type);
  if (types.includes('burned')) return { cls: 'burned', label: 'burned' };
  if (types.includes('destroyed')) return { cls: 'gone', label: 'destroyed' };
  if (types.includes('expired')) return { cls: 'gone', label: 'expired' };
  return { cls: 'gone', label: 'gone' };
}

export default function VaultPage() {
  const [cards, setCards] = useState<CardState[]>([]);
  const [loaded, setLoaded] = useState(false);

  async function refresh(entries?: VaultEntry[]) {
    const list = entries ?? listVault();
    const next: CardState[] = await Promise.all(
      list.map(async (entry) => {
        const prev = cards.find((c) => c.entry.id === entry.id);
        try {
          const res = await fetch(`/api/drop/${entry.id}/owner`, {
            headers: { 'x-destroy-token': entry.destroyToken },
          });
          if (!res.ok) throw new Error(res.status === 404 ? 'No trace of this drop on the server.' : 'fetch failed');
          const view: OwnerView = await res.json();

          // decrypt replies locally — the vault kept the key
          let decryptedReplies = prev?.decryptedReplies;
          if (view.replies.length !== (decryptedReplies?.length ?? -1)) {
            const key = fromB64Url(entry.key);
            decryptedReplies = [];
            for (const r of view.replies) {
              try {
                const payload: EncryptedPayload = JSON.parse(r.blob);
                const pt = await decryptJson<{ text: string }>(payload, key);
                decryptedReplies.push({ text: pt.text, at: r.created_at });
              } catch {
                decryptedReplies.push({ text: '(could not decrypt this reply)', at: r.created_at });
              }
            }
          }
          return { entry, view, decryptedReplies, open: prev?.open ?? false };
        } catch (e: any) {
          return { entry, error: e.message || 'unreachable', open: prev?.open ?? false };
        }
      })
    );
    setCards(next);
    setLoaded(true);
  }

  useEffect(() => {
    refresh();
    const t = setInterval(() => refresh(), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function destroy(entry: VaultEntry) {
    await fetch(`/api/drop/${entry.id}`, {
      method: 'DELETE',
      headers: { 'x-destroy-token': entry.destroyToken },
    });
    refresh();
  }

  function forget(entry: VaultEntry) {
    removeFromVault(entry.id);
    refresh(listVault());
  }

  async function copyLink(entry: VaultEntry) {
    await navigator.clipboard.writeText(`${location.origin}/d/${entry.id}#${entry.key}`);
  }

  return (
    <div>
      <div className="hero">
        <Rise i={0}>
          <div className="eyebrow">live · refreshes every 5s</div>
        </Rise>
        <Rise i={1}>
          <h1>
            The <span className="serif">vault</span>
          </h1>
        </Rise>
        <Rise i={2}>
          <p>
            Every drop you&apos;ve sealed from this browser — with live read receipts, burn events, and decrypted
            replies. This list exists only in your browser; the server has no idea these drops are yours.
          </p>
        </Rise>
      </div>

      {loaded && cards.length === 0 && (
        <div className="gate">
          <div className="gate-icon">◆</div>
          <h2>Nothing here yet</h2>
          <p>Seal your first drop and it will show up here, tracked live.</p>
          <a href="/">
            <button className="primary" style={{ maxWidth: 240 }}>
              Create a drop
            </button>
          </a>
        </div>
      )}

      <div className="vault-grid">
        {cards.map((c, idx) => {
          const st = statusOf(c.view);
          const readEvents = c.view?.events.filter((e) => e.type === 'read') ?? [];
          return (
            <motion.div
              className="vault-card"
              key={c.entry.id}
              layout
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: Math.min(idx * 0.07, 0.5) }}
            >
              <div className="vault-head">
                <div>
                  <div className="vault-label">{c.entry.label || 'untitled drop'}</div>
                  <div className="vault-meta">
                    sealed {timeAgo(c.entry.createdAt)}
                    {c.entry.hasPassword ? ' · password-locked' : ''}
                    {c.entry.maxViews ? ` · ${c.entry.maxViews}-read limit` : ' · unlimited reads'}
                  </div>
                </div>
                <div className="vault-actions">
                  <span className={`status-pill ${st.cls}`}>
                    <span className="dot" /> {st.label}
                  </span>
                  {c.view?.alive && (
                    <>
                      <button className="secondary" onClick={() => copyLink(c.entry)}>
                        Copy link
                      </button>
                      <button className="danger" onClick={() => destroy(c.entry)}>
                        Destroy
                      </button>
                    </>
                  )}
                  <button
                    className="secondary"
                    onClick={() =>
                      setCards(cards.map((x) => (x.entry.id === c.entry.id ? { ...x, open: !x.open } : x)))
                    }
                  >
                    {c.open ? 'Hide' : 'Timeline'}
                  </button>
                  {!c.view?.alive && (
                    <button className="secondary" onClick={() => forget(c.entry)}>
                      Forget
                    </button>
                  )}
                </div>
              </div>

              {c.view?.alive && c.view.maxViews !== null && (
                <>
                  <div className="views-bar">
                    <div style={{ width: `${((c.view.views ?? 0) / c.view.maxViews) * 100}%` }} />
                  </div>
                  <div className="vault-meta">
                    {c.view.views}/{c.view.maxViews} reads used
                    {c.view.expiresAt ? ` · expires ${new Date(c.view.expiresAt).toLocaleString()}` : ''}
                  </div>
                </>
              )}
              {c.view?.alive && c.view.maxViews === null && (
                <div className="vault-meta" style={{ marginTop: 10 }}>
                  {c.view.views} read{c.view.views === 1 ? '' : 's'} so far
                  {c.view.expiresAt ? ` · expires ${new Date(c.view.expiresAt).toLocaleString()}` : ''}
                </div>
              )}

              {readEvents.length > 0 && !c.open && (
                <div className="vault-meta" style={{ marginTop: 8 }}>
                  last read {timeAgo(readEvents[readEvents.length - 1].at)}
                </div>
              )}

              {c.error && (
                <div className="vault-meta" style={{ marginTop: 8, color: 'var(--danger)' }}>
                  {c.error}
                </div>
              )}

              {c.open && c.view && (
                <>
                  <ul className="timeline">
                    {c.view.events.map((e, i) => (
                      <li key={i} className={`ev-${e.type}`}>
                        {EVENT_LABELS[e.type] || e.type} — {new Date(e.at).toLocaleString()}
                      </li>
                    ))}
                  </ul>
                  {c.decryptedReplies && c.decryptedReplies.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <label>Replies (decrypted locally)</label>
                      {c.decryptedReplies.map((r, i) => (
                        <div className="reply-bubble" key={i}>
                          <div className="when">{new Date(r.at).toLocaleString()}</div>
                          {r.text}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
