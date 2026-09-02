/**
 * The shapes the browser actually receives.
 *
 * Deliberately narrow. A run holds typed arrays, graph indexes and the whole
 * snapshot; none of that crosses the wire. Every screen reads a projection
 * sized for what it draws.
 *
 * One convention runs through all of it: **nothing appears without a unit and a
 * date.** A field carrying a quantity carries the unit beside it, and a field
 * carrying a bucket carries the week it falls in. "800" is not information.
 */

import type { ActionGroup, ExceptionCode, Severity } from '@repo/planning-engine';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export interface PlantOption {
  id: string;
  name: string;
  type: 'OWN' | 'COPACKER';
}

/**
 * The run header, on every screen.
 *
 * Not administrative hygiene. When a planner asks why a number differs from
 * Friday's, the first thing they need is confirmation that they are looking at
 * a different run — so every screen states which one it is looking at.
 */
export interface RunHeader {
  planningDate: string;
  /** ISO week of the planning date — `W36`. */
  planningWeek: string;
  runType: string;
  mpsVersion: string;
  category: string;
  pilotPlantId: string;
  horizonDays: number;
  /** Item-plants the engine actually planned. */
  materialsPlanned: number;
  elapsedMs: number;
  plants: PlantOption[];
}

/** A supply confidence tier, as the browser reads it. */
export interface TierView {
  tier: 1 | 2 | 3;
  label: string;
  fill: 'SOLID' | 'OUTLINE' | 'HATCHED';
}

// ---------------------------------------------------------------------------
// Screen 1 — Planning Position
// ---------------------------------------------------------------------------

/** A tile is a filter, not a decoration. `filter` is what it scopes the table to. */
export interface PositionTile {
  key: 'PLANNED' | 'STOCKOUTS' | 'BREACHES' | 'UNREACHABLE' | 'UNCONFIRMED' | 'EXCESS';
  label: string;
  count: number;
  note: string;
}

/**
 * One row of the drift panel — a material whose position moved since the
 * previous run, with the cause attributed.
 */
export interface DriftRow {
  itemId: string;
  plantId: string;
  description: string;
  baseUom: string;
  cause: string;
  causeLabel: string;
  detail: string;
  /** Days of cover at the previous run and at this one. */
  coverBefore: number;
  coverAfter: number;
  /** Positive means cover was lost. */
  coverLost: number;
  breachBefore: string | null;
  breachAfter: string | null;
}

export interface PositionRow {
  itemId: string;
  plantId: string;
  description: string;
  itemType: string;
  baseUom: string;
  abcClass: string;
  /** First date the honest balance falls below safety stock. */
  firstBreachDate: string | null;
  firstBreachWeek: string | null;
  /** Days until that breach. Null when there is none inside the horizon. */
  daysToBreach: number | null;
  daysOfCover: number;
  qtyAtRisk: number;
  valueAtRisk: number;
  /** The next receipt, and how much anybody has actually agreed to it. */
  nextReceipt: { date: string; week: string; qty: number; tier: TierView } | null;
  status: 'STOCK_OUT' | 'BREACH' | 'UNREACHABLE' | 'EXCESS' | 'OK';
  statusLabel: string;
  /** True when no order placed today can reach the exposure. */
  reachableByOrdering: boolean;
  maxNormDays: number | null;
  /**
   * The tiles this row belongs to.
   *
   * Computed once and read by both the count and the drill-down, so clicking a
   * tile shows exactly as many rows as the tile says.
   */
  tiles: PositionTile['key'][];
}

export interface PlanningPosition {
  header: RunHeader;
  tiles: PositionTile[];
  drift: DriftRow[];
  rows: PositionRow[];
  total: number;
}

// ---------------------------------------------------------------------------
// Screen 2 — Material Workbench
// ---------------------------------------------------------------------------

