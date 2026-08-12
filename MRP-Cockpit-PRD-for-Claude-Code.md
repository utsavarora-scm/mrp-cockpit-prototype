# PRD — MRP Exception Cockpit & Planning Engine

### Build spec for Claude Code | Heizen | Demo target: GCPL Business Transformation

**Version:** 1.0 **Author:** Utsav Arora **Date:** 11 August 2026 **Build target:** Next.js prototype, functional on
seeded data, demo-ready **Codename:** `mrp-cockpit`

---

## 0. How to read this document

This is an implementation spec written for an AI coding agent. It is deliberately prescriptive about **domain logic**
(Sections 5–8) because the differentiator in this demo is planning correctness, not UI. Where the spec says "must",
implement exactly. Where it says "should", use judgement.

**The single most important constraint:** every number on screen must be derived from a real calculation over the seeded
dataset. No hardcoded figures, no fake charts. The audience will ask "why is that number that number?" and the app must
be able to answer.

---

## 1. Strategic context

Godrej Consumer Products (GCPL) is building in-house product capability to reduce dependence on external vendors and
subscription SaaS. Heizen is already engaged on cost sheet automation and intelligent RFQ awarding. The Business
Transformation head has now asked for a demo of MRP work — this is a dipstick test of whether Heizen has genuine supply
chain depth, not just build capacity.

**Their current stack:** SAP S/4HANA (system of record + execution), Kinaxis (concurrent supply planning), o9 (demand /
IBP). All three are deployed.

**The trap to avoid:** demoing something that looks like a worse version of software they already pay for. If the demo
reads as "here's our MRP that competes with Kinaxis", we lose. The prototype must occupy space that none of the three
systems owns.

**The white space we are claiming:**

| Layer                                     | Owner today | Gap                                                                                      |
| ----------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| Demand / consensus plan                   | o9          | —                                                                                        |
| Concurrent supply plan, scenarios         | Kinaxis     | —                                                                                        |
| Execution, master data, transactions      | SAP S/4HANA | —                                                                                        |
| **Exception triage ranked by money**      | **nobody**  | Planners see exception _counts_ across three UIs, not business impact                    |
| **The seam between the three systems**    | **nobody**  | Master data drift, plan divergence, stale sync — silently corrupts every plan downstream |
| **Master data decay detection**           | **nobody**  | Planning params are set once and rot; nothing tells you lead time is now 38 days, not 21 |
| **Closed-loop resolution with writeback** | **nobody**  | Planners decide in Excel, then re-key into SAP                                           |

The product is the **orchestration and decision layer above the stack**, with a real MRP engine embedded so we can show
the math when challenged.

**Positioning one-liner for the room:**

> "This does not replace Kinaxis or SAP. It is the layer that tells your planner which of the 1,200 exceptions across
> those three systems is the one that costs you $4 million this month — and then closes it."

---

## 2. Audience and demo constraints

- **Primary audience:** GCPL Business Transformation head. Senior, commercially literate, technically adjacent. Will
  probe.
- **Secondary:** whoever they bring — likely supply chain and IT.
- **Format:** live screen-share, 12–15 minutes of product, then Q&A.
- **The demo must survive:** "change that number and re-run it", "where does this data come from", "how does this talk
  to SAP without us modifying SAP", "what happens when Kinaxis and SAP disagree".

**Build implication:** the app must be interactive and recalculate live. A click-through mock fails this audience.

### Data pack and anonymisation

The seeded dataset is **confectionery / chocolate manufacturing**, reflecting the domain of the pre-sale MRP engagement
this prototype grows out of. GCPL already knows that is the origin, so there is nothing to conceal — and pretending
otherwise would be the weaker position in the room. The requirement is **professional anonymisation, not disguise**:

- The client's name appears nowhere in code, data, UI copy, filenames, or repo history. Refer to the domain as "a
  confectionery manufacturer".
- Vendor, customer, and plant identifiers are synthetic (`VEND-114`, `P1`, `Northeast MT Account`). No real trading
  partner names.
- SKU descriptions are generic category descriptors ("Milk Chocolate Bar 43g, Multipack ×6"), never real brand names.
- No figure is traceable to real volumes, costs, or margins. Every quantity is generated from the seed.

Separately, keep the dataset in a swappable **data pack** (`/data-packs/<name>/*.json`) selected by
`NEXT_PUBLIC_DATA_PACK`, with no confectionery terminology hardcoded in the engine, schema, or UI. This is for
portability, not cover: an `fmcg-india` pack (home care / personal care, multi-plant, co-packers, seasonal insecticides)
then becomes a one-day build, and offering GCPL a second run of the same demo in their own categories is a strong
follow-up move.

**Currency:** all monetary values are **USD**, formatted `en-US` (`$18.4M`, `$4.2M`, `$25,000`).

---

## 3. Product scope

### In scope (v1 demo)

1. Deterministic time-phased MRP engine (netting, lot-sizing, lead-time offsetting, multi-level BOM explosion, pegging)
2. Exception generation across four classes: supply continuity, master data, cross-system reconciliation, feasibility
3. Impact ranking in currency, not counts
4. Planner cockpit, Item 360, exception resolution workbench
5. What-if simulation with before/after diff
6. Pegging / blast-radius explorer
7. Master data health scoring
8. Three-system reconciliation monitor
9. Rules-based auto-resolution agent with audit log
10. Integration adapter architecture with SAP / Kinaxis / o9 mock adapters returning realistic payload shapes

### Explicitly out of scope

- Authentication, user management, multi-tenancy, RBAC
- Real credentials or live connections to any system
- Capacity scheduling / finite scheduling beyond a simple load check
- Distribution network optimisation, transport planning
- Mobile responsive layouts (desktop 1440px+ only)
- Persistence of user accounts; state resets on demo reset

---

## 4. Success criteria

**Demo success:** the transformation head asks a scoping question ("could this read our actual Kinaxis instance?")
rather than an evaluative one ("interesting, we'll get back to you").

