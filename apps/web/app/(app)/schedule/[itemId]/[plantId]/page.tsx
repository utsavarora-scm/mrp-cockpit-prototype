'use client';

/**
 * Screen 3 — the supply timeline and the purchase-order schedule builder.
 *
 * Two halves. Above, the inbound timeline: every open order, every schedule
 * line, the stage it has reached and the slip against what was asked for.
 * Below, the builder: the ideal schedule beside the committable one, a ledger
 * attributing every unit of difference to a named constraint, and a committed
 * column the planner can change.
 *
 * This file is the wiring. The two halves, the line editor and the prepare
 * dialog are their own components, because the moment the builder became
 * editable this was going to be a thousand lines of one file otherwise.
 */

import { formatNumber } from '@repo/domain';
import { Skeleton } from '@repo/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import type { DeliveryLineView, SchedulePayloadView, ScheduleBuilderView, ScheduleLineView } from '@/lib/api-types';
import { DeliveryLedger } from '@/components/schedule/DeliveryLedger';
import { InboundTimeline } from '@/components/schedule/InboundTimeline';
import { LineEditDialog, lineSummary, type LineEditSubmission } from '@/components/schedule/LineEditDialog';
import { PrepareScheduleDialog } from '@/components/schedule/PrepareScheduleDialog';
import { CaptureDialog } from '@/components/adherence/CaptureDialog';

type Editing =
  | { kind: 'inbound'; line: DeliveryLineView }
  | { kind: 'capture'; line: DeliveryLineView }
  | { kind: 'proposed'; line: ScheduleLineView }
  | { kind: 'prepare' }
  | null;

