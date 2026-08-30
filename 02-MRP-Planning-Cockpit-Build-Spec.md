# MRP Planning Cockpit — Build Specification

**Companion to:** `01-MRP-Planning-Cockpit-Product-Brief.md` — read that first for the objective, the demo story and the
screens in plain language. This document is the engineering and UI/UX specification for building it. **For:** Claude
Code **Repo:** `mrp-cockpit-prototype/` **Author:** Utsav Arora · Version 1.0 · 30 August 2026

---

## 0. How to use this document

The prototype exists to earn a discovery green light from GCPL Procurement & Supply Planning via a ~5 minute demo video.
Everything here is subordinate to that.

**Three rules that override any other instruction in this file:**

1. **If it isn't in the demo (Brief §6), it isn't in the build.** The previous iteration failed because it kept adding
   without removing.
2. **Every number on screen must be computed from seeded data.** No hardcoded figures, no illustrative charts. The
   client interrogates inputs — the last demo died on _"where does this number come from?"_
3. **Delete before you build.** Section 2 is not optional cleanup to do later. It is step zero.

---

## 1. The reuse decision

**Verdict: fork `sourabh-feedbacks`, delete roughly 60% of it, then build. Do not start from scratch, and do not start
from `next-prototype-template`.**

### What the audit found

Both `main` and `sourabh-feedbacks` carry the **identical twelve routes**. The feedback branch added components without
removing anything — good work bolted onto a broken information architecture. That is the whole explanation for why the
current prototype is incomprehensible.

`next-prototype-template` is the bare scaffold. `mrp-cockpit-prototype` already contains it plus everything since, so
starting there would only mean re-doing setup.

### Keep

| Asset                                                                    | Why                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Turborepo + Next 16 + React 19 + Tailwind 4 workspace**                | Correctly configured. Rebuilding gains nothing                                                                                                                                                                                                             |
| **`packages/ui` — the shadcn kit (50+ components)**                      | Standard, complete, unmodified. Keep entirely                                                                                                                                                                                                              |
| **`packages/ui/src/styles/globals.css` — the Heizen palette**            | **Important: the design tokens are not the problem.** Neutral grayscale, single teal accent, oklch, light + dark, chart ramp. The ugliness is information architecture and composition, not palette. Do not rewrite this file beyond the additions in §4.3 |
| **`packages/mrp-engine/src/calendar.ts`**                                | 130 LOC, genuinely well built — precomputed Int32Array working-day windows, correct backwards walking. Reuse as-is                                                                                                                                         |
| **`packages/mrp-engine/src/low-level-codes.ts`**                         | Topological BOM sort with cycle handling. Reuse as-is                                                                                                                                                                                                      |
| **`packages/mrp-engine/src/netting.ts`**                                 | 321 LOC. The bucket walk is correct and handles past-due release deliberately. Adapt per §5.1, don't rewrite                                                                                                                                               |
| **`packages/mrp-engine/src/lot-sizing.ts`**                              | Reuse, but it becomes an input to the scheduling engine rather than a terminal step                                                                                                                                                                        |
| **`packages/mrp-engine/src/forecast-consumption.ts`**, **`observed.ts`** | Small and sound                                                                                                                                                                                                                                            |
| **`packages/data-packs/src/prng.ts`**                                    | Seeded PRNG. Determinism depends on it                                                                                                                                                                                                                     |
| **`components/item/PoSchedule.tsx`** (405 LOC)                           | Closest thing already built to the Supply Schedule. Its `PIPELINE` constant — PO created → Supplier committed → In transit → Goods received — is exactly the client's stated need. **Refactor per §6.3, don't rewrite**                                    |
| **`components/item/WhyPanel.tsx`** (199 LOC)                             | The explain panel. Restyle per §4.6, keep the structure                                                                                                                                                                                                    |
| **`components/item/OverrideDialog.tsx`** (268 LOC)                       | The override panel. Keep, restyle                                                                                                                                                                                                                          |
| **`lib/server/projections.ts`** (503 LOC)                                | Projection assembly. Adapt                                                                                                                                                                                                                                 |
| **TanStack Query / Table / Virtual, Recharts, Zustand, Zod, Vitest**     | All correct choices, already wired                                                                                                                                                                                                                         |

### Delete

Do this in one commit, before writing any new code.

**Routes — remove nine of twelve:**