/** One bucket of the projection chart, with everything drawn at that x. */
export interface ChartBucket {
  index: number;
  label: string;
  week: string;
  kind: 'DAY' | 'WEEK' | 'MONTH';
  zone: 'EXECUTION' | 'SCHEDULING' | 'PROCUREMENT' | 'STRATEGIC';
  /** True on the first bucket of a zone — where the axis draws a boundary. */
  startsZone: boolean;
  startDate: string;
  endDate: string;
  demand: number;
  /** Supply, split by how much anybody has actually agreed to it. */
  confirmed: number;
  committed: number;
  planned: number;
  /** Quantity clearing quality inspection in this bucket. */
  qaRelease: number;
  /** The honest position: stock and existing orders, nothing proposed. */
  balanceBeforePlanned: number;
  /** The same, counting only supply somebody has acknowledged. */
  balanceConfirmedOnly: number;
  /** The plan, if everything proposed is actually done. */
  balanceAfterPlanned: number;
  /**
   * The same, less any order whose release date has already passed.
   *
   * The honest counterpart: a textbook MRP run always looks solvable, because
   * it happily plans a receipt for a date it can no longer be ordered for.
   * Drawn beside `balanceAfterPlanned`, the gap between them is the exposure
   * no purchase order can reach.
   */
  balanceAfterPlaceable: number;
  safetyStock: number;
  maxNorm: number | null;
  daysOfCover: number;
  /** Against the maintained fence. */
  fenceZone: 'FROZEN' | 'FIRM' | 'FREE';
  status: 'OK' | 'TIGHT' | 'BREACH' | 'STOCK_OUT' | 'EXCESS';
}

/**
 * One annotation in a grid cell that carries a date rather than a quantity.
 *
 * The planned-order release row is the case: under the bucket a receipt is
 * needed in, it names the week the order had to be placed. A quantity keyed to
 * the release bucket cannot say "week 39 needed ordering in week 26", which is
 * the single most useful thing the screen shows.
 */
export interface GridCell {
  text: string;
  tone: 'NEUTRAL' | 'PAST';
  releaseWeek: string;
  releaseDate: string;
  /** How many weeks the release date has already passed by. Zero when it has not. */
  weeksLate: number;
  qty: number;
}

/** One row of the classic planning grid. Fixed order, every cell explainable. */
export interface GridRow {
  key: string;
  label: string;
  /** Sub-rows are indented under the row they decompose. */
  indent: 0 | 1;
  values: number[];
  /** How the row collapses when days are bucketed into weeks. */
  aggregate: 'SUM' | 'LAST';
  emphasis: 'BALANCE' | 'THRESHOLD' | 'ANSWER' | 'NONE';
  /** Flags a cell red where the value is a date in the past, not a quantity. */
  tone: 'NEUTRAL' | 'NEGATIVE_IS_BAD' | 'PAST_IS_BAD';
  note: string | null;
  /**
   * Per-bucket annotations, where the row is dates rather than numbers.
   *
   * One array per bucket, because lot sizing can split a single requirement
   * across several receipts and each carries its own release date. Present only
   * on the rows that need it; `values` stays authoritative everywhere else.
   */
  cells?: GridCell[][];
}

/** One interval of the lead-time chain, with the function that owns it. */
export interface ChainIntervalView {
  key: string;
  label: string;
  days: number;
  owner: string;
  note: string;
}

export interface FenceView {
  totalDays: number;
  earliestReceiptDate: string;
  earliestReceiptWeek: string;
  earliestReceiptBucket: number;
}

export interface ParameterView {
  field: string;
  label: string;
  maintained: string;
  measured: string | null;
  status: 'FRESH' | 'DRIFTED' | 'MISSING' | 'STALE';
  /** Source system, field, and when it was last touched. */
  source: string;
  lastChangedOn: string;
  /** Who last touched it. A date on its own leaves the planner's next question open. */
  changedBy: string;
  note: string | null;
  /** True where the planner may override it from this screen. */
  editable: boolean;
}

export interface VendorSplitView {
  vendorId: string;
  vendorName: string | null;
  isPrimary: boolean;
  /** 0–1. */
  allocationShare: number;
  leadTimeDays: number;
  isImport: boolean;
  weeklyCapacity: number | null;
  shutdownWeeks: string[];
}

export interface MaterialDetail {
  header: RunHeader;
  itemId: string;
  plantId: string;
  description: string;
  itemType: string;
  baseUom: string;
  abcClass: string;
  itemCategoryId: string | null;
  standardCost: number;
  plannerCode: string | null;
  lowLevelCode: number;

  stock: { unrestricted: number; blocked: number; qualityInspection: number; inTransit: number };
  quarantine: Array<{ batchId: string; qty: number; receivedOn: string; expectedReleaseDate: string }>;
  safetyStock: number;
  maxNorm: number | null;

  buckets: ChartBucket[];
  grid: GridRow[];

  chain: ChainIntervalView[];
  fences: { maintained: FenceView; measured: FenceView | null; driftDays: number | null };
  parameters: ParameterView[];
  vendors: VendorSplitView[];

  firstBreachDate: string | null;
  firstStockoutDate: string | null;
  daysOfCoverToday: number;

