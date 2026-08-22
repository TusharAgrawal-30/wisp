'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  decryptJson,
  encryptJson,
  fromB64,
  fromB64Url,
  type EncryptedPayload,
  type DropPlaintext,
} from '@/lib/crypto';
import { Scramble } from '@/components/fx';
import { Countdown } from '@/components/Countdown';

interface Meta {
  maxViews: number | null;
  views: number;
  viewsLeft: number | null;
  allowReply: boolean;
  expiresAt: number | null;
}

interface Consumed {
  burned: boolean;
  views: number;
  maxViews: number | null;
  allowReply: boolean;
  expiresAt: number | null;
}

type Stage =
  | { kind: 'loading' }
  | { kind: 'gone' }
  | { kind: 'no-key' }
  | { kind: 'gate'; meta: Meta }
  | { kind: 'password'; payload: EncryptedPayload; info: Consumed; wrong: boolean }
  | { kind: 'ready'; content: DropPlaintext; info: Consumed }
  | { kind: 'error'; message: string };

export default function ViewPage({ params }: { params: { id: string } }) {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [pwInput, setPwInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [html, setHtml] = useState('');
  const [reply, setReply] = useState('');
  const [replyState, setReplyState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  function urlKey(): Uint8Array<ArrayBuffer> | null {
    const frag = location.hash.slice(1);
    if (!frag) return null;
    try {
      const k = fromB64Url(frag);
      return k.length === 32 ? k : null;
    } catch {
      return null;
    }
  }

  async function fetchAndDecrypt(password = '') {
    const key = urlKey();
    if (!key) {
      setStage({ kind: 'no-key' });
      return;
    }
    setStage({ kind: 'loading' });
    try {
      const res = await fetch(`/api/drop/${params.id}`);
      if (res.status === 404) {
        setStage({ kind: 'gone' });
        return;
      }
      if (!res.ok) throw new Error('The server had a problem. Try again in a moment.');
      const data = await res.json();
      const payload: EncryptedPayload = JSON.parse(data.blob);
      const info: Consumed = {
        burned: data.burned,
        views: data.views,
        maxViews: data.maxViews,
        allowReply: data.allowReply,
        expiresAt: data.expiresAt,
      };
      if (payload.pw && !password) {
        setStage({ kind: 'password', payload, info, wrong: false });
        return;
      }
      try {
        const content = await decryptJson<DropPlaintext>(payload, key, password);
        setStage({ kind: 'ready', content, info });
      } catch {
        if (payload.pw) {
          setStage({ kind: 'password', payload, info, wrong: password.length > 0 });
        } else {
          setStage({ kind: 'error', message: 'Decryption failed — the link is probably incomplete or mangled.' });
        }
      }
    } catch (e: any) {
      setStage({ kind: 'error', message: e.message || 'Something went wrong.' });
    }
  }

  // Reading a view-limited drop consumes a view, so check metadata first
  // and make the reader confirm. Also keeps link-preview bots from
  // burning a one-shot drop.
  useEffect(() => {
    (async () => {
      if (!urlKey()) {
        setStage({ kind: 'no-key' });
        return;
      }
      try {
        const res = await fetch(`/api/drop/${params.id}/meta`);
        if (res.status === 404) {
          setStage({ kind: 'gone' });
          return;
        }
        const meta: Meta = await res.json();
        if (meta.maxViews !== null) {
          setStage({ kind: 'gate', meta });
        } else {
          await fetchAndDecrypt();
        }
      } catch {
        setStage({ kind: 'error', message: 'Could not reach the server.' });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Markdown / code rendering happens client-side, after decryption.
  useEffect(() => {
    if (stage.kind !== 'ready') return;
    const { content } = stage;
    (async () => {
      if (content.format === 'markdown') {
        const [{ marked }, { default: DOMPurify }] = await Promise.all([import('marked'), import('dompurify')]);
        const raw = await marked.parse(content.text, { gfm: true, breaks: true });
        setHtml(DOMPurify.sanitize(raw as string));
      } else if (content.format === 'code') {
        const { default: hljs } = await import('highlight.js');
        const result = hljs.highlightAuto(content.text);
        setHtml(`<pre><code class="hljs">${result.value}</code></pre>`);
      }
    })();
  }, [stage]);

  async function decryptWithPassword(e: React.FormEvent) {
    e.preventDefault();
    if (stage.kind !== 'password') return;
    const key = urlKey();
    if (!key) return;
    try {
      const content = await decryptJson<DropPlaintext>(stage.payload, key, pwInput);
      setStage({ kind: 'ready', content, info: stage.info });
    } catch {
      setStage({ ...stage, wrong: true });
    }
  }

  async function sendReply() {
    if (!reply.trim() || stage.kind !== 'ready') return;
    const key = urlKey();
    if (!key) return;
    setReplyState('sending');
    try {
      // encrypted with the same key — only someone holding the link
      // (i.e. the drop's owner) can read it
      const payload = await encryptJson({ text: reply }, key);
      const res = await fetch(`/api/drop/${params.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blob: JSON.stringify(payload) }),
      });
      if (!res.ok) throw new Error();
      setReplyState('sent');
      setReply('');
    } catch {
      setReplyState('failed');
    }
  }

  function downloadFile(f: NonNullable<DropPlaintext['files']>[number]) {
    const bytes = fromB64(f.data);
    const blob = new Blob([bytes], { type: f.type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = f.name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (stage.kind === 'loading') {
    return <p style={{ color: 'var(--text-dim)' }}>Loading…</p>;
  }

  if (stage.kind === 'gone') {
    return (
      <div className="gate">
        <div className="gate-icon">∅</div>
        <h2>Gone like smoke</h2>
        <p>This drop doesn&apos;t exist — it burned out, expired, or its owner destroyed it.</p>
        <a href="/">
          <button className="secondary">Create your own</button>
        </a>
      </div>
    );
  }

  if (stage.kind === 'no-key') {
    return (
      <div className="notice error">
        This link is missing its decryption key (the part after <code>#</code>). Without it the content
        can&apos;t be decrypted — ask the sender for the complete link.
      </div>
    );
  }

  if (stage.kind === 'gate') {
    const last = stage.meta.viewsLeft !== null && stage.meta.viewsLeft <= 1;
    return (
      <motion.div
        className="gate"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45 }}
      >
        <div className="gate-icon">{last ? '▲' : '◈'}</div>
        <h2>{last ? 'This is the last read' : 'This drop has limited reads'}</h2>
        <p>
          {last
            ? 'Opening it will permanently burn the drop — there is no second chance. Make sure you’re ready.'
            : `Opening it consumes one of ${stage.meta.viewsLeft} remaining reads.`}
        </p>
        <button className="primary" style={{ maxWidth: 300 }} onClick={() => fetchAndDecrypt()}>
          {last ? 'Reveal & burn' : 'Reveal'}
        </button>
      </motion.div>
    );
  }

  if (stage.kind === 'password') {
    return (
      <div className="card" style={{ maxWidth: 460, margin: '60px auto' }}>
        <h2 style={{ marginTop: 0 }}>Password required</h2>
        <p className="hint" style={{ marginBottom: 14 }}>
          The sender added a password on top of the link key. It travels separately on purpose.
        </p>
        <form onSubmit={decryptWithPassword}>
          <input
            type="password"
            placeholder="Password"
            value={pwInput}
            onChange={(e) => setPwInput(e.target.value)}
            autoFocus
          />
          {stage.wrong && (
            <p className="hint" style={{ color: 'var(--danger)' }}>
              That password didn&apos;t work.
            </p>
          )}
          <button className="primary" style={{ marginTop: 12 }} type="submit">
            Decrypt
          </button>
        </form>
      </div>
    );
  }

  if (stage.kind === 'error') {
    return <div className="notice error">{stage.message}</div>;
  }

  const { content, info } = stage;

  return (
    <div>
      <motion.div
        className="drop-view"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.21, 0.6, 0.35, 1] }}
      >
        <div className="drop-toolbar">
          <div>
            {info.burned ? (
              <span className="tag burn">burned — that was the last read</span>
            ) : (
              <>
                <span className="tag">{content.format}</span>
                {info.maxViews !== null ? (
                  <span className="tag ember">
                    read {info.views}/{info.maxViews}
                  </span>
                ) : (
                  <span className="tag">views: {info.views}</span>
                )}
                {info.expiresAt && <Countdown expiresAt={info.expiresAt} />}
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {content.text && (
              <button
                className="secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(content.text);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                }}
              >
                {copied ? 'Copied' : 'Copy text'}
              </button>
            )}
            <a href="/" style={{ fontSize: 13.5, color: 'var(--text-dim)' }}>
              new drop
            </a>
          </div>
        </div>

        {content.text &&
          (content.format === 'plain' ? (
            <div className="drop-body">
              {/* text descrambles from cipher-noise into plaintext — decryption, visualized */}
              <Scramble text={content.text} as="pre" speed={content.text.length > 600 ? 6 : 14} />
            </div>
          ) : (
            <motion.div
              className={`drop-body ${content.format === 'markdown' ? 'markdown' : ''}`}
              initial={{ opacity: 0, filter: 'blur(8px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              transition={{ duration: 0.7 }}
              dangerouslySetInnerHTML={{ __html: html || '<pre>…</pre>' }}
            />
          ))}

        {content.files && content.files.length > 0 && (
          <div style={{ padding: '0 22px 20px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {content.files.map((f, i) => (
              <button className="secondary" key={i} onClick={() => downloadFile(f)}>
                ⬇ {f.name}
              </button>
            ))}
          </div>
        )}
      </motion.div>

      {info.burned && (
        <p className="hint" style={{ marginTop: 12 }}>
          This content now exists only on your screen. Copy it somewhere safe if you need it again.
        </p>
      )}

      {info.allowReply && (
        <div className="card">
          <label>Reply — sealed with the same key</label>
          {replyState === 'sent' ? (
            <div className="notice success" style={{ margin: 0 }}>
              Reply sealed and sent. Only the sender can decrypt it.
            </div>
          ) : (
            <>
              <textarea
                className="editor"
                style={{ minHeight: 100 }}
                placeholder="Your answer goes back through the same encrypted channel…"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
              />
              {replyState === 'failed' && (
                <p className="hint" style={{ color: 'var(--danger)' }}>
                  Could not send the reply — it may be closed for this drop.
                </p>
              )}
              <button
                className="primary"
                style={{ marginTop: 10, maxWidth: 260 }}
                onClick={sendReply}
                disabled={replyState === 'sending' || !reply.trim()}
              >
                {replyState === 'sending' ? 'Sealing…' : 'Encrypt & reply'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
