'use client';

import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import QRCode from 'qrcode';
import { encryptJson, generateUrlKey, toB64, toB64Url, type DropPlaintext, type DropFile } from '@/lib/crypto';
import { saveToVault } from '@/lib/vault';
import { Rise, ScrambleCycle } from '@/components/fx';
import { FeatureGrid } from '@/components/FeatureGrid';

const MAX_FILE_BYTES = 8 * 1024 * 1024;

type Result = {
  url: string;
  destroyToken: string;
  id: string;
  qr: string;
  maxViews: number;
  expiry: string;
};

const EXPIRY_LABELS: Record<string, string> = {
  '10m': '10 minutes',
  '1h': '1 hour',
  '1d': '1 day',
  '7d': '7 days',
  '30d': '30 days',
  never: 'until views run out',
};

const VIEW_LABELS: Record<number, string> = {
  1: 'burns after 1 read',
  3: 'burns after 3 reads',
  5: 'burns after 5 reads',
  0: 'unlimited reads',
};

async function fileToB64(file: File): Promise<string> {
  return toB64(new Uint8Array(await file.arrayBuffer()));
}

export default function CreatePage() {
  const [text, setText] = useState('');
  const [format, setFormat] = useState<DropPlaintext['format']>('plain');
  const [expiry, setExpiry] = useState('1d');
  const [maxViews, setMaxViews] = useState(1);
  const [password, setPassword] = useState('');
  const [allowReply, setAllowReply] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | File[]) {
    const next = [...files, ...Array.from(list)];
    const total = next.reduce((s, f) => s + f.size, 0);
    if (total > MAX_FILE_BYTES) {
      setError('Files are too big — 8 MB total, keep it lean.');
      return;
    }
    setError('');
    setFiles(next);
  }

  async function create() {
    setError('');
    if (!text.trim() && files.length === 0) {
      setError('Write something or drop a file first.');
      return;
    }
    setBusy(true);
    try {
      const encFiles: DropFile[] = [];
      for (const f of files) {
        encFiles.push({ name: f.name, type: f.type || 'application/octet-stream', data: await fileToB64(f) });
      }
      const plaintext: DropPlaintext = { text, format, files: encFiles.length ? encFiles : undefined };

      const urlKey = generateUrlKey();
      const payload = await encryptJson(plaintext, urlKey, password);

      const res = await fetch('/api/drop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blob: JSON.stringify(payload), maxViews, expiry, allowReply }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');

      const keyStr = toB64Url(urlKey);
      const url = `${location.origin}/d/${data.id}#${keyStr}`;
      const qr = await QRCode.toDataURL(url, { margin: 1, width: 280 });

      saveToVault({
        id: data.id,
        key: keyStr,
        destroyToken: data.destroyToken,
        label: text.trim() ? text.trim().slice(0, 42) : files.map((f) => f.name).join(', ').slice(0, 42),
        createdAt: Date.now(),
        hasPassword: password.length > 0,
        maxViews: maxViews === 0 ? null : maxViews,
      });

      setResult({ url, destroyToken: data.destroyToken, id: data.id, qr, maxViews, expiry });
    } catch (e: any) {
      setError(e.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!result) return;
    await navigator.clipboard.writeText(result.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function reset() {
    setResult(null);
    setText('');
    setPassword('');
    setFiles([]);
    setAllowReply(false);
    setMaxViews(1);
    setCopied(false);
  }

  if (result) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="result"
          initial={{ opacity: 0, scale: 0.96, y: 18 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.21, 0.6, 0.35, 1] }}
        >
          <div className="hero">
            <div className="eyebrow">✓ sealed & encrypted</div>
            <h1>
              Your drop is <span className="serif">live</span>
            </h1>
            <p>The decryption key rides after the # — it never touched our server. Share the whole link.</p>
          </div>

          <div className="card">
            <label htmlFor="share-url">Share link</label>
            <div className="share-link">
              <input id="share-url" type="text" readOnly value={result.url} onFocus={(e) => e.target.select()} />
              <button className="secondary" onClick={copyLink}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>

            <div style={{ marginTop: 16 }}>
              <span className={`tag ${result.maxViews === 0 ? '' : 'burn'}`}>{VIEW_LABELS[result.maxViews]}</span>
              <span className="tag">expires: {EXPIRY_LABELS[result.expiry]}</span>
              <span className="tag ok">encrypted in your browser</span>
            </div>

            <div className="qr-wrap">
              <motion.img
                src={result.qr}
                alt="QR code for the share link"
                initial={{ opacity: 0, rotate: -4, scale: 0.9 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                transition={{ delay: 0.25, duration: 0.45 }}
              />
              <div style={{ flex: 1, minWidth: 250 }}>
                <p className="hint" style={{ marginTop: 0, fontSize: 13.5 }}>
                  This drop is now in your <a href="/vault" style={{ color: 'var(--azure)' }}>vault</a> — watch it
                  get read live, see sealed replies, or destroy it early. The vault exists only in this browser.
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  <a href="/vault">
                    <button className="secondary">Open vault →</button>
                  </a>
                  <button className="secondary" onClick={reset}>
                    New drop
                  </button>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <div>
      <div className="hero">
        <Rise i={0}>
          <div className="eyebrow">
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--azure)', display: 'inline-block' }} />
            zero-knowledge dead drops
          </div>
        </Rise>
        <Rise i={1}>
          <h1>
            Secrets that <span className="serif">vanish</span>
            <br />
            like smoke.
          </h1>
        </Rise>
        <Rise i={2}>
          <p>
            Text and files, encrypted in your browser before they leave your machine. Links that burn out after
            a set number of reads. Read receipts, sealed replies, no accounts.
          </p>
        </Rise>
        <Rise i={3}>
          <div className="scramble-line">
            <ScrambleCycle
              phrases={[
                '> the server stores: U2FsdGVkX19qk3...vQ== — and nothing else',
                '> your key never leaves the url fragment',
                '> last read burns the ciphertext. atomically.',
                '> no accounts. ownership is a token.',
              ]}
            />
          </div>
        </Rise>
      </div>

      <Rise i={4}>
        <div className="card">
          <label htmlFor="editor">Secret</label>
          <textarea
            id="editor"
            className="editor"
            placeholder="Credentials, keys, a confession, code that must not leak…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') create();
            }}
            spellCheck={false}
          />
          <p className="hint">
            <span className="kbd">⌘/Ctrl</span> + <span className="kbd">Enter</span> to seal it
          </p>

          <div
            className={`dropzone ${dragOver ? 'over' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
          >
            ⬡ drop files here or click to attach — encrypted too, names included (≤ 8 MB total)
            <input
              ref={fileRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </div>
          <AnimatePresence>
            {files.length > 0 && (
              <motion.div className="file-chips" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                {files.map((f, i) => (
                  <span className="file-chip" key={i}>
                    {f.name} · {(f.size / 1024).toFixed(0)} KB
                    <button onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button>
                  </span>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="controls">
            <div>
              <label>Self-destructs after</label>
              <div className="chip-row">
                {[1, 3, 5, 0].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`chip ${maxViews === n ? 'selected' : ''}`}
                    onClick={() => setMaxViews(n)}
                  >
                    {n === 0 ? '∞ reads' : `${n} read${n > 1 ? 's' : ''}`}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="expiry">Or expires in</label>
              <select id="expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                <option value="10m">10 minutes</option>
                <option value="1h">1 hour</option>
                <option value="1d">1 day</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
                <option value="never">no time limit</option>
              </select>
            </div>
            <div>
              <label htmlFor="format">Format</label>
              <select id="format" value={format} onChange={(e) => setFormat(e.target.value as any)}>
                <option value="plain">Plain text</option>
                <option value="code">Code (highlighted)</option>
                <option value="markdown">Markdown</option>
              </select>
            </div>
            <div>
              <label htmlFor="pw">Password (optional)</label>
              <input
                id="pw"
                type="password"
                placeholder="A second lock, shared separately"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>

          <label className="check-row">
            <input type="checkbox" checked={allowReply} onChange={(e) => setAllowReply(e.target.checked)} />
            Allow an encrypted reply — the reader can answer through the same sealed channel
          </label>

          <AnimatePresence>
            {error && (
              <motion.div className="notice error" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <button className="primary" onClick={create} disabled={busy}>
            {busy ? 'Encrypting in your browser…' : 'Encrypt & seal drop'}
          </button>
        </div>
      </Rise>

      <FeatureGrid startIndex={5} />
    </div>
  );
}
