/**
 * The adapter boundary.
 *
 * Every system of record is reached through this one interface, and the mock
 * implementations return payloads shaped like the *real* APIs — genuine entity
 * sets, genuine field names — before mapping them into the domain model. That is
 * what makes the writeback preview and the integration screen truthful rather
 * than decorative.
 *
 * `proposeWriteback` returns a payload. It never sends one. There is no HTTP
 * client anywhere in this package.
 */

import type {
  BomLine,
  Item,
  ItemPlant,
  PlanningSnapshot,
  SnapshotMutation,
  StockPosition,
  SupplyElement,
  SystemSnapshot,
  TargetSystem,
  WritebackPayload,
} from '@repo/domain';

export interface AdapterHealth {
  ok: boolean;
  lastSyncAt: string;
  latencyMs: number;
  recordCount: number;
  /** How often this feed is refreshed, in hours. */
  syncCadenceHours: number;
}

/** One API this adapter reads or writes, for the integration architecture view. */
export interface EndpointDescriptor {
  name: string;
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  purpose: string;
  direction: 'READ' | 'WRITE';
  /** Approximate records moved per sync. */
  recordVolume: number;
  notes?: string;
}

export interface SystemOfRecordAdapter {
  readonly system: TargetSystem;
  readonly label: string;
  /** True for the mock adapters that run the demo. */
  readonly isMock: boolean;
  /** Protocol description, shown verbatim on the integration screen. */
  readonly protocol: string;
  readonly endpoints: EndpointDescriptor[];
  /** Stated plainly on screen — this is the question IT will ask. */
  readonly coreImpact: string;

  fetchItems(): Promise<Item[]>;
  fetchItemPlants(): Promise<ItemPlant[]>;
  fetchBoms(): Promise<BomLine[]>;
  fetchStock(): Promise<StockPosition[]>;
  fetchSupply(): Promise<SupplyElement[]>;
  fetchSnapshot(): Promise<SystemSnapshot>;
  /** Returns the payload that would be sent. Sends nothing. */
  proposeWriteback(mutation: SnapshotMutation): Promise<WritebackPayload | null>;
  healthCheck(): Promise<AdapterHealth>;
}

/** What the mock adapters read from instead of a network. */
export interface AdapterSource {
  snapshot: PlanningSnapshot;
  planningDate: string;
}
