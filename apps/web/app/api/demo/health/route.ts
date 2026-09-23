/**
 * Whether this server can hold a shared demo.
 *
 * The session is one per process and the decision log is one file on its disk.
 * That is exactly right for a single long-running server, and wrong the moment
 * requests are spread across instances or the disk is read-only: decisions
 * then fail to save, or save on one instance and are missing on the next.
 *
 * Open this on the shared address before handing it over. `writable` must be
 * true, and `instance` must stay the same across a few reloads — a changing
 * value means requests are landing on different processes, each with its own
 * session.
 */

import { NextResponse } from 'next/server';

import { logStatus } from '@/lib/server/event-log';
import { decisionLog } from '@/lib/server/planning-session';

export const dynamic = 'force-dynamic';

const STARTED_AT = new Date().toISOString();

export async function GET() {
  const log = logStatus();
  return NextResponse.json({
    writable: log.writable,
    logPath: log.path,
    eventsOnDisk: log.events,
    decisionsInSession: decisionLog().length,
    instance: `${process.pid}@${STARTED_AT}`,
    detail: log.detail,
  });
}