  /** The order the plan recommends, where it recommends one. */
  recommendation: RecommendationView | null;
  /** Open orders, with their delivery lines. */
  orders: OrderView[];
  /** Exceptions on this material, ranked. */
  exceptions: ExceptionView[];
}

/** What the plan proposes, and whether it can still be placed. */
export interface RecommendationView {
  qty: number;
  /** What the requirement alone asked for, before any rule. */
  netRequirement: number;
  /** What the rules added on top of it. */
  lotSizingAddition: number;
  receiptDate: string;
  receiptWeek: string;
  releaseDate: string;
  releaseWeek: string;
  isReleaseInPast: boolean;
  /** How many weeks the release date has already passed by. */
  weeksLate: number;
  leadTimeDays: number;
}

// ---------------------------------------------------------------------------
// Screen 5 — Explain
// ---------------------------------------------------------------------------

/** One line of the arithmetic. Every operand carries its own provenance. */
export interface ExplainLine {
  label: string;
  value: number | null;
  uom: string;
  /** `+`, `−`, `=`, or blank for a heading. */
  operator: '' | '+' | '−' | '×' | '÷' | '=';
  source: string | null;
  emphasis: boolean;
  /** True where the operand itself expands into its own calculation. */
  expandable: boolean;
}

/** One step of the walk back up the bill of material to a number people know. */
export interface ChainStep {
  label: string;
  factorLabel: string;
  /** The multiplier or divisor applied at this step. */
  factor: number;
  operator: '×' | '÷';
  /** A decision somebody made, or a property of the process. They differ. */
  kind: 'DECISION' | 'PROCESS';
  resultQty: number;
  uom: string;
  itemId: string;
}

export interface ProvenanceRow {
  field: string;
  value: string;
  system: string;
  lastChangedOn: string;
  /** Who last touched it. A date on its own leaves the planner's next question open. */
  changedBy: string;
  /** Days since it was last touched. Master data set once is a fact worth seeing. */
  ageDays: number;
}

export interface ExplainPayload {
  itemId: string;
  plantId: string;
  /** Which cell this explains, where it was opened from one. */
  anchor: { row: string | null; label: string; week: string } | null;
  /** One sentence, before any table. Deterministic — the same numbers always
   * produce the same sentence. A generated narrative that cannot be reproduced
   * is the opposite of a trust layer. */
  sentence: string;
  arithmetic: ExplainLine[];
  /** Where the requirement came from, factor by factor. */
  chain: ChainStep[];
  provenance: ProvenanceRow[];
  /** The other material codes carrying the same chemistry. */
  categoryCheck: Array<{
    itemId: string;
    description: string;
    leadTimeDays: number;
    earliestReceiptDate: string;
    earliestReceiptWeek: string;
    reachesTheBreach: boolean;
  }>;
  /** The other components of the same parent, and whether they can move. */
  horizontalCheck: Array<{
    itemId: string;
    description: string;
    parentItemId: string;
    firstBreachDate: string | null;
    blocked: boolean;
  }>;
  /** Maintained against measured, with the receipts behind the measurement. */
  realityCheck: {
    maintainedDays: number | null;
    measuredDays: number | null;
    stdDevDays: number | null;
    matchedCount: number;
    unmatchedCount: number;
    receipts: ReceiptView[];
  };
}

// ---------------------------------------------------------------------------
// Screen 3 — Supply Timeline & PO Schedule Builder
// ---------------------------------------------------------------------------

export interface DeliveryLineView {
  orderId: string;
  line: number;
  qty: number;
  requestedDate: string;
  requestedWeek: string;
  committedDate: string | null;
  expectedDate: string;
  expectedWeek: string;
  tier: TierView;
  stage: string;
  /** Days the expected date sits after the requested one. */
  slipDays: number;
  /** That slip, in days of cover — five days on a fast mover is not five on a slow one. */
  coverLostDays: number;
  reasonCode: string | null;
  reasonLabel: string | null;
  note: string | null;
  grnDate: string | null;
  grnQty: number | null;
  qaReleasedOn: string | null;
  editable: boolean;
}

export interface OrderView {
  id: string;
  vendorId: string | null;
  vendorName: string | null;
  totalQty: number;
  /** Quantity somebody has acknowledged, and quantity nobody has. */
  confirmedQty: number;
  unconfirmedQty: number;
  lines: DeliveryLineView[];
}

export interface ScheduleLineView {
  line: number;
  week: string;
  date: string;
  dispatchDate: string;
  /** What the requirement alone asked for. */
  requirement: number;
  needQty: number;
  lotSizingAddition: number;
  idealQty: number;
  committedQty: number;
  delta: number;
  balanceAfter: number;
  constraint: string | null;
  constraintLabel: string | null;
  note: string;
  insideFence: boolean;
  unreachableByDays: number;
}

