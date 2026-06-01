export type CustomerStatus = 'active' | 'invited' | 'churned';

export interface Customer {
  id: string;
  name: string;
  email: string;
  company: string;
  status: CustomerStatus;
  spend: number;
  joinedAt: string; // ISO date
}

export const customers: Customer[] = [
  {
    id: 'cus_01',
    name: 'Aisha Verma',
    email: 'aisha@brightroast.co',
    company: 'Bright Roast',
    status: 'active',
    spend: 4820,
    joinedAt: '2025-11-02',
  },
  {
    id: 'cus_02',
    name: 'Marcus Lee',
    email: 'marcus@lumalabs.io',
    company: 'Luma Labs',
    status: 'active',
    spend: 12940,
    joinedAt: '2025-09-18',
  },
  {
    id: 'cus_03',
    name: 'Sofia Marchetti',
    email: 'sofia@northwind.studio',
    company: 'Northwind Studio',
    status: 'invited',
    spend: 0,
    joinedAt: '2026-05-21',
  },
  {
    id: 'cus_04',
    name: 'Daniel Okoro',
    email: 'daniel@finchpay.com',
    company: 'FinchPay',
    status: 'active',
    spend: 7610,
    joinedAt: '2026-01-09',
  },
  {
    id: 'cus_05',
    name: 'Priya Nair',
    email: 'priya@harborhealth.org',
    company: 'Harbor Health',
    status: 'churned',
    spend: 2150,
    joinedAt: '2025-07-30',
  },
  {
    id: 'cus_06',
    name: 'Tom Becker',
    email: 'tom@graphite.dev',
    company: 'Graphite',
    status: 'active',
    spend: 9330,
    joinedAt: '2026-03-14',
  },
];
