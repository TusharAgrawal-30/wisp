import { Rise } from '@/components/fx';

const FEATURES = [
  {
    glyph: '◈',
    title: 'Zero-knowledge',
    body: 'AES-256-GCM in your browser. The key lives in the URL fragment — it never reaches the server.',
  },
  {
    glyph: '▲',
    title: 'Burns out',
    body: '1, 3, or 5 reads — deleted atomically on the last one. Two readers can’t both take the final view.',
  },
  {
    glyph: '◉',
    title: 'Read receipts',
    body: 'Your vault shows when each drop was opened, burned, or answered. Live. No accounts needed.',
  },
  {
    glyph: '⬡',
    title: 'Sealed replies',
    body: 'Readers can reply through the same encrypted channel. The server relays envelopes it can’t open.',
  },
];

export function FeatureGrid({ startIndex = 0 }: { startIndex?: number }) {
  return (
    <div className="features">
      {FEATURES.map((f, i) => (
        <Rise i={startIndex + i} key={f.title}>
          <div className="feature">
            <span className="glyph">{f.glyph}</span>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        </Rise>
      ))}
    </div>
  );
}