export interface ConstraintView {
  key: string;
  label: string;
  binding: boolean;
  value: number | null;
  note: string;
}

export interface ScheduleBuilderView {
  header: RunHeader;
  itemId: string;
  plantId: string;
  description: string;
  baseUom: string;
  vendorId: string | null;
  vendorName: string | null;
  safetyStock: number;
  openingBalance: number;
  /** The window the schedule covers, and why it is that long. */
  window: { fromDate: string; toDate: string; fromWeek: string; toWeek: string; days: number; reason: string };
  lines: ScheduleLineView[];
  totals: { ideal: number; committed: number; delta: number };
  constraints: ConstraintView[];
  /** The delta ledger, as prose, in the order a planner reads it. */
  ledger: string[];
  /** Ways to close the residual. Only levers the constraint set supports. */
  options: string[];
  residual: {
    weeks: string[];
    shortfall: number;
    shortfallDays: number;
    recoveredIn: string | null;
    stocksOut: boolean;
  } | null;
  /** The inbound timeline — every open order on this material. */
  orders: OrderView[];
  fence: FenceView;

  /**
   * Why this schedule cannot be sent. Empty means it can.
   *
   * Kept apart from `advisories` because the two are answered differently: a
   * broken ceiling is a mistake to fix, a residual exposure is a finding to
   * accept. The packaging hero's worked example ends in one of each.
   */
  blockingViolations: ScheduleViolationView[];
  advisories: ScheduleAdvisoryView[];
  /** What the engine would change elsewhere to fit an edit. Offered, not applied. */
  proposedCorrections: ProposedCorrectionView[];
  /** The lines the planner has set by hand, as they stand. */
  plannerLines: Array<{ line: number; qty: number }>;
}

export interface ScheduleViolationView {
  line: number | null;
  week: string;
  constraint: string;
  constraintLabel: string;
  qty: number;
  message: string;
}

export interface ScheduleAdvisoryView {
  line: number | null;
  week: string | null;
  kind: 'RESIDUAL_EXPOSURE' | 'INSIDE_FENCE';
  message: string;
}

export interface ProposedCorrectionView {
  line: number;
  week: string;
  from: number;
  to: number;
  reason: string;
}

/** What a prepared schedule would send. Produced, never transmitted. */
export interface SchedulePayloadView {
  itemId: string;
  plantId: string;
  description: string;
  baseUom: string;
  vendorId: string | null;
  vendorName: string | null;
  shipFrom: string | null;
  shipTo: string;
  preparedBy: string;
  reasonCode: string | null;
  note: string;
  lines: Array<{
    line: number;
    qty: number;
    requestedDeliveryDate: string;
    dispatchBy: string;
    changeFromPrevious: string | null;
  }>;
  /** Advisories the planner acknowledged in order to prepare this. */
  acknowledged: ScheduleAdvisoryView[];
}

// ---------------------------------------------------------------------------
// Screen 4 — Adherence
// ---------------------------------------------------------------------------

export interface ReceiptView {
  poId: string;
  vendorId: string;
  vendorName: string | null;
  orderedOn: string;
  promisedOn: string;
  acknowledgedOn: string | null;
  dispatchedOn: string | null;
  receivedOn: string;
  qaReleasedOn: string | null;
  orderedQty: number;
  qty: number;
  /** qty ÷ orderedQty. */
  fillRate: number;
  totalDays: number;
  /** Against the maintained chain. */
  deviationDays: number;
  reasonCode: string | null;
  reasonLabel: string | null;
  matched: boolean;
}

/** One interval of a receipt's slip, and whose it is. */
export interface IntervalSlip {
  key: string;
  label: string;
  owner: string;
  maintainedDays: number;
  actualDays: number;
  slipDays: number;
}

/** A distribution rather than an average — 104 reliable is not 104 as a coin toss. */
export interface Distribution {
  count: number;
  meanDays: number;
  medianDays: number;
  stdDevDays: number;
  minDays: number;
  maxDays: number;
  /** Histogram buckets, for drawing the spread. */
  buckets: Array<{ from: number; to: number; count: number }>;
}

export interface AdherenceLineView {
  itemId: string;
  plantId: string;
  description: string;
  baseUom: string;
  poId: string;
  line: number;
  requestedDate: string;
  committedDate: string | null;
  grnDate: string | null;
  qaReleasedOn: string | null;
  requestedQty: number;
  committedQty: number | null;
  receivedQty: number | null;
  fillRate: number | null;
  deviationDays: number | null;
  reasonCode: string | null;
  reasonLabel: string | null;
  intervals: IntervalSlip[];
}

