import { Topbar } from '@/components/app-shell/Topbar';
import { CustomersView } from '@/components/customers/CustomersView';

export default function CustomersPage() {
  return (
    <>
      <Topbar title='Customers' />
      <main className='flex flex-1 flex-col p-4 md:p-6'>
        <CustomersView />
      </main>
    </>
  );
}