```
apps/web/app/(app)/agent/                    ← v1 autopilot
apps/web/app/(app)/blast/                    ← v1 pegging explorer
apps/web/app/(app)/exceptions/               ← v1 exception cockpit (client deferred this)
apps/web/app/(app)/integration/              ← v1 connector status page
apps/web/app/(app)/master-data/              ← v1 data-health screen
apps/web/app/(app)/reconciliation/           ← v1 three-system diff
apps/web/app/(app)/scenarios/                ← v1 scenario compare
```

**API routes:** remove `api/exceptions`, `api/blast`, `api/simulate`, `api/commit`. Keep and adapt `api/plan`,
`api/materials`, `api/items`, `api/demo`.

**Engine — remove ~4,700 of 5,600 LOC:**

```
packages/mrp-engine/src/exceptions/          ← 2,672 LOC, classes A/B/C/D. All v1
packages/mrp-engine/src/resolutions.ts       ← 651 LOC
packages/mrp-engine/src/simulate.ts          ← 357 LOC
packages/mrp-engine/src/pegging.ts           ← 178 LOC
packages/mrp-engine/src/kpis.ts              ← 179 LOC, v1 impact-ranking metrics
packages/domain/src/exceptions.ts
packages/domain/src/impact-config.ts
```

`run-mrp.ts` (648 LOC) orchestrates the v1 pipeline. Strip it to the netting path and rebuild the orchestration around
the four engines in §5.

**Also remove:** `@xyflow/react` from `apps/web/package.json` (React Flow was only for the blast-radius graph),
`packages/adapters/src/sap.ts` (stub, not needed for the demo), and the entire `packages/data-packs/src/confectionery/`
pack.

### Build new

Nothing that follows exists in either branch:

- Norms engine — lead-time reconstruction, recency weighting, the combined safety-stock formula, seasonal norm curves
  (§5.2)
- Adherence engine — GRN-to-line matching, vendor reliability (§5.3)
- Scheduling engine — constraint-driven PO splitting (§5.4). The existing `delivery-schedule.ts` _generates_ schedules
  for seed data; it does not _solve_ for them
- Pre-build planner — contract-manufacturer capacity, last order date (§5.5)
- Two data packs — soaps and household insecticides (§7)
- All four screens, rebuilt (§6)

### Branch

```bash
git checkout sourabh-feedbacks
git checkout -b v2-planning-cockpit
# then: the deletion commit, before anything else
```

---

## 2. Step zero — the deletion commit

Do this first, verify it, commit it, then read on.

**Acceptance:** `pnpm build` and `pnpm typecheck` pass with only three routes remaining (`/`, `/item`,
`/item/[id]/[plant]`); no file references anything under `exceptions/`, `blast/`, `agent/`, `reconciliation/`,
`integration/`, `scenarios/`, `master-data/`; `ts-prune` reports no orphans from the removed modules; the app boots and
the two surviving screens render without errors.

Why this is non-negotiable: `sourabh-feedbacks` demonstrates exactly what happens otherwise. Good components were added,
nothing was removed, and the result is unusable — nine destinations for a story that needs four.

---

## 3. Information architecture

**Four screens. Two panels. No tabs at the top level.**

```
/                       Planning Cockpit          (landing)
/material/[id]/[plant]  Material View
/supply/[orderId]       Supply Schedule
/norms                  Norm Review

Panels — overlay any screen, never a route:
  Explain      right drawer, 480px
  Override     centred modal, 560px
```

**Navigation** is a single top bar: product name, category switcher (Soaps / Household Insecticides), plant filter, and
a demo-reset button. No sidebar. The previous build's sidebar with nine items is a large part of why it reads as
confusing.

**Movement between screens is by clicking data, not navigation.** A cockpit row opens a material; a material's supply
block opens the schedule; a material's norm rail opens norm review filtered to that material. Breadcrumb back only.

---

## 4. UI/UX specification

The stated problem is _"the UI is ugly… messy and confusing."_ Diagnosis: the tokens are fine, the composition is not.
Everything currently sits at the same visual weight, so nothing reads as important.

### 4.1 The governing principle

**One hero per screen.** Each screen has exactly one element that owns the majority of visual weight, and everything
else supports it.

| Screen           | Hero                                 |
| ---------------- | ------------------------------------ |
| Planning Cockpit | The excess ↔ exposure pair           |
| Material View    | The projection chart                 |
| Supply Schedule  | The delivery timeline                |
| Norm Review      | The lead-time distribution histogram |

If a viewer pauses the video on any frame, they should know instantly what they're meant to be looking at.

### 4.2 Layout

