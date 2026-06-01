import { Topbar } from '@/components/app-shell/Topbar';
import { RecentOrders } from '@/components/dashboard/RecentOrders';

export default function OrdersPage() {
  return (
    <>
      <Topbar title='Orders' />
      <main className='flex flex-1 flex-col p-4 md:p-6'>
        <RecentOrders />
      </main>
    </>
  );
}
