import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Debate Tree — Make room for better arguments', description: 'Explore a debate, build your stance, and evaluate the arguments with Grok.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