- Desktop only, designed at **1440px**, functional to 1920px. No mobile, no tablet
- **12-column grid, 24px gutters, 32px page margins.** Max content width 1600px, centred
- Vertical rhythm on an **8px** base. Section spacing 32px, card padding 24px, related-element spacing 12px
- **Cards are containers, not decoration.** One card per idea. Never nest a card inside a card
- The hero element gets a minimum of 45% of first-viewport height

### 4.3 Type and numbers

Three levels of type on any screen. More than three and hierarchy collapses — the current build's main failing.

| Role             | Spec                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| Hero figure      | 48px / 600 / -0.02em tracking, tabular-nums                           |
| Section heading  | 15px / 600 / uppercase / 0.04em / `--muted-foreground`                |
| Body and table   | 14px / 400                                                            |
| Table numerals   | 13px / 450 / **`font-variant-numeric: tabular-nums`** / right-aligned |
| Supporting label | 12px / 450 / `--muted-foreground`                                     |

**All quantities, dates and currency use tabular numerals and right alignment, without exception.** Ragged numeric
columns are the single most common reason a data-dense UI looks amateur.

Currency: `Intl.NumberFormat('en-IN', {style:'currency', currency:'INR', maximumFractionDigits:0})`. Abbreviate above
six figures — `₹8.68 Cr`, `₹12.4 L` — full precision below. Add to `packages/domain/src/format.ts`.

### 4.4 Colour discipline

Add to `globals.css` alongside the existing tokens. Do not change what's there.

```css
--status-critical: oklch(0.58 0.16 27); /* infeasible, stockout — reuse destructive */
--status-attention: oklch(0.72 0.13 75); /* drift, breach approaching */
--status-settled: oklch(0.62 0.09 155); /* confirmed, approved */
--surface-sunken: oklch(0.975 0 0); /* table headers, panel grounds */
--grid-line: oklch(0.93 0 0); /* chart gridlines only */
```

Rules:

1. **Teal is for interactive only** — primary actions, links, focus rings, the active projection line. Never decorative
2. **Exactly three status colours.** Not a palette per exception type. The old build coloured everything and so
   communicated nothing
3. **Status is carried by a 3px left border on the row, plus a text label.** Never colour a whole row's background — it
   destroys legibility and makes tables look like spreadsheets from 2003
4. **Charts are monochrome + one accent.** Confirmed supply is solid teal, planned supply is the same teal at 40% with a
   dashed stroke. Red appears only below the zero line

### 4.5 Tables

Dense data, made readable:

- Row height **44px**, not 28px. Fitting more rows is not the goal
- Header: `--surface-sunken`, 12px, uppercase, 0.04em, sticky
- **Max 8 columns visible.** Anything more goes into row expansion
- Zebra striping off. Row separators: 1px `--border` at 50% opacity
- Hover: `--surface-sunken`. Selected: 3px teal left border
- Sort indicator on the active column only
- Row expansion opens **inline**, pushing rows down — never a modal for detail-in-context
- Virtualise above 100 rows (`@tanstack/react-virtual`, already installed)

### 4.6 Panels

**Explain drawer** — 480px, slides from the right over a 200ms ease-out, does not cover the number that triggered it
(shift page content left if needed).

Structure, top to bottom:

1. The result — hero figure treatment, with its label
2. The formula, rendered as a visual equation with real values substituted, not symbols
3. Each input as a row: label, value, **source chip**, last-updated timestamp
4. Inputs that are themselves derived are clickable, going one level deeper. Maximum two levels before a raw source

Source chips are small, monospace, `--surface-sunken`: `SAP · MARC-DISPO`, `Computed · Norms`,
`GRN history · 14 receipts`.

**Override modal** — 560px, centred. System value, planner input, required reason (select + free text), then a live
before/after of the recalculated result. Apply is disabled until a reason is given.

### 4.7 The projection chart — full specification

This is the most valuable single visual in the product. Build it deliberately; do not accept Recharts defaults.

**Frame:** minimum 340px tall, full card width, 48px left gutter for the axis, 16px right.

**Axes:** X is time with the bucket granularity currently selected. Y is quantity, always including zero, with headroom
above the peak. Gridlines horizontal only, 1px `--grid-line`. No vertical gridlines. Axis labels 12px
`--muted-foreground`.

**Layers, back to front:**

1. **Norm band** — filled region from zero to the norm level, `--muted` at 35%. **Must support a time-varying upper
   edge** so the seasonal norm curve renders as a shape rather than a flat line. This is the entire Act 2 argument in
   one visual
