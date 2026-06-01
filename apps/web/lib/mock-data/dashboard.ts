export interface Stat {
  label: string;
  value: string;
  delta: number; // percent change vs. previous period
}

export const stats: Stat[] = [
  { label: 'Revenue', value: '$48,290', delta: 12.4 },
  { label: 'Orders', value: '1,204', delta: 8.1 },
  { label: 'Customers', value: '612', delta: 3.6 },
  { label: 'Refund rate', value: '1.8%', delta: -0.4 },
];

export interface RevennuePoint {
  month: string;
  revenue: number;
}

export const revenueSeries: RevennuePoint[] = [
  { month: 'Jan', revenue: 28400 },
  { month: 'Feb', revenue: 31200 },
  { month: 'Mar', revenue: 29800 },
  { month: 'Apr', revenue: 36100 },
  { month: 'May', revenue: 42300 },
  { month: 'Jun', revenue: 48290 },
];
