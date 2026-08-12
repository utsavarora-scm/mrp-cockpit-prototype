import type { Metadata } from 'next';
import { Suspense } from 'react';
import Providers from '@/app/providers';
import { dmSans, plexMono } from '@/lib/fonts';
import GlobalLoading from './loading';
import './globals.css';

export const metadata: Metadata = {
  title: 'MRP Exception Cockpit',
  description: 'Planning exceptions across SAP, Kinaxis and o9, ranked by what they cost.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='en' suppressHydrationWarning>
      <body className={`${dmSans.className} ${plexMono.variable} antialiased`}>
        <Suspense fallback={<GlobalLoading />}>
          <Providers>{children}</Providers>
        </Suspense>
      </body>
    </html>
  );
}
