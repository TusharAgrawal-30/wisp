# Wisp

Dead drops for the web: share text and files through links that burn out after a set number of reads —
and watch, live, as your secrets get read. The server can't read any of it.

## The idea

Pastebins solved sharing. PrivateBin solved *trust* — encrypt in the browser so the server only holds
ciphertext. Wisp keeps that zero-knowledge core and asks the next question: once you've shared a secret,
**what happened to it?** Did the right person open it? Did someone else? Is it gone yet?

Wisp answers those without accounts, cookies, or telemetry:

- **Read receipts** — every drop has a live timeline: sealed → read → burned. You watch it happen.
- **Sealed replies** — the reader can answer through the same encrypted channel; the server relays
  envelopes it cannot open.
- **The vault** — a dashboard of every drop you've made, live status and all, stored entirely in *your*
  browser. The server never learns which drops are yours.

## The crypto

```
                    browser                                  server
 ┌────────────────────────────────────────────┐   ┌─────────────────────────┐
 │ 1. random 256-bit key K (Web Crypto)       │   │ ciphertext, iv, salt    │
 │ 2. AES-256-GCM encrypt(content, K')        │──▶│ view counters, expiry   │
 │    where K' = PBKDF2(K ∥ password, salt)   │   │ sha256(owner token)     │
 │ 3. link = /d/<id>#<K>                      │   │ event timestamps        │
 │    (fragment: never sent to the server)    │   │ ...and nothing else     │
 └────────────────────────────────────────────┘   └─────────────────────────┘
```

- The key rides in the **URL fragment** — browsers never transmit it, so it can't appear in server logs
  or the database even by accident.
- Text, files, **filenames, and the content format** are all inside the ciphertext. The server can't
  tell a love letter from a private key.
- An optional password is folded into key derivation (PBKDF2-SHA256, 310k iterations), so a leaked link
  alone isn't enough.
- Replies are encrypted by the *reader's* browser with the same key — only the original sender, who
  still holds the link, can open them.

## Ownership without accounts

Creating a drop returns a random owner token; the server keeps only its hash. Presenting the token
unlocks the drop's event timeline and replies. That's the whole identity system. The vault page stores
your tokens and keys in localStorage — clear your browser and the server still knows nothing, you've
just forgotten your own drops.

## Burn semantics

A drop can allow exactly 1, 3, or 5 reads. The read that exhausts the limit deletes the ciphertext in
the same SQLite transaction that serves it, so concurrent readers can't double-spend the last view
(there's a test that fires 8 simultaneous readers to prove it). The viewer checks metadata before
consuming anything and asks for confirmation — which also stops link-preview bots in chat apps from
silently burning a one-shot drop.

## Features

- 1 / 3 / 5 / unlimited reads, plus time expiry (10 minutes – 30 days)
- Burn-gate confirmation before consuming a limited read
- Multi-file drops via drag & drop (everything encrypted, ≤ 8 MB)
- Plain text, markdown (sanitized), auto-highlighted code
- Password protection layered on the link key
- Live vault dashboard: status pills, view meters, event timelines, decrypted replies
- Early destroy with the owner token
- QR code for cross-device sharing
- Rate limiting, strict CSP, no cookies, no analytics

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
```

Production:

```bash
npm run build
npm start
```

Requires Node 22.13+ (uses the built-in `node:sqlite` — zero native dependencies).

## Storage

Two interchangeable backends behind `lib/store.ts`, picked at runtime:

- **SQLite** (default) — zero config. Data lives in `.data/` (override with `WISP_DATA_DIR`).
  Right for local dev and any host with a persistent disk.
- **Upstash Redis** — used automatically when `UPSTASH_REDIS_REST_URL` and
  `UPSTASH_REDIS_REST_TOKEN` are set. The right choice on serverless hosts (Vercel, etc.), where
  instances don't share a filesystem. Talks to the Upstash REST API with plain fetch — no extra
  dependency. Burn atomicity comes from Redis's atomic INCR, so the last read stays single-winner
  even across separate serverless instances.

To deploy on Vercel with persistent storage: create a free Redis database at upstash.com, copy the
REST URL and token from its dashboard into the project's environment variables, and redeploy.

## Tests

With the server running:

```bash
npm test
```

30 checks covering the crypto round trip, view-limit semantics, the 8-reader burn race, passwords,
sealed replies (including replying to an already-burned drop), owner timeline auth, destroy tokens,
file round trips, and input validation.

The suite runs against whichever backend the server is using. To exercise the Redis path locally
without an account, `node scripts/upstash-mock.mjs` starts an in-memory stand-in for the Upstash
REST API; point the env vars at it (`UPSTASH_REDIS_REST_URL=http://localhost:8790`,
`UPSTASH_REDIS_REST_TOKEN=test`) and start the server.

## Project layout

```
app/
  page.tsx               create flow — encryption happens here
  d/[id]/page.tsx        viewer: gate → consume → decrypt → render → reply
  vault/page.tsx         owner dashboard: live status, timelines, replies
  about/page.tsx         the security model in human words
  api/drop/              POST create
  api/drop/[id]/         GET consume (burn-aware) · DELETE with owner token
  api/drop/[id]/meta/    GET flags only — powers the burn gate
  api/drop/[id]/reply/   POST sealed reply envelope
  api/drop/[id]/owner/   GET timeline + replies, owner-token auth
components/
  Backdrop.tsx           glow field, light beam, dot matrix, film grain
  Nav.tsx / Footer.tsx   chrome
  FeatureGrid.tsx        landing feature tiles
  Countdown.tsx          live expiry ticker
  fx.tsx                 scramble/descramble text effects, entrance motion
lib/
  crypto.ts              Web Crypto: AES-GCM + PBKDF2, base64url helpers
  store.ts               storage facade — picks a backend at runtime
  store-sqlite.ts        SQLite backend: drops, events, replies, tombstones
  store-redis.ts         Upstash Redis backend (REST, no dependency)
  server.ts              ids, hashing, rate limiter
  vault.ts               localStorage vault (client only)
  format.ts              relative time / countdown formatting
scripts/
  upstash-mock.mjs       in-memory Upstash stand-in for testing the redis path
```

## Design decisions

- **Fragment keys over key escrow** — simplest honest zero-knowledge design; works with plain links.
- **Tombstones** — when ciphertext burns, a `(id, token-hash)` pair survives so the owner keeps their
  timeline. It's just a hash; it reveals nothing.
- **Replies stay open 24h after a burn** — a one-shot drop would otherwise be unanswerable the moment
  it's read, which kills the most natural use ("here's the password — reply once you're in").
- **Vault in localStorage, not a database** — an account system would put a map of who-owns-what on the
  server, which is exactly the metadata a zero-knowledge design should refuse to have.
- **Built-in `node:sqlite`** — zero native deps, `npm install` never compiles anything, and atomic burn
  semantics come free with a transaction.

## Threat model, briefly

Protects against: a curious or compromised server, database leaks, log scraping, link interception
(with a password shared out-of-band).

Doesn't protect against: a compromised reader or sender device, link + password shared in the same
channel, or a malicious deployment shipping tampered JavaScript. If your threat model includes the
operator, self-host — it's two commands.
