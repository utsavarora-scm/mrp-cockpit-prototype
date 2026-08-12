/**
 * The complete input to the planning engine. `runMrp` is a pure function of a
 * PlanningSnapshot plus MrpOptions — nothing is read from a clock, a database
 * or the environment, which is what makes the plan reproducible and testable.
 */

import type {
  BomLine,
  Calendar,
  Item,
  ItemPlant,
  ItemRouting,
  ItemVendor,
  Plant,
  ReceiptHistory,
  Resource,
  SubstituteItem,
  Vendor,
} from './master-data';
import type { Customer, DemandElement, StockPosition, SupplyElement, SystemSnapshot } from './transactional';

export interface PlanningSnapshot {
  /** Identifies the data pack this snapshot came from, e.g. 'confectionery'. */
  dataPackId: string;
  items: Item[];
  plants: Plant[];
  itemPlants: ItemPlant[];
  boms: BomLine[];
  resources: Resource[];
  routings: ItemRouting[];
  vendors: Vendor[];
  itemVendors: ItemVendor[];
  substitutes: SubstituteItem[];
  calendars: Calendar[];
  receiptHistory: ReceiptHistory[];
  stock: StockPosition[];
  supply: SupplyElement[];
  demand: DemandElement[];
  customers: Customer[];
  /** SAP / Kinaxis / o9, as each currently believes the world to be. */
  systemSnapshots: SystemSnapshot[];
}

export interface MrpOptions {
  planningDate: string;
  horizonDays: number;
  bucketing: 'DAY';
  forecastConsumption: { backwardDays: number; forwardDays: number };
  /** false = plan on maintained master data; true = plan on observed lead times. */
  useActualLeadTimes: boolean;
  scenarioId: string;
}

export const DEFAULT_MRP_OPTIONS: Omit<MrpOptions, 'planningDate' | 'scenarioId'> = {
  horizonDays: 180,
  bucketing: 'DAY',
  forecastConsumption: { backwardDays: 20, forwardDays: 10 },
  useActualLeadTimes: false,
};
