/**
 * The twelve conditions of §5 step 11, one case each.
 *
 * There was no test file here at all, and the gaps that left were exactly the
 * ones a sampled test cannot see: a code declared and never emitted, an
 * `else if` swallowing the second of two findings, a filter that admitted an
 * alternate source which did not actually reach the exposure and then told the
 * planner to switch to it. None of those is a subtle bug. All of them survived
 * because nothing enumerated the list the requirements document asks for.
 *
 * Every case here is built from the smallest context that produces it, so a
 * failure names the condition rather than a fixture.
 */

import { describe, expect, it } from 'vitest';
import type { ItemPlant, ItemPlantPlan, ItemVendor, PlannedOrderExplanation } from '@repo/domain';

import { raiseExceptions, rankExceptions, type MaterialContext } from '../src/exceptions';
import { computeFences } from '../src/fences';
import { WorkingCalendar } from '../src/calendar';
import { itemPlant as makeItemPlant, CONTINUOUS_CALENDAR } from './fixtures';

const PLANNING_DATE = '2026-08-31';
const HORIZON = 90;
const CALENDAR = new WorkingCalendar(CONTINUOUS_CALENDAR, PLANNING_DATE, 200);

/** A flat series, so a case only has to say what it changes. */
function series(fill: number): Float64Array {
  return new Float64Array(HORIZON + 1).fill(fill);
}

function plan(overrides: Partial<ItemPlantPlan> = {}): ItemPlantPlan {
  return {
    itemId: 'RM-1',
    plantId: 'P1',
    lowLevelCode: 1,
    openingStock: 1_000,
    safetyStock: 500,
    grossRequirements: series(10),
    underlyingDemand: series(10),
    scheduledReceipts: series(0),
    confirmedReceipts: series(0),
    committedReceipts: series(0),
    qaReleases: series(0),
    netRequirements: series(0),
    plannedReceipts: series(0),
    projectedAvailable: series(1_000),
    projectedBeforePlanned: series(1_000),
    projectedConfirmedOnly: series(1_000),
    projectedAvailableFeasible: series(1_000),
    daysOfCover: series(30),
    ...overrides,
  };
}

function context(overrides: Partial<MaterialContext> = {}): MaterialContext {
  const master: ItemPlant = makeItemPlant({ itemId: 'RM-1', plantId: 'P1', leadTimeDays: 30, safetyStock: 500 });
  return {
    itemId: 'RM-1',
    plantId: 'P1',
    description: 'A raw material',
    baseUom: 'MT',
    standardCost: 100,
    itemPlant: master,
    vendor: { vendorId: 'V-1' } as ItemVendor,
    plan: plan(),
    fences: computeFences({
      planningEpochDay: 0,
      calendar: CALENDAR,
      maintainedChainDays: 30,
      measuredTotalDays: null,
      horizonDays: HORIZON,
    }),
    orders: [],
    recovery: null,
    dailyDemandMean: 10,
    observedLeadTimeDays: null,
    maxNormDays: null,
    shelfLifeDays: null,
    openLines: [],
    categorySiblings: [],
    horizontalSiblings: [],
    hasBom: true,
    expiringBatches: [],
    ...overrides,
  };
}

/** The codes raised, for the assertion every case makes. */
function codes(ctx: MaterialContext): string[] {
  return raiseExceptions(ctx, HORIZON).map((row) => row.code);
}

function order(overrides: Partial<PlannedOrderExplanation> = {}): PlannedOrderExplanation {
  return {
    itemId: 'RM-1',
    plantId: 'P1',
    qty: 1_000,
    ruleQty: 1_000,
    netRequirement: 120,
    threshold: 500,
    balanceBefore: 380,
    requirementDay: 20,
    receiptDate: '2026-09-20',
    releaseDate: '2026-06-20',
    releaseDay: -72,
    isReleaseInPast: true,
    effectiveLeadTimeDays: 30,
    totalOffsetDays: 30,
    requirementId: 'RM-1@P1#20',
    ...overrides,
  };
}

describe('1 — projected stock-out', () => {
  it('fires where the honest balance goes below zero', () => {
    const balance = series(1_000);
    balance[40] = -200;
    expect(codes(context({ plan: plan({ projectedAvailableFeasible: balance }) }))).toContain('PROJECTED_STOCKOUT');
  });
});

