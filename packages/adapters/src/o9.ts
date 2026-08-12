/**
 * o9 adapter.
 *
 * Demand and consensus plan reads from the platform's tenant API and
 * knowledge-graph export. o9 owns the demand side; nothing here writes a plan,
 * only a consensus override that a demand planner then accepts or rejects.
 *
 * This is the slowest-moving of the three feeds, and the one most often planned
 * against after it has gone out of date — which is where `C5-STALE-SYNC` comes
 * from.
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

export const O9_ENDPOINTS: EndpointDescriptor[] = [
  {
    name: 'Tenant API — Graph Query',
    method: 'POST',
    path: '/api/v1/graph/query',
    purpose: 'Read the consensus demand plan by item, site and week',
    direction: 'READ',
    recordVolume: 268_400,
  },
  {
    name: 'Tenant API — Measures',
    method: 'GET',
    path: '/api/v1/measures/ConsensusDemand',
    purpose: 'Read the agreed forecast measure, versioned by planning cycle',
    direction: 'READ',
    recordVolume: 268_400,
    notes: 'The version matters: a plan built on last cycle is a different plan.',
  },
  {
    name: 'Knowledge Graph Export',
    method: 'GET',
    path: '/api/v1/export/dimension/Item',
    purpose: 'Read the item dimension, including items SAP has never heard of',
    direction: 'READ',
    recordVolume: 44_100,
    notes: 'This is where absent items are found — demand exists here with no planning master downstream.',
  },
  {
    name: 'Tenant API — Measures',
    method: 'POST',
    path: '/api/v1/measures/ConsensusDemand/override',
    purpose: 'Propose a consensus override for a demand planner to accept',
    direction: 'WRITE',
    recordVolume: 0,
  },
];

export function createMockO9Adapter(source: AdapterSource): SystemOfRecordAdapter {
  const snapshotFor = () => source.snapshot.systemSnapshots.find((entry) => entry.system === 'O9');

  return {
    system: 'O9',
    label: 'o9 Solutions',
    isMock: true,
    protocol: 'Tenant API + knowledge-graph export · read-mostly',
    endpoints: O9_ENDPOINTS,
    coreImpact:
      'Zero modifications. Demand is read; the only write is a consensus override a demand planner must accept.',

    async fetchItems(): Promise<Item[]> {
      await simulatedLatency('O9', 'items');
      return source.snapshot.items;
    },

    async fetchItemPlants(): Promise<ItemPlant[]> {
      await simulatedLatency('O9', 'itemPlants');
      return source.snapshot.itemPlants;
    },

    async fetchBoms(): Promise<BomLine[]> {
      // o9 does not hold bills of material. Saying so is more useful than
      // returning an empty list and letting a caller assume it read nothing.
      return [];
    },

    async fetchStock(): Promise<StockPosition[]> {
      return [];
    },

    async fetchSupply(): Promise<SupplyElement[]> {
      return [];
    },

    async fetchSnapshot(): Promise<SystemSnapshot> {
      await simulatedLatency('O9', 'snapshot');
      const snapshot = snapshotFor();
      if (!snapshot) throw new Error('o9 snapshot missing from the data pack');
      return snapshot;
    },

    async proposeWriteback(mutation: SnapshotMutation): Promise<WritebackPayload | null> {
      if (mutation.kind !== 'REPRIORITISE_DEMAND') return null;
      return {
        system: 'O9',
        method: 'POST',
        endpoint: '/api/v1/measures/ConsensusDemand/override',
        description: 'Propose a consensus override reflecting the reallocation, pending demand planner acceptance',
        body: {
          Version: 'CurrentWorkingView',
          Measure: 'Consensus Demand Override',
          Dimensions: { DemandElement: mutation.demandElementId },
          Attributes: { AllocationPriority: mutation.newPriority },
          Comment: 'Short supply reallocated by margin contribution — raised from exception cockpit',
          RequiresApproval: true,
        },
      };
    },

    async healthCheck(): Promise<AdapterHealth> {
      const snapshot = snapshotFor();
      return {
        ok: true,
        lastSyncAt: snapshot?.lastSyncAt ?? `${source.planningDate}T23:05:00Z`,
        latencyMs: 612,
        recordCount: snapshot?.recordCount ?? 0,
        syncCadenceHours: 24,
      };
    },
  };
}