2. **Stock-out region** — where the projection falls below zero, fill `--status-critical` at 18% down to the axis floor
3. **Receipt bars** — from the baseline. Confirmed: solid teal, 60% opacity, 12px wide. Planned: 1px teal outline, no
   fill, same width. The visual difference must be obvious at video resolution
4. **Projection line, confirmed only** — 2px solid teal
5. **Projection line, confirmed + planned** — 2px dashed teal at 45%. **Never merge these into one line.** The client
   was explicit: _"they should not be assumptions which are giving you a rosy picture"_
6. **Today marker** — 1px vertical `--foreground` at 30%, dashed, labelled "Today"
7. **Event markers** — small inverted triangles below the axis for the projected stock-out date and, on seasonal
   materials, the season opening and the last-order date

**Interaction:** hover shows a vertical crosshair and a floating readout listing every component at that date — opening
balance, requirement, confirmed in, planned in, closing balance, days of cover. Anchor the readout to avoid the cursor;
never let it leave the card.

**Legend:** inline above the chart, horizontal, 12px. Not a boxed legend in the corner.

### 4.8 Motion

Restrained. 150–200ms, ease-out. Panels slide, values cross-fade on recalculation, rows expand on height. Nothing
bounces, nothing spins. A recalculation triggered by an override should visibly settle — that transition is what
communicates "this is live", and it matters more on video than in person.

### 4.9 Empty, loading, error

- **Loading:** skeletons matching final layout. Never a centred spinner
- **Recalculating:** existing values dim to 50% and the elapsed-ms counter runs. Do not blank the screen
- **Empty:** one line of explanation and one action. Never a bare "No data"
- **Error:** plain-language message, a retry, and the technical detail behind a disclosure. No stack traces

---

## 5. Engine specification

Four engines in `packages/planning-engine` (rename from `mrp-engine`). All pure, no I/O, no framework imports,
`planningDate` always injected, never `Date.now()`. Each independently unit-tested.

Orchestration order matters — adherence feeds norms, norms feed netting, netting feeds scheduling:

```
adherence  →  norms  →  netting  →  scheduling  →  prebuild (seasonal only)
```

### 5.1 Netting — adapt existing

Keep `netting.ts` largely as-is. Three changes:

1. **Two projected balances, not one.** Return `projectedBalanceConfirmed` and `projectedBalanceWithPlanned` as separate
   arrays. Every consumer uses both
2. **Do not lot-size to a final order.** Netting now emits a time-phased net requirement; the scheduling engine decides
   quantity _and_ split together, because with MOQ, shipment caps and storage limits those are one decision, not two
3. **Norm comes from the norms engine**, expressed as a quantity per bucket so a seasonal norm varies across the horizon

Keep the past-due release handling. It is correct and it is the source of the Act 1 red line.

### 5.2 Norms engine — new

**Step 1 — Reconstruct observed lead time.**

```
observedLeadTime = grnDate − poReleaseDate
```

Per material × vendor × plant, over 24 months of seeded history. Require **≥ 6 receipts** for a recommendation; below
that, fall back to vendor level, then category level, and mark confidence low. Winsorise at P99. Never pool imports with
domestic.

**Step 2 — Recency weighting.** Exponential decay, default half-life **90 days**, exposed as a control in the UI. Return
mean, standard deviation, P50, P85, P95, and sample size.

The half-life must be visible and adjustable. Planners already over-weight recent events; the model has to be
demonstrably better _and_ transparent about how it weights, or it gets dismissed as a black box.

**Step 3 — Recommended order days.**

```
recommendedOrderDays = observedLeadTimeMean + transitTimeMean + poProcessingDays
```

Use the **mean**, not P85 — variability is absorbed by stock days below. Using P85 in both double-counts the buffer.
Surface this as a note in the UI; it's the error a category manager makes by hand.

**Step 4 — Recommended stock days.** The combined formula for variable demand _and_ variable lead time:

```
SS = z(serviceLevel) × √( LT̄ × σ²_D  +  D̄² × σ²_LT )
recommendedStockDays = SS / D̄
```

Also compute the naive form `z × σ_D × √LT̄` and return it as `naiveComparison`. **The UI shows both side by side** — the
gap between them is the Act 1 finding and must be computed, never asserted.

**Step 5 — Constraints, applied after the formula, each recorded when binding:**

| Constraint                      | Effect                                        |
| ------------------------------- | --------------------------------------------- |
| Production campaign cycle floor | `stockDays ≥ campaignCycleDays`               |
| MOQ floor                       | Cannot be below the coverage one MOQ provides |
| Shelf-life ceiling              | `stockDays + orderDays ≤ shelfLife × 0.75`    |
| Storage ceiling                 | Norm quantity ≤ plant storage capacity        |