describe('2 — safety-stock breach', () => {
  it('fires where the balance eats the buffer without going negative', () => {
    const balance = series(1_000);
    balance[40] = 300;
    const raised = codes(context({ plan: plan({ projectedAvailableFeasible: balance }) }));
    expect(raised).toContain('SAFETY_STOCK_BREACH');
    expect(raised).not.toContain('PROJECTED_STOCKOUT');
  });
});

describe('3 — unreachable requirement', () => {
  const balance = series(1_000);
  balance[40] = 300;

  it('fires where the order the plan asks for needed releasing before today', () => {
    expect(codes(context({ plan: plan({ projectedAvailableFeasible: balance }), orders: [order()] }))).toContain(
      'UNREACHABLE_REQUIREMENT'
    );
  });

  it('prices the shortfall, not the lot-sized quantity', () => {
    const raised = raiseExceptions(
      context({ plan: plan({ projectedAvailableFeasible: balance }), orders: [order()] }),
      HORIZON
    );
    const row = raised.find((entry) => entry.code === 'UNREACHABLE_REQUIREMENT');
    // The order is 1,000; the shortage behind it is 120. Ordering 1,000 to close
    // a 120 gap does not make the business 1,000 short.
    expect(row?.qtyAtStake).toBe(120);
    expect(row?.operands.find((operand) => operand.label === 'Executable order quantity')?.value).toBe(1_000);
  });

  it('counts one shortage once, however many slices it was cut into', () => {
    // A max-lot split emits one order per slice, each carrying the same
    // requirement. Summing across orders reported it three times over.
    const slices = [order({ qty: 4_000 }), order({ qty: 4_000 }), order({ qty: 4_000 })];
    const raised = raiseExceptions(
      context({ plan: plan({ projectedAvailableFeasible: balance }), orders: slices }),
      HORIZON
    );
    const row = raised.find((entry) => entry.code === 'UNREACHABLE_REQUIREMENT');
    expect(row?.qtyAtStake).toBe(120);
    expect(row?.operands.find((operand) => operand.label === 'Executable order quantity')?.value).toBe(12_000);
  });

  it('counts two distinct shortages separately', () => {
    const raised = raiseExceptions(
      context({
        plan: plan({ projectedAvailableFeasible: balance }),
        orders: [order(), order({ requirementId: 'RM-1@P1#40', netRequirement: 80, requirementDay: 40 })],
      }),
      HORIZON
    );
    expect(raised.find((entry) => entry.code === 'UNREACHABLE_REQUIREMENT')?.qtyAtStake).toBe(200);
  });
});

describe('reachability, decided by what ordering actually closes', () => {
  const balance = series(1_000);
  balance[40] = -200;

  /** A recovery pass that closed the whole exposure. */
  const closed = {
    orders: [
      {
        itemId: 'RM-1',
        plantId: 'P1',
        qty: 500,
        slices: [500],
        receiptDay: 30,
        receiptDate: '2026-09-30',
        releaseDate: '2026-08-31',
        coversRequirementIds: ['RM-1@P1#20'],
        sizingTrace: [],
      },
    ],
    blocked: [],
    projectedAvailableRecovered: series(1_000),
    unavoidableQty: 0,
    recoverableQty: 200,
    residualQty: 0,
    residualAfterFenceQty: 0,
    firstResidualDay: -1,
  };

  it('is reachable when recovery closes it, whatever the bite day', () => {
    const raised = raiseExceptions(
      context({ plan: plan({ projectedAvailableFeasible: balance }), recovery: closed }),
      HORIZON
    );
    const row = raised.find((entry) => entry.code === 'PROJECTED_STOCKOUT');
    expect(row?.reachableByOrdering).toBe(true);
    expect(row?.group).toBe('ORDER_NOW');
  });

  it('is not reachable when a constraint blocks the recovery, even past the fence', () => {
    // The exposure bites on day 40, well right of a 30-day fence, so the old
    // test would have called this reachable and told the planner to order. The
    // vendor cannot make it.
    const raised = raiseExceptions(
      context({
        plan: plan({ projectedAvailableFeasible: balance }),
        recovery: {
          ...closed,
          orders: [],
          recoverableQty: 0,
          residualQty: 200,
          residualAfterFenceQty: 200,
          blocked: [{ receiptDay: 40, qty: 500, blockedBy: 'VENDOR_CAPACITY', detail: 'x' }],
        },
      }),
      HORIZON
    );
    const row = raised.find((entry) => entry.code === 'PROJECTED_STOCKOUT');
    expect(row?.reachableByOrdering).toBe(false);
    expect(row?.group).toBe('CANNOT_ORDER');
    // And it must not then tell anyone to place the order this week.
    expect(row?.actions.join(' ')).not.toContain('Place the order this week');
  });

  it('never pairs an unreachable headline with an order-it-now action', () => {
    for (const recovery of [
      null,
      { ...closed, orders: [], recoverableQty: 0, residualQty: 200, residualAfterFenceQty: 200 },
    ]) {
      const raised = raiseExceptions(
        context({ plan: plan({ projectedAvailableFeasible: balance }), recovery }),
        HORIZON
      );
      for (const row of raised) {
        if (row.reachableByOrdering) continue;
        expect(row.actions.join(' '), `${row.code} contradicts itself`).not.toContain('Place the order this week');
      }
    }
  });
});