**Build success:**

| Criterion                                                      | Target                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------ |
| Engine runtime, 5,000 items × 180 daily buckets × 4 BOM levels | < 2,000 ms server-side                                 |
| Engine determinism                                             | Same seed → byte-identical plan output, every run      |
| Engine unit test coverage                                      | 100% of lot-sizing rules, netting, offsetting, pegging |
| Any screen interaction → recalculated result                   | < 800 ms                                               |
| Cold start to demo-ready                                       | < 10 s, one command                                    |
| Demo reset                                                     | Single button, < 2 s, returns to exact initial state   |

---

## 5. Domain model

All quantities are `number` in the item's base UoM. All dates are ISO `YYYY-MM-DD` strings; the engine works in
**integer day offsets from `planningDate`** internally and converts at the boundary.

```ts
// ---------- Master data ----------

type ItemType = 'FG' | 'SFG' | 'RM' | 'PM';
type ProcurementType = 'MAKE' | 'BUY' | 'TRANSFER';
type LotSizeRule = 'LFL' | 'FOQ' | 'POQ' | 'MINMAX' | 'EOQ';
type MrpType = 'PD' | 'VB' | 'ND'; // deterministic | reorder point | no planning

interface Item {
  id: string; // e.g. 'RM-CB-001'
  description: string;
  type: ItemType;
  baseUom: string;
  abcClass: 'A' | 'B' | 'C'; // by consumption value
  xyzClass: 'X' | 'Y' | 'Z'; // by demand variability
  shelfLifeDays: number | null;
  isPhantom: boolean;
  standardCost: number; // per base UoM
  createdOn: string;
}

interface Plant {
  id: string; // 'P1'
  name: string;
  country: string;
  type: 'OWN' | 'COPACKER';
  calendarId: string;
}

// The planning master. Nullable fields are intentional — absence IS the signal
// that drives class-B master data exceptions.
interface ItemPlant {
  itemId: string;
  plantId: string;
  mrpType: MrpType | null;
  procurementType: ProcurementType | null;
  lotSizeRule: LotSizeRule | null;
  fixedLotSize: number | null; // FOQ
  minLotSize: number | null;
  maxLotSize: number | null;
  roundingValue: number | null;
  periodsOfSupplyDays: number | null; // POQ
  reorderPoint: number | null; // VB
  leadTimeDays: number | null; // planned delivery time (BUY) or in-house production time (MAKE)
  grProcessingTimeDays: number; // goods receipt processing
  safetyStock: number | null;
  safetyTimeDays: number;
  scrapPct: number; // assembly scrap, 0–1
  serviceLevelTarget: number; // 0–1, used for calculated SS
  plannerCode: string | null;
  sourcePlantId: string | null; // for TRANSFER
  isPlanningRelevant: boolean;
}

interface BomLine {
  parentItemId: string;
  plantId: string;
  componentItemId: string;
  qtyPer: number; // per 1 base UoM of parent
  componentScrapPct: number; // 0–1
  validFrom: string;
  validTo: string;
  alternateBomId: string; // '1' = primary
  isAlternate: boolean;
}

interface Resource {
  // light capacity model
  id: string;
  plantId: string;
  name: string;
  dailyCapacityHours: number;
}

interface ItemRouting {
  itemId: string;
  plantId: string;
  resourceId: string;
  hoursPerBaseUom: number;
}

interface Vendor {
  id: string;
  name: string;
  reliabilityScore: number; // 0–1, derived from OTIF history
}

interface ItemVendor {
  itemId: string;
  plantId: string;
  vendorId: string;
  isPrimary: boolean;
  leadTimeDays: number;
  moq: number;
  incrementQty: number;
  unitPrice: number;
  dailyCapacity: number | null;
  expediteAvailable: boolean;
  expediteLeadTimeDays: number | null;
  expediteUnitPriceUplift: number | null; // fraction, e.g. 0.35
}

interface SubstituteItem {
  // approved alternates
  itemId: string;
  substituteItemId: string;
  plantId: string;
  conversionFactor: number;
  approvalStatus: 'APPROVED' | 'CONDITIONAL' | 'BLOCKED';
  note: string;
}

interface Calendar {
  id: string;
  workingDays: number[]; // 0=Sun … 6=Sat
  holidays: string[]; // ISO dates
}

// ---------- Transactional ----------

interface StockPosition {
  itemId: string;
  plantId: string;
  unrestricted: number;
  blocked: number;
  qualityInspection: number;
  inTransit: number;
  batches: Array<{ batchId: string; qty: number; expiryDate: string | null }>;
}

type SupplyType = 'PO' | 'PRODUCTION_ORDER' | 'PLANNED_ORDER' | 'STO';

interface SupplyElement {
  id: string;
  type: SupplyType;
  itemId: string;
  plantId: string;
  qty: number;
  dueDate: string; // receipt date
  releaseDate: string;
  vendorId: string | null;
  sourcePlantId: string | null;
  isFirm: boolean;
  sourceSystem: 'SAP' | 'KINAXIS' | 'ENGINE';
}

type DemandType = 'SALES_ORDER' | 'FORECAST' | 'DEPENDENT' | 'STO_DEMAND' | 'SAFETY_STOCK';

interface DemandElement {
  id: string;
  type: DemandType;
  itemId: string;
  plantId: string;
  qty: number;
  requiredDate: string;
  customerId: string | null;
  channel: 'MT' | 'GT' | 'ECOM' | 'EXPORT' | 'INTERNAL' | null;
  marginPerUnit: number;
  priority: number; // 1 = highest
  parentSupplyElementId: string | null; // set for DEPENDENT — this is the pegging link
  sourceSystem: 'SAP' | 'KINAXIS' | 'O9' | 'ENGINE';
}

// ---------- Cross-system shadow records (drive class-C exceptions) ----------

// The same logical fact, as each system currently believes it.
interface SystemSnapshot {
  system: 'SAP' | 'KINAXIS' | 'O9';
  lastSyncAt: string;
  itemPlantParams: Array<{
    itemId: string;
    plantId: string;
    leadTimeDays: number | null;
    safetyStock: number | null;
    lotSizeRule: string | null;
  }>;
  onHand: Array<{ itemId: string; plantId: string; qty: number }>;
  demandBuckets: Array<{ itemId: string; plantId: string; weekStart: string; qty: number }>;
  plannedOrders: Array<{ itemId: string; plantId: string; qty: number; dueDate: string }>;
}
```