**Step 6 — Seasonal norm curve.** When a material's demand profile has a seasonality index outside 0.75–1.35, compute
the norm **per week** against forward demand for that week's coverage window, rather than one annual figure. Return a
`NormCurve` — an array of `{weekStart, stockDays, stockQty}`.

Also return `flatNormCoverageByPeriod`: what the _maintained_ flat norm actually delivers in each period. This produces
the Act 2 line — 50 days of cover in April, 14 in July — and it must be computed from the seeded demand profile.

**Step 7 — Financial impact.**

```
maintained > computed →  excessCapital = (maintainedQty − computedQty) × standardCost
maintained < computed →  unprotectedExposure = (computedQty − maintainedQty) × standardCost × P(stockout)
```

Aggregate to category. These two figures are the cockpit hero.

### 5.3 Adherence engine — new

**GRN-to-line matching**, in order:

1. Exact match on order + line id
2. Otherwise order id + FIFO across open lines, earliest first
3. Partial receipts split across lines; over-receipts allocate forward then flag
4. **Unmatched receipts go to a queue. Never silently dropped** — discarding them biases every statistic downstream

**Metrics.** Per line: date variance, quantity variance, on-time, in-full, observed lead time. Rolled up per vendor, per
vendor × material, and per vendor × plant **separately** — a vendor reliable on one material is often unreliable on
another, and a single score hides exactly the variance the norms engine needs.

Track **confirmation adherence** apart from **delivery adherence**. A vendor who confirms everything and delivers late
is a different problem from one who negotiates dates honestly.

Every norm recommendation must be able to name the receipts that produced it. That traceability is what turns an
assertion into an argument, and it's the 1:50 beat of the demo.

### 5.4 Scheduling engine — new

The keystone. Input: time-phased net requirement plus vendor, plant and calendar constraints. Output: an order with
delivery lines, each carrying a required-by date, a dispatch-by date, a confidence and a **generated rationale**.

**Step 1 — Order window** from `recommendedOrderDays`.

**Step 2 — Total quantity:** net requirements across the window + target closing position − confirmed receipts landing
inside it.

**Step 3 — Vendor allocation** where volume splits (their 60/40), one order per vendor, constraints applied
independently, rounding preserving the total.

**Step 4 — Line count:**

```
byShipmentCap = ceil(total / maxShipmentQty)
byStorage     = ceil(total / availableStorage)
byReceiving   = ceil(total / (receivingPerDay × maxUnloadDays))
byShelfLife   = ceil(total / (dailyDemand × shelfLife × 0.75))
lineCount     = max(of the above, 1)
```

Then reduce `lineCount` until every line clears MOQ. If it reaches 1 and total is still below MOQ, emit a `BELOW_MOQ`
decision requiring the planner to pull demand forward or defer. **Never silently order below MOQ.**

**Step 5 — Line quantities:** even split, round each to `incrementQty`, remainder onto the last line, re-verify MOQ and
cap.

**Step 6 — Dates,** paced to consumption:

```
coverPerLine  = lineQty / dailyDemandMean
requiredBy(1) = firstUncoveredDay
requiredBy(n) = requiredBy(n−1) + coverPerLine(n−1)
```

Snap each to the plant's next receiving day over the working calendar — never naive date arithmetic. Then
`requestedDispatch(n) = requiredBy(n) − transitDays` over the vendor calendar.

If `requestedDispatch(1)` precedes the earliest the vendor can dispatch, **emit the line flagged `INFEASIBLE_LINE` with
the gap in days**. Do not silently push it out. With a 47-day imported lead time this is routine, and surfacing it is
the 2:45 demo beat.

**Step 7 — Confidence per line** from vendor reliability at that horizon, out of the adherence engine.

**Step 8 — Rationale**, generated from the _binding constraints_, never from a template list. For example: _"5 lines:
shipment cap 600 MT forces ≥ 5. Each line at 500 MT clears the 200 MT MOQ and rounds to the 20 MT increment. Paced at
11.9 days of cover. Line 1 required 7 days before this vendor can dispatch."_

Templated prose is the fastest way to make a prototype feel fake. Build these sentences from the constraint objects.

### 5.5 Pre-build planner — new, seasonal + contract-manufactured only

