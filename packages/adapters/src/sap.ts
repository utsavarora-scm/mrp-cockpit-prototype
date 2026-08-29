/**
 * SAP S/4HANA adapter.
 *
 * Reads through the standard OData V4 / CDS surface and writes through the
 * purchase requisition and product APIs. No ABAP modification, no core change:
 * this is a side-by-side extension consuming published APIs, which is precisely
 * the objection an IT-adjacent audience will raise first.
 *
 * The mock returns OData-shaped envelopes with genuine `A_*` field names and
 * then maps them into the domain model, so the writeback preview shows the
 * payload that would really be posted.
 */

import {
  type BomLine,
  type Item,
  type ItemPlant,
  type SnapshotMutation,
  type StockPosition,
  type SupplyElement,
  type SystemSnapshot,
  type WritebackPayload,
} from '@repo/domain';

import type { AdapterHealth, AdapterSource, EndpointDescriptor, SystemOfRecordAdapter } from './types';
import { simulatedLatency } from './latency';

/** OData envelope, as S/4HANA actually returns it. */
interface ODataCollection<T> {
  d: { results: T[] };
}

interface A_Product {
  Product: string;
  ProductDescription: string;
  ProductType: string;
  BaseUnit: string;
  GrossWeight: string;
  CreationDate: string;
}

interface A_ProductPlant {
  Product: string;
  Plant: string;
  MRPType: string;
  MRPController: string;
  ProcurementType: string;
  LotSizingProcedure: string;
  FixedLotSizeQuantity: string;
  RoundingQuantity: string;
  PlannedDeliveryDurationInDays: string;
  GoodsReceiptDuration: string;
  SafetyStockQuantity: string;
  SafetyDuration: string;
  IsMarkedForDeletion: boolean;
}

export const SAP_ENDPOINTS: EndpointDescriptor[] = [
  {
    name: 'API_PRODUCT_SRV',
    method: 'GET',
    path: '/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product',
    purpose: 'Material master — descriptions, types, base units',
    direction: 'READ',
    recordVolume: 41_820,
  },
  {
    name: 'API_PRODUCT_SRV',
    method: 'GET',
    path: '/sap/opu/odata/sap/API_PRODUCT_SRV/A_ProductPlant',
    purpose: 'Planning master — MRP type, lot sizing, lead time, safety stock',
    direction: 'READ',
    recordVolume: 96_430,
    notes: 'The parameters the whole plan trusts. Nothing in SAP audits whether they are still true.',
  },
  {
    name: 'API_MATERIAL_STOCK_SRV',
    method: 'GET',
    path: '/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod',
    purpose: 'Stock by type — unrestricted, blocked, quality inspection, in transit',
    direction: 'READ',
    recordVolume: 118_200,
  },
  {
    name: 'API_PURCHASEORDER_PROCESS_SRV',
    method: 'GET',
    path: '/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrderItem',
    purpose: 'Open purchase orders and scheduled receipts',
    direction: 'READ',
    recordVolume: 24_760,
  },
  {
    name: 'API_BILL_OF_MATERIAL_SRV',
    method: 'GET',
    path: '/sap/opu/odata/sap/API_BILL_OF_MATERIAL_SRV/BillOfMaterialItem',
    purpose: 'Bills of material with validity dates and component scrap',
    direction: 'READ',
    recordVolume: 63_940,
  },
  {
    name: 'C_MRPMaterialCoverage',
    method: 'GET',
    path: '/sap/opu/odata4/sap/api_mrpmaterialcoverage/srvd_a2x/sap/mrpmaterialcoverage/0001/',
    purpose: 'MRP coverage and exception messages, for reconciliation against our own run',
    direction: 'READ',
    recordVolume: 8_150,
  },
  {
    name: 'API_PURCHASEREQ_PROCESS_SRV',
    method: 'POST',
    path: '/sap/opu/odata/sap/API_PURCHASEREQ_PROCESS_SRV/A_PurchaseRequisitionHeader',
    purpose: 'Raise a purchase requisition from a committed resolution',
    direction: 'WRITE',
    recordVolume: 0,
    notes: 'Standard API. No modification to SAP is required to accept it.',
  },
  {
    name: 'API_PRODUCT_SRV',
    method: 'PATCH',
    path: "/sap/opu/odata/sap/API_PRODUCT_SRV/A_ProductPlant(Product='…',Plant='…')",
    purpose: 'Correct a decayed planning parameter at source',
    direction: 'WRITE',
    recordVolume: 0,
  },
];

