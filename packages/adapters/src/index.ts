/**
 * Adapter registry.
 *
 * The mock adapters are the ones that run the demo. The real ones exist as
 * declarations only — they describe the same interface against the same
 * endpoints, so the integration screen can show exactly what a production
 * deployment would connect to, and nobody has to take it on trust that the shape
 * would be the same.
 */

import type { PlanningSnapshot, SnapshotMutation, TargetSystem, WritebackPayload } from '@repo/domain';

import { createMockKinaxisAdapter, KINAXIS_ENDPOINTS, KINAXIS_TARGET_SCENARIO, buildKinaxisWriteback } from './kinaxis';
import { createMockO9Adapter, O9_ENDPOINTS } from './o9';
import { buildSapWriteback, createMockSapAdapter, SAP_ENDPOINTS } from './sap';
import type { AdapterSource, SystemOfRecordAdapter } from './types';

export * from './types';
export { SAP_ENDPOINTS, KINAXIS_ENDPOINTS, O9_ENDPOINTS, KINAXIS_TARGET_SCENARIO };
export { latencyFor } from './latency';

export interface AdapterSet {
  sap: SystemOfRecordAdapter;
  kinaxis: SystemOfRecordAdapter;
  o9: SystemOfRecordAdapter;
  all: SystemOfRecordAdapter[];
  byId(system: TargetSystem): SystemOfRecordAdapter;
}

export function createAdapters(snapshot: PlanningSnapshot, planningDate: string): AdapterSet {
  const source: AdapterSource = { snapshot, planningDate };
  const sap = createMockSapAdapter(source);
  const kinaxis = createMockKinaxisAdapter(source);
  const o9 = createMockO9Adapter(source);
  const all = [sap, kinaxis, o9];

  return {
    sap,
    kinaxis,
    o9,
    all,
    byId(system) {
      const found = all.find((adapter) => adapter.system === system);
      if (!found) throw new Error(`No adapter registered for ${system}`);
      return found;
    },
  };
}

/**
 * Every payload a committed resolution would send, across every system it
 * touches. Nothing is sent — this is what the writeback preview renders.
 */
export function proposeWritebacks(mutations: SnapshotMutation[], planningDate: string): WritebackPayload[] {
  const payloads: WritebackPayload[] = [];
  for (const mutation of mutations) {
    const sap = buildSapWriteback(mutation, planningDate);
    if (sap) payloads.push(sap);
    const kinaxis = buildKinaxisWriteback(mutation);
    if (kinaxis) payloads.push(kinaxis);
    if (mutation.kind === 'REPRIORITISE_DEMAND') {
      payloads.push({
        system: 'O9',
        method: 'POST',
        endpoint: '/api/v1/measures/ConsensusDemand/override',
        description: 'Propose a consensus override reflecting the reallocation, pending demand planner acceptance',
        body: {
          Version: 'CurrentWorkingView',
          Measure: 'Consensus Demand Override',
          Dimensions: { DemandElement: mutation.demandElementId },
          Attributes: { AllocationPriority: mutation.newPriority },
          RequiresApproval: true,
        },
      });
    }
  }
  return payloads;
}

/**
 * The production adapters, declared but not implemented.
 *
 * Listed so the integration view can be honest about what exists today and what
 * a real deployment would add — which is a far better answer than an
 * architecture diagram that implies more than has been built.
 */
export const PLANNED_ADAPTERS = [
  {
    id: 'SapODataAdapter',
    system: 'SAP' as const,
    status: 'Interface defined, not implemented',
    requires: 'Communication user, OData scopes on the listed services, network route to the gateway',
  },
  {
    id: 'KinaxisRestAdapter',
    system: 'KINAXIS' as const,
    status: 'Interface defined, not implemented',
    requires: 'API user with control-set access and rights on the target scenario',
  },
  {
    id: 'O9TenantAdapter',
    system: 'O9' as const,
    status: 'Interface defined, not implemented',
    requires: 'Tenant API credentials and a graph query role',
  },
];