export interface AdherenceByMaterial {
  itemId: string;
  plantId: string;
  description: string;
  baseUom: string;
  maintainedDays: number | null;
  distribution: Distribution;
  fillRate: number;
  /** measured − maintained. */
  driftDays: number | null;
  intervals: IntervalSlip[];
}

export interface AdherenceByVendor {
  vendorId: string;
  vendorName: string;
  materials: number;
  distribution: Distribution;
  fillRate: number;
  onTimeRate: number;
  /** Value the vendor currently holds in the open book. */
  openBookValue: number;
  intervals: IntervalSlip[];
}

export interface AdherenceView {
  header: RunHeader;
  lines: AdherenceLineView[];
  byMaterial: AdherenceByMaterial[];
  byVendor: AdherenceByVendor[];
  reasonCodes: Array<{ code: string; label: string; owner: string; count: number }>;
  /** What this screen deliberately does not do, stated on it. */
  boundary: string;
}

// ---------------------------------------------------------------------------
// Screen 6 — Exception Queue
// ---------------------------------------------------------------------------

export interface ExceptionView {
  id: string;
  code: ExceptionCode;
  group: ActionGroup;
  groupLabel: string;
  severity: Severity;
  itemId: string;
  plantId: string;
  description: string;
  baseUom: string;
  headline: string;
  biteDate: string;
  biteWeek: string;
  daysToBite: number;
  qtyAtStake: number;
  daysAtStake: number;
  valueAtStake: number;
  reachableByOrdering: boolean;
  /**
   * The engine's own ranking, by consequence rather than by count.
   *
   * Computed per exception and then thrown away, because it never reached the
   * browser: the queue re-sorted on time-to-breach and value, which cannot see
   * severity or reachability at all.
   */
  score: number;
  operands: Array<{ label: string; value: number; source: string }>;
  actions: string[];
  dismissed: boolean;
}

export interface ExceptionQueueView {
  header: RunHeader;
  groups: Array<{
    group: ActionGroup;
    label: string;
    note: string;
    count: number;
    valueAtStake: number;
    exceptions: ExceptionView[];
    /** How many of `count` the list below actually holds. */
    shown: number;
  }>;
  total: number;
}

// ---------------------------------------------------------------------------
// Screen 7 — Simulate & Override
// ---------------------------------------------------------------------------

export interface SimulationView {
  field: string;
  label: string;
  before: number | null;
  after: number | null;
  /** Both plans, side by side, on the figures a planner decides with. */
  metrics: Array<{
    label: string;
    before: string;
    after: string;
    delta: string;
    /** Whether the change made things better, worse or neither. */
    direction: 'BETTER' | 'WORSE' | 'SAME';
  }>;
  /** The balance either side, bucketed, so the chart can draw both. */
  beforeBalance: number[];
  afterBalance: number[];
  bucketLabels: string[];
  beforeFence: FenceView;
  afterFence: FenceView;
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// Screen 8 — PO Control Tower
// ---------------------------------------------------------------------------

export interface ControlTowerView {
  header: RunHeader;
  openBook: {
    rows: Array<{ state: string; lines: number; share: number; qty: number; value: number }>;
    totalLines: number;
    totalValue: number;
    /** The figure that should stop a category manager. */
    unconfirmedShare: number;
  };
  closedBook: {
    rows: Array<{ outcome: string; lines: number; share: number }>;
    totalLines: number;
    fillRate: number;
    /** Line-level on-time-in-full. Currently unknown at GCPL, which is the point. */
    otif: number;
    windowDays: number;
  };
  byPlant: Array<{ id: string; name: string; lines: number; value: number; unconfirmedShare: number }>;
  byVendor: Array<{
    id: string;
    name: string;
    lines: number;
    value: number;
    medianLeadTimeDays: number;
    spreadDays: number;
  }>;
  byRaiser: Array<{ raiser: string; lines: number; share: number }>;
  /** Stated on the screen, because the boundary is the product decision. */
  boundary: string;
}

// ---------------------------------------------------------------------------
// The decision log
// ---------------------------------------------------------------------------

export interface DecisionView {
  id: string;
  kind: string;
  itemId: string;
  plantId: string;
  target: string;
  before: string | null;
  after: string | null;
  reasonCode: string | null;
  reasonLabel: string | null;
  note: string;
  actor: string;
}
