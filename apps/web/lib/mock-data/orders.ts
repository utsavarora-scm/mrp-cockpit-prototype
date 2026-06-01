export type OrderStatus = 'paid' | 'pending' | 'refunded';

export interface Order {
  id: string;
  customer: string;
  email: string;
  amount: number;
  status: OrderStatus;
  date: string; // ISO date
}

export const orders: Order[] = [
  { id: '#3201', customer: 'Marcus Lee', email: 'marcus@lumalabs.io', amount: 1290, status: 'paid', date: '2026-05-31' },
  { id: '#3200', customer: 'Tom Becker', email: 'tom@graphite.dev', amount: 540, status: 'paid', date: '2026-05-31' },
  {
    id: '#3199',
    customer: 'Daniel Okoro',
    email: 'daniel@finchpay.com',
    amount: 980,
    status: 'pending',
    date: '2026-05-30',
  },
  {
    id: '#3198',
    customer: 'Aisha Verma',
    email: 'aisha@brightroast.co',
    amount: 220,
    status: 'paid',
    date: '2026-05-30',
  },
  {
    id: '#3197',
    customer: 'Priya Nair',
    email: 'priya@harborhealth.org',
    amount: 410,
    status: 'refunded',
    date: '2026-05-29',
  },
  {
    id: '#3196',
    customer: 'Marcus Lee',
    email: 'marcus@lumalabs.io',
    amount: 1750,
    status: 'paid',
    date: '2026-05-29',
  },
];