describe('4 — an alternate source reaches it', () => {
  const balance = series(1_000);
  balance[5] = 300;

  /** The exposure bites on day 5, inside this material's own 30-day fence. */
  const unreachable = { plan: plan({ projectedAvailableFeasible: balance }) };

  it('fires where the alternate actually lands before the exposure bites', () => {
    const raised = codes(
      context({
        ...unreachable,
        categorySiblings: [{ itemId: 'RM-2', description: 'The local twin', earliestReceiptDay: 4, leadTimeDays: 4 }],
      })
    );
    expect(raised).toContain('ALTERNATE_SOURCE_REACHES');
  });

  it('does not fire for an alternate that is merely faster and still too late', () => {
    // Twenty days beats this material's thirty and reaches nothing: the
    // exposure bit fifteen days earlier. Raising it here put "fix by switching
    // source" above an exception that fixed nothing.
    const raised = codes(
      context({
        ...unreachable,
        categorySiblings: [
          {
            itemId: 'RM-2',
            description: 'A faster code that still cannot reach it',
            earliestReceiptDay: 20,
            leadTimeDays: 20,
          },
        ],
      })
    );
    expect(raised).not.toContain('ALTERNATE_SOURCE_REACHES');
  });
});

describe('5 — pull-in', () => {
  it('fires where an open line lands after the bucket that needs it', () => {
    const balance = series(1_000);
    balance[20] = 300;
    const raised = codes(
      context({
        plan: plan({ projectedAvailableFeasible: balance }),
        openLines: [
          {
            orderId: 'PO-1',
            line: 10,
            qty: 500,
            expectedDay: 40,
            expectedDate: '2026-10-10',
            tier: 2,
            vendorId: 'V-1',
            vendorName: 'A vendor',
            hasGrn: false,
            plannedDay: 40,
            plannedDate: '2026-10-10',
            confirmedDate: null,
          },
        ],
      })
    );
    expect(raised).toContain('PULL_IN');
  });
});

describe('6 — push-out', () => {
  it('fires where a line lands into cover already beyond the maximum norm', () => {
    // The mirror of the pull-in, and the half that was declared and never
    // written. `EXCESS_RISK` has been telling planners to "push out the next
    // inbound line" without anything naming which line that is.
    const raised = codes(
      context({
        maxNormDays: 20,
        plan: plan({ daysOfCover: series(60) }),
        openLines: [
          {
            orderId: 'PO-9',
            line: 10,
            qty: 400,
            expectedDay: 30,
            expectedDate: '2026-09-30',
            tier: 2,
            vendorId: 'V-1',
            vendorName: 'A vendor',
            hasGrn: false,
            plannedDay: 30,
            plannedDate: '2026-09-30',
            confirmedDate: null,
          },
        ],
      })
    );
    expect(raised).toContain('PUSH_OUT');
  });

  it('fires where a line lands on a position the floor cannot hold', () => {
    const raised = codes(
      context({
        itemPlant: makeItemPlant({
          itemId: 'RM-1',
          plantId: 'P1',
          leadTimeDays: 30,
          safetyStock: 500,
          storageCapacity: 800,
        }),
        openLines: [
          {
            orderId: 'PO-9',
            line: 10,
            qty: 400,
            expectedDay: 30,
            expectedDate: '2026-09-30',
            tier: 2,
            vendorId: 'V-1',
            vendorName: 'A vendor',
            hasGrn: false,
            plannedDay: 30,
            plannedDate: '2026-09-30',
            confirmedDate: null,
          },
        ],
      })
    );
    expect(raised).toContain('PUSH_OUT');
  });

  it('stays quiet where the position wants the delivery', () => {
    const raised = codes(
      context({
        maxNormDays: 90,
        openLines: [
          {
            orderId: 'PO-9',
            line: 10,
            qty: 400,
            expectedDay: 30,
            expectedDate: '2026-09-30',
            tier: 2,
            vendorId: 'V-1',
            vendorName: 'A vendor',
            hasGrn: false,
            plannedDay: 30,
            plannedDate: '2026-09-30',
            confirmedDate: null,
          },
        ],
      })
    );
    expect(raised).not.toContain('PUSH_OUT');
  });
});

