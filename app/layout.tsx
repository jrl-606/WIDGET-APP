import type { ReactNode } from 'react';

export const metadata = {
  title: 'widget-api',
  description: 'API layer over the widget-app Neon Postgres project',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