```
seasonRequirement   = Σ demand over season weeks
producibleInSeason  = contractedWeeklyCapacity × seasonWeeks
preBuildQty         = max(0, seasonRequirement − producibleInSeason)
offSeasonSurplus    = contractedWeeklyCapacity − offSeasonWeeklyDemand
preBuildWeeks       = ceil(preBuildQty / offSeasonSurplus)
buildStartDate      = seasonStart − preBuildWeeks (working calendar)
lastOrderDate       = buildStartDate − max(inputMaterialLeadTimes)
```

Return every intermediate, not just the final date — the whole chain is shown in the UI. `lastOrderDate` is the sharpest
single output in the product; it must be traceable end to end.

Verify against Brief Appendix A.2 as a unit test.

---

## 6. Screen specifications

### 6.1 Planning Cockpit — `/`

**Hero:** the excess ↔ exposure pair.

**Layout, top to bottom:**

1. **Top bar** — product name, category switcher, plant filter, demo reset
2. **Hero band** (full width, 180px): two hero figures side by side separated by a vertical rule — **₹ excess capital**
   left, **₹ unprotected exposure** right — with a single line beneath spanning both: _"Both caused by the same thing:
   norms that were set once and never moved."_ This is the 0:00 beat and it must land in three seconds
3. **Supporting metrics** (4 columns): materials under management · coverage against norm · materials below norm ·
   materials in excess. 32px figures, not 48px — they support the hero, they don't compete with it
4. **Gap attribution** (7 cols) — horizontal stacked bar: needs a PO / PO placed but arriving late / stock at the wrong
   plant. Each segment labelled with ₹ and %
5. **Needs attention** (5 cols) — top 6 rows only, ranked by ₹. Material, plain-language issue, days to impact, ₹ at
   stake. "View all" opens the full virtualised table below

**Interaction:** any row opens the Material View. Category switch re-runs the plan and animates the hero figures.

**Do not build:** exception type filters, severity chips, a full exception queue as the primary object. Ranked-by-rupees
is the whole point.

### 6.2 Material View — `/material/[id]/[plant]`

**Hero:** the projection chart (§4.7).

**Layout:**

1. **Header** — material code and description, plant, status pill, projected stock-out date. One line
2. **Projection chart** — 9 columns, min 340px
3. **Norm rail** — 3 columns, right of the chart: maintained vs recommended for both order days and stock days, the gap,
   ₹ impact, confidence, last-changed date. A "Why?" link opens the Explain drawer. A "Review norms" link goes to Norm
   Review filtered here
4. **Bucket toggle** — segmented control: Daily · Weekly · **GCPL buckets (7/15/30/45/90/180)**. Their own working
   buckets, and including them is cheap credibility
5. **Time-phased table** — rows: requirement, confirmed receipts, planned receipts, projected balance (confirmed),
   projected balance (with planned), days of cover. Columns are buckets. Requirement and receipt rows expand to show
   constituent elements
6. **Supply block** — open orders for this material, each a row with total quantity, line count, next delivery date and
   status. Clicking opens the Supply Schedule

**Interaction:** editable cells on requirement and norm rows trigger a recalculation of the affected sub-network with
the elapsed-ms counter visible. Any number opens Explain; any input opens Override.

### 6.3 Supply Schedule — `/supply/[orderId]`

**Hero:** the delivery timeline.

Refactor from `PoSchedule.tsx` — keep its `PIPELINE` model, replace its layout.

**Layout:**

1. **Header** — order reference, material, vendor, total quantity, release date, order type badge (**Purchase Order** or
   **Capacity Call-off**)
2. **Timeline** (full width, 200px): a horizontal track, today marked, each delivery line a block positioned at its
   required-by date, width proportional to quantity. Infeasible lines rendered in `--status-critical` with the gap in
   days labelled directly on the block. Pipeline stage shown by fill treatment — solid = received, 60% = in transit, 30%
   = confirmed, outline = planned
3. **Pre-build strip** — _seasonal materials only_, above the timeline: season opening, in-season capacity, pre-build
   quantity, build start, **last order date**, each as a marker on the same time axis. This is the 4:30 beat
4. **Lines table** (8 cols) — line no, quantity, required-by, dispatch-by, confirmed, status, confidence. Row expansion
   shows that line's own rationale
5. **Constraints panel** (4 cols) — every constraint that shaped the split, each with its value and a **binding /
   slack** indicator. Binding ones first. Beneath it, the generated rationale paragraph

**Interaction:** drag a line on the timeline to change its date; edit a quantity in the table. Both recalculate the
whole schedule and re-evaluate constraints, with newly-violated ones flashing once. Override with reason on any line.