export function createMockSapAdapter(source: AdapterSource): SystemOfRecordAdapter {
  const snapshotFor = () => source.snapshot.systemSnapshots.find((entry) => entry.system === 'SAP');

  /** Shapes the domain model back into what S/4HANA would have returned. */
  const asProducts = (): ODataCollection<A_Product> => ({
    d: {
      results: source.snapshot.items.map((item) => ({
        Product: item.id,
        ProductDescription: item.description,
        ProductType: item.type === 'FG' ? 'FERT' : item.type === 'SFG' ? 'HALB' : 'ROH',
        BaseUnit: item.baseUom,
        GrossWeight: '0.000',
        CreationDate: `/Date(${Date.parse(`${item.createdOn}T00:00:00Z`)})/`,
      })),
    },
  });

  const asProductPlants = (): ODataCollection<A_ProductPlant> => ({
    d: {
      results: source.snapshot.itemPlants.map((record) => ({
        Product: record.itemId,
        Plant: record.plantId,
        MRPType: record.mrpType ?? '',
        MRPController: record.plannerCode ?? '',
        ProcurementType: record.procurementType === 'MAKE' ? 'E' : record.procurementType === 'BUY' ? 'F' : 'X',
        LotSizingProcedure: record.lotSizeRule ?? '',
        FixedLotSizeQuantity: numeric(record.fixedLotSize),
        RoundingQuantity: numeric(record.roundingValue),
        PlannedDeliveryDurationInDays: numeric(record.leadTimeDays),
        GoodsReceiptDuration: numeric(record.grProcessingTimeDays),
        SafetyStockQuantity: numeric(record.safetyStock),
        SafetyDuration: numeric(record.safetyTimeDays),
        IsMarkedForDeletion: false,
      })),
    },
  });

  return {
    system: 'SAP',
    label: 'SAP S/4HANA',
    isMock: true,
    protocol: 'OData V4 / CDS · side-by-side extension',
    endpoints: SAP_ENDPOINTS,
    coreImpact: 'Zero modifications. Standard published APIs only — no ABAP, no core extension, no custom table.',

    async fetchItems(): Promise<Item[]> {
      await simulatedLatency('SAP', 'items');
      // Round-trip through the OData shape so the mapping is exercised, not skipped.
      const collection = asProducts();
      const byId = new Map(source.snapshot.items.map((item) => [item.id, item]));
      return collection.d.results.map((row) => byId.get(row.Product)).filter((item): item is Item => Boolean(item));
    },

    async fetchItemPlants(): Promise<ItemPlant[]> {
      await simulatedLatency('SAP', 'itemPlants');
      const collection = asProductPlants();
      const byKey = new Map(source.snapshot.itemPlants.map((record) => [`${record.itemId}@${record.plantId}`, record]));
      return collection.d.results
        .map((row) => byKey.get(`${row.Product}@${row.Plant}`))
        .filter((record): record is ItemPlant => Boolean(record));
    },

    async fetchBoms(): Promise<BomLine[]> {
      await simulatedLatency('SAP', 'boms');
      return source.snapshot.boms;
    },

    async fetchStock(): Promise<StockPosition[]> {
      await simulatedLatency('SAP', 'stock');
      return source.snapshot.stock;
    },

    async fetchSupply(): Promise<SupplyElement[]> {
      await simulatedLatency('SAP', 'supply');
      return source.snapshot.supply.filter((element) => element.sourceSystem === 'SAP');
    },

    async fetchSnapshot(): Promise<SystemSnapshot> {
      await simulatedLatency('SAP', 'snapshot');
      const snapshot = snapshotFor();
      if (!snapshot) throw new Error('SAP snapshot missing from the data pack');
      return snapshot;
    },

    async proposeWriteback(mutation: SnapshotMutation): Promise<WritebackPayload | null> {
      return buildSapWriteback(mutation, source.planningDate);
    },

    async healthCheck(): Promise<AdapterHealth> {
      const snapshot = snapshotFor();
      return {
        ok: true,
        lastSyncAt: snapshot?.lastSyncAt ?? `${source.planningDate}T04:30:00Z`,
        latencyMs: 214,
        recordCount: snapshot?.recordCount ?? 0,
        syncCadenceHours: 4,
      };
    },
  };
}

/**
 * The payload a committed resolution would post. Field names are the real ones,
 * so a planner or a basis consultant can recognise it on sight.
 */
