import { TopBar } from '@/components/app-shell/TopBar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex min-h-svh flex-col'>
      <TopBar />
      {/* The dense screens are designed for 1440px and up and scroll below it. */}
      <main className='board flex-1 overflow-x-auto'>{children}</main>
    </div>
  );
}