**This screen answers _"why five lines and why 500 each?"_ before it's asked.** The constraints panel is not
supplementary — it is the argument.

### 6.4 Norm Review — `/norms`

**Hero:** the lead-time distribution histogram, inside row expansion.

**Layout:**

1. **Header** — category, count of materials with a recommendation, total ₹ impact, "Propose selected" action
2. **Filters** — plant, vendor, ABC, source region, staleness, confidence. Inline chips, not a sidebar
3. **Table** (8 cols) — material, maintained order days, recommended, maintained stock days, recommended, gap, ₹ impact,
   confidence. Sorted by ₹ descending. Checkbox column for batch selection
4. **Row expansion** — the reasoning, in three parts side by side:
   - **Lead-time histogram** with the maintained norm drawn across it as a vertical rule. The visual that makes drift
     undeniable
   - **The calculation**, written out with real values substituted, and the naive formula beside it with the ratio
     between them called out
   - **Binding constraints** and the demand profile. For seasonal materials, the norm curve against the flat maintained
     norm, plus the coverage-by-period table
   - Beneath all three: **the individual receipts**, each row clickable

**Batch flow:** select rows → Propose → review screen showing every change with its ₹ impact → approve or amend → a
write-back preview showing the exact payload, clearly labelled _"Preview — nothing was sent."_

That labelling is deliberate. Saying it out loud pre-empts the IT objection and costs nothing.

---

## 7. Data packs

Replace `confectionery` entirely. Two packs, deterministic from seed `20260830`, selected by `NEXT_PUBLIC_DATA_PACK`.

**Anonymisation applies to both:** no real vendor or customer names, generic SKU descriptors, plants as `P1`–`P4` with
region labels, no figure traceable to real GCPL volumes or costs.

### 7.1 `gcpl-soaps`

3 own plants + 1 co-packer. ~150 FG, ~35 SFG, ~70 RM, ~120 PM, BOM depth 3. ~35 vendors: imports (palm derivatives,
fragrance) at 35–70 day lead times with high variance; domestic packaging at 7–25 days, tighter. Two materials
dual-sourced 60/40. 24 months of orders and receipts so lead times genuinely reconstruct. Mild summer skew, festive
gifting peak.

**Planted scenarios** — each must arise from seeded facts, never injected records:

| #   | Scenario                                                                     | Demo beat    |
| --- | ---------------------------------------------------------------------------- | ------------ |
| 1   | Imported palm derivative: maintained 45 days, reconstructed 47 ± 11          | 0:55         |
| 2   | Naive vs combined safety stock differing 7.6× on that material               | 1:25         |
| 3   | 40 domestic packaging materials at 45 maintained days against 18-day reality | 0:00 hero    |
| 4   | Same material, two vendors, P85 of 34 vs 71 days                             | supporting   |
| 5   | 2,520 MT requirement splitting into 5 lines under 6 constraints              | 2:10         |
| 6   | Line 1 infeasible by 7 days                                                  | 2:45         |
| 7   | ~4% of receipts unmatched to a line                                          | traceability |

Calibrate so category inventory lands ₹40–60 Cr with a combined norm gap of ₹8–14 Cr.

### 7.2 `gcpl-insecticides`

2 contract manufacturers + 1 own plant. ~60 FG (liquid vaporiser refills, machines, coils, aerosols), ~25 RM (actives,
solvents, perfumes), ~45 PM. Actives imported at ~7 week lead times.

**Demand profile:** 14-week peak from the second week of June averaging 7.0 lakh units/week; 38 off-season weeks at 2.0
lakh. Regional monsoon variation across plants.

**Planted scenarios:**

| #   | Scenario                                                             | Demo beat  |
| --- | -------------------------------------------------------------------- | ---------- |
| 8   | Flat 30-day norm yielding 50 days cover in April, 14 in July         | 3:40       |
| 9   | Contracted capacity 4.5 lakh/week against 7.0 lakh peak              | 4:05       |
| 10  | Pre-build of 35 lakh units → 14 weeks → build starts 2 March         | 4:30       |
| 11  | Last order date 12 January, 19 weeks out                             | 4:30       |
| 12  | Co-packer's other committed volume constraining the pre-build window | supporting |

Every figure in Brief Appendix A.2 must be reproduced exactly by the generator, and asserted in
`packages/data-packs/tests/calibration.test.ts`.

---

## 8. Demo mode

**Determinism:** all randomness through the seeded PRNG. Two runs on two machines produce byte-identical output.
Non-negotiable — the video will be re-recorded several times.