---

## 6. The MRP engine — specification

The engine lives in `packages/mrp-engine` as a **pure TypeScript library with zero I/O and zero framework
dependencies**. Signature:

```ts
function runMrp(snapshot: PlanningSnapshot, options: MrpOptions): MrpResult;
```

It must be callable from a Vitest test with a hand-built 10-item fixture. This is non-negotiable — it is what makes the
logic auditable in front of a technical challenger.

```ts
interface MrpOptions {
  planningDate: string;
  horizonDays: number; // default 180
  bucketing: 'DAY'; // v1 is daily
  forecastConsumption: { backwardDays: number; forwardDays: number };
  useActualLeadTimes: boolean; // false = use master data; true = use observed. Drives the drift demo.
  scenarioId: string;
}
```

### 6.1 Algorithm

**Step 1 — Low-level code assignment.** Topologically sort the BOM graph per plant. `lowLevelCode(item)` = length of the
longest path from any independent-demand item down to it. Detect cycles and emit a `B-CIRCULAR-BOM` exception rather
than throwing. Phantom items are exploded through: they receive no planned orders, their demand passes straight to their
components in the same bucket with no lead-time offset.

**Step 2 — Bucketise.** Build a `Float64Array` of length `horizonDays + 1` per item-plant for each of: gross
requirements, scheduled receipts, planned receipts, projected available balance.

**Step 3 — Forecast consumption.** Before netting, consume forecast against firm sales orders. For each sales order at
day _d_, reduce forecast quantities within `[d - backwardDays, d + forwardDays]`, nearest bucket first. Prevents
double-counting demand — a classic real-world error and worth calling out live.

**Step 4 — Net requirements, processed level by level in ascending low-level code.**

For each item-plant, walk buckets `t = 0 … horizonDays`:

```
GR(t)  = firmSalesOrders(t) + netForecast(t) + dependentDemand(t) + stoDemand(t)
SR(t)  = openPOs(t) + openProductionOrders(t) + inTransitSTOs(t) + firmPlannedOrders(t)
PAB(t) = PAB(t-1) + SR(t) + PlannedReceipts(t) - GR(t)      // PAB(-1) = unrestricted stock
```

If `PAB(t) < safetyStock`, a net requirement exists:

```
netRequirement = safetyStock - PAB(t)
```

**Step 5 — Lot sizing.** Convert `netRequirement` into `orderQty`:

| Rule     | Logic                                                                                                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LFL`    | `orderQty = netRequirement`                                                                                                                                                                               |
| `FOQ`    | `orderQty = ceil(netRequirement / fixedLotSize) * fixedLotSize`                                                                                                                                           |
| `POQ`    | Sum net requirements over the next `periodsOfSupplyDays` working days; order the total once                                                                                                               |
| `MINMAX` | If `PAB(t) < minLotSize`, order up to `maxLotSize`                                                                                                                                                        |
| `EOQ`    | `sqrt(2 · D · S / (H · C))` where `D` = annualised demand from the horizon, `S` = order cost (default 5,000), `H` = holding rate (default 0.22), `C` = standard cost. Clamp to `[minLotSize, maxLotSize]` |

Then apply, in order: `orderQty = max(orderQty, moq)` → `orderQty = ceil(orderQty / roundingValue) * roundingValue` → if
`maxLotSize` exceeded, split into multiple orders on consecutive working days.

Then inflate for scrap: `orderQty = orderQty / (1 - scrapPct)`.

**Step 6 — Lead-time offsetting.** Receipt date is bucket `t`. Release date is computed by walking **backwards over the
plant/vendor working calendar** — never by naive date subtraction:

```
totalOffset = leadTimeDays + grProcessingTimeDays + safetyTimeDays
releaseDate = subtractWorkingDays(bucketDate(t), totalOffset, calendar)
```

If `releaseDate < planningDate`, the order cannot be executed → emit exception `A8-ORDER-IN-PAST` and clamp the release
date to `planningDate` (keeping the infeasible receipt date visible, which is what makes the exception legible).

**Step 7 — BOM explosion.** For each planned order at its release date, for each active BOM line
(`validFrom <= releaseDate <= validTo`, primary alternate unless the scenario overrides):

```
componentQty = orderQty * qtyPer / (1 - componentScrapPct)
```

Create a `DemandElement` of type `DEPENDENT` on the component at the parent's **release date**, with
`parentSupplyElementId` set. That field is the pegging edge — do not omit it.

If no active BOM line exists for a `MAKE` item → `B2-NO-SOURCE-OF-SUPPLY`. If the BOM's `validTo` falls inside the
horizon → `B5-BOM-VALIDITY-GAP`.

**Step 8 — Pegging.** Build a directed graph after all levels complete:

- Nodes: demand elements, supply elements, stock positions
- Edges: FIFO allocation of supply to demand within each item-plant, plus the `parentSupplyElementId` links across
  levels
- Provide `traceUp(supplyElementId): DemandElement[]` returning the independent-demand leaves (sales orders / forecast)
  reachable from any component. This powers the blast-radius screen and is the single most persuasive visual in the
  demo.

**Step 9 — Exception generation.** See Section 7.

**Step 10 — Impact valuation.** Every exception must carry a currency figure. See Section 7.5.

### 6.2 Worked example — must match exactly in tests

Item `RM-CB-001` (cocoa butter), plant `P1`. Master data: `safetyStock` 15,000 kg, `leadTimeDays` 21,
`grProcessingTimeDays` 0, `safetyTimeDays` 3, `LotSizeRule` FOQ, `fixedLotSize` 25,000, `roundingValue` 1,000,
`scrapPct` 0. Opening unrestricted stock 40,000 kg. Gross requirements 4,000 kg/day, days 1–20. One open PO of 30,000 kg
due day 9.

| Day    | GR    | SR     | PAB        | Flag                                    |
| ------ | ----- | ------ | ---------- | --------------------------------------- |
| 0      | —     | —      | 40,000     |                                         |
| 6      | 4,000 | —      | 16,000     |                                         |
| **7**  | 4,000 | —      | **12,000** | `A2-SAFETY-STOCK-BREACH` (below 15,000) |
| 8      | 4,000 | —      | 8,000      |                                         |
| 9      | 4,000 | 30,000 | 34,000     | recovered                               |
| 13     | 4,000 | —      | 18,000     |                                         |
| **14** | 4,000 | —      | **14,000** | `A2` again → net requirement = 1,000    |
| 18     | 4,000 | —      | **-2,000** | `A1-PROJECTED-STOCKOUT` if unplanned    |

**Netting rule for the day-7 breach:** the engine nets at day 7 (`netRequirement = 3,000`) but the computed release date
is day 7 − 24 = **day −17**, already in the past. The engine must **not** silently drop this order. It emits
`A8-ORDER-IN-PAST`, clamps release to day 0, keeps the infeasible receipt date visible, and continues. The incoming PO
at day 9 then covers the gap, so the day-7 order is superseded and flagged `A5-RESCHEDULE-OUT`. Implement this sequence
exactly — planners recognise it instantly, and it demonstrates the engine handles the past-due case rather than
pretending it away.

**Netting at day 14:** `netRequirement = 15,000 - 14,000 = 1,000`. FOQ rounds up to **25,000**. Planned receipt 25,000
on day 14 → PAB(14) = 39,000, decaying to exactly 15,000 by day 20. One order covers the horizon.

Release date: day 14 minus (21 + 0 + 3) = **day −10**, walked over the working calendar. Negative ⇒
**`A8-ORDER-IN-PAST`**. With the _observed_ lead time of 38 days (`useActualLeadTimes: true`), release is day −27.

**This example is the spine of the demo.** The exception is not caused by a demand spike — it is caused by master data
that stopped being true. Neither SAP nor Kinaxis surfaces that, because both faithfully use the maintained parameter.

---

## 7. Exception taxonomy

Four classes. Each exception is
`{ code, class, severity, itemId, plantId, bucketDay, narrative, evidence, impactValue, resolutions[] }`.

### 7.1 Class A — Supply continuity

| Code                       | Trigger                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ |
| `A1-PROJECTED-STOCKOUT`    | `PAB(t) < 0`                                                                   |
| `A2-SAFETY-STOCK-BREACH`   | `0 <= PAB(t) < safetyStock`                                                    |
| `A3-COVERAGE-BELOW-TARGET` | Forward days of cover < `periodsOfSupplyDays`                                  |
| `A4-RESCHEDULE-IN`         | Existing PO arrives after the need date; earlier date would resolve a shortage |
| `A5-RESCHEDULE-OUT`        | PO arrives > 14 days before need; ties up cash and space                       |
| `A6-CANCEL-EXCESS`         | PO no longer pegged to any demand in horizon                                   |
| `A7-PAST-DUE-SUPPLY`       | Open supply with `dueDate < planningDate` still open                           |
| `A8-ORDER-IN-PAST`         | Computed release date earlier than `planningDate`                              |

### 7.2 Class B — Master data integrity _(generalisation of the absent-items use case from the prior engagement)_

| Code                            | Trigger                                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `B1-INCOMPLETE-PLANNING-MASTER` | Any of `mrpType`, `lotSizeRule`, `leadTimeDays`, `safetyStock` is null on a demand-carrying item                        |
| `B2-NO-SOURCE-OF-SUPPLY`        | `MAKE` item with no active BOM, or `BUY` item with no `ItemVendor`                                                      |
| `B3-ABSENT-ITEM`                | **Item carries demand in o9/Kinaxis but has no `ItemPlant` record in SAP.** The NPD/seasonal-launch gap                 |
| `B4-ORPHAN-ITEM`                | `ItemPlant` exists, stock on hand > 0, zero demand and zero consumption for 180 days → obsolescence candidate           |
| `B5-BOM-VALIDITY-GAP`           | Active BOM expires inside the planning horizon with no successor                                                        |
| `B6-EMPTY-PHANTOM`              | Phantom item resolving to zero components                                                                               |
| `B7-LEAD-TIME-DRIFT`            | \|observed avg GR lead time − maintained lead time\| > 20% over last 6 receipts                                         |
| `B8-SAFETY-STOCK-MISALIGNED`    | \|calculated SS − maintained SS\| > 30%, where calculated SS = `z(serviceLevelTarget) · σ(demand) · sqrt(leadTimeDays)` |
| `B9-UOM-INCONSISTENCY`          | BOM `qtyPer` implies a UoM conversion that does not exist                                                               |
| `B10-DUPLICATE-ITEM`            | Two item codes, same plant, description similarity > 0.9 (trigram) and identical base UoM                               |

`B7` and `B8` are the sharpest items in the whole product. They detect **master data decay** — parameters that were
correct at go-live and are now quietly wrong. Every planning system in the stack trusts them blindly. Make sure the UI
labels this concept explicitly.

### 7.3 Class C — Cross-system reconciliation

Computed by diffing `SystemSnapshot` records. **This is the white space; give it its own screen.**

| Code                      | Trigger                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `C1-DEMAND-DIVERGENCE`    | o9 forecast vs Kinaxis demand vs SAP PIR differ > 5% in any week                         |
| `C2-INVENTORY-DIVERGENCE` | Kinaxis on-hand ≠ SAP unrestricted (common cause: blocked / QI stock not modelled)       |
| `C3-PARAMETER-DRIFT`      | Same item-plant, different `leadTimeDays` / `safetyStock` / `lotSizeRule` across systems |
| `C4-PLAN-NOT-EXECUTED`    | Kinaxis planned order with no corresponding SAP planned order or PR after 48h            |
| `C5-STALE-SYNC`           | `lastSyncAt` older than the system's SLA threshold                                       |

### 7.4 Class D — Feasibility

| Code                         | Trigger                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `D1-VENDOR-CONSTRAINT`       | Order qty < MOQ, or exceeds vendor `dailyCapacity`                                            |
| `D2-CAPACITY-OVERLOAD`       | Σ (planned order hours) at a resource > `dailyCapacityHours`                                  |
| `D3-SHELF-LIFE-VIOLATION`    | Batch expiry earlier than its pegged consumption date, or order cover exceeds `shelfLifeDays` |
| `D4-LOT-SIZE-INDUCED-EXCESS` | Lot sizing produces > 120 days of cover                                                       |

### 7.5 Impact valuation — the ranking model

Sorting by severity is table stakes. Sort by money.

```
impactValue =
    revenueAtRisk        // Σ over pegged independent demand: qty × price × P(miss)
  + marginAtRisk         // Σ qty × marginPerUnit
  + excessInventoryValue // qty beyond 90-day cover × standardCost
  + expediteCostExposure // cheapest resolution's premium
  + obsolescenceExposure // shelf-life-at-risk qty × standardCost
