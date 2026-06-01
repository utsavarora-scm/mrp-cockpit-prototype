'use client';

import { Separator } from '@repo/ui/components/separator';
import { SidebarTrigger } from '@repo/ui/components/sidebar';
import { ThemeToggle } from '@repo/ui/components/theme-toggle';

export function Topbar({ title }: { title: string }) {
  return (
    <header className='bg-background/80 sticky top-0 z-10 flex h-14 items-center gap-3 border-b px-4 backdrop-blur'>
      <SidebarTrigger />
      <Separator orientation='vertical' className='h-5' />
      <h1 className='text-sm font-semibold'>{title}</h1>
      <div className='ml-auto'>
        <ThemeToggle />
      </div>
    </header>
  );
}