describe('7 — past due', () => {
  it('fires where a receipt is past its date with no goods receipt', () => {
    const raised = codes(
      context({
        openLines: [
          {
            orderId: 'PO-2',
            line: 10,
            qty: 300,
            expectedDay: -9,
            expectedDate: '2026-08-22',
            tier: 1,
            vendorId: 'V-1',
            vendorName: 'A vendor',
            hasGrn: false,
            plannedDay: -9,
            plannedDate: '2026-08-22',
            confirmedDate: null,
          },
        ],
      })
    );
    expect(raised).toContain('PAST_DUE');
  });

  it('stays quiet once the goods receipt is posted', () => {
    const raised = codes(
      context({
        openLines: [
          {
            orderId: 'PO-2',
            line: 10,
            qty: 300,
            expectedDay: -9,
            expectedDate: '2026-08-22',
            tier: 1,
            vendorId: 'V-1',
            vendorName: 'A vendor',
            hasGrn: true,
            plannedDay: -9,
            plannedDate: '2026-08-22',
            confirmedDate: null,
          },
        ],
      })
    );
    expect(raised).not.toContain('PAST_DUE');
  });
});

describe('a confirmation later than the order asked for', () => {
  const line = {
    orderId: 'PO-4',
    line: 10,
    qty: 600,
    expectedDay: 30,
    expectedDate: '2026-09-30',
    tier: 1 as const,
    vendorId: 'V-1',
    vendorName: 'A vendor',
    hasGrn: false,
    plannedDay: 18,
    plannedDate: '2026-09-18',
    confirmedDate: '2026-09-30',
  };

  it('fires where the slip opens a shortfall the ordered date would have covered', () => {
    const balance = series(1_000);
    for (let day = 18; day < 30; day += 1) balance[day] = 200;
    const raised = context({ plan: plan({ projectedAvailableFeasible: balance }), openLines: [line] });
    const exception = raiseExceptions(raised, HORIZON).find((row) => row.code === 'CONFIRMED_LATE');
    expect(exception?.headline).toContain('12 days after');
    // 300 below a 500 buffer; the 600 on the line would have closed all of it.
    expect(exception?.qtyAtStake).toBe(300);
  });

  it('stays quiet when the position carries the slip', () => {
    const raised = codes(context({ openLines: [line] }));
    expect(raised).not.toContain('CONFIRMED_LATE');
  });
});

describe('8 — unconfirmed supply in a critical week', () => {
  it('fires where removing the unacknowledged lines runs the material out', () => {
    // Tier 2, per §6.4. The requirements document's exception table says Tier 3
    // here and contradicts its own §6.4, which is the section that defines the
    // tiers: a Tier-3-avoided breach is still a breach, and is raised as one.
    const confirmedOnly = series(1_000);
    confirmedOnly[10] = 200;
    const raised = codes(
      context({
        plan: plan({ projectedConfirmedOnly: confirmedOnly }),
        openLines: [
          {
            orderId: 'PO-3',
            line: 20,
            qty: 900,
            expectedDay: 12,
            expectedDate: '2026-09-12',
            tier: 2,
            vendorId: 'V-1',
            vendorName: 'A vendor',
            hasGrn: false,
            plannedDay: 12,
            plannedDate: '2026-09-12',
            confirmedDate: null,
          },
        ],
      })
    );
    expect(raised).toContain('UNCONFIRMED_SUPPLY');
  });
});

