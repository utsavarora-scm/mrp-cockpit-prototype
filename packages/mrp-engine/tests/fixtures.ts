/**
 * Hand-built fixtures.
 *
 * Small enough to hold in your head and check by hand, which is the point: if
 * someone challenges the arithmetic during the demo, these are what get opened.
 */

import type {
  BomLine,
  Calendar,
  DemandElement,
  Item,
  ItemPlant,
  MrpOptions,
  PlanningSnapshot,
  StockPosition,
  SupplyElement,
} from '@repo/domain';
import { addDays } from '@repo/domain';

export const PLANNING_DATE = '2026-08-11';

/**
 * A seven-day working calendar with no holidays.
 *
 * Deliberate: with every day a working day, walking the calendar backwards
 * reduces exactly to subtracting calendar days, which is what lets the §6.2
 * worked example be checked by hand. The calendar-aware tests use a five-day
 * calendar instead.
 */
export const CONTINUOUS_CALENDAR: Calendar = {
  id: 'CAL-7',
  workingDays: [0, 1, 2, 3, 4, 5, 6],
  holidays: [],
};

export const FIVE_DAY_CALENDAR: Calendar = {
  id: 'CAL-5',
  workingDays: [1, 2, 3, 4, 5],
  holidays: [],
};

export function options(overrides: Partial<MrpOptions> = {}): MrpOptions {
  return {
    planningDate: PLANNING_DATE,
    horizonDays: 30,
    bucketing: 'DAY',
    forecastConsumption: { backwardDays: 20, forwardDays: 10 },
    useActualLeadTimes: false,
    scenarioId: 'test',
    ...overrides,
  };
}

export function item(overrides: Partial<Item> & Pick<Item, 'id'>): Item {
  return {
    description: overrides.id,
    type: 'RM',
    baseUom: 'KG',
    abcClass: 'A',
    xyzClass: 'X',
    shelfLifeDays: null,
    isPhantom: false,
    standardCost: 1,
    createdOn: '2020-01-01',
    ...overrides,
  };
}

export function itemPlant(overrides: Partial<ItemPlant> & Pick<ItemPlant, 'itemId' | 'plantId'>): ItemPlant {
  return {
    mrpType: 'PD',
    procurementType: 'BUY',
    lotSizeRule: 'LFL',
    fixedLotSize: null,
    minLotSize: null,
    maxLotSize: null,
    roundingValue: null,
    periodsOfSupplyDays: null,
    reorderPoint: null,
    leadTimeDays: 0,
    grProcessingTimeDays: 0,
    safetyStock: 0,
    safetyTimeDays: 0,
    scrapPct: 0,
    serviceLevelTarget: 0.95,
    plannerCode: 'PLN-1',
    sourcePlantId: null,
    isPlanningRelevant: true,
    paramsLastChangedOn: '2024-01-01',
    storageCapacity: null,
    dailyReceivingCapacity: null,
    maintainedStockDays: null,
    maintainedOrderDays: null,
    campaignCycleDays: null,
    ...overrides,
  };
}

export function stock(itemId: string, plantId: string, unrestricted: number): StockPosition {
  return { itemId, plantId, unrestricted, blocked: 0, qualityInspection: 0, inTransit: 0, batches: [] };
}

export function demand(
  overrides: Partial<DemandElement> & Pick<DemandElement, 'id' | 'itemId' | 'plantId' | 'qty' | 'requiredDate'>
): DemandElement {
  return {
    type: 'SALES_ORDER',
    customerId: null,
    channel: null,
    marginPerUnit: 0,
    pricePerUnit: 0,
    priority: 1,
    parentSupplyElementId: null,
    sourceSystem: 'SAP',
    ...overrides,
  };
}

export function supply(
  overrides: Partial<SupplyElement> & Pick<SupplyElement, 'id' | 'itemId' | 'plantId' | 'qty' | 'dueDate'>
): SupplyElement {
  return {
    type: 'PO',
    releaseDate: overrides.dueDate,
    vendorId: null,
    sourcePlantId: null,
    isFirm: true,
    sourceSystem: 'SAP',
    ...overrides,
  };
}

export function bom(
  parentItemId: string,
  plantId: string,
  componentItemId: string,
  qtyPer: number,
  componentScrapPct = 0
): BomLine {
  return {
    parentItemId,
    plantId,
    componentItemId,
    qtyPer,
    componentScrapPct,
    validFrom: '2020-01-01',
    validTo: '2099-12-31',
    alternateBomId: '1',
    isAlternate: false,
  };
}

/** An otherwise empty snapshot the individual tests fill in. */
export function snapshot(overrides: Partial<PlanningSnapshot> = {}): PlanningSnapshot {
  return {
    dataPackId: 'test',
    items: [],
    plants: [{ id: 'P1', name: 'Plant 1', country: 'US', type: 'OWN', calendarId: CONTINUOUS_CALENDAR.id }],
    itemPlants: [],
    boms: [],
    resources: [],
    routings: [],
    vendors: [],
    itemVendors: [],
    substitutes: [],
    calendars: [CONTINUOUS_CALENDAR, FIVE_DAY_CALENDAR],
    receiptHistory: [],
    stock: [],
    supply: [],
    demand: [],
    customers: [],
    systemSnapshots: [],
    ...overrides,
  };
}

/** Daily demand of `qty` on each of days `from`…`to` inclusive. */
export function dailyDemand(itemId: string, plantId: string, qty: number, from: number, to: number): DemandElement[] {
  const elements: DemandElement[] = [];
  for (let day = from; day <= to; day += 1) {
    elements.push(
      demand({
        id: `D-${itemId}-${day}`,
        itemId,
        plantId,
        qty,
        requiredDate: addDays(PLANNING_DATE, day),
      })
    );
  }
  return elements;
}