export function buildSapWriteback(mutation: SnapshotMutation, planningDate: string): WritebackPayload | null {
  switch (mutation.kind) {
    case 'ADD_SUPPLY':
      return {
        system: 'SAP',
        method: 'POST',
        endpoint: '/sap/opu/odata/sap/API_PURCHASEREQ_PROCESS_SRV/A_PurchaseRequisitionHeader',
        description: 'Create a purchase requisition for the additional quantity',
        body: {
          PurchaseRequisitionType: 'NB',
          CreationDate: planningDate,
          to_PurchaseReqnItem: {
            results: [
              {
                PurchaseRequisitionItem: '00010',
                Material: mutation.itemId,
                Plant: mutation.plantId,
                RequestedQuantity: mutation.qty.toFixed(3),
                PurchaseRequisitionItemCategory: '0',
                DeliveryDate: mutation.dueDate,
                Supplier: mutation.vendorId ?? '',
                PurchasingOrganization: '1000',
                PurchasingGroup: '001',
                MaterialGroup: 'RAW',
                PurReqnItemText: 'Raised from exception cockpit — planner committed',
              },
            ],
          },
        },
      };

    case 'EXPEDITE_SUPPLY':
    case 'RESCHEDULE_SUPPLY':
      return {
        system: 'SAP',
        method: 'PATCH',
        endpoint: `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrderScheduleLine(PurchaseOrder='${mutation.supplyElementId}',PurchaseOrderItem='00010',ScheduleLine='0001')`,
        description:
          mutation.kind === 'EXPEDITE_SUPPLY'
            ? 'Compress the delivery schedule and record the premium freight agreement'
            : 'Move the delivery schedule line',
        body: {
          ScheduleLineDeliveryDate: mutation.newDueDate,
          PerformanceType: mutation.kind === 'EXPEDITE_SUPPLY' ? 'EXPEDITE' : '',
          ScheduleLineOrderQuantity: undefined,
        },
      };

    case 'RESCHEDULE_DELIVERY_LINE':
      // The schedule line is the record SAP actually keys the delivery on, so a
      // per-drop move maps onto exactly one line rather than the whole item.
      return {
        system: 'SAP',
        method: 'PATCH',
        endpoint: `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrderScheduleLine(PurchaseOrder='${mutation.supplyElementId}',PurchaseOrderItem='00010',ScheduleLine='${String(mutation.line).padStart(4, '0')}')`,
        description: mutation.confirmed
          ? 'Move the delivery schedule line and record the supplier confirmation'
          : 'Move the delivery schedule line',
        body: {
          ScheduleLineDeliveryDate: mutation.newDate,
          ScheduleLineOrderQuantity: mutation.newQty,
          ConfirmationStatus: mutation.confirmed ? 'CONFIRMED' : undefined,
        },
      };

    case 'CANCEL_SUPPLY':
      return {
        system: 'SAP',
        method: 'PATCH',
        endpoint: `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrderItem(PurchaseOrder='${mutation.supplyElementId}',PurchaseOrderItem='00010')`,
        description: 'Flag the purchase order item for deletion',
        body: { IsFinallyInvoiced: false, PurchasingDocumentDeletionCode: 'L' },
      };

    case 'SET_ITEM_PLANT_PARAM':
      return {
        system: 'SAP',
        method: 'PATCH',
        endpoint: `/sap/opu/odata/sap/API_PRODUCT_SRV/A_ProductPlant(Product='${mutation.itemId}',Plant='${mutation.plantId}')`,
        description: `Correct ${mutation.field} at source, so every future plan uses the right number`,
        body: { [sapFieldFor(mutation.field)]: mutation.value === null ? null : String(mutation.value) },
      };

    case 'SET_LOT_SIZE_RULE':
      return {
        system: 'SAP',
        method: 'PATCH',
        endpoint: `/sap/opu/odata/sap/API_PRODUCT_SRV/A_ProductPlant(Product='${mutation.itemId}',Plant='${mutation.plantId}')`,
        description: 'Change the lot sizing procedure',
        body: { LotSizingProcedure: mutation.value },
      };

    case 'CREATE_ITEM_PLANT':
      return {
        system: 'SAP',
        method: 'POST',
        endpoint: '/sap/opu/odata/sap/API_PRODUCT_SRV/A_ProductPlant',
        description: 'Create the missing planning master so the item enters the supply plan at all',
        body: {
          Product: mutation.itemId,
          Plant: mutation.plantId,
          MRPType: 'PD',
          MRPController: '001',
          ProcurementType: 'F',
          LotSizingProcedure: 'EX',
          IsMarkedForDeletion: false,
        },
      };

    case 'INVENTORY_REBALANCE':
      return {
        system: 'SAP',
        method: 'POST',
        endpoint: '/sap/opu/odata/sap/API_STOCK_TRANSPORT_ORDER_SRV/A_StockTransportOrder',
        description: 'Raise a stock transport order between the two plants',
        body: {
          PurchaseOrderType: 'UB',
          SupplyingPlant: mutation.fromPlantId,
          to_PurchaseOrderItem: {
            results: [
              {
                Material: mutation.itemId,
                Plant: mutation.toPlantId,
                OrderQuantity: mutation.qty.toFixed(3),
                ScheduleLineDeliveryDate: mutation.arrivalDate,
              },
            ],
          },
        },
      };

    default:
      return null;
  }
}

/** Domain field → the S/4HANA property that actually holds it. */
function sapFieldFor(field: string): string {
  const map: Record<string, string> = {
    leadTimeDays: 'PlannedDeliveryDurationInDays',
    safetyStock: 'SafetyStockQuantity',
    safetyTimeDays: 'SafetyDuration',
    grProcessingTimeDays: 'GoodsReceiptDuration',
    fixedLotSize: 'FixedLotSizeQuantity',
    minLotSize: 'MinimumLotSizeQuantity',
    maxLotSize: 'MaximumLotSizeQuantity',
    roundingValue: 'RoundingQuantity',
    periodsOfSupplyDays: 'PlanningTimeFence',
    reorderPoint: 'ReorderThresholdQuantity',
    scrapPct: 'AssemblyScrapPercent',
    serviceLevelTarget: 'ServiceLevel',
  };
  return map[field] ?? field;
}

function numeric(value: number | null): string {
  return value === null ? '0.000' : value.toFixed(3);
}
