/**
 * Supply confidence — the structural answer to "assumptions that give you a
 * rosy picture".
 *
 * Every supply element carries a tier and the tier is always visible, because
 * a planned receipt that reads like a confirmed one is not a display problem,
 * it is a wrong plan. Two rules follow and neither is negotiable:
 *
 *   - A safety-stock breach avoided only by a Tier 3 receipt is still a breach.
 *   - A breach avoided only by a Tier 2 receipt is raised as *supply
 *     unconfirmed*, naming the line, the vendor and the quantity at risk.
 *
 * Those rules live in the exception engine; the classification lives here so
 * one definition serves the chart, the grid, the timeline and the queue.
 */

import type { DeliveryLine, DeliveryStatus } from './transactional';

/** 1 = confirmed, 2 = committed, 3 = planned. Lower is more certain. */
export type SupplyTier = 1 | 2 | 3;

export interface TierMeta {
  tier: SupplyTier;
  /** The word. Colour never carries meaning alone. */
  label: string;
  /** How the chart draws it. */
  fill: 'SOLID' | 'OUTLINE' | 'HATCHED';
  description: string;
}

export const TIERS: Record<SupplyTier, TierMeta> = {
  1: {
    tier: 1,
    label: 'Confirmed',
    fill: 'SOLID',
    description: 'The vendor has acknowledged this line, date and quantity — or has already dispatched against it.',
  },
  2: {
    tier: 2,
    label: 'Committed',
    fill: 'OUTLINE',
    description: 'A purchase order schedule line exists. Nobody has acknowledged it.',
  },
  3: {
    tier: 3,
    label: 'Planned',
    fill: 'HATCHED',
    description: 'The system is proposing this. Nothing has been ordered.',
  },
};

/**
 * The tier of one delivery line.
 *
 * A vendor acknowledgement or anything further down the pipeline is Tier 1; a
 * line that exists on a purchase order with no acknowledgement behind it is
 * Tier 2. Nothing on a placed order is ever Tier 3 — that tier belongs to the
 * engine's own proposals, which have no line to carry it.
 */
export function tierOfLine(line: Pick<DeliveryLine, 'status' | 'confirmedDate'>): SupplyTier {
  if (line.status === 'RECEIVED' || line.status === 'IN_TRANSIT') return 1;
  if (line.confirmedDate !== null) return 1;
  return 2;
}

/** Where along the inbound pipeline a line has got. Ordered, and shown in order. */
export const PIPELINE_STAGES = [
  'PO created',
  'Vendor acknowledged',
  'Dispatched',
  'In transit',
  'Received (GRN)',
  'QA released',
  'Available',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export function pipelineStageOf(line: Pick<DeliveryLine, 'status' | 'confirmedDate'>): PipelineStage {
  switch (line.status) {
    case 'RECEIVED':
      return 'Received (GRN)';
    case 'IN_TRANSIT':
      return 'In transit';
    case 'DELAYED':
    case 'CONFIRMED':
      return 'Vendor acknowledged';
    default:
      return line.confirmedDate === null ? 'PO created' : 'Vendor acknowledged';
  }
}

/**
 * Why a schedule line moved, or why a receipt deviated.
 *
 * Short, closed and set with planners rather than for them — a long list is
 * left blank and a free-text-only field cannot be counted. Free text sits
 * alongside it, never instead of it.
 */
export const REASON_CODES = [
  { code: 'VESSEL_ROLL', label: 'Vessel roll at transhipment', owner: 'Logistics' },
  { code: 'PORT_CONGESTION', label: 'Port congestion or customs hold', owner: 'Logistics' },
  { code: 'VENDOR_CAPACITY', label: 'Vendor capacity shortfall', owner: 'Vendor' },
  { code: 'VENDOR_SHUTDOWN', label: 'Vendor plant shutdown', owner: 'Vendor' },
  { code: 'QUALITY_HOLD', label: 'Quality hold or COA failure', owner: 'Plant / QC' },
  { code: 'WAREHOUSE_FULL', label: 'No space to receive', owner: 'Plant' },
  { code: 'PO_RAISED_LATE', label: 'Purchase order released late', owner: 'Sourcing' },
  { code: 'DEMAND_CHANGE', label: 'Requirement changed after the order', owner: 'Planning' },
  { code: 'PLANNER_PULL_IN', label: 'Planner pulled the line in', owner: 'Planning' },
  { code: 'PLANNER_PUSH_OUT', label: 'Planner pushed the line out', owner: 'Planning' },
] as const;

export type ReasonCode = (typeof REASON_CODES)[number]['code'];

export function reasonLabel(code: string | null): string | null {
  if (code === null) return null;
  return REASON_CODES.find((row) => row.code === code)?.label ?? code;
}

/** The four owners a total lead time decomposes across. */
export const INTERVAL_OWNERS = {
  response: 'Sourcing',
  readiness: 'Vendor',
  transit: 'Logistics',
  release: 'Plant / QC',
} as const;
