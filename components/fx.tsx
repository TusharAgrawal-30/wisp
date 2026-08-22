'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

const GLYPHS = '!<>-_\\/[]{}—=+*^?#$%&@abcdef0123456789';

// Text descrambles from cipher-noise into the real string. Used for the
// decrypt reveal and the hero — makes the encryption story visible.
export function Scramble({
  text,
  speed = 18,
  delay = 0,
  className,
  as: Tag = 'span',
}: {
  text: string;
  speed?: number;
  delay?: number;
  className?: string;
  as?: any;
}) {
  const [out, setOut] = useState('');
  const frame = useRef(0);

  useEffect(() => {
    let raf: number;
    let start: number | null = null;
    const step = (t: number) => {
      if (start === null) start = t + delay;
      if (t < start) {
        raf = requestAnimationFrame(step);
        return;
      }
      frame.current = Math.floor((t - start) / speed);
      const settled = Math.floor(frame.current / 2);
      let s = '';
      for (let i = 0; i < text.length; i++) {
        if (i < settled) s += text[i];
        else if (text[i] === ' ' || text[i] === '\n') s += text[i];
        else s += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      setOut(s);
      if (settled < text.length) raf = requestAnimationFrame(step);
      else setOut(text);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, speed, delay]);

  return <Tag className={className}>{out || ' '}</Tag>;
}

// Loops a phrase between plaintext and cipher-noise — the hero's live
// "watch it encrypt" moment.
export function ScrambleCycle({ phrases, className }: { phrases: string[]; className?: string }) {
  const [idx, setIdx] = useState(0);
  const [key, setKey] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % phrases.length);
      setKey((k) => k + 1);
    }, 3400);
    return () => clearInterval(t);
  }, [phrases.length]);

  return <Scramble key={key} text={phrases[idx]} className={className} speed={14} />;
}

// Standard entrance: fade + rise, staggered by `i`.
export function Rise({
  children,
  i = 0,
  className,
}: {
  children: React.ReactNode;
  i?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay: i * 0.09, ease: [0.21, 0.6, 0.35, 1] }}
    >
      {children}
    </motion.div>
  );
}
