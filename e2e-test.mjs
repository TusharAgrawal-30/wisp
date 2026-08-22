// End-to-end test against a running server. Mirrors the browser crypto
// exactly (Web Crypto is the same API in Node), then exercises the whole
// drop lifecycle: create, meta, view limits, burn races, passwords,
// replies, owner timeline, destroy.
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ITER = 310_000;

const enc = new TextEncoder();
const dec = new TextDecoder();
const toB64 = (u8) => Buffer.from(u8).toString('base64');
const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const toB64Url = (u8) => Buffer.from(u8).toString('base64url');

async function deriveKey(urlKey, password, salt, usage) {
  const pw = enc.encode(password);
  const ikm = new Uint8Array(urlKey.length + pw.length);
  ikm.set(urlKey);
  ikm.set(pw, urlKey.length);
  const base = await crypto.subtle.importKey('raw', ikm, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    usage
  );
}

async function encrypt(obj, urlKey, password = '') {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(urlKey, password, salt, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { v: 1, ct: toB64(new Uint8Array(ct)), iv: toB64(iv), salt: toB64(salt), pw: password.length > 0 };
}

async function decrypt(payload, urlKey, password = '') {
  const key = await deriveKey(urlKey, password, fromB64(payload.salt), ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(payload.iv) }, key, fromB64(payload.ct));
  return JSON.parse(dec.decode(pt));
}

async function createDrop(content, { maxViews = 1, expiry = '1d', password = '', allowReply = false } = {}) {
  const urlKey = crypto.getRandomValues(new Uint8Array(32));
  const payload = await encrypt(content, urlKey, password);
  const res = await fetch(`${BASE}/api/drop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob: JSON.stringify(payload), maxViews, expiry, allowReply }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return { ...data, urlKey, shareUrl: `${BASE}/d/${data.id}#${toB64Url(urlKey)}` };
}

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

// 1. round trip, unlimited views
{
  const d = await createDrop({ text: 'hello wisp', format: 'plain' }, { maxViews: 0 });
  const r = await fetch(`${BASE}/api/drop/${d.id}`).then((r) => r.json());
  const out = await decrypt(JSON.parse(r.blob), d.urlKey);
  check('round trip decrypts', out.text === 'hello wisp');
  check('server blob is not plaintext', !r.blob.includes('hello wisp'));
  const r2 = await fetch(`${BASE}/api/drop/${d.id}`).then((r) => r.json());
  check('unlimited drop readable again, views increment', r2.views === 2);
}

// 2. one-read burn
{
  const d = await createDrop({ text: 'burn me', format: 'plain' }, { maxViews: 1 });
  const meta = await fetch(`${BASE}/api/drop/${d.id}/meta`).then((r) => r.json());
  check('meta shows 1 view left without consuming', meta.viewsLeft === 1);
  const meta2 = await fetch(`${BASE}/api/drop/${d.id}/meta`).then((r) => r.json());
  check('meta is repeatable', meta2.viewsLeft === 1);
  const r1 = await fetch(`${BASE}/api/drop/${d.id}`);
  const j1 = await r1.json();
  check('first read succeeds and reports burned', r1.status === 200 && j1.burned === true);
  const r2 = await fetch(`${BASE}/api/drop/${d.id}`);
  check('second read is 404', r2.status === 404);
}

// 3. three-read limit
{
  const d = await createDrop({ text: 'three reads', format: 'plain' }, { maxViews: 3 });
  const s1 = await fetch(`${BASE}/api/drop/${d.id}`).then((r) => r.json());
  const s2 = await fetch(`${BASE}/api/drop/${d.id}`).then((r) => r.json());
  const s3 = await fetch(`${BASE}/api/drop/${d.id}`).then((r) => r.json());
  const s4 = await fetch(`${BASE}/api/drop/${d.id}`);
  check('reads 1-2 not burned, read 3 burned, read 4 gone',
    s1.burned === false && s2.burned === false && s3.burned === true && s4.status === 404);
}

// 4. concurrent race for the last view
{
  const d = await createDrop({ text: 'race', format: 'plain' }, { maxViews: 1 });
  const results = await Promise.all(
    Array.from({ length: 8 }, () => fetch(`${BASE}/api/drop/${d.id}`).then((r) => r.status))
  );
  const wins = results.filter((s) => s === 200).length;
  check(`exactly one concurrent reader wins (got ${wins})`, wins === 1);
}

// 5. password
{
  const d = await createDrop({ text: 'locked', format: 'plain' }, { maxViews: 0, password: 'hunter2' });
  const r = await fetch(`${BASE}/api/drop/${d.id}`).then((r) => r.json());
  const payload = JSON.parse(r.blob);
  check('payload flags password', payload.pw === true);
  let wrongFailed = false;
  try { await decrypt(payload, d.urlKey, 'wrong'); } catch { wrongFailed = true; }
  check('wrong password fails', wrongFailed);
  const out = await decrypt(payload, d.urlKey, 'hunter2');
  check('right password decrypts', out.text === 'locked');
}

// 6. sealed replies + owner view
{
  const d = await createDrop({ text: 'reply to me', format: 'plain' }, { maxViews: 1, allowReply: true });
  await fetch(`${BASE}/api/drop/${d.id}`); // burn it with a read
  const replyPayload = await encrypt({ text: 'got it, thanks' }, d.urlKey);
  const rep = await fetch(`${BASE}/api/drop/${d.id}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob: JSON.stringify(replyPayload) }),
  });
  check('reply accepted even after burn (24h window)', rep.status === 200);

  const owner = await fetch(`${BASE}/api/drop/${d.id}/owner`, {
    headers: { 'x-destroy-token': d.destroyToken },
  }).then((r) => r.json());
  check('owner sees timeline after burn', owner.alive === false && owner.events.some((e) => e.type === 'burned'));
  check('owner sees read event', owner.events.some((e) => e.type === 'read'));
  const sealed = JSON.parse(owner.replies[0].blob);
  const opened = await decrypt(sealed, d.urlKey);
  check('owner decrypts sealed reply', opened.text === 'got it, thanks');

  const bad = await fetch(`${BASE}/api/drop/${d.id}/owner`, { headers: { 'x-destroy-token': 'nope' } });
  check('wrong owner token rejected', bad.status === 404);
}

// 7. reply rejected when not allowed
{
  const d = await createDrop({ text: 'no replies', format: 'plain' }, { maxViews: 0, allowReply: false });
  const replyPayload = await encrypt({ text: 'sneaky' }, d.urlKey);
  const rep = await fetch(`${BASE}/api/drop/${d.id}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob: JSON.stringify(replyPayload) }),
  });
  check('reply rejected when disabled', rep.status === 403);
}

