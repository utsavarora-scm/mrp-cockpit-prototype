/**
 * A resolution is never a text suggestion — it is a mutation applied to a cloned
 * snapshot, after which the engine re-runs and we diff the two plans. That is
 * what lets the workbench show both the problems a fix solves and the ones it
 * creates.
 */

import type { LotSizeRule } from './master-data';

export type SnapshotMutation =
  | {
      kind: 'SET_ITEM_PLANT_PARAM';
      itemId: string;
      plantId: string;
      /** Only planning-relevant numeric/enum fields may be set this way. */
      field:
        | 'leadTimeDays'
        | 'safetyStock'
        | 'fixedLotSize'
        | 'minLotSize'
        | 'maxLotSize'
        | 'roundingValue'
        | 'periodsOfSupplyDays'
        | 'reorderPoint'
        | 'safetyTimeDays'
        | 'grProcessingTimeDays'
        | 'scrapPct'
        | 'serviceLevelTarget';
      value: number | null;
    }
  | { kind: 'SET_LOT_SIZE_RULE'; itemId: string; plantId: string; value: LotSizeRule }
  | { kind: 'CREATE_ITEM_PLANT'; itemId: string; plantId: string; template: 'FROM_SIMILAR' | 'DEFAULT' }
  | { kind: 'RESCHEDULE_SUPPLY'; supplyElementId: string; newDueDate: string }
  | {
      /**
       * Move one delivery bucket of an order, rather than the order as a whole.
       *
       * Rescheduling the whole PO when only the second drop has slipped
       * overstates the problem by the quantity of every drop that is fine. The
       * order's own due date follows the latest line, so the engine keeps
       * netting against the date the last of it actually arrives.
       */
      kind: 'RESCHEDULE_DELIVERY_LINE';
      supplyElementId: string;
      line: number;
      newDate: string;
      newQty?: number;
      /** Set to record that the supplier has now committed to this line. */
      confirmed?: boolean;
    }
  | { kind: 'CANCEL_SUPPLY'; supplyElementId: string }
  | { kind: 'EXPEDITE_SUPPLY'; supplyElementId: string; newDueDate: string; premiumCost: number }
  | {
      kind: 'ADD_SUPPLY';
      itemId: string;
      plantId: string;
      qty: number;
      dueDate: string;
      vendorId: string | null;
      sourcePlantId: string | null;
    }
  | { kind: 'SWITCH_VENDOR'; itemId: string; plantId: string; vendorId: string }
  | {
      kind: 'SUBSTITUTE_COMPONENT';
      parentItemId: string;
      plantId: string;
      componentItemId: string;
      substituteItemId: string;
    }
  | { kind: 'SWITCH_ALTERNATE_BOM'; parentItemId: string; plantId: string; alternateBomId: string }
  | {
      kind: 'INVENTORY_REBALANCE';
      itemId: string;
      fromPlantId: string;
      toPlantId: string;
      qty: number;
      arrivalDate: string;
    }
  | { kind: 'REPRIORITISE_DEMAND'; demandElementId: string; newPriority: number }
  | { kind: 'ACCEPT_AND_MONITOR'; exceptionId: string };

export type ResolutionType =
  | 'EXPEDITE_EXISTING'
  | 'ALTERNATE_SOURCE'
  | 'SUBSTITUTE_COMPONENT'
  | 'ALTERNATE_BOM'
  | 'INVENTORY_REBALANCE'
  | 'RESCHEDULE_IN'
  | 'RESCHEDULE_OUT'
  | 'CANCEL_ORDER'
  | 'RELOT_SIZE'
  | 'DEMAND_REPRIORITISE'
  | 'FIX_MASTER_DATA'
  | 'ACCEPT_AND_MONITOR';

export type TargetSystem = 'SAP' | 'KINAXIS' | 'O9';

export interface Resolution {
  id: string;
  exceptionId: string;
  type: ResolutionType;
  label: string;
  /** Why this option exists, drawn from the same evidence as the exception. */
  rationale: string;
  mutations: SnapshotMutation[];
  estimatedCost: number;
  /** Δ fill rate, as a fraction. */
  estimatedServiceImpact: number;
  estimatedInventoryImpact: number;
  /** Working days before the fix takes effect. */
  leadTimeToEffect: number;
  /** 0–1. */
  confidence: number;
  writebackTargets: TargetSystem[];
}

/** What a writeback would send, if anything were actually sent. */
export interface WritebackPayload {
  system: TargetSystem;
  method: 'POST' | 'PATCH' | 'PUT';
  endpoint: string;
  description: string;
  body: unknown;
}
