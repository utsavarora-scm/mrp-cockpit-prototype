import { Topbar } from '@/components/app-shell/Topbar';
import { RecentOrders } from '@/components/dashboard/RecentOrders';
import { RevenueChart } from '@/components/dashboard/RevenueChart';
import { StatCards } from '@/components/dashboard/StatCards';

export default function DashboardPage() {
  return (
    <>
      <Topbar title='Dashboard' />
      <main className='flex flex-1 flex-col gap-6 p-4 md:p-6'>
        <StatCards />
        <div className='grid gap-6 lg:grid-cols-5'>
          <div className='lg:col-span-3'>
            <RevenueChart />
          </div>
          <div className='lg:col-span-2'>
            <RecentOrders />
          </div>
        </div>
      </main>
    </>
  );
}