```

`P(miss)` = 1 for `A1` inside lead time, 0.5 for `A1` outside lead time, 0.15 for `A2`. Expose these coefficients in a
config file — someone will ask, and being able to open the file and show them wins the room.

The cockpit's default sort is `impactValue DESC`. Show the count _and_ the money in the header: **"1,247 exceptions ·
$18.4M at risk · top 12 exceptions = 71% of exposure."** That single line is the product thesis.

---

## 8. Resolution framework

Every exception carries ranked `resolutions[]`. Each resolution is a **simulatable mutation** to the planning snapshot —
never a text suggestion.

```ts
interface Resolution {
  id: string;
  type: ResolutionType;
  label: string;
  mutation: SnapshotMutation; // applied to a cloned snapshot, engine re-runs
  estimatedCost: number;
  estimatedServiceImpact: number; // Δ fill rate, fraction
  estimatedInventoryImpact: number;
  leadTimeToEffect: number;
  confidence: number; // 0–1
  writebackTargets: Array<'SAP' | 'KINAXIS' | 'O9'>;
}

type ResolutionType =
  | 'EXPEDITE_EXISTING' // compress an open PO via premium freight
  | 'ALTERNATE_SOURCE' // switch to secondary vendor
  | 'SUBSTITUTE_COMPONENT' // approved alternate material
  | 'ALTERNATE_BOM' // alternate recipe
  | 'INVENTORY_REBALANCE' // STO from a plant holding excess
  | 'RESCHEDULE_IN'
  | 'RESCHEDULE_OUT'
  | 'CANCEL_ORDER'
  | 'RELOT_SIZE' // change lot-size rule/params
  | 'DEMAND_REPRIORITISE' // allocate short supply by margin/channel priority
  | 'FIX_MASTER_DATA' // write the missing/decayed parameter back
  | 'ACCEPT_AND_MONITOR';
