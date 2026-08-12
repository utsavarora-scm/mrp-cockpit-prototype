'use client';

import { ExceptionPicker } from '@/components/general/ExceptionPicker';

export default function BlastIndexPage() {
  return (
    <ExceptionPicker
      title='Blast radius'
      subtitle='Pick an exception to trace it upward — through the finished goods that consume the material, to the customer orders behind them. Only exceptions with pegged finished goods are listed.'
      hrefFor={(row) => `/blast/${encodeURIComponent(row.id)}`}
      filter={(row) => row.peggedFgCount > 0}
    />
  );
}