describe('9 — lead-time drift', () => {
  it('fires where measured deviates materially from maintained', () => {
    expect(codes(context({ observedLeadTimeDays: 45 }))).toContain('LEAD_TIME_DRIFT');
  });

  it('stays quiet inside the threshold', () => {
    expect(codes(context({ observedLeadTimeDays: 33 }))).not.toContain('LEAD_TIME_DRIFT');
  });
});

describe('10 — excess and obsolescence', () => {
  it('fires on cover beyond the maximum norm', () => {
    expect(codes(context({ maxNormDays: 20, plan: plan({ daysOfCover: series(60) }) }))).toContain('EXCESS_RISK');
  });

  it('reports the norm *and* the shelf life, not whichever is tested first', () => {
    // An `else if` here reported only the norm breach, and did it at the lower
    // of the two severities because the norm branch is tested first.
    const raised = raiseExceptions(
      context({ maxNormDays: 20, shelfLifeDays: 40, plan: plan({ daysOfCover: series(60) }) }),
      HORIZON
    ).filter((row) => row.code === 'EXCESS_RISK');

    expect(raised.length).toBeGreaterThanOrEqual(2);
    expect(raised.some((row) => row.headline.includes('maximum norm'))).toBe(true);
    expect(raised.some((row) => row.headline.includes('shelf life'))).toBe(true);
  });

  it('fires on a batch dated to expire, whatever the forward cover says', () => {
    // Expiry is a different question from cover, and the data has been in the
    // snapshot the whole time with nothing reading it.
    const raised = codes(
      context({
        shelfLifeDays: 120,
        expiringBatches: [{ batchId: 'B-1', qty: 400, expiryDate: '2026-09-10', daysToExpiry: 10 }],
      })
    );
    expect(raised).toContain('EXCESS_RISK');
  });
});

describe('11 — horizontal block', () => {
  it('fires where a sibling of the same parent cannot move either', () => {
    const balance = series(1_000);
    balance[20] = 300;
    const raised = codes(
      context({
        plan: plan({ projectedAvailableFeasible: balance }),
        horizontalSiblings: [
          {
            itemId: 'RM-9',
            description: 'The other oil in the blend',
            parentItemId: 'SFG-1',
            firstBreachDay: 18,
            unreachable: true,
          },
        ],
      })
    );
    expect(raised).toContain('HORIZONTAL_BLOCK');
  });
});

describe('12 — master-data gap', () => {
  it.each([
    ['lead time', makeItemPlant({ itemId: 'RM-1', plantId: 'P1', leadTimeDays: null, safetyStock: 500 })],
    ['safety stock', makeItemPlant({ itemId: 'RM-1', plantId: 'P1', leadTimeDays: 30, safetyStock: null })],
    [
      'lot-sizing rule',
      makeItemPlant({ itemId: 'RM-1', plantId: 'P1', leadTimeDays: 30, safetyStock: 500, lotSizeRule: null }),
    ],
  ])('fires on a missing %s', (_label, master) => {
    expect(codes(context({ itemPlant: master }))).toContain('MASTER_DATA_GAP');
  });

  it('fires on an approved source a bought material does not have', () => {
    expect(codes(context({ vendor: null }))).toContain('MASTER_DATA_GAP');
  });

  it('fires on a made material with no bill of material', () => {
    // The gap with the largest consequence, and the one the check never looked
    // for: nothing below it raises a requirement at all.
    const raised = codes(
      context({
        itemPlant: makeItemPlant({
          itemId: 'SFG-1',
          plantId: 'P1',
          procurementType: 'MAKE',
          leadTimeDays: 3,
          safetyStock: 500,
        }),
        vendor: null,
        hasBom: false,
      })
    );
    expect(raised).toContain('MASTER_DATA_GAP');
    expect(
      raiseExceptions(
        context({
          itemPlant: makeItemPlant({
            itemId: 'SFG-1',
            plantId: 'P1',
            procurementType: 'MAKE',
            leadTimeDays: 3,
            safetyStock: 500,
          }),
          vendor: null,
          hasBom: false,
        }),
        HORIZON
      ).find((row) => row.code === 'MASTER_DATA_GAP')?.headline
    ).toContain('bill of material');
  });

  it('stays quiet on a material whose master data is complete', () => {
    expect(codes(context())).not.toContain('MASTER_DATA_GAP');
  });
});

