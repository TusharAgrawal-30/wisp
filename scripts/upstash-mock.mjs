// Minimal in-memory stand-in for the Upstash Redis REST API, covering the
// commands lib/store-redis.ts uses: SET (with PX), GET, DEL, INCR, RPUSH,
// LRANGE, LLEN, PEXPIRE. Lets the e2e suite exercise the redis backend
// without an account. Not used in production.
import http from 'node:http';

const kv = new Map(); // key -> { value: string | string[], expiresAt: number | null }

function alive(key) {
  const e = kv.get(key);
  if (!e) return null;
  if (e.expiresAt !== null && e.expiresAt < Date.now()) {
    kv.delete(key);
    return null;
  }
  return e;
}

function exec(cmd) {
  const op = String(cmd[0]).toUpperCase();
  const key = cmd[1];
  switch (op) {
    case 'SET': {
      let expiresAt = null;
      for (let i = 3; i < cmd.length; i += 2) {
        if (String(cmd[i]).toUpperCase() === 'PX') expiresAt = Date.now() + Number(cmd[i + 1]);
      }
      kv.set(key, { value: String(cmd[2]), expiresAt });
      return 'OK';
    }
    case 'GET': {
      const e = alive(key);
      return e && typeof e.value === 'string' ? e.value : null;
    }
    case 'DEL': {
      let n = 0;
      for (const k of cmd.slice(1)) if (alive(k)) { kv.delete(k); n++; }
      return n;
    }
    case 'INCR': {
      const e = alive(key);
      const next = (e ? parseInt(e.value, 10) : 0) + 1;
      kv.set(key, { value: String(next), expiresAt: e ? e.expiresAt : null });
      return next;
    }
    case 'RPUSH': {
      const e = alive(key);
      const arr = e && Array.isArray(e.value) ? e.value : [];
      arr.push(...cmd.slice(2).map(String));
      kv.set(key, { value: arr, expiresAt: e ? e.expiresAt : null });
      return arr.length;
    }
    case 'LRANGE': {
      const e = alive(key);
      if (!e || !Array.isArray(e.value)) return [];
      const start = Number(cmd[2]);
      let stop = Number(cmd[3]);
      if (stop < 0) stop = e.value.length + stop;
      return e.value.slice(start, stop + 1);
    }
    case 'LLEN': {
      const e = alive(key);
      return e && Array.isArray(e.value) ? e.value.length : 0;
    }
    case 'PEXPIRE': {
      const e = alive(key);
      if (!e) return 0;
      e.expiresAt = Date.now() + Number(cmd[2]);
      return 1;
    }
    default:
      throw new Error(`unsupported command: ${op}`);
  }
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const result = exec(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
  });
});

const port = process.env.MOCK_PORT || 8790;
server.listen(port, () => console.log(`upstash mock on :${port}`));