export default function SchedulePage() {
  const params = useParams<{ itemId: string; plantId: string }>();
  const itemId = decodeURIComponent(params.itemId);
  const plantId = decodeURIComponent(params.plantId);
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<Editing>(null);
  const [payload, setPayload] = useState<SchedulePayloadView | null>(null);

  const endpoint = `/api/schedule/${encodeURIComponent(itemId)}/${encodeURIComponent(plantId)}`;

  const query = useQuery({
    queryKey: ['schedule', itemId, plantId],
    queryFn: async (): Promise<ScheduleBuilderView> => {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error('That schedule could not be built.');
      return response.json();
    },
  });

  const post = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'That change was not recorded.');
      return json;
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!query.data) {
    return (
      <Shell>
        <Skeleton className='h-8 w-96' />
        <Skeleton className='mt-6 h-[240px] rounded-lg' />
        <Skeleton className='mt-6 h-[420px] rounded-lg' />
      </Shell>
    );
  }

  const view = query.data;

  const close = (): void => {
    setEditing(null);
    setPayload(null);
  };

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries();
  };

  const moveLine = (line: DeliveryLineView, submission: LineEditSubmission): void => {
    post.mutate(
      {
        action: 'move',
        orderId: line.orderId,
        line: line.line,
        qty: submission.qty,
        date: submission.date ?? line.expectedDate,
        reasonCode: submission.reasonCode,
        note: submission.note,
        before: lineSummary(line.qty, view.baseUom, line.expectedDate),
      },
      {
        onSuccess: async () => {
          await refresh();
          toast.success('Schedule line updated', {
            description:
              'Recorded with its reason. The vendor has not agreed to the new date until they acknowledge it.',
          });
          close();
        },
      },
    );
  };

  const setProposedLine = (line: ScheduleLineView, submission: LineEditSubmission): void => {
    post.mutate(
      {
        action: 'line',
        line: line.line,
        qty: submission.qty,
        reasonCode: submission.reasonCode,
        note: submission.note,
      },
      {
        onSuccess: async () => {
          await refresh();
          toast.success(
            submission.qty === null ? `Line ${line.line} handed back to the engine` : `Line ${line.line} set by hand`,
            {
              description:
                submission.qty === null
                  ? 'The schedule is the engine’s again from here.'
                  : 'The ledger has re-attributed. Anything your quantity breaks is named against the line.',
            },
          );
          close();
        },
      },
    );
  };

  const prepare = (input: { acknowledge: boolean; reasonCode: string | null; note: string }): void => {
    post.mutate(
      { action: 'export', ...input },
      {
        onSuccess: async (result: SchedulePayloadView) => {
          await refresh();
          setPayload(result);
          toast.success('Schedule prepared', { description: 'Nothing was transmitted. The decision is recorded.' });
        },
      },
    );
  };

  return (
    <Shell>
      <Link
        href={`/material/${encodeURIComponent(itemId)}/${encodeURIComponent(plantId)}`}
        className='text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-[12px]'
      >
        <ArrowLeft className='size-3.5' />
        {itemId}
      </Link>

      <header className='mb-5'>
        <h1 className='text-[20px] font-semibold tracking-tight'>Delivery schedule — {view.description}</h1>
        <p className='text-muted-foreground mt-1 text-[13px]'>
          {view.itemId} · {view.plantId} · {view.vendorName ?? view.vendorId ?? 'no approved source'} ·{' '}
          {view.window.fromWeek} to {view.window.toWeek} ({view.window.days} days) · {view.window.reason}
        </p>
      </header>

      <InboundTimeline
        view={view}
        onEdit={(line) => setEditing({ kind: 'inbound', line })}
        onCapture={(line) => setEditing({ kind: 'capture', line })}
      />

      <DeliveryLedger
        view={view}
        onEditLine={(line) => setEditing({ kind: 'proposed', line })}
        onPrepare={() => setEditing({ kind: 'prepare' })}
      />

      {editing?.kind === 'inbound' ? (
        <LineEditDialog
          title={`${editing.line.orderId} · line ${editing.line.line}`}
          standfirst={
            <>
              Currently {lineSummary(editing.line.qty, view.baseUom, editing.line.expectedDate)}, requested for{' '}
              {editing.line.requestedDate}.
            </>
          }
          uom={view.baseUom}
          initialQty={editing.line.qty}
          initialDate={editing.line.expectedDate}
          defaultReason='PLANNER_PULL_IN'
          allowClear={false}
          pending={post.isPending}
          footnote='Moving a line clears the vendor’s acknowledgement. Asking for a new date is not the same as being given one, and the plan will treat it as unconfirmed until they say otherwise.'
          onSubmit={(submission) => moveLine((editing as { line: DeliveryLineView }).line, submission)}
          onClose={close}
        />
      ) : null}

      {editing?.kind === 'proposed' ? (
        <LineEditDialog
          title={`Proposed line ${editing.line.line} · ${editing.line.week}`}
          standfirst={
            <>
              The plan wants {formatNumber(editing.line.idealQty)} {view.baseUom} here and can commit{' '}
              {formatNumber(editing.line.committedQty)}. Set your own quantity and the ledger re-attributes around it.
            </>
          }
          uom={view.baseUom}
          initialQty={editing.line.committedQty}
          defaultReason='PLANNER_PULL_IN'
          allowClear
          pending={post.isPending}
          footnote='Your quantity is left exactly as you type it. Where it breaks a constraint the constraint is named against this line, and where the engine would do something different elsewhere it says so rather than doing it.'
          onSubmit={(submission) => setProposedLine((editing as { line: ScheduleLineView }).line, submission)}
          onClose={close}
        />
      ) : null}

      {editing?.kind === 'capture' ? (
        <CaptureDialog
          target={{
            itemId,
            plantId,
            orderId: editing.line.orderId,
            line: editing.line.line,
            baseUom: view.baseUom,
            requestedDate: editing.line.requestedDate,
            confirmedDate: editing.line.committedDate,
            grnDate: editing.line.grnDate,
            grnQty: editing.line.grnQty,
            qaReleasedOn: editing.line.qaReleasedOn,
            reasonCode: editing.line.reasonCode,
          }}
          onClose={close}
        />
      ) : null}

      {editing?.kind === 'prepare' ? (
        <PrepareScheduleDialog
          view={view}
          pending={post.isPending}
          payload={payload}
          onPrepare={prepare}
          onClose={close}
        />
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className='mx-auto max-w-[1680px] px-6 py-6'>{children}</div>;
}
