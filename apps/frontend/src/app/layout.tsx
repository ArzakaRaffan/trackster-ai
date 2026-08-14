import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Trackster',
  description: 'Ide besar, dikerjain semaleman',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="min-h-screen">
        <div className="max-w-2xl mx-auto px-4 py-6">{children}</div>
      </body>
    </html>
  );
}
