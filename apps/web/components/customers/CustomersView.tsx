'use client';

import { Badge } from '@repo/ui/components/badge';
import { Card, CardContent } from '@repo/ui/components/card';
import { Input } from '@repo/ui/components/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/table';
import { Search, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import EmptyMessage from '@/components/general/EmptyMessage';
import { AddCustomerDialog } from '@/components/customers/AddCustomerDialog';
import { type Customer, type CustomerStatus, customers as seed } from '@/lib/mock-data/customers';
import { localStore } from '@/lib/mock';
import { getInitials } from '@/utils';

const STATUS_VARIANT: Record<CustomerStatus, 'default' | 'secondary' | 'outline'> = {
  active: 'default',
  invited: 'secondary',
  churned: 'outline',
};

const STORE_KEY = 'prototype.customers';

export function CustomersView() {
  const [list, setList] = useState<Customer[]>(seed);
  const [query, setQuery] = useState('');

  // Load any customers added in a previous session. localStorage is a
  // client-only external store, so we hydrate from it after mount (SSR-safe).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from an external (localStorage) store on mount
    setList(localStore.get<Customer[]>(STORE_KEY, seed));
  }, []);

  const addCustomer = (customer: Customer) => {
    setList((prev) => {
      const next = [customer, ...prev];
      localStore.set(STORE_KEY, next);
      return next;
    });
    toast.success(`${customer.name} added`);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.company.toLowerCase().includes(q),
    );
  }, [list, query]);

  return (
    <div className='space-y-4'>
      <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <div className='relative w-full sm:max-w-xs'>
          <Search className='text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2' />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search customers…'
            className='pl-9'
          />
        </div>
        <AddCustomerDialog onAdd={addCustomer} />
      </div>

      <Card>
        <CardContent className='p-0'>
          {filtered.length === 0 ? (
            <EmptyMessage
              icon={<Users className='text-muted-foreground size-8' />}
              message='No customers found'
              description='Try a different search, or add a new customer.'
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='text-right'>Lifetime spend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className='flex items-center gap-3'>
                        <div className='bg-muted flex size-8 items-center justify-center rounded-full text-xs font-medium'>
                          {getInitials(c.name)}
                        </div>
                        <div>
                          <div className='font-medium'>{c.name}</div>
                          <div className='text-muted-foreground text-xs'>{c.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{c.company}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[c.status]} className='capitalize'>
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-right font-medium'>
                      {new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        maximumFractionDigits: 0,
                      }).format(c.spend)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