```

### 8.1 Simulation

`POST /api/simulate` accepts `{ exceptionId, resolutionId }`, clones the snapshot, applies the mutation, re-runs
`runMrp`, and returns a **diff**: exceptions resolved, exceptions created (critical — resolutions cause new problems,
and showing that is what makes it credible), Δ PAB curve, Δ inventory value, Δ projected fill rate, Δ cost.

Simulations are ephemeral until the planner clicks **Commit**.

### 8.2 Writeback preview

Commit does not call anything real. It opens a **Writeback Preview** panel showing the exact payloads that _would_ be
sent:

- SAP: `POST /API_PURCHASEREQ_PROCESS_SRV/A_PurchaseRequisitionHeader` — rendered as real JSON with correct field names
  (`PurchaseRequisitionType`, `MaterialGroup`, `PurReqnItemText`, `DeliveryDate`)
- Kinaxis: `POST /rest/v1/scenario/{id}/data/IndependentDemand` with the RapidResponse record shape
- o9: consensus plan override payload

Label the panel **"Preview — no system was contacted."** Honesty here buys enormous credibility with an IT-adjacent
audience, and pre-empts the "did you connect to something?" question.

### 8.3 Autonomous resolution agent

A policy engine that auto-applies resolutions meeting all of: `confidence > 0.85`, `impactValue < $25,000`, exception
class in an allowlist, item `abcClass` in `['B','C']`, resolution type in
`['RESCHEDULE_OUT','CANCEL_ORDER','ACCEPT_AND_MONITOR','FIX_MASTER_DATA']`.

Every auto-action writes to an immutable audit log: timestamp, exception, policy rule fired, mutation, simulated impact,
reversal handle. Policies are editable in the UI.

**Demo line:** "Overnight, 340 of these closed themselves under policy you control. Your planners woke up to 907, ranked
by money. That is the difference between a planner who reacts and a planner who decides."

---

## 9. Screens

Desktop 1440px+. Dense, information-first, closer to a Bloomberg terminal than a SaaS marketing site. Dark-neutral
surface with a single accent. **No decorative illustrations, no rounded-cartoon aesthetic, no emoji.** Numeric columns
tabular-aligned, monospace for quantities and dates.

### S1 — Planner Cockpit _(landing)_

- **Header KPI strip:** exposure $, projected case fill rate, inventory value + DOH, excess/obsolete exposure, expedite
  spend MTD, exceptions auto-resolved %. Each with sparkline and Δ vs last run.
- **Pareto bar:** cumulative `impactValue` by exception, with the "top 12 = 71%" annotation drawn from live data.
- **Exception queue:** virtualised table, default sort `impactValue DESC`. Columns: impact $, code, class chip, item,
  plant, description, need date, days to impact, ABC/XYZ, pegged FG count, best resolution, confidence. Row expands
  inline to a mini PAB sparkline.
- **Facets:** plant, planner code, exception class, item type, ABC, time-to-impact bucket, "auto-resolvable only".
- **Persistent "Run MRP" button** with visible elapsed-ms readout. Showing a 1.4s full re-plan live is a quiet flex — do
  not hide it behind a spinner.

### S2 — Item 360

The MD04 replacement, and the screen that proves domain depth.

- **Header:** item, plant, type, ABC/XYZ, standard cost, planner, procurement type, current stock split (unrestricted /
  blocked / QI / in-transit).
- **PAB chart:** stacked area of gross requirements below the axis, receipts above, PAB line overlaid, safety stock as a
  dashed reference band, zero line emphasised. Shade stockout regions. Brushable time axis.
- **Time-phased grid:** rows = GR (expandable by demand type and source system), SR (expandable by supply element),
  planned receipts, PAB, days of cover. Columns = daily buckets, collapsible to weekly. **Cells for planning parameters
  and firm supply must be editable — edit triggers immediate re-plan of the affected sub-network.** This is the "change
  it and re-run" answer.
- **Right rail — Planning parameters:** every `ItemPlant` field, each annotated with a health indicator: green (fresh),
  amber (drifted — shows maintained vs observed side by side), red (missing). This is where `B7`/`B8` become visceral.
- **Exception ribbon:** all exceptions for this item-plant, click-through to S3.

### S3 — Exception Resolution Workbench

Three-column layout.

- **Left — Root cause trace:** a vertical causal narrative built from evidence, not a template string. E.g. _"Planned
  receipt required day 14 → release day −10 → infeasible. Maintained lead time 21d. Observed lead time across last 6
  receipts from VEND-114: 38d (σ 4.2d). Parameter last changed 2023-06-11."_ Each line links to its evidence record.
- **Centre — Resolution options:** cards ranked by a composite score, each showing cost, Δ service, Δ inventory, time to
  effect, confidence, writeback targets. **Simulate** on each.
- **Right — Simulation result:** before/after PAB chart overlay, exceptions resolved (green) and **exceptions newly
  created (red — always show these)**, Δ KPI table, Commit → writeback preview.

### S4 — Blast Radius / Pegging Explorer

Force-directed graph (React Flow) rooted on the exception's item, expanding upward through the pegging graph to finished
goods, then to customer orders. Node size ∝ value at risk; edge thickness ∝ quantity. Side panel lists affected customer
orders with value, channel, promised date, margin.

**Demo moment:** one cocoa butter shortage → 12 FG SKUs → $4.2M of committed orders across two key accounts. No system
in their stack draws this picture.

### S5 — Master Data Health

- Health score 0–100 per item-plant: completeness (40%), freshness (30%), consistency across systems (30%). Formula
  visible on hover.
- Heatmap: item type × plant, coloured by mean health.
- Ranked list of class-B exceptions with one-click **Fix** → writeback preview.
- **Absent items panel (`B3`)** — the original absent-items use case, generalised and quantified: items carrying demand
  with no planning master, with downstream component cascade shown.

### S6 — Three-System Reconciliation Monitor

- Top strip: three system cards (SAP / Kinaxis / o9) with last sync, record counts, health.
- **Divergence table:** one row per disagreeing fact, three value columns, delta, business impact, "source of truth"
  recommendation with reasoning.
- Timeline: divergence count over 30 days — divergence is chronic, not incidental, and the chart should say so.
- **Positioning line to place directly on this screen:** _"Three systems. Three versions of the truth. Nobody owns the
  seam."_

### S7 — Scenario Compare

Two to four scenarios side by side (baseline, +2 committed resolutions, aggressive rebalance, demand upside +15%). KPI
matrix, exception count by class, inventory and service frontier scatter. Clone / branch / promote.

### S8 — Integration Architecture

Live-status diagram of the adapter layer: which adapter is active (mock), what each reads and writes, actual API
endpoint names, payload shapes, sync cadence, clean-core annotations.

Explicit callout: **"Zero modifications to SAP. Zero modifications to Kinaxis. Side-by-side extension consuming standard
OData and REST APIs."** This directly answers the objection that will otherwise be raised in Q&A.

### S9 — Agent Activity Log

Chronological auto-resolution feed, editable policy rules, reversal action per entry, cumulative planner-hours-saved
counter derived from an assumed minutes-per-exception constant (make the constant visible and editable — do not smuggle
it).

---

## 10. Integration architecture

```
apps/web (Next.js)
  └── server actions / route handlers
        └── packages/mrp-engine        (pure, deterministic, tested)
        └── packages/adapters
              ├── SystemOfRecordAdapter (interface)
              ├── MockSapAdapter        ← active in demo
              ├── MockKinaxisAdapter    ← active in demo
              ├── MockO9Adapter         ← active in demo
              └── (SapODataAdapter / KinaxisRestAdapter / O9Adapter — stubs, interface only)
