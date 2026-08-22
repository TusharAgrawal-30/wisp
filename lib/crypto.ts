// All encryption happens in the browser with the Web Crypto API.
// The random key material goes into the URL *fragment* (#...), which
// browsers never send to the server. With an optional password, the
// actual AES key is derived from key material + password, so the link
// alone isn't enough to decrypt.

const PBKDF2_ITERATIONS = 310_000;

export interface EncryptedPayload {
  v: 1;
  ct: string; // base64 ciphertext
  iv: string; // base64, 12 bytes
  salt: string; // base64, 16 bytes
  pw: boolean; // whether a password is required on top of the URL key
}

export interface DropFile {
  name: string;
  type: string;
  data: string; // base64
}

// What actually gets encrypted. Format/filenames stay inside the
// ciphertext so the server can't even tell what kind of content it is.
export interface DropPlaintext {
  text: string;
  format: 'plain' | 'markdown' | 'code';
  files?: DropFile[];
}

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toB64Url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64Url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

export function generateUrlKey(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(32));
}

async function deriveAesKey(
  urlKey: Uint8Array,
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  usage: KeyUsage[]
): Promise<CryptoKey> {
  const pwBytes = new TextEncoder().encode(password);
  const ikm = new Uint8Array(urlKey.length + pwBytes.length);
  ikm.set(urlKey);
  ikm.set(pwBytes, urlKey.length);

  const base = await crypto.subtle.importKey('raw', ikm, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    usage
  );
}

export async function encryptJson(
  plaintext: unknown,
  urlKey: Uint8Array,
  password = ''
): Promise<EncryptedPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(urlKey, password, salt, ['encrypt']);
  const data = new TextEncoder().encode(JSON.stringify(plaintext));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { v: 1, ct: toB64(ct), iv: toB64(iv), salt: toB64(salt), pw: password.length > 0 };
}

export async function decryptJson<T>(
  payload: EncryptedPayload,
  urlKey: Uint8Array,
  password = ''
): Promise<T> {
  const key = await deriveAesKey(urlKey, password, fromB64(payload.salt), ['decrypt']);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(payload.iv) },
    key,
    fromB64(payload.ct)
  );
  return JSON.parse(new TextDecoder().decode(pt));
}