// 8. destroy
{
  const d = await createDrop({ text: 'destroy me', format: 'plain' }, { maxViews: 0 });
  const bad = await fetch(`${BASE}/api/drop/${d.id}`, { method: 'DELETE', headers: { 'x-destroy-token': 'nope' } });
  check('wrong destroy token rejected', bad.status === 404);
  const good = await fetch(`${BASE}/api/drop/${d.id}`, {
    method: 'DELETE',
    headers: { 'x-destroy-token': d.destroyToken },
  });
  check('correct destroy token deletes', good.status === 200);
  const after = await fetch(`${BASE}/api/drop/${d.id}`);
  check('destroyed drop gone', after.status === 404);
  const owner = await fetch(`${BASE}/api/drop/${d.id}/owner`, {
    headers: { 'x-destroy-token': d.destroyToken },
  }).then((r) => r.json());
  check('timeline shows destroy event', owner.events.some((e) => e.type === 'destroyed'));
}

// 9. files round trip
{
  const fileBytes = crypto.getRandomValues(new Uint8Array(4096));
  const d = await createDrop(
    { text: '', format: 'plain', files: [{ name: 'secret.bin', type: 'application/octet-stream', data: toB64(fileBytes) }] },
    { maxViews: 0 }
  );
  const r = await fetch(`${BASE}/api/drop/${d.id}`).then((r) => r.json());
  const out = await decrypt(JSON.parse(r.blob), d.urlKey);
  check('file survives round trip', out.files[0].data === toB64(fileBytes) && out.files[0].name === 'secret.bin');
}

// 10. validation
{
  const res = await fetch(`${BASE}/api/drop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob: 'x', maxViews: 2, expiry: '1d' }),
  });
  check('invalid view limit rejected', res.status === 400);
  const res2 = await fetch(`${BASE}/api/drop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob: 'x', maxViews: 1, expiry: 'bogus' }),
  });
  check('invalid expiry rejected', res2.status === 400);
  const res3 = await fetch(`${BASE}/api/drop/does-not-exist`);
  check('unknown id 404', res3.status === 404);
}

// 11. pages render
{
  const d = await createDrop({ text: 'page', format: 'plain' }, { maxViews: 0 });
  for (const [name, path] of [['home', '/'], ['viewer', `/d/${d.id}`], ['vault', '/vault'], ['about', '/about']]) {
    const r = await fetch(`${BASE}${path}`);
    check(`${name} page 200`, r.status === 200);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
