'use client';

import { Badge } from '@repo/ui/components/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/card';
import { Skeleton } from '@repo/ui/components/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/table';
import { useQuery } from '@tanstack/react-query';
import { type Order, type OrderStatus, orders } from '@/lib/mock-data/orders';
import { fakeLatency } from '@/lib/mock';

const usd = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);

const STATUS_VARIANT: Record<OrderStatus, 'default' | 'secondary' | 'destructive'> = {
  paid: 'default',
  pending: 'secondary',
  refunded: 'destructive',
};

export function RecentOrders() {
  const { data, isLoading } = useQuery({
    queryKey: ['recent-orders'],
    queryFn: () => fakeLatency<Order[]>(orders, 900),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent orders</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <div className='space-y-3'>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className='h-10 w-full' />
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className='text-right'>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className='font-medium'>{order.id}</TableCell>
                  <TableCell>
                    <div className='font-medium'>{order.customer}</div>
                    <div className='text-muted-foreground text-xs'>{order.email}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[order.status]} className='capitalize'>
                      {order.status}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-right font-medium'>{usd(order.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