describe('every code the union declares is reachable', () => {
  it('leaves none of the twelve unemittable', () => {
    // `PUSH_OUT` sat in this union for the life of the module without a single
    // path raising it, and nothing noticed because nothing counted.
    const raised = new Set<string>();
    const balance = series(1_000);
    balance[5] = -100;
    const confirmedOnly = series(1_000);
    confirmedOnly[10] = 200;

    // Short between the day ordered for and the day confirmed for.
    const late = series(1_000);
    for (let day = 18; day < 30; day += 1) late[day] = 200;
    const cases: MaterialContext[] = [
      context({ plan: plan({ projectedAvailableFeasible: balance }) }),
      context({ plan: plan({ projectedAvailableFeasible: series(1_000).map(() => 300) as unknown as Float64Array }) }),
      context({ plan: plan({ projectedAvailableFeasible: balance }), orders: [order()] }),
      context({
        plan: plan({ projectedAvailableFeasible: balance }),
        categorySiblings: [{ itemId: 'RM-2', description: 'The twin', earliestReceiptDay: 2, leadTimeDays: 2 }],
      }),
      context({
        plan: plan({ projectedAvailableFeasible: balance }),
        openLines: [
          {
            orderId: 'PO-1',
            line: 10,
            qty: 500,
            expectedDay: 40,
            expectedDate: '2026-10-10',
            tier: 2,
            vendorId: 'V-1',
            vendorName: 'V',
            hasGrn: false,
            plannedDay: 40,
            plannedDate: '2026-10-10',
            confirmedDate: null,
          },
        ],
      }),
      context({
        maxNormDays: 20,
        plan: plan({ daysOfCover: series(60) }),
        openLines: [
          {
            orderId: 'PO-9',
            line: 10,
            qty: 400,
            expectedDay: 30,
            expectedDate: '2026-09-30',
            tier: 2,
            vendorId: 'V-1',
            vendorName: 'V',
            hasGrn: false,
            plannedDay: 30,
            plannedDate: '2026-09-30',
            confirmedDate: null,
          },
        ],
      }),
      context({
        openLines: [
          {
            orderId: 'PO-2',
            line: 10,
            qty: 300,
            expectedDay: -9,
            expectedDate: '2026-08-22',
            tier: 1,
            vendorId: 'V-1',
            vendorName: 'V',
            hasGrn: false,
            plannedDay: -9,
            plannedDate: '2026-08-22',
            confirmedDate: null,
          },
        ],
      }),
      context({
        plan: plan({ projectedConfirmedOnly: confirmedOnly }),
        openLines: [
          {
            orderId: 'PO-3',
            line: 20,
            qty: 900,
            expectedDay: 12,
            expectedDate: '2026-09-12',
            tier: 2,
            vendorId: 'V-1',
            vendorName: 'V',
            hasGrn: false,
            plannedDay: 12,
            plannedDate: '2026-09-12',
            confirmedDate: null,
          },
        ],
      }),
      context({
        plan: plan({ projectedAvailableFeasible: late }),
        openLines: [
          {
            orderId: 'PO-4',
            line: 10,
            qty: 600,
            expectedDay: 30,
            expectedDate: '2026-09-30',
            tier: 1,
            vendorId: 'V-1',
            vendorName: 'V',
            hasGrn: false,
            plannedDay: 18,
            plannedDate: '2026-09-18',
            confirmedDate: '2026-09-30',
          },
        ],
      }),
      context({ observedLeadTimeDays: 45 }),
      context({ maxNormDays: 20, plan: plan({ daysOfCover: series(60) }) }),
      context({
        plan: plan({ projectedAvailableFeasible: balance }),
        horizontalSiblings: [
          { itemId: 'RM-9', description: 'A sibling', parentItemId: 'SFG-1', firstBreachDay: 3, unreachable: true },
        ],
      }),
      context({ vendor: null }),
    ];

    for (const each of cases) for (const code of codes(each)) raised.add(code);

    for (const code of [
      'PROJECTED_STOCKOUT',
      'SAFETY_STOCK_BREACH',
      'UNREACHABLE_REQUIREMENT',
      'ALTERNATE_SOURCE_REACHES',
      'PULL_IN',
      'PUSH_OUT',
      'PAST_DUE',
      'UNCONFIRMED_SUPPLY',
      'CONFIRMED_LATE',
      'LEAD_TIME_DRIFT',
      'EXCESS_RISK',
      'HORIZONTAL_BLOCK',
      'MASTER_DATA_GAP',
    ]) {
      expect(raised.has(code), `${code} is declared and never emitted`).toBe(true);
    }
  });
});

