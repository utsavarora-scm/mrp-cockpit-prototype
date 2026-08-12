'use client';

/**
 * S4 — the blast radius.
 *
 * One raw material, fanning out through the finished goods that consume it to
 * the customer orders behind them. Node size is money at risk. This is the
 * picture none of SAP, Kinaxis or o9 draws, because none of them holds all three
 * levels at once.
 */

import '@xyflow/react/dist/style.css';

import { formatCurrency, formatDateShort, formatNumber, formatQty } from '@repo/domain';
import { Badge } from '@repo/ui/components/badge';
import { Button } from '@repo/ui/components/button';
import { Skeleton } from '@repo/ui/components/skeleton';
import { cn } from '@repo/ui/lib/utils';
import { Background, Controls, type Edge, type Node, ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';

import type { BlastRadius, BlastRadiusNode } from '@/lib/api-types';

export default function BlastRadiusPage() {
  const params = useParams<{ exceptionId: string }>();
  const exceptionId = decodeURIComponent(params.exceptionId);

  const radius = useQuery({
    queryKey: ['blast', exceptionId],
    queryFn: async (): Promise<BlastRadius> => {
      const response = await fetch(`/api/blast/${encodeURIComponent(exceptionId)}`);
      if (!response.ok) throw new Error((await response.json()).error ?? 'The blast radius could not be traced.');
      return response.json();
    },
  });

  if (radius.isLoading) {
    return (
      <div className='flex gap-2 p-4'>
        <Skeleton className='h-[70svh] flex-1' />
        <Skeleton className='h-[70svh] w-80' />
      </div>
    );
  }

  if (radius.isError || !radius.data) {
    return (
      <div className='flex h-96 flex-col items-center justify-center gap-2 text-[13px]'>
        <span className='font-medium'>{radius.error?.message ?? 'The blast radius could not be traced.'}</span>
        <Button asChild variant='outline' size='sm'>
          <Link href='/'>Back to the cockpit</Link>
        </Button>
      </div>
    );
  }

  const data = radius.data;

  return (
    <div className='flex h-[calc(100svh-3rem)] flex-col'>
      <div className='flex items-center gap-3 border-b px-4 py-2'>
        <Button asChild variant='ghost' size='sm' className='h-6 gap-1 px-1.5 text-[11.5px]'>
          <Link href={`/exceptions/${encodeURIComponent(exceptionId)}`}>
            <ArrowLeft className='size-3.5' />
            Workbench
          </Link>
        </Button>
        <span className='mono text-[14px] font-semibold'>
          {data.rootItemId} @ {data.rootPlantId}
        </span>
        <span className='text-muted-foreground text-[13px]'>
          reaches {formatNumber(data.finishedGoodsCount)} finished goods and {formatNumber(data.committedOrderCount)}{' '}
          committed order{data.committedOrderCount === 1 ? '' : 's'}
        </span>
        <div className='ml-auto flex items-center gap-4 text-[12px]'>
          <span className='text-muted-foreground'>
            Demand at risk{' '}
            <span className='mono text-foreground text-[14px] font-semibold'>
              {formatCurrency(data.totalValueAtRisk)}
            </span>
          </span>
          <span className='text-muted-foreground'>
            Committed <span className='mono text-foreground font-semibold'>{formatCurrency(data.committedValue)}</span>
          </span>
          <span className='text-muted-foreground'>
            Forecast <span className='mono text-foreground font-semibold'>{formatCurrency(data.forecastValue)}</span>
          </span>
          <span className='text-muted-foreground'>
            Margin <span className='mono text-foreground font-semibold'>{formatCurrency(data.totalMarginAtRisk)}</span>
          </span>
          {data.keyAccountCount > 0 ? (
            <Badge variant='outline' className='h-5 text-[11px]'>
              {data.keyAccountCount} key account{data.keyAccountCount === 1 ? '' : 's'}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className='flex min-h-0 flex-1'>
        <div className='min-w-0 flex-1'>
          <ReactFlowProvider>
            <BlastGraph data={data} />
          </ReactFlowProvider>
        </div>

        <aside className='flex w-[344px] shrink-0 flex-col border-l'>
          <div className='bg-muted/40 border-b px-3 py-1.5'>
            <div className='text-[11px] font-medium tracking-wide uppercase'>Demand behind this material</div>
            <div className='text-muted-foreground text-[10.5px]'>
              Committed orders first, then forecast — ranked by value
            </div>
          </div>
          {data.orders.length === 0 ? (
            <p className='text-muted-foreground px-3 py-3 text-[12px]'>
              Nothing downstream pegs to this item in the horizon.
            </p>
          ) : (
            <div className='flex-1 divide-y overflow-auto'>
              {data.orders.map((order) => (
                <div key={order.id} className='px-3 py-2'>
                  <div className='flex items-baseline justify-between gap-2'>
                    <span className='truncate text-[12.5px] font-medium'>{order.customerName}</span>
                    <span className='mono shrink-0 text-[12.5px] font-semibold'>{formatCurrency(order.value)}</span>
                  </div>
                  <div className='text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[11px]'>
                    {order.channel ? (
                      <Badge variant='outline' className='mono h-4 px-1 text-[9.5px] font-normal'>
                        {order.channel}
                      </Badge>
                    ) : null}
                    {order.isKeyAccount ? (
                      <Badge className='h-4 px-1 text-[9.5px] font-normal'>key account</Badge>
                    ) : null}
                    {order.kind === 'FORECAST' ? (
                      <Badge variant='secondary' className='h-4 px-1 text-[9.5px] font-normal'>
                        forecast
                      </Badge>
                    ) : null}
                    <span className='mono'>{formatDateShort(order.requiredDate)}</span>
                  </div>
                  <div className='text-muted-foreground mt-0.5 truncate text-[11px]'>
                    <span className='mono'>{order.itemId}</span> · {order.itemDescription}
                  </div>
                  <div className='text-muted-foreground mt-0.5 text-[11px]'>
                    <span className='mono'>{formatQty(order.qty)}</span> units · margin{' '}
                    <span className='mono'>{formatCurrency(order.marginValue)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/**
 * Layered layout rather than a force simulation: the levels mean something
 * (component → finished good → order), and a deterministic position is worth
 * more in a demo than an organic-looking one that lands differently every time.
 */
function BlastGraph({ data }: { data: BlastRadius }) {
  const { nodes, edges } = useMemo(() => {
    const byLevel = new Map<number, BlastRadiusNode[]>();
    for (const node of data.nodes) {
      const bucket = byLevel.get(node.level);
      if (bucket) bucket.push(node);
      else byLevel.set(node.level, [node]);
    }

    const maxValue = Math.max(...data.nodes.map((node) => node.valueAtRisk), 1);
    const columnWidth = 320;
    const rowHeight = 62;

    const flowNodes: Node[] = [];
    for (const [level, levelNodes] of byLevel) {
      levelNodes.sort((a, b) => b.valueAtRisk - a.valueAtRisk);
      const totalHeight = levelNodes.length * rowHeight;
      levelNodes.forEach((node, index) => {
        const scale = 0.72 + (node.valueAtRisk / maxValue) * 0.6;
        flowNodes.push({
          id: node.id,
          position: { x: level * columnWidth, y: index * rowHeight - totalHeight / 2 },
          data: { label: <NodeCard node={node} /> },
          type: 'default',
          draggable: true,
          style: {
            width: 240 * Math.min(scale, 1.15),
            padding: 0,
            border: 'none',
            background: 'transparent',
            boxShadow: 'none',
          },
        });
      });
    }

    const flowEdges: Edge[] = data.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      animated: false,
      style: {
        stroke: 'var(--muted-foreground)',
        strokeOpacity: 0.35,
        strokeWidth: Math.min(4, 0.5 + Math.log10(Math.max(edge.qty, 1))),
      },
    }));

    return { nodes: flowNodes, edges: flowEdges };
  }, [data]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.2}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      edgesFocusable={false}
    >
      <Background gap={22} size={1} color='var(--border)' />
      <Controls showInteractive={false} className='!bottom-3 !left-3' />
    </ReactFlow>
  );
}

function NodeCard({ node }: { node: BlastRadiusNode }) {
  return (
    <div
      className={cn(
        'bg-card rounded-[5px] border px-2 py-1.5 text-left shadow-sm',
        node.kind === 'COMPONENT' && 'border-destructive/50 bg-destructive/8',
        node.kind === 'FINISHED' && 'border-primary/40',
      )}
    >
      <div className='flex items-baseline justify-between gap-2'>
        <span className='mono truncate text-[11.5px] font-semibold'>{node.label}</span>
        <span className='mono shrink-0 text-[11px]'>{formatCurrency(node.valueAtRisk)}</span>
      </div>
      <div className='text-muted-foreground truncate text-[10.5px]'>{node.sublabel}</div>
    </div>
  );
}
