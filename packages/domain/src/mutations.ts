/**
 * A planner override, expressed as a mutation against a cloned snapshot rather
 * than as free text. Recording the change this way is what lets an override be
 * replayed, reversed, and written back as a concrete payload.
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
        // Quality inspection is a planning parameter like any other, and the
        // simulate dialog has offered it for as long as it has existed — forced
        // through a cast because this union had never been told.
        | 'qaQuarantineDays'
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
  | { kind: 'SET_NORM'; itemId: string; plantId: string; orderDays: number; stockDays: number };
