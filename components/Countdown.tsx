'use client';

import { useEffect, useState } from 'react';
import { timeLeft } from '@/lib/format';

// Live "expires in Xm Ys" tag. Ticks every second; flips to a danger
// style in the final minute.
export function Countdown({ expiresAt }: { expiresAt: number }) {
  const [, tick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return <span className="tag burn">expired</span>;
  const urgent = remaining < 60_000;
  return <span className={`tag ${urgent ? 'burn' : 'info'}`}>expires in {timeLeft(expiresAt)}</span>;
}
