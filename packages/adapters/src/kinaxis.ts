/**
 * Kinaxis Maestro / RapidResponse adapter.
 *
 * Reads through the REST APIs, with Bulk Data Services for the large loads.
 * The RapidResponse constructs — resources, control sets, worksheets, scenarios,
 * versioning — are preserved across the boundary rather than flattened away.
 *
 * Writeback lands in a **named scenario**, never the live plan. That distinction
 * matters: it is how Kinaxis is actually governed, and saying so out loud is
 * what signals we understand the tool rather than just its API surface.
 */

import type {
  BomLine,
  Item,
  ItemPlant,
  SnapshotMutation,
  StockPosition,
  SupplyElement,
  SystemSnapshot,
  WritebackPayload,
} from '@repo/domain';

import type { AdapterHealth, AdapterSource, EndpointDescriptor, SystemOfRecordAdapter } from './types';
import { simulatedLatency } from './latency';

/** The named scenario every writeback is staged into. Never the live plan. */
export const KINAXIS_TARGET_SCENARIO = 'Exception Cockpit :: Proposed';

/** RapidResponse query responses come back as a column spec plus rows. */
interface RapidResponseQueryResult {
  Columns: Array<{ Name: string; Type: string }>;
  Rows: Array<{ Values: string[] }>;
  Total: number;
}

export const KINAXIS_ENDPOINTS: EndpointDescriptor[] = [
  {
    name: 'Data Query',
    method: 'POST',
    path: '/rest/v1/data/query',
    purpose: 'Read Part, PartSource and PartCustomer records from a control set',
    direction: 'READ',
    recordVolume: 96_430,
  },
  {
    name: 'Data Query',
    method: 'POST',
    path: '/rest/v1/data/query — IndependentDemand',
    purpose: 'Read the demand the supply plan is actually built on',
    direction: 'READ',
    recordVolume: 212_600,
  },
  {
    name: 'Data Query',
    method: 'POST',
    path: '/rest/v1/data/query — SupplyOrder / OnHand',
    purpose: 'Read planned orders and on-hand position by part and site',
    direction: 'READ',
    recordVolume: 148_900,
    notes: 'On-hand here is what the supply plan believes. Reconciling it against SAP is where C2 comes from.',
  },
  {
    name: 'Bulk Data Services',
    method: 'POST',
    path: '/integration/V1/bulk/upload',
    purpose: 'Bulk load above roughly 200k records, where the query API is the wrong tool',
    direction: 'READ',
    recordVolume: 0,
  },
  {
    name: 'Scenario',
    method: 'GET',
    path: '/rest/v1/scenario',
    purpose: 'List scenarios and resolve the target for staged changes',
    direction: 'READ',
    recordVolume: 40,
  },
  {
    name: 'Scenario Data',
    method: 'POST',
    path: '/rest/v1/scenario/{scenario}/data/IndependentDemand',
    purpose: 'Stage a committed resolution into a named scenario',
    direction: 'WRITE',
    recordVolume: 0,
    notes: 'Never the live plan. A planner promotes the scenario, or discards it.',
  },
  {
    name: 'Scenario Data',
    method: 'POST',
    path: '/rest/v1/scenario/{scenario}/data/PartSource',
    purpose: 'Stage a corrected lead time or sourcing change',
    direction: 'WRITE',
    recordVolume: 0,
  },
];

export function createMockKinaxisAdapter(source: AdapterSource): SystemOfRecordAdapter {
  const snapshotFor = () => source.snapshot.systemSnapshots.find((entry) => entry.system === 'KINAXIS');

  /** Shapes item-plant data the way a RapidResponse query returns it. */
  const asPartSourceQuery = (): RapidResponseQueryResult => {
    const params = snapshotFor()?.itemPlantParams ?? [];
    return {
      Columns: [
        { Name: 'Part.Name', Type: 'String' },
        { Name: 'Part.Site', Type: 'String' },
        { Name: 'LeadTime', Type: 'Integer' },
        { Name: 'SafetyStock', Type: 'Quantity' },
        { Name: 'LotSizeRule', Type: 'String' },
      ],
      Rows: params.map((row) => ({
        Values: [
          row.itemId,
          row.plantId,
          String(row.leadTimeDays ?? ''),
          String(row.safetyStock ?? ''),
          row.lotSizeRule ?? '',
        ],
      })),
      Total: params.length,
    };
  };

  return {
    system: 'KINAXIS',
    label: 'Kinaxis Maestro (RapidResponse)',
    isMock: true,
    protocol: 'REST + Bulk Data Services · scenario-scoped writeback',
    endpoints: KINAXIS_ENDPOINTS,
    coreImpact: `Zero modifications. Reads via control sets; every write is staged into the named scenario "${KINAXIS_TARGET_SCENARIO}" and never touches the live plan.`,

    async fetchItems(): Promise<Item[]> {
      await simulatedLatency('KINAXIS', 'items');
      return source.snapshot.items;
    },

    async fetchItemPlants(): Promise<ItemPlant[]> {
      await simulatedLatency('KINAXIS', 'itemPlants');
      // Kinaxis holds its own copy of the planning parameters, which is exactly
      // why they can disagree with SAP. Return that copy, not the domain record.
      const query = asPartSourceQuery();
      const byKey = new Map(source.snapshot.itemPlants.map((record) => [`${record.itemId}@${record.plantId}`, record]));
      return query.Rows.map((row) => {
        const [itemId, plantId, leadTime, safetyStock, lotSizeRule] = row.Values as [
          string,
          string,
          string,
          string,
          string,
        ];
        const base = byKey.get(`${itemId}@${plantId}`);
        if (!base) return null;
        return {
          ...base,
          leadTimeDays: leadTime === '' ? null : Number(leadTime),
          safetyStock: safetyStock === '' ? null : Number(safetyStock),
          lotSizeRule: (lotSizeRule || null) as ItemPlant['lotSizeRule'],
        } satisfies ItemPlant;
      }).filter((record): record is ItemPlant => Boolean(record));
    },

    async fetchBoms(): Promise<BomLine[]> {
      await simulatedLatency('KINAXIS', 'boms');
      return source.snapshot.boms;
    },

    async fetchStock(): Promise<StockPosition[]> {
      await simulatedLatency('KINAXIS', 'stock');
      // Kinaxis models a single on-hand figure; the blocked and inspection
      // split simply is not there, which is the usual cause of C2.
      const onHand = snapshotFor()?.onHand ?? [];
      return onHand.map((row) => ({
        itemId: row.itemId,
        plantId: row.plantId,
        unrestricted: row.qty,
        blocked: 0,
        qualityInspection: 0,
        inTransit: 0,
        batches: [],
      }));
    },

    async fetchSupply(): Promise<SupplyElement[]> {
      await simulatedLatency('KINAXIS', 'supply');
      return source.snapshot.supply.filter((element) => element.sourceSystem === 'KINAXIS');
    },

    async fetchSnapshot(): Promise<SystemSnapshot> {
      await simulatedLatency('KINAXIS', 'snapshot');
      const snapshot = snapshotFor();
      if (!snapshot) throw new Error('Kinaxis snapshot missing from the data pack');
      return snapshot;
    },

    async proposeWriteback(mutation: SnapshotMutation): Promise<WritebackPayload | null> {
      return buildKinaxisWriteback(mutation);
    },

    async healthCheck(): Promise<AdapterHealth> {
      const snapshot = snapshotFor();
      return {
        ok: true,
        lastSyncAt: snapshot?.lastSyncAt ?? `${source.planningDate}T02:10:00Z`,
        latencyMs: 386,
        recordCount: snapshot?.recordCount ?? 0,
        syncCadenceHours: 12,
      };
    },
  };
}

