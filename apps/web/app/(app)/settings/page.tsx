import { Settings } from 'lucide-react';
import { Topbar } from '@/components/app-shell/Topbar';
import EmptyMessage from '@/components/general/EmptyMessage';

export default function SettingsPage() {
  return (
    <>
      <Topbar title='Settings' />
      <main className='flex flex-1 flex-col p-4 md:p-6'>
        <EmptyMessage
          icon={<Settings className='text-muted-foreground size-8' />}
          message='Settings'
          description='This is a starting point — describe what you want here and it will be built.'
        />
      </main>
    </>
  );
}
