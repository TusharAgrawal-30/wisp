export const metadata = { title: 'How Wisp works' };

export default function AboutPage() {
  return (
    <div className="prose">
      <div className="hero">
        <h1>How it works</h1>
        <p>Short version: we can&apos;t read your drops. Longer version below.</p>
      </div>

      <h2>Zero-knowledge by construction</h2>
      <p>
        When you seal a drop, your browser generates a random 256-bit key and encrypts everything —
        text, files, filenames, even the content format — with AES-256-GCM via the Web Crypto API. Only
        ciphertext is uploaded. The key goes into the URL <em>fragment</em> (the part after <code>#</code>),
        which browsers never transmit to any server. The link you share carries the key; our server only ever
        sees <code>/d/abc123</code>.
      </p>
      <p>
        This isn&apos;t a privacy policy, it&apos;s an architectural property: the server-side code has no
        path to your plaintext because the material needed to decrypt never arrives.
      </p>

      <h2>Read limits and burning</h2>
      <p>
        A drop can allow exactly 1, 3, or 5 reads. The read that exhausts the limit deletes the ciphertext
        inside the same database transaction — two people opening the last view simultaneously can&apos;t
        both win. Because a plain page load would consume a view, the viewer checks metadata first and asks
        for confirmation; that also stops chat-app link preview bots from silently burning a one-shot drop.
      </p>

      <h2>Read receipts without accounts</h2>
      <p>
        Creating a drop returns a random owner token. Its hash is stored server-side; the token itself lives
        only in your browser&apos;s vault. Presenting the token proves ownership, and unlocks the drop&apos;s
        event timeline — sealed, read, burned, expired, destroyed, replied. That&apos;s the entire identity
        system: no accounts, no emails, no cookies. The server never learns which drops belong to the same
        person.
      </p>

      <h2>Sealed replies</h2>
      <p>
        If the sender allows replies, the reader can answer through the same channel: the reply is encrypted
        in the reader&apos;s browser with the same key from the URL fragment. The server stores an envelope it
        cannot open; only someone holding the original link — the sender — can decrypt it in their vault.
      </p>

      <h2>Passwords</h2>
      <p>
        An optional password is mixed into the key derivation (PBKDF2-SHA256, 310k iterations) together with
        the URL key. Someone who intercepts the link — say, from a chat log — still can&apos;t decrypt without
        the password, which you share over a different channel.
      </p>

      <h2>What the server stores</h2>
      <ul>
        <li>ciphertext, IV, salt — opaque blobs</li>
        <li>view counters, expiry time, reply flag</li>
        <li>a hash of the owner token, and an event timeline of timestamps</li>
      </ul>
      <p>
        Notably absent: plaintext, keys, passwords, filenames, content types, reader identities, IP logs tied
        to content. Everything meaningful lives inside the ciphertext.
      </p>

      <h2>What this doesn&apos;t protect against</h2>
      <p>
        Honesty section. If your device is compromised, or you share the full link and the password in the
        same channel, encryption can&apos;t save you. And like any web app, you trust the JavaScript the
        server ships — a malicious deployment could serve backdoored code. For higher stakes, audit the
        source and self-host; it&apos;s a two-command deployment.
      </p>
    </div>
  );
}