export function buildKinaxisWriteback(mutation: SnapshotMutation): WritebackPayload | null {
  const scenario = encodeURIComponent(KINAXIS_TARGET_SCENARIO);

  switch (mutation.kind) {
    case 'SET_ITEM_PLANT_PARAM':
    case 'SET_LOT_SIZE_RULE':
      return {
        system: 'KINAXIS',
        method: 'POST',
        endpoint: `/rest/v1/scenario/${scenario}/data/PartSource`,
        description: 'Stage the corrected planning parameter into the named scenario',
        body: {
          Scenario: { Name: KINAXIS_TARGET_SCENARIO, Scope: 'Public' },
          Fields:
            mutation.kind === 'SET_LOT_SIZE_RULE'
              ? ['Part.Name', 'Part.Site', 'LotSizeRule']
              : ['Part.Name', 'Part.Site', kinaxisFieldFor(mutation.field)],
          Rows: [
            {
              Values:
                mutation.kind === 'SET_LOT_SIZE_RULE'
                  ? [mutation.itemId, mutation.plantId, mutation.value]
                  : [mutation.itemId, mutation.plantId, mutation.value === null ? '' : String(mutation.value)],
            },
          ],
        },
      };

    case 'SWITCH_VENDOR':
      return {
        system: 'KINAXIS',
        method: 'POST',
        endpoint: `/rest/v1/scenario/${scenario}/data/PartSource`,
        description: 'Stage the sourcing switch into the named scenario',
        body: {
          Scenario: { Name: KINAXIS_TARGET_SCENARIO, Scope: 'Public' },
          Fields: ['Part.Name', 'Part.Site', 'Source.Name', 'IsPrimarySource'],
          Rows: [{ Values: [mutation.itemId, mutation.plantId, mutation.vendorId, 'true'] }],
        },
      };

    case 'INVENTORY_REBALANCE':
      return {
        system: 'KINAXIS',
        method: 'POST',
        endpoint: `/rest/v1/scenario/${scenario}/data/IndependentDemand`,
        description: 'Stage the inter-site transfer so the supply plan sees both sides of it',
        body: {
          Scenario: { Name: KINAXIS_TARGET_SCENARIO, Scope: 'Public' },
          Fields: ['Part.Name', 'Part.Site', 'DueDate', 'Quantity', 'Type'],
          Rows: [
            { Values: [mutation.itemId, mutation.toPlantId, mutation.arrivalDate, String(mutation.qty), 'Transfer'] },
            {
              Values: [mutation.itemId, mutation.fromPlantId, mutation.arrivalDate, String(-mutation.qty), 'Transfer'],
            },
          ],
        },
      };

    case 'RESCHEDULE_SUPPLY':
    case 'EXPEDITE_SUPPLY':
      return {
        system: 'KINAXIS',
        method: 'POST',
        endpoint: `/rest/v1/scenario/${scenario}/data/SupplyOrder`,
        description: 'Stage the revised receipt date into the named scenario',
        body: {
          Scenario: { Name: KINAXIS_TARGET_SCENARIO, Scope: 'Public' },
          Fields: ['Order.Name', 'DueDate'],
          Rows: [{ Values: [mutation.supplyElementId, mutation.newDueDate] }],
        },
      };

    default:
      return null;
  }
}

function kinaxisFieldFor(field: string): string {
  const map: Record<string, string> = {
    leadTimeDays: 'LeadTime',
    safetyStock: 'SafetyStock',
    safetyTimeDays: 'SafetyLeadTime',
    fixedLotSize: 'OrderMultiple',
    minLotSize: 'OrderMinimum',
    maxLotSize: 'OrderMaximum',
    periodsOfSupplyDays: 'DaysOfSupply',
    reorderPoint: 'ReorderPoint',
  };
  return map[field] ?? field;
}