describe('ranking, by consequence rather than by count', () => {
  it('puts an exposure no order can reach above one that is merely larger', () => {
    const soon = series(1_000);
    soon[2] = -500;
    const later = series(1_000);
    later[80] = -5_000;

    const [first] = rankExceptions([
      ...raiseExceptions(context({ plan: plan({ projectedAvailableFeasible: later }) }), HORIZON),
      ...raiseExceptions(context({ plan: plan({ projectedAvailableFeasible: soon }) }), HORIZON),
    ]);

    expect(first?.biteDay).toBe(2);
  });
});

describe('exposure on an existing line, as a counterfactual', () => {
  /** A position that dips 200 below its 500 buffer on day 40. */
  const balance = series(1_000);
  balance[40] = 300;

  it('prices an overdue line by what its absence costs, not by its weight', () => {
    const raised = raiseExceptions(
      context({
        plan: plan({ projectedAvailableFeasible: balance }),
        openLines: [
          {
            orderId: 'PO-1',
            line: 10,
            qty: 5_000,
            expectedDay: -30,
            expectedDate: '2026-08-01',
            tier: 2,
            vendorId: 'V-1',
            vendorName: 'A vendor',
            hasGrn: false,
            plannedDay: -30,
            plannedDate: '2026-08-01',
            confirmedDate: null,
          },
        ],
      }),
      HORIZON
    );
    const row = raised.find((entry) => entry.code === 'PAST_DUE');
    // The line is 5,000. Removing it deepens the worst shortfall from 200 to
    // 5,200, so it is worth 5,000 — capped at the line, which is the whole of it
    // here. What matters is that the number came from the balance, not the
    // weight: with a smaller line the two diverge.
    expect(row?.qtyAtStake).toBe(5_000);
    expect(row?.operands.find((o) => o.label === 'Worst shortfall as planned')?.value).toBe(200);
  });

  it('caps that exposure at the line, however deep the hole', () => {
    const deep = series(1_000);
    deep[40] = -9_000;
    const raised = raiseExceptions(
      context({
        plan: plan({ projectedAvailableFeasible: deep }),
        openLines: [
          {
            orderId: 'PO-1',
            line: 10,
            qty: 100,
            expectedDay: -30,
            expectedDate: '2026-08-01',
            tier: 2,
            vendorId: 'V-1',
            vendorName: 'A vendor',
            hasGrn: false,
            plannedDay: -30,
            plannedDate: '2026-08-01',
            confirmedDate: null,
          },
        ],
      }),
      HORIZON
    );
    // A 100 MT line cannot be responsible for a 9,500 MT hole.
    expect(raised.find((entry) => entry.code === 'PAST_DUE')?.qtyAtStake).toBe(100);
  });

  it('prices a late line by what advancing it is worth', () => {
    const raised = raiseExceptions(
      context({
        plan: plan({ projectedAvailableFeasible: balance }),
        openLines: [
          {
            orderId: 'PO-2',
            line: 20,
            qty: 5_000,
            expectedDay: 60,
            expectedDate: '2026-10-30',
            tier: 2,
            vendorId: 'V-1',
            vendorName: 'A vendor',
            hasGrn: false,
            plannedDay: 60,
            plannedDate: '2026-10-30',
            confirmedDate: null,
          },
        ],
      }),
      HORIZON
    );
    const row = raised.find((entry) => entry.code === 'PULL_IN');
    // Advancing it from day 60 to day 40 closes the whole 200 dip, and is worth
    // exactly that — not the 5,000 the line happens to carry.
    expect(row?.qtyAtStake).toBe(200);
  });
});
