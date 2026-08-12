'use client';

import { ExceptionPicker } from '@/components/general/ExceptionPicker';

export default function ExceptionsIndexPage() {
  return (
    <ExceptionPicker
      title='Resolution workbench'
      subtitle='Pick an exception to see why it happened, what can be done about it, and what each fix would cost.'
      hrefFor={(row) => `/exceptions/${encodeURIComponent(row.id)}`}
    />
  );
}