**Reset:** `pnpm demo:reset` and a top-bar button, both restoring exact seeded state in under 2 seconds, including
clearing overrides and schedule edits.

**Fixed planning date:** `2026-08-30`, injected, never `Date.now()`. Every date in the demo is stable.

**Performance:** full category re-plan under 2,000 ms, elapsed milliseconds displayed. Showing a 1.4s recalculation live
is a quiet flex; don't hide it behind a spinner.

**Recording aids:** a `?demo=1` flag that slightly enlarges hero figures and slows transitions to 300ms for legibility
at video compression.

---

## 9. Build sequence

Each step ends demoable and independently verifiable.

| Step   | Work                                                                                    | Done when                                                                                                                 |
| ------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **0**  | Branch, deletion commit                                                                 | §2 acceptance passes                                                                                                      |
| **1**  | Domain types, `gcpl-soaps` pack, seed, reset                                            | Seed reproduces identical counts twice; calibration test passes                                                           |
| **2**  | **Adherence engine** — build before norms; it produces their inputs and demos alone     | Lead-time distributions for all pairs with ≥6 receipts; unmatched receipts queued not dropped                             |
| **3**  | **Norms engine**                                                                        | Brief A.1 passes as a test: 121 MT naive, 914 MT combined, 7.6×, 98% attribution. Every recommendation traces to receipts |
| **4**  | Netting adaptation — two balances, norm quantity per bucket                             | Full category run < 2s; confirmed and planned separated                                                                   |
| **5**  | **Scheduling engine**                                                                   | Brief A.2 passes: 5 lines, 500/500/500/500/520, line 1 infeasible by 7 days, storage flag at 1,414 vs 1,400               |
| **6**  | Design system additions, chart component, table primitives, Explain and Override panels | Chart renders all 7 layers; seasonal norm band curves; panels reach source in ≤2 levels                                   |
| **7**  | Cockpit + Material View                                                                 | Act 1 beats 0:00–1:50 run without a dead click                                                                            |
| **8**  | Supply Schedule + Norm Review                                                           | Act 1 complete; constraints panel answers "why 5 lines"                                                                   |
| **9**  | `gcpl-insecticides` pack, seasonal norms, pre-build planner, call-off variant           | Brief A.2 seasonal figures reproduce; Act 2 runs                                                                          |
| **10** | Polish, empty/error states, reset, dress rehearsal                                      | Full ~5:20 arc, no dead clicks, every number reaches a formula in ≤2 clicks                                               |

---

## 10. Definition of done

Before recording, verify every line:

- [ ] Nine v1 routes deleted; four screens and two panels exist
- [ ] No hardcoded number anywhere on screen — every figure traces to seeded data through a formula
- [ ] Brief A.1 and A.2 both pass as unit tests
- [ ] Both packs seed deterministically; reset restores exact state in under 2s
- [ ] Full re-plan under 2,000 ms with elapsed time visible
- [ ] Projection chart shows two separate balance lines, never blended
- [ ] Norm band curves for seasonal materials
- [ ] Infeasible schedule lines render red with the gap in days
- [ ] Constraints panel shows binding vs slack for every constraint
- [ ] Explain reaches a raw source in at most two levels, on every computed number
- [ ] Override requires a reason and records actor, before, after, timestamp
- [ ] Every table column right-aligned with tabular numerals
- [ ] Every screen has one unmistakable hero element
- [ ] No stack trace reachable; every empty state has an explanation and an action
- [ ] The word "exception" does not appear in any UI copy
- [ ] Both demo acts run end to end without a dead click

---

## Appendix — Deletion checklist

```
# Routes
rm -rf apps/web/app/\(app\)/{agent,blast,exceptions,integration,master-data,reconciliation,scenarios}
rm -rf apps/web/app/api/{exceptions,blast,simulate,commit}

# Engine
rm -rf packages/mrp-engine/src/exceptions
rm packages/mrp-engine/src/{resolutions,simulate,pegging,kpis}.ts
rm packages/domain/src/{exceptions,impact-config}.ts

# Data
rm -rf packages/data-packs/src/confectionery
rm packages/adapters/src/sap.ts

# Dependencies
pnpm --filter web remove @xyflow/react

# Rename
git mv packages/mrp-engine packages/planning-engine   # update workspace refs

# Then strip run-mrp.ts to the netting path and rebuild orchestration per §5.
```

Verify with `pnpm typecheck && pnpm build && pnpm test`, then commit before writing anything new.
