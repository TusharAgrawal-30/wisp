import type { Metadata } from 'next';
import './globals.css';
import { Backdrop } from '@/components/Backdrop';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Wisp — secrets that vanish like smoke',
  description:
    'Zero-knowledge dead drops: text and files encrypted in your browser, links that burn out after a set number of reads, and read receipts for your secrets. The server only ever stores ciphertext.',
  icons: { icon: '/icon.svg' },
  openGraph: {
    title: 'Wisp — secrets that vanish like smoke',
    description:
      'Encrypt in your browser, share a link that burns out after a set number of reads, and watch read receipts live. The server only ever stores ciphertext.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;650&family=Space+Grotesk:wght@500;700&family=JetBrains+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Backdrop />
        <div className="shell">
          <Nav />
          <main>{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