```

```ts
interface SystemOfRecordAdapter {
  readonly system: 'SAP' | 'KINAXIS' | 'O9';
  fetchItems(): Promise<Item[]>;
  fetchItemPlants(): Promise<ItemPlant[]>;
  fetchBoms(): Promise<BomLine[]>;
  fetchStock(): Promise<StockPosition[]>;
  fetchSupply(): Promise<SupplyElement[]>;
  fetchDemand(): Promise<DemandElement[]>;
  fetchSnapshot(): Promise<SystemSnapshot>;
  proposeWriteback(m: SnapshotMutation): Promise<WritebackPayload>; // returns payload, does not send
  healthCheck(): Promise<{ ok: boolean; lastSyncAt: string; latencyMs: number }>;
}
```

Mock adapters must return payloads shaped like the **real** APIs, then map them into the domain model. Use genuine field
names so the writeback preview and integration screen are truthful:

- **SAP S/4HANA** — OData V4 / CDS. `API_PRODUCT_SRV` (`A_Product`, `A_ProductPlant`), `API_MATERIAL_STOCK_SRV`,
  `API_PURCHASEORDER_PROCESS_SRV`, `API_PURCHASEREQ_PROCESS_SRV`, `API_BILL_OF_MATERIAL_SRV`, and MRP coverage views
  (`C_MRPMaterialCoverage`, `MRP Material Exceptions`). Clean core: side-by-side extension, no ABAP modification.
- **Kinaxis Maestro / RapidResponse** — REST APIs plus Bulk Data Services for loads above ~200k records; preserve the
  RapidResponse constructs (resources, control sets, worksheets, scenarios, versioning) across the boundary. Writeback
  lands in a **named scenario**, never the live plan — say this out loud in the demo, it signals you understand how
  Kinaxis is actually governed.
- **o9** — demand and consensus plan reads from the platform's tenant API / knowledge-graph export.

Latency and record counts in the mock adapters should be realistic (200–800ms, tens of thousands of records) so the
health screen is not obviously synthetic.

---

## 11. Seeded dataset — `confectionery` pack

Deterministic generation from a fixed seed (`mulberry32`, seed `20260811`). Same output every run, every machine.
Non-negotiable — the demo must be rehearsable.

**Network:** 3 own plants + 2 co-packers, 1 distribution centre.

**Items:** ~450 FG (bars, bagged/pouch, seasonal, king-size, multipack), ~120 SFG (chocolate mass, caramel, wafer,
coating compound), ~180 RM (cocoa liquor, cocoa butter, sugar, milk powder, palm oil, lecithin, almonds, peanuts,
flavours), ~150 PM (wrapper film, cartons, corrugated, labels, laminates). BOM depth 3–4 levels. ~40 vendors with
reliability spread 0.55–0.98.

**Demand:** 24 months history + 12 months forward. Seasonal peaks — Halloween (Sep–Oct), Christmas (Nov–Dec), Valentine
(Jan–Feb), Easter (Mar). Channel mix MT/GT/ECOM/EXPORT with differing margins and priorities. Demand variability
calibrated so X/Y/Z classification is meaningful.

### 11.1 Planted scenarios — the demo depends on these existing

Each must be reproducible and traceable to seeded facts, not injected exception rows.

| #   | Scenario                                                                                                             | Exceptions produced        | Demo purpose                                   |
| --- | -------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------- |
| 1   | **Cocoa butter lead-time drift** — VEND-114 maintained 21d, last 6 receipts average 38d                              | `B7`, `A8`, `A1` on 12 FGs | The hero. Master data decay nobody detects     |
| 2   | **Absent item** — new Halloween SKU has o9 forecast and Kinaxis demand, no SAP `ItemPlant`; cascades to 4 components | `B3`, `B2` ×4              | Generalises the original absent-items use case |
| 3   | **Inventory divergence** — Kinaxis shows 40,000 units at P2, SAP shows 12,000 unrestricted + 28,000 blocked          | `C2`                       | The plan is built on a false position          |

| 4 | **PM excess** — wrapper film with FOQ 500,000 against 1,300/day demand → 384 days cover | `D4`, `A5` |
Working-capital story, not just service | | 5 | **Shelf-life violation** — milk powder batch expires 11 days before its
pegged consumption | `D3` | Depth: batch-level, not just aggregate | | 6 | **Cross-plant imbalance** — SFG caramel: P1
holds 210 days cover, P3 stocks out day 22 | `A1` + `INVENTORY_REBALANCE` resolution | Resolution that costs nothing and
saves the order | | 7 | **Substitutable shortage** — lecithin short; approved substitute available at +4% cost | `A1` +
`SUBSTITUTE_COMPONENT` | Shows the alternates model | | 8 | **Safety stock misalignment** — 40 A-class items where
calculated SS is 2–3× maintained SS | `B8` ×40 | Systemic, not anecdotal | | 9 | **Parameter drift across systems** — 63
item-plants with different lead times in SAP vs Kinaxis | `C3` ×63 | Scale of the seam problem | | 10 | **Plan not
executed** — 18 Kinaxis planned orders with no SAP counterpart after 72h | `C4` ×18 | Closed-loop failure |

Expected totals at baseline: roughly 1,200–1,400 exceptions, **$17–20M exposure**, with the top ~12 carrying ~70% of it.
Tune generation to land in this band — the Pareto is the point.

---

## 12. Technical requirements

**Stack:** Next.js 15 (App Router) · TypeScript strict · Tailwind + shadcn/ui · Postgres via Drizzle (SQLite acceptable
for local demo) · TanStack Table + Virtual · Recharts (time-phased charts) · React Flow (pegging graph) · TanStack Query
· Zustand (UI state only) · Vitest.

**Repo layout:**

```
/apps/web
/packages/mrp-engine        # pure, no I/O, no React
/packages/adapters
/packages/domain            # shared types
/data-packs/confectionery
/scripts/seed.ts
/scripts/reset-demo.ts
```

**Hard requirements:**

1. **Determinism.** All randomness through a single seeded PRNG. `runMrp` must be a pure function of its inputs. Two
   runs, identical output.
2. **Engine isolation.** `packages/mrp-engine` imports nothing from `apps/web`, no database client, no `Date.now()` —
   `planningDate` is always injected.
3. **Test coverage.** Every lot-sizing rule, the working-day calendar walk, forecast consumption, multi-level explosion
   with scrap, phantom pass-through, cycle detection, and the Section 6.2 worked example, all as Vitest cases.
4. **Performance.** Typed arrays for bucket math. Precompute low-level codes once. Target < 2,000 ms for the full seeded
   dataset; log actual elapsed ms and surface it in the UI.
5. **Demo reset.** `npm run demo:reset` and an in-app button, both returning to the exact seeded initial state in under
   2 seconds.
6. **No dead ends.** Every clickable element does something. A dead link in front of this audience is worse than a
   missing feature.
7. **Empty and error states** must be designed, not default. Never show a raw stack trace.

**Explicitly do not build:** auth, onboarding flows, settings pages, marketing/landing pages, dark-mode toggle, mobile
layouts, real network calls to any external system.

---

## 13. Build phases

Each phase ends demoable on its own, so there is always something to show if time runs short.

**Phase 0 — Foundation.** Monorepo, domain types, Drizzle schema, seed script, data-pack loader, demo reset. _Done
when:_ `npm run seed` produces the full confectionery dataset deterministically and a smoke test asserts exact record
counts.

**Phase 1 — Engine.** Low-level codes, bucketing, forecast consumption, netting, all five lot-sizing rules,
calendar-aware offsetting, multi-level explosion with scrap, phantoms, pegging graph, class A + D exceptions. _Done
when:_ the Section 6.2 worked example passes as a test, and a full run over the seeded dataset completes under 2s.

**Phase 2 — Cockpit + Item 360 (S1, S2).** KPI strip, Pareto, exception queue with facets, PAB chart, editable
time-phased grid, parameter health rail. _Done when:_ editing safety stock in the grid triggers a re-plan and the queue
reorders live.

**Phase 3 — Resolution (S3).** Root-cause trace, resolution generation, simulation with diff, writeback preview with
real payload shapes. _Done when:_ simulating an alternate source on scenario 1 resolves the stockout, surfaces at least
one newly created exception, and renders a valid SAP PR payload.

**Phase 4 — The differentiators (S4, S5, S6).** Blast-radius graph, master data health with `B3`/`B7`/`B8`, three-system
reconciliation monitor. _Done when:_ the cocoa butter exception traces to 12 FGs and named customer orders in the graph,
and the reconciliation table shows all seeded class-C divergences.

**Phase 5 — Depth and polish (S7, S8, S9).** Scenario compare, integration architecture view, agent policy engine and
audit log, visual pass, empty/error states, demo rehearsal fixes. _Done when:_ the full 12-minute run-through executes
without a dead click.

---

## 14. Demo narrative — the app must support this arc

Build backwards from this. If a screen does not serve a beat here, it is Phase 5 or later.

| Time  | Beat                                                                                                                                                                                                                                      | Screen          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 0:00  | "1,247 exceptions. $18.4M at risk. Twelve of them are 71% of it. Your planners see these across three systems, ranked by none of that."                                                                                                   | S1              |
| 2:00  | Open the top exception. PAB dives through safety stock at day 14, stocks out day 18.                                                                                                                                                      | S2              |
| 3:30  | Root cause is not demand. Lead time says 21 days; the last six receipts averaged 38. The parameter was last touched in 2023. SAP and Kinaxis both plan faithfully on a number that stopped being true.                                    | S3 left         |
| 5:00  | Blast radius: one raw material → 12 finished SKUs → $4.2M of committed orders across two key accounts.                                                                                                                                    | S4              |
| 6:30  | Four resolutions with cost and service impact. Simulate the alternate source — it resolves this and creates two smaller exceptions downstream, which we also show. Commit → the exact SAP purchase requisition payload. Nothing was sent. | S3 centre/right |
| 8:30  | Why this happened at all: three systems, three versions of the truth. 63 items with different lead times. 18 Kinaxis plans that never reached SAP. Nobody owns this seam.                                                                 | S6              |
| 10:00 | And the systemic version: items carrying demand with no planning master at all. New launches that the supply model has never heard of.                                                                                                    | S5              |
| 11:00 | Overnight, 340 exceptions closed themselves under policy you write and can reverse.                                                                                                                                                       | S9              |
| 12:00 | How it runs: standard OData and REST, side-by-side, zero modification to SAP or Kinaxis, writeback into a named scenario.                                                                                                                 | S8              |

**Closing line:** _"You don't need a fourth planning system. You need something that makes the three you have tell the
truth to each other, and ranks what's left by money."_

---

## 15. Risks and mitigations

| Risk                                                     | Mitigation                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reads as "competing with Kinaxis"                        | Never say MRP engine standalone. Lead with the seam and the ranking. S8 exists precisely to defuse this                                                                  |
| Client confidentiality slip during the demo              | The §2.3 anonymisation rules are enforced in code and data, not just in what is said out loud. Nothing on screen names a client, vendor, or customer                     |
| "Is this work committed to another client?"              | Say it before they ask: that engagement is pre-sale with no commitment, and this prototype shares no code or data with it — only domain understanding                    |
| Confectionery domain feels distant from their categories | Lean into it rather than apologising — the planning failure modes are identical. Have the `fmcg-india` pack costed as a one-day build and offer it as the follow-up demo |
| "Where did this data come from?"                         | Answer immediately and unprompted: synthetic, seeded, generated by us. Show the seed script if asked                                                                     |
| Challenged on planning correctness                       | Open the Vitest suite and the Section 6.2 worked example live. This is why the engine is a pure, testable package                                                        |
| "How long to build the real thing?"                      | Have a phased answer ready before the meeting; the PRD's phase structure maps to it                                                                                      |

---

## 16. Appendix — implementation notes for Claude Code

- Build the engine **first**, with tests, before any UI. If the engine is wrong, the demo is unsalvageable; if the UI is
  rough, it is survivable.
- When a spec detail here conflicts with what makes the demo clearer, flag it rather than silently deviating.
- Prefer server-side computation with results streamed to the client. Do not ship the full snapshot to the browser.
- All monetary values in **USD**, `en-US` locale, `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`.
  Abbreviate above six figures (`$4.2M`, `$18.4M`); show full precision below (`$25,000`). Quantities to the item's base
  UoM precision. Never show more precision than the data supports.
- Every exception narrative must be **generated from evidence**, not selected from a template list. Templated prose is
  the fastest way to make a prototype feel fake.
- Log engine timing to the console and surface it in the UI. Speed is part of the story.
- Before declaring done, run the Section 14 arc end to end and fix every dead click.
