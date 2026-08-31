# Product Requirements Document

# MRP, PO Generation and Dynamic Scheduling — GCPL

**Prepared by:** Heizen **For:** Godrej Consumer Products Limited — Supply Chain Planning **Version:** v3 (clean
rebuild) **Date:** 31 August 2026 **Basis:** Sponsor workshop at GCPL, 27 August 2026 + FMCG post-PO scheduling research

**Status of this document.** This is a rebuild, not an edit. It is written from what the sponsors actually said in the
27 August workshop plus domain research on FMCG post-PO scheduling. Where an earlier product brief made assumptions the
sponsors did not confirm, those assumptions have been dropped rather than inherited. Everything not yet confirmed sits
in the Open Questions Register (§13) rather than being quietly assumed into the design.

---

## 0. How to read this document

**In one line.** GCPL's MRP calculation already works, and this product does not try to replace it. What is missing is
the layer that turns the MRP result into an _executable_ material and purchase-order schedule — one that stays current
between runs, says exactly what should arrive where and when, distinguishes supply that is genuinely committed from
supply that is merely assumed, and then measures what actually happened so the assumptions feeding MRP can be corrected.
This document specifies that layer.

| If you are…                                                | Read                |
| ---------------------------------------------------------- | ------------------- |
| A sponsor deciding whether Heizen understands your problem | §1, §2, §12         |
| A planner who will use this                                | §5, §6, §7, §8, §12 |
| Reviewing the calculation logic                            | §4, §5, §6          |
| Assessing what data you must supply                        | §10, §13            |
| Concerned about scope creep                                | §3, §14             |

Every number in this document is worked end to end and foots. Two hero materials run through the whole PRD — one
long-lead imported raw material, one short-lead local packaging material — because the same engine has to behave very
differently for each, and that difference _is_ the domain.

---

## 1. What the sponsors actually said

The design below is anchored to these statements from the 27 August workshop. They are paraphrased only where the
transcript was garbled.

**On the MRP calculation itself**

> "MRP is running flawlessly. Because it's just a netting calculation… that's the correct thing."

The netting engine in SAP is not broken. This matters enormously for scope. **We are not being asked to build a better
calculator. We are being asked to build the calculation people can see, trust, and act on** — and to build the
scheduling layer that SAP does not give them.

**On inventory norms — named problem #1**

> "The stock norms which are maintained in the system and the ones which are in reality are divergent. There are no
> intelligent ways of us understanding… they were the tribal knowledge which each category manager has. So has given the
> number based on vendor lead time, transit time — addition of that is our order norms. That is maintained in SAP.
> There's no science to that."

**On transitions — named problem #2**

> "When it comes to transitions, we don't have any sort of system where we know that at this point this should go out,
> at this point this material should come in — when we are doing a packaging change for one FG code."

**On source split and the missing feedback loop — named problem #3**

> "The SOQ maintenance on each of the vendors — there is no science to it. It is 60:40… Monitoring whatever you have put
> after the POs are placed, and the GRNs that are happening — whether it is adhering or there is a deviation, that
> entire intelligence coming in from the PO data is not there right now."

**On the core ask — PO scheduling**

> "If I have a purchase order of 1,000 quantity, 500 is connecting in next five days and another 500 is connecting in
> next 10 days. This visibility, the system doesn't have… We want that our MRP should itself be enabled to tell me — if
> I've created a purchase order of 1,000 units, I have to receive 500 at this location at this point in time and another
> 500 at this point in time."

> "First task itself is: how do you break the PO? If I'm generating a PO from my MRP, divide it into the required number
> of parts in which I would ideally need my deliveries to happen."

> "Adherence against that is something that you look after your GRN is done."

**On the decay between MRP runs**

> "After running the MRP, three or four days later… during this period of one MRP run versus next week, the months of
> coverage of different materials change. This is something that pushes planners to create a separate Excel — suddenly
> my covers are at risk."

**On honest signals**

> "They should not be assumptions which are giving you a rosy picture, and then later you realise this is not actually
> going to happen."

On the specific question of whether GRN history can predict arrivals, the sponsor was clear it cannot:

> "Historical will give you supplier performance trends. But if you want to be sure of whether I will have stock on a
> particular day, that needs a deterministic signal."

And on TMS: _"I don't have a TMS system, but I would not say that is a 100% accurate way… because not every vendor will
upload data."_

**On sequencing — the sponsor's own phasing**

> "Let us look at first our base systems… and then ideally doing the PO scheduling piece of it, plus an intelligence on
> dynamic norms — the SOQs that are in system, how well built my norms are. Mostly it is data science."

> "These are products which can tell you exceptions and insights from those data points. We will have to have the base
> system."

> "We'll see if we can do a POC in terms of the entire process itself, or let's say maybe we pick up a category and
> build up the norms and then the scheduling part of it."

**The sponsor's phasing is the phasing in this PRD.** Base system and scheduling first; norms science second;
intelligence layer third and explicitly deferred.

---

## 2. The problem, restated in one page

A GCPL material planner opens SAP on Monday morning. The MRP run over the weekend has produced thousands of lines.
Somewhere in there, a material is going to run out in three weeks. The planner cannot see it, cannot easily prove it,
and cannot show anyone else why.

Four things are working against them:

**1. The plan is a list, not a picture.** SAP shows the netting result as rows of numbers per material. There is no
chart of where inventory is going, no visible safety stock line, no visible moment of breach. The planner reconstructs
that picture in Excel, one material at a time, which is why parallel spreadsheets exist.

**2. The plan goes stale between runs.** The netting is a snapshot. Three days later, demand has moved, stock has moved,
a GRN has landed or not landed — and nothing tells the planner _what changed since the last run_. So they rebuild the
snapshot themselves.

**3. A PO is a lump, not a schedule.** MRP produces a quantity and a date. Reality needs 1,000 units split into four
deliveries across four weeks, sized to what the vendor can actually make and what the warehouse can actually hold. That
split is done today by phone, memory and experience — and it is never written back anywhere the system can learn from.

**4. The inputs are folklore.** Lead time and safety stock in SAP were set by a category manager, from experience, at
some point in the past. Nobody knows whether they are still true, because the data that would prove or disprove them —
what we asked the vendor for versus what actually arrived — is not captured in a form anyone can analyse.

Problems 1–3 are a **visibility and scheduling** problem. That is Phase 1. Problem 4 is a **norms** problem, and it
_cannot be solved before Phase 1_ because Phase 1 is what generates the schedule-adherence data the norms need. That is
Phase 2.

---

## 3. Scope

### Phase 1 — MRP, PO Generation and Dynamic Scheduling _(this prototype)_

The prototype demonstrates one complete planner journey, end to end, on one pilot category:

```
See the position  →  Find the risk  →  Understand the calculation
      →  See the supply timeline  →  Build the PO schedule
      →  Decide and act  →  Record what was decided
```

In scope:

- Planning horizon, calendar and time buckets
- Master Production Schedule of independent demand as the entry point
- Low-Level-Code BOM explosion from FG down to RM and PM, with yield and scrap
- Lead-time offsetting, netting and net requirement calculation
- Lot sizing — MOQ, rounding value, lot-for-lot and fixed-period policies
- Projected inventory as a chart _and_ as the classic planning grid
- Planned order → purchase order → **delivery schedule lines**, which is the sponsor's headline ask
- The unconstrained (ideal) schedule versus the constrained (committable) schedule, with every unit of difference
  attributed to a named constraint
- Supply confidence tiers, so a "planned receipt" never masquerades as a confirmed one
- Exception queue driven by the calculation, not by a separate rules engine
- Planner override with reason capture and full audit
- What-if simulation of a single parameter change
- **Schedule adherence capture** — the committed date and quantity per schedule line, compared against actual GRN. This
  is the data asset Phase 2 runs on.

### Phase 2 — Dynamic Norms Calculator _(next)_

A calculator the planner can run to propose, simulate and override the inputs the MRP engine consumes: lead time, safety
stock, order norm / reorder point, lot size and source split. Proposals are computed from measured execution data, shown
against maintained values with the inventory and service impact of each change, and approved through governance before
any write-back.

### Explicitly deferred — Intelligence layer

The sponsor deferred this himself: _"These are products which can tell you exceptions and insights from those data
points. We will have to have the base system."_

Not in scope now: LLM narrative summaries, autonomous PO release, loss-attribution waterfalls, forecast-accuracy
analytics, scenario libraries, the seasonal absent-item detection module, and the transitions module. Each is noted in
§14 with its prerequisite so the sequencing is visible rather than forgotten.

---

## 4. The domain model, in plain language

Nine objects. Everything in the engine is built from these.

**Planning calendar.** Not a normal calendar. It knows plant working days, plant shutdowns, vendor working days and
vendor holidays. A delivery cannot be scheduled into a day the plant cannot receive on, and a dispatch cannot be
scheduled from a day the vendor is closed. Getting this wrong is the single most common reason a "correct" schedule is
rejected by the people who have to execute it.

**Planning horizon.** How far forward the engine looks. It must be at least as long as the _cumulative_ lead time of the
deepest branch of the BOM, plus the production window, plus a decision margin. For an imported oil on a 90-day lead
time, a 13-week horizon is structurally blind: the material you need in week 12 had to be ordered before the horizon
started.

**Time bucket.** The unit of time a quantity is stated in. Buckets are not free — a weekly bucket says "some time this
week", which is fine 20 weeks out and useless next Tuesday.

**Independent demand.** Demand that comes from outside the plan: the sales forecast, distributor replenishment pull,
confirmed customer orders, inter-plant transfer requirements. This is the only demand the planner can argue about;
everything else is derived.

**Master Production Schedule (MPS).** Independent demand, resolved into a producible plan by FG, by plant, by date — the
single agreed entry point. The MRP engine explodes the MPS. If the MPS is wrong, everything downstream is precisely,
confidently wrong.

**Bill of Materials.** What goes into what, in what quantity, with what yield and scrap, on which line, at which plant.
FMCG BOMs are shallow but wide: one bulk stage, then a long list of packaging.

**Low-Level Code (LLC).** The processing order. FG is level 0; bulk/semi-finished is level 1; RM and PM are level 2.
Because a material can appear in several BOMs at several depths, its LLC is the _deepest_ level it appears at anywhere
in the portfolio. The engine processes level 0 completely, then level 1, then level 2 — which guarantees that when it
finally nets a shared packaging item, _every_ parent's demand for it has already been counted. Nothing is netted twice,
and nothing is netted early.

**Supply element.** Anything that adds stock: an open PO not yet received (scheduled receipt), stock in transit, stock
in QA quarantine awaiting release, a subcontractor's finished-goods return, a stock transfer from another plant, and a
system-proposed planned order. These are not equal and must never be displayed as equal — see §6.4.

**Norm.** The set of parameters that make the engine produce a number: lead time, safety stock, reorder / order-up-to
level, MOQ, rounding value, lot-sizing policy, source split. Today at GCPL these are largely tribal. Phase 1 _consumes_
them exactly as maintained, and _measures_ them. Phase 2 _proposes_ them.

### 4.1 Why RM and PM need the same engine and different judgement

This distinction runs through the whole product. It is the clearest signal of whether a planning system was designed by
someone who has actually planned FMCG.

|                     | Raw material (e.g. imported fatty-acid oils, surfactants, perfume)    | Packaging material (e.g. HDPE bottle, laminate, carton, cap)           |
| ------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Typical lead time   | 45–120 days, often imported                                           | 7–21 days, usually local/regional                                      |
| Dominant risk       | Transit, port congestion, tier-2 availability                         | Artwork change, promo timing, vendor capacity                          |
| Physical constraint | Shelf life, storage class, quarantine                                 | **Volume.** Empty bottles are almost all air                           |
| Can you expedite?   | Largely no — once on the water, transit is a hard wall                | Often yes — a local vendor can run an extra shift                      |
| Quality gate        | Quarantine + Certificate of Analysis before it counts as stock        | Usually visual/AQL, short or nil                                       |
| Right posture       | Cover — carry buffer, order early, protect against variability        | Just-in-time — hold as little as possible, arrive close to consumption |
| What kills you      | Vessel delay, or a batch failing stability and going to blocked stock | Warehouse full, or 400,000 obsolete wrappers after an artwork change   |

Two consequences the product must respect:

**Quarantine is not stock.** RM sitting in QA has not entered available inventory. If the system counts it, the plan is
optimistic by the length of the QA cycle. Worse: when QA moves a _received_ batch to blocked stock, that quantity leaves
available balance instantly and every downstream week goes negative at once. The projection must show quarantine as a
distinct, dated, not-yet-available line.

**A pull-in you cannot use is not a pull-in.** If MRP tells you to expedite bottles but the caps are constrained,
expediting the bottles just fills the warehouse. The planner must be able to see, on one screen, whether the _other
components of the same parent_ can move too. We call this the horizontal check, and it is why the explain panel shows
sibling components (§7.5).

---

## 5. The planning engine, step by step

Eleven steps. Each is stated plainly, then worked on a hero material.

**Hero A — RM-30114, PFAD Import.** Palm Fatty Acid Distillate, imported. Plant: Malanpur (M014), the soap-noodle plant.
Unit: MT. Item category **PFAD**, shared with **RM-30112, PFAD Local** — same chemistry, different material code,
different source, materially different lead time. Maintained lead time 90 days. MOQ 1,000 MT (bulk vessel parcel),
rounding value 250 MT. Maintained safety stock 1,400 MT. Inbound QC (IV, FFA, moisture, colour) against the COA before
release.

The property that shapes everything below is the **local twin**: the same chemistry is available on a 30-day lead time
under a different material code, which means a shortage this material cannot reach may still be reachable by its own
item category.

**Hero B — PM-88431.** 45 ml refill bottle, HDPE. Plant: Malanpur. Unit: pieces. Local vendor, 10-day lead time. MOQ per
call-off 100,000 pcs, rounding value 10,000 pcs (one pallet). Maintained safety stock 100,000 pcs. Warehouse volumetric
ceiling for this item: 320,000 pcs.

_(If the pilot lands on the soap category, the identical worked example runs on a soap-category packaging item — a
wrapper or shipper carton at the same plant. The constraint set, the arithmetic and the schedule-builder logic are
unchanged; only the description and the unit move. Either version can front the demo.)_

Today is **Monday 31 August 2026 = W36.** W37 = 7 Sep, W38 = 14 Sep, W39 = 21 Sep, W40 = 28 Sep, W41 = 5 Oct, W42 = 12
Oct, W43 = 19 Oct, W44 = 26 Oct, W45 = 2 Nov.

---

### Step 1 — Freeze the picture

Every run stamps an **as-of** moment and records exactly which version of every input it used: stock as at, MPS version,
BOM version, norms version, open PO status.

This is not administrative hygiene. It is the direct answer to the sponsor's Excel problem. When a planner asks "why
does this look different from Friday?", the system must answer with a specific list of changes, not a shrug. See the
Drift Panel, §7.1.

**Requirement.** Every screen carries the as-of stamp. Every run is retained and comparable to the previous run.

---

### Step 2 — Set the horizon and the buckets

The horizon must cover the longest cumulative lead time in the BOM branch plus the production window plus a decision
margin. Buckets get coarser with distance, because precision you do not have should not be displayed as precision you
do.

| Zone        | Bucket      | Length      | Why                                                                                       |
| ----------- | ----------- | ----------- | ----------------------------------------------------------------------------------------- |
| Execution   | **Daily**   | Weeks 1–4   | Dock-level decisions. "Some time next week" is not actionable when the line runs Tuesday. |
| Scheduling  | **Weekly**  | Weeks 5–16  | Where PO schedule lines are built and adjusted. Vendors think in weeks.                   |
| Procurement | **Weekly**  | Weeks 17–26 | Long-lead RM ordering window. Nothing lands here without being ordered now.               |
| Strategic   | **Monthly** | Months 7–18 | Capacity and long-lead commitment only. Not a netting horizon.                            |

Two visible rules:

- The default RM horizon is **26 weeks**; PM is **16 weeks**. If a material's cumulative lead time exceeds its horizon,
  the system flags the material rather than silently truncating the plan.
- Bucket boundaries are always visible on the chart. A planner must never mistake a weekly bar for a daily one.

**Time fences.** Three zones, drawn on every chart:

| Zone       | Meaning                                  | What the planner may do                                                                                 |
| ---------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Frozen** | Inside the material's lead time          | Nothing new can be ordered to land here. Only expedite, substitute, spot-buy, or reschedule production. |
| **Firm**   | Lead time → lead time + one review cycle | Existing POs can be pulled in or pushed out. New POs are tight but possible.                            |
| **Free**   | Beyond that                              | The plan is fully changeable.                                                                           |

**The lead-time fence is the most important line on the chart** and most planning tools omit it. It is the vertical line
marking the earliest date a _newly placed_ order can arrive. Every shortage to the left of it is unsolvable by ordering
— and the planner needs to know that in the first three seconds, not after two phone calls.

---

### Step 3 — Take the MPS as the entry point

The engine consumes an agreed MPS: FG, plant, quantity, date, version. It does not forecast, does not smooth, does not
resolve conflicts.

Where GCPL's demand is a distributor-pull replenishment signal rather than a classical forecast, that signal is resolved
into an MPS upstream and enters here. The MPS is versioned and every projection names its version, so two planners
looking at two numbers can always find out whether they are looking at two plans.

**Non-goal.** Phase 1 contains no forecasting engine and no demand-planning workflow.

---

### Step 4 — Sequence by Low-Level Code

Before any netting, the engine assigns each material its LLC across the whole portfolio and processes strictly in order:
all level 0, then all level 1, then all level 2.

Why this matters at GCPL: a single carton or a single surfactant may feed a dozen FGs across three plants. If it is
netted while some parent demand is still unprocessed, the requirement is understated and the system confidently
recommends too little. LLC sequencing is what prevents that. It is invisible when right and catastrophic when wrong, so
the product states it explicitly and the explain panel shows _which parents contributed_ to any component's gross
requirement.

---

### Step 5 — Explode the BOM

For each parent, in LLC order: multiply parent requirement by component quantity-per, then adjust for yield and scrap.

```
Component gross requirement
  = Parent order quantity
  × Quantity per parent
  ÷ Operation yield
  × (1 + component scrap %)
```

Yield and scrap are separated deliberately, because they behave differently and are argued about differently. Operation
yield is a process property (a filling line delivers 97% of theoretical). Component scrap is a material property (3% of
laminate is lost to changeover and web waste). A planner disputing a number must be able to see which of the two is
inflating it.

**Worked — RM-30114 (PFAD Import), week 39.** The soap chain has three conversion stages before it reaches an oil, and
every factor below is one GCPL already maintains:

| Step                                                      |                                       |                                Quantity |
| --------------------------------------------------------- | ------------------------------------- | --------------------------------------: |
| Soap demand, W39 (all plants supplied by Malanpur noodle) |                                       |                                3,400 MT |
| × 0.9                                                     | soap → noodle factor                  |                         3,060 MT noodle |
| × 77.5%                                                   | oil content of noodle                 |                            2,371 MT DFA |
| ÷ 99.1%                                                   | DFA-stage yield                       |                                2,393 MT |
| ÷ 89.7%                                                   | raw → CFA/DFA conversion yield        | 2,668 MT raw oil, all oils in the blend |
| × 50%                                                     | PFAD share of the Hardstearine blend  |                           1,334 MT PFAD |
| × 60%                                                     | import share of the PFAD source split |                                  800 MT |
| **Gross requirement**                                     |                                       |                              **800 MT** |

Note where the yields sit. The two conversion losses (0.991 and 0.897) are _process_ properties of the distillation and
splitting stages; the blend ratio and the source split are _decisions_. A planner disputing the 800 MT needs to know
which of those four they are actually arguing with, and the explain panel separates them.

**Special cases the engine must handle and the UI must label:**

- **Phantom / placeholder items.** A future FG whose code does not exist yet cannot generate a requirement — the
  sponsor's own point. Phase 1 supports a placeholder item with a borrowed (predecessor) BOM, clearly marked as a
  placeholder so no one mistakes it for a live code. _Detecting_ which placeholders should exist is the deferred
  absent-item module (§14).
- **Alternative BOMs and production versions.** The same FG made on two lines at two plants can have different component
  sets. The engine uses the production version the MPS names, and the explain panel says which one.
- **Subcontracted FG.** Where a contract manufacturer makes the FG but GCPL supplies the RM/PM, the components must
  arrive at the CM, not at GCPL. Back-scheduling adds two extra legs:

  ```
  Component need-by date at CM
    = FG receipt date
      − CM manufacturing lead time
      − CM-to-GCPL transit
      − dispatch buffer at GCPL
  Component need-by date at GCPL
    = that date − GCPL-to-CM transit − pick/pack/challan time
  ```

  The planner's real deadline for a CM-bound component is therefore _earlier_ than the naive one, often by two to three
  weeks. The grid shows both dates, labelled. For India, the statutory job-work challan validity window is displayed
  against the CM's stock-provided-to-vendor position, because a push-out that breaches it is not a free decision.

---

### Step 6 — Offset by lead time

The date a material is _needed_ and the date it must be _ordered_ are separated by the full chain, not just the vendor's
quoted number:

```
Order release date
  = Need-by date
    − vendor manufacturing lead time
    − transit time
    − customs / clearance (imports)
    − inbound QA quarantine and COA release
    − goods-receipt and put-away time
```

For RM-30114 at a maintained 90 days, that is **13 weekly buckets**. Today is W36, so the earliest a newly-placed import
parcel can land is **W49 (30 Nov)**.

At the _measured_ lead time of 104 days (§9), it is **15 buckets** — earliest landing **W51 (14 Dec)**.

For its local twin RM-30112 at 30 days, it is **5 buckets** — earliest landing **W41 (5 Oct)**. Same chemistry, same
item category, eight weeks of difference. That gap is the whole reason the source split exists, and it is invisible on
any screen the planner has today.

Those two dates are the difference between a plan that works and a plan that fails, and the difference is invisible in
SAP today. The product draws both fences on the chart.

---

### Step 7 — Net

For each bucket in order, roll the projected available balance:

```
Projected Available Balance (end of bucket)
  = Balance at end of previous bucket
  + Scheduled receipts landing in this bucket
  + Planned order receipts in this bucket
  − Gross requirements in this bucket
```

**Worked — RM-30114 (PFAD Import), before any planned orders.** Opening unrestricted stock 2,750 MT. 250 MT held pending
COA release in W37. Open PO 4700221 has two schedule lines: 1,150 MT in W38 (vendor-confirmed) and 1,150 MT in W41 (not
confirmed). Safety stock 1,400 MT. Gross requirements rise through the pre-summer noodle build.

| MT                     |       W36 |       W37 |       W38 |        W39 |        W40 |        W41 |          W42 |          W43 |
| ---------------------- | --------: | --------: | --------: | ---------: | ---------: | ---------: | -----------: | -----------: |
| Gross requirement      |       660 |       690 |       720 |        800 |        890 |        970 |        1,030 |        1,030 |
| Scheduled receipts     |         — |       250 |     1,150 |          — |          — |      1,150 |            — |            — |
| _of which QC release_  |         — |     _250_ |         — |          — |          — |          — |            — |            — |
| _of which unconfirmed_ |         — |         — |         — |          — |          — |    _1,150_ |            — |            — |
| **Projected balance**  | **2,090** | **1,650** | **2,080** |  **1,280** |    **390** |    **570** |     **−460** |   **−1,490** |
| Safety stock           |     1,400 |     1,400 |     1,400 |      1,400 |      1,400 |      1,400 |        1,400 |        1,400 |
| Status                 |        OK |     Tight |        OK | **Breach** | **Breach** | **Breach** | **Negative** | **Negative** |

**First safety-stock breach: W39 (21 Sep).** First physical stock-out: W42 (12 Oct).

Read the row three times and three separate things fall out — this is what the chart has to make visible in five
seconds:

1. W37 is already tight (250 MT above safety stock) and it is only tight because a QC release lands that week. If that
   parcel fails its COA on IV or FFA, W37 breaches too.
2. W39 breaches _before_ the next PO line arrives in W41.
3. The W41 line that would fix it is **unconfirmed**. If it is treated as real, the plan looks recoverable. If it is
   treated honestly, it is not. This is exactly the sponsor's _"should not be assumptions which are giving you a rosy
   picture."_

---

### Step 8 — Compute the net requirement

Whenever the balance would fall below safety stock:

```
Net requirement
  = (Gross requirement + Safety stock)
    − (Previous balance + Scheduled receipts this bucket)
```

**Worked — W39:** (800 + 1,400) − (2,080 + 0) = **120 MT**.

That single line is the answer to _"why is the system asking me to order this?"_ and it must be reachable in one click
from the number itself.

---

### Step 9 — Apply lot sizing

The net requirement is a mathematical quantity. The order must be a _purchasable_ quantity.

| Rule               | Meaning                                                | RM-30114                 | PM-88431            |
| ------------------ | ------------------------------------------------------ | ------------------------ | ------------------- |
| Lot-for-lot        | Order exactly what is needed, per bucket               | default                  | default             |
| **MOQ**            | Vendor will not accept less                            | 1,000 MT (vessel parcel) | 100,000 pcs         |
| **Rounding value** | Must be a whole multiple — parcel, drum, pallet, truck | 250 MT                   | 10,000 pcs (pallet) |
| Fixed period       | Consolidate N buckets into one order                   | optional                 | 6-week campaign     |
| Max lot            | Never exceed — tankage, shelf life or storage cap      | tank capacity            | volumetric cap      |

Order of application is fixed and shown: **net requirement → MOQ floor → round up to rounding value → max-lot ceiling.**
Any quantity added by a lot-sizing rule is displayed separately from the requirement itself, so the planner always knows
how much of an order is _need_ and how much is _rule_.

**Worked — RM-30114, full roll with planned orders:**

| MT                                             |   W36 |   W37 |   W38 |       W39 |       W40 |       W41 |       W42 |       W43 |
| ---------------------------------------------- | ----: | ----: | ----: | --------: | --------: | --------: | --------: | --------: |
| Gross requirement                              |   660 |   690 |   720 |       800 |       890 |       970 |     1,030 |     1,030 |
| Scheduled receipts                             |     — |   250 | 1,150 |         — |         — |     1,150 |         — |         — |
| **Net requirement**                            |     — |     — |     — |   **120** |    **10** |         — |         — |   **890** |
| Planned order receipt _(after MOQ + rounding)_ |     — |     — |     — | **1,000** | **1,000** |         — |         — | **1,000** |
| _of which added by lot sizing_                 |     — |     — |     — |    _+880_ |    _+990_ |         — |         — |    _+110_ |
| **Projected balance**                          | 2,090 | 1,650 | 2,080 | **2,280** | **2,390** | **2,570** | **1,540** | **1,510** |
| Safety stock                                   | 1,400 | 1,400 | 1,400 |     1,400 |     1,400 |     1,400 |     1,400 |     1,400 |
| Days of cover _(at next week's rate)_          |  21.2 |  16.0 |  18.2 |      17.9 |      17.2 |      17.5 |      10.5 |         — |

Balance never falls below safety stock. Arithmetic foots at every step.

Note the _of which added by lot sizing_ row. In W39 the requirement is 120 MT and the order is 1,000 MT, because the
minimum parcel is 1,000 MT. The planner should never have to work out which part of an order is need and which part is
rule.

---

### Step 10 — Back-schedule to the order release date

Every planned order receipt is offset backwards by the full lead-time chain to give the **last responsible order date**
— the sponsor's own framing from the seasonal walkthrough: _"what is my ordering last order date."_

**Worked — RM-30114, at the maintained 90-day lead time (13 buckets):**

| Planned receipt | Quantity | Required release week | Verdict                                |
| --------------- | -------: | --------------------- | -------------------------------------- |
| W39 (21 Sep)    | 1,000 MT | W26 (22 Jun)          | **Release date passed — 10 weeks ago** |
| W40 (28 Sep)    | 1,000 MT | W27 (29 Jun)          | **Passed — 9 weeks ago**               |
| W43 (19 Oct)    | 1,000 MT | W30 (20 Jul)          | **Passed — 6 weeks ago**               |

This is the single most useful thing the prototype can put in front of a planner, and no current screen shows it.

**Not one of the orders the engine just proposed can be placed.** Every planned receipt in the visible horizon sits
inside the frozen zone. The earliest an import parcel ordered today can land is **W49 (30 Nov)** — and the first breach
is **W39 (21 Sep)**. That is a **ten-week window no import purchase order can reach.**

That reframes the planner's job completely. It is not "raise these three POs". It is a choice between the levers that
can actually reach the exposure:

- **The confirmed W38 line** — expedite discharge and quality release to buy a few days at the front.
- **The unconfirmed W41 line (1,150 MT)** — get it confirmed and pull it forward. It is the only import supply that can
  touch W41 at all.
- **The local twin, RM-30112 (PFAD Local), 30-day lead time** — earliest landing W41. It cannot reach W39 or W40, but it
  can cover W41 onward, and it is the same chemistry under a different material code. **This lever is invisible today**
  because nothing links the two material codes on a planning screen; the item category exists in the master data and
  nowhere in the plan.
- **W49 onward** must be committed now.

W39 and W40 are reachable by none of them. The honest answer for those two weeks is that the decision was missed in late
June, and the residual has to be absorbed. Phase 1's job is to make that exposure visible early enough that it is
decided deliberately rather than discovered.

And at the measured 104-day lead time, the frozen zone extends to **W51 (14 Dec)** — two more weeks, on a material where
two weeks is a vessel. The product shows both fences with a toggle — see §7.2.

---

### Step 11 — Raise exceptions from the calculation

Exceptions are not a separate rules engine. Every exception is a named condition on a number the engine already
computed, which is why every exception can explain itself.

| Exception                                 | Condition                                                                                  | Typical action                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| **Projected stock-out**                   | Balance < 0 in any bucket                                                                  | Expedite, spot-buy, resequence                 |
| **Safety-stock breach**                   | 0 ≤ balance < safety stock                                                                 | Pull in an open PO                             |
| **Unreachable requirement**               | Planned order release date < today                                                         | Cannot be ordered — must be solved another way |
| **Alternate source reaches it**           | An unreachable requirement is reachable by another material code in the same item category | Order the alternate for the weeks it can cover |
| **Pull-in**                               | An open PO lands after the bucket that needs it                                            | Ask vendor to advance the schedule line        |
| **Push-out**                              | An open PO lands into a bucket with ample cover, or breaches the storage cap               | Ask vendor to defer                            |
| **Past due**                              | Scheduled receipt date passed, no GRN posted                                               | Trace the shipment                             |
| **Unconfirmed supply in a critical week** | A breach is only avoided by a Tier-3 receipt                                               | Get confirmation or plan without it            |
| **Lead-time drift**                       | Measured lead time deviates materially from maintained                                     | Review the norm (Phase 2)                      |
| **Excess / obsolescence risk**            | Cover exceeds max norm, or exceeds remaining shelf life                                    | Push out, cancel, redeploy                     |
| **Horizontal block**                      | A sibling component of the same parent cannot be moved                                     | Do not expedite this one alone                 |
| **Master-data gap**                       | Missing lead time, BOM, norm or source                                                     | Fix data before trusting the line              |

Every exception carries: severity, the material, the bucket it bites in, the quantity at stake, the days of cover at
stake, the calculation that produced it, and the actions available. Nothing is a bare alert.

---

## 6. Post-PO scheduling — the sponsor's headline ask

> _"How do you break the PO? If I'm generating a PO from my MRP, divide it into the required number of parts in which I
> would ideally need my deliveries to happen."_

This is the part SAP does not do for GCPL and the part the prototype must nail.

### 6.1 The two-view model

The product produces **two schedules and the reconciliation between them.**

**The unconstrained (ideal) schedule** answers: _if the vendor and the warehouse could do anything, when would I want
each unit?_ It comes straight from the netting — quantity per bucket, exactly to requirement, MOQ and rounding not yet
applied. It is the planner's statement of need and it is the benchmark everything else is measured against.

**The constrained (committable) schedule** answers: _given everything that is actually true, what can I ask for?_

**The delta ledger** answers the question that decides whether a planner trusts the tool: _why are these two different?_
Every unit of difference is attributed to a named constraint. No unattributed deltas — if the engine cannot name a
reason, it must not make the change.

### 6.2 The constraint set

| Constraint                     | Source                    | Effect                                           |
| ------------------------------ | ------------------------- | ------------------------------------------------ |
| MOQ per call-off               | Contract                  | Floors each delivery                             |
| Rounding value                 | Pack, pallet, drum, truck | Each delivery is a whole multiple                |
| Vendor capacity per period     | Contract / measured       | Ceilings each delivery                           |
| Vendor calendar                | Vendor master             | No dispatch on non-working days                  |
| Plant receiving calendar       | Plant master              | No receipt on shutdown days                      |
| Transit time                   | Lane                      | Shifts dispatch vs receipt dates                 |
| QA quarantine                  | Material master           | Delays availability after receipt                |
| **Volumetric storage cap**     | Warehouse                 | Ceilings on-hand at any moment — dominant for PM |
| Shelf life                     | Material master           | Ceilings forward cover for RM                    |
| Minimum gap between deliveries | Logistics                 | Prevents uneconomic dribble                      |
| Source split                   | Sourcing (the 60:40)      | Divides each line across vendors                 |
| Artwork / version cut-over     | Marketing                 | Hard stop date for old-version PM                |
| Challan validity               | Statutory (job work)      | Ceilings how long components sit at a CM         |

### 6.3 Worked — PM-88431 delivery schedule

**Requirement.** MRP proposes a consolidated 6-week PO (fixed-period lot sizing, one campaign). Opening stock 260,000
pcs; safety stock 100,000 pcs.

**The unconstrained (ideal) schedule — what the planner wants:**

| Line | Need-by          | Gross req that week | Ideal delivery | Balance after |
| ---- | ---------------- | ------------------: | -------------: | ------------: |
| 10   | Mon W37 (7 Sep)  |             180,000 |        100,000 |       180,000 |
| 20   | Mon W38 (14 Sep) |             210,000 |        130,000 |       100,000 |
| 30   | Mon W39 (21 Sep) |             240,000 |        240,000 |       100,000 |
| 40   | Mon W40 (28 Sep) |             240,000 |        240,000 |       100,000 |
| 50   | Mon W41 (5 Oct)  |             200,000 |        200,000 |       100,000 |
| 60   | Mon W42 (12 Oct) |             180,000 |        180,000 |       100,000 |
|      |                  |       **1,250,000** |  **1,090,000** |               |

_(Line 10 is 100,000 not 20,000 because MOQ floors it. That +80,000 is a lot-sizing addition, not a requirement, and is
labelled as such.)_

**Now apply the constraints.** Two bind:

- Vendor's annual maintenance shutdown in **W39** — confirmed, zero production capacity that week.
- Vendor weekly capacity **250,000 pcs**.
- **Warehouse volumetric cap 320,000 pcs** for this item.

**The constrained (committable) schedule:**

| Line | Delivery date |         Ideal | **Committed** |        Δ | Balance after | Constraint that moved it                  |
| ---- | ------------- | ------------: | ------------: | -------: | ------------: | ----------------------------------------- |
| 10   | Mon W37       |       100,000 |   **240,000** | +140,000 |       320,000 | Pull-forward to cover W39 shutdown        |
| 20   | Mon W38       |       130,000 |   **210,000** |  +80,000 |       320,000 | Pull-forward, capped by warehouse ceiling |
| 30   | W39           |       240,000 |         **0** | −240,000 |        80,000 | **Vendor shutdown — no capacity**         |
| 40   | Mon W40       |       240,000 |   **240,000** |        0 |        80,000 | —                                         |
| 50   | Mon W41       |       200,000 |   **220,000** |  +20,000 |       100,000 | Recovery of the safety-stock dip          |
| 60   | Mon W42       |       180,000 |   **180,000** |        0 |       100,000 | —                                         |
|      |               | **1,090,000** | **1,090,000** |    **0** |               |                                           |

**The delta ledger — displayed verbatim to the planner:**

> **240,000 pcs moved out of W39.** Vendor plant shutdown 21–27 Sep (confirmed 14 Aug). No production capacity that
> week.
>
> **Pull-forward capped at 240,000 / 210,000 in W37 / W38.** The binding constraint is **not** vendor capacity — the
> vendor could supply 250,000 in each week. It is the **warehouse volumetric ceiling of 320,000 pcs** for this item.
> Empty bottles are the constraint, not the vendor.
>
> **Residual exposure: 20,000 pcs below safety stock in W39 and W40** — approximately 0.7 days of cover. Recovered in
> W41. Safety stock is never fully consumed and there is no stock-out at any point.
>
> **No MOQ or rounding adjustment required.** All committed lines are whole pallet multiples and above the 100,000 MOQ.
>
> **Three ways to close the residual 20,000:**
>
> 1. Accept it — 0.7 days into a buffer sized for ~3.4 days.
> 2. Ask the vendor to dispatch 20,000 in W39 from finished stock built ahead of the shutdown. _The shutdown stops
>    production, not dispatch._
> 3. Take 20,000 pcs of external floor space in W37 to lift the volumetric ceiling.

That last distinction — production shutdown is not dispatch shutdown — is the kind of thing a planner knows and a system
usually does not. Encoding it is what makes the difference between a tool a planner uses and a tool a planner works
around.

### 6.4 Supply confidence tiers

The sponsor's rosy-picture warning becomes a structural rule. Every supply element carries a tier, and the tier is
always visible.

| Tier  | Name          | What it means                                                                                         | How it is drawn  | Counted in the plan?                           |
| ----- | ------------- | ----------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------- |
| **1** | **Confirmed** | Vendor has acknowledged this specific schedule line, date and quantity — or has dispatched against it | Solid            | Yes, at the stated date                        |
| **2** | **Committed** | A PO schedule line exists; no vendor acknowledgement                                                  | Solid outline    | Yes, at the stated date, flagged               |
| **3** | **Planned**   | System-proposed. Nothing has been ordered                                                             | Hatched / dotted | Shown, but **excluded** from exception scoring |

Two rules follow, and they are non-negotiable:

- **A safety-stock breach avoided only by a Tier-3 receipt is still a breach.** It is raised as one.
- **A breach avoided only by a Tier-2 receipt is raised as "supply unconfirmed"**, naming the line, the vendor and the
  quantity at risk.

For RM-30114, W41's 1,150 MT is Tier 2. The plan looks recoverable _because of a line nobody has confirmed_. The system
says so.

### 6.5 Adherence capture — the quiet foundation of Phase 2

Every committed schedule line records, permanently: quantity, requested date, vendor-committed date, dispatch date if
known, actual GRN date, actual GRN quantity, and the reason code for any change.

This is a small feature with a large consequence. It is the data GCPL does not have today — _"we don't have in the
system a PO date to the lead time specifically mapped in the PO itself, it's more of an experience that comes in from
people"_ — and it is the exact data Phase 2 needs. The sponsor drew this link himself: _"once we have your scheduling
done, then you can ideally rely on that data to even calculate the supplier reliability factor, which currently is
experiential."_

**Phase 1 must run for one full ordering cycle before Phase 2 has anything to learn from.** That is a schedule
dependency, and it should be said out loud in the SOW rather than discovered later.

---

## 7. Screens

Eight screens. Each is described by what its reader must be able to conclude from it.

Screens 1 to 7 are the planner's daily loop: see the position, find the risk, understand the calculation, build the
schedule, act, and record what happened. Screen 8 serves a different reader — the category manager, the sourcing lead,
the planning head — and answers the sponsor's separate question about what intelligence comes out of the PO data as a
whole.

### 7.1 Screen 1 — Planning Position

_"What needs me today?"_ — answered in 30 seconds.

- **Run header:** as-of timestamp, run type, MPS version, pilot category, coverage of materials planned.
- **Six tiles:** materials planned · projected stock-outs · safety-stock breaches · **unreachable requirements**
  (release date already passed) · unconfirmed supply in critical weeks · excess-or-expiry risk. Each tile is a filter,
  not a decoration.
- **The Drift Panel — _"what changed since the last run"_.** This is the direct answer to the parallel-Excel problem,
  and it is the feature most likely to change a planner's daily behaviour. It lists materials whose position moved
  materially since the previous run, with the cause attributed: demand changed · stock changed · a GRN landed · a GRN
  did not land · a norm was changed · a PO was rescheduled. Sorted by days-of-cover lost.
- **Material table:** material · description · plant · type (RM/PM) · first breach date · days of cover today · quantity
  at risk · supply confidence of the next receipt · status. Sorted by _time to breach_, not by material code.

### 7.2 Screen 2 — Material Workbench

The heart of the product. The chart and the grid, together, on one screen, for one material. This is where the sponsor's
_"clean net requirement calculation"_ actually lands.

**The chart — projected inventory over time**

| Element             | Specification                                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X axis              | Time buckets, with bucket-width boundaries visible; daily near-term, weekly thereafter                                                                                                       |
| Y axis              | Quantity in the material's own unit, always labelled                                                                                                                                         |
| Primary series      | Projected available balance as a **stepped line** — stock changes in discrete events, not smooth curves. A smoothed line implies a precision the plan does not have.                         |
| Safety stock        | Solid horizontal reference line, with the area beneath it lightly shaded as the risk zone                                                                                                    |
| Zero line           | Distinct from safety stock — the difference between "eating buffer" and "stopped the line"                                                                                                   |
| Max norm            | Second horizontal line; area above shaded as excess                                                                                                                                          |
| Demand              | Downward bars below the axis, per bucket                                                                                                                                                     |
| Supply              | Upward bars: **solid** = Tier 1 confirmed, **outlined** = Tier 2 committed, **hatched** = Tier 3 planned. The visual weight must match the confidence.                                       |
| **Today marker**    | Vertical line                                                                                                                                                                                |
| **Lead-time fence** | Vertical line at the earliest achievable receipt for a _new_ order. Everything left of it is unsolvable by ordering. Labelled in words on the chart, not just in a legend.                   |
| **Drift overlay**   | Toggle: _maintained lead time_ vs _measured lead time_. Draws the second fence and a ghost balance line. This is where a planner sees, in one click, what their master data is costing them. |
| Breach shading      | Buckets where balance < safety stock shaded amber; < 0 shaded red                                                                                                                            |
| Hover               | The complete arithmetic for that bucket — opening, in, out, closing, versus safety stock                                                                                                     |

**The grid — the classic planning table, made legible**

Rows are fixed and in this order. Columns are buckets. Every cell is clickable to its explanation.

| #   | Row                                         | Meaning                                                          |
| --- | ------------------------------------------- | ---------------------------------------------------------------- |
| 1   | Gross requirement                           | Demand for this material this bucket                             |
| 2   | — _from MPS (independent)_                  | For an FG or MTO item                                            |
| 3   | — _from BOM explosion (dependent)_          | Aggregated across parents — **expandable to show which parents** |
| 4   | Scheduled receipts — confirmed              | Tier 1                                                           |
| 5   | Scheduled receipts — committed              | Tier 2                                                           |
| 6   | In transit / in QA                          | Dated, not yet available                                         |
| 7   | **Projected balance before planned orders** | The honest position with no wishful supply                       |
| 8   | Safety stock                                | The line being defended                                          |
| 9   | **Net requirement**                         | The shortfall — _the number the sponsor asked for_               |
| 10  | Planned order receipt                       | After MOQ, rounding, max lot                                     |
| 11  | — _of which added by lot sizing_            | Need versus rule, separated                                      |
| 12  | **Planned order release**                   | Offset back by lead time — **red if in the past**                |
| 13  | **Projected balance after planned orders**  | The plan, if everything proposed is actually done                |
| 14  | Days of cover                               | Forward-looking, at planned consumption                          |
| 15  | Status                                      | OK / Tight / Breach / Stock-out / Unreachable / Excess           |

Row 7 versus row 13 is the whole story of the screen: _where you are heading_ versus _where you would head if you
acted_. Showing only row 13 — which most tools do — hides the problem behind its own proposed solution.

### 7.3 Screen 3 — Supply Timeline & PO Schedule Builder

Two halves.

**Upper — the inbound timeline.** Each open PO on a horizontal track, with its schedule lines as markers, and each
line's state along the pipeline the sponsor described:

```
PO created → vendor acknowledged → dispatched → in transit → received (GRN) → QA released → available
```

Each line shows quantity, requested date, committed date, current expected date, tier and the drift against the
maintained lead time. Where a line is late, the delay is shown in days and in _days of cover lost_, because a five-day
delay on a fast mover and a five-day delay on a slow mover are not the same event.

**Lower — the schedule builder.** Side by side: ideal schedule, committed schedule, delta ledger (as §6.3). The planner
can adjust a line's quantity or date; the chart above and the grid on Screen 2 recompute live; the delta ledger
re-attributes; any constraint violated by the manual edit is named immediately rather than silently accepted.

The output is a schedule the planner can send: PO number, line, quantity, requested delivery date, ship-from, ship-to,
and the reason for any change from the previous version.

### 7.4 Screen 4 — Adherence

> _"Adherence against that is something that you look after your GRN is done."_

The schedule builder says what GCPL asked for. This screen says what happened. It is the other half of the same feature,
and without it the schedule is a document rather than a loop.

**The record.** Every schedule line carries its own history, permanently, whether or not anyone looks at it:

|                                           | RM-30114 · PO 4700221 · line 10  |
| ----------------------------------------- | -------------------------------- |
| Requested available date                  | 14 Sep                           |
| Vendor committed date                     | 18 Sep                           |
| Goods receipt (GRN)                       | 22 Sep                           |
| Quality released — available              | 26 Sep                           |
| **Deviation against request**             | **+12 days**                     |
| Quantity requested / committed / received | 1,150 / 1,150 / 1,120 MT         |
| **Quantity fill**                         | **97.4%**                        |
| Reason code                               | Vessel roll at transhipment port |

**And then the part that changes the conversation.** A twelve-day slip is not "the supplier was late". Split across the
four intervals of §9.2, against the 90-day maintained chain:

| Interval                                          | Maintained |    Actual |    Slip | Owner      |
| ------------------------------------------------- | ---------: | --------: | ------: | ---------- |
| Vendor response — PO release to acknowledgement   |        3 d |       7 d |  **+4** | Sourcing   |
| Vendor readiness — acknowledgement to dispatch    |       35 d |      37 d |      +2 | Vendor     |
| Transit + clearance — dispatch to gate-in         |       46 d |      50 d |  **+4** | Logistics  |
| Receipt to available — gate-in to quality release |        6 d |       8 d |      +2 | Plant / QC |
| **Total planning lead time**                      |   **90 d** | **102 d** | **+12** |            |

Two-thirds of the slip belongs to GCPL, not to the supplier. Four days were lost before the vendor was even told, and
four more after the material had physically arrived in the country. That is not an accusation — it is four different
fixes with four different owners, and none of them is "chase the vendor harder".

**Three views, same data.**

- **By line** — the record above, opened from any receipt on the supply timeline.
- **By material** — every receipt of RM-30114 over the measurement window, as a distribution rather than an average, so
  a planner can see whether 104 days is a reliable 104 or a coin toss between 88 and 121.
- **By vendor** — the same distribution for everything that vendor supplies, which is the input to vendor scorecards and
  to Phase 2.

**Reason codes matter more than they look.** A deviation with no reason is a number; a deviation with a reason is a
pattern. The code list is short, closed, and set with the planners rather than for them, and free text is always
available alongside it. Reason capture is what lets Phase 2 exclude a genuine one-off — a port strike, a plant shutdown
— from a lead-time calculation without anyone quietly deleting inconvenient data.

**What this screen deliberately does not do.** It does not score anyone, does not propose a new lead time, and does not
adjust master data. Phase 1 measures. Phase 2 proposes. Keeping those apart is what makes the measurement trustworthy
enough to act on later — and it is why this screen has to exist from day one even though its value is mostly realised
later.

**One honest caveat.** Vendor committed date and dispatch date do not exist in a system today (§10). At the start, the
planner records them — a field on the line, filled in after the call they were already making. That is enough to build
the dataset, and it costs the planner nothing they were not already doing.

### 7.5 Screen 5 — Explain

Opens from any number, anywhere. Never a separate destination.

Three tiers, disclosed progressively:

**Tier 1 — one sentence, before any table.**

> _"Order 1,000 MT of RM-30114 (PFAD Import) to land in week 39 (21 Sep). Week 39 demand of 800 MT plus a 1,400 MT
> safety stock exceeds the 2,080 MT projected on hand by 120 MT. The order is 1,000 MT — not 120 MT — because the
> minimum vessel parcel is 1,000 MT. This order needed to be released in week 26 (22 Jun) and cannot now be placed in
> time."_

**Tier 2 — the arithmetic, one line per operand, each with its own provenance.**

```
Gross requirement, W39                          800 MT   ← soap → noodle → oil chain  ▸
+ Safety stock                                1,400 MT   ← SAP material master, set 14 Mar 2024
= Required position                           2,200 MT

Projected balance, end W38                    2,080 MT   ← rolled from opening stock  ▸
+ Scheduled receipts, W39                         0 MT
= Available position                          2,080 MT

NET REQUIREMENT                                 120 MT
MOQ 1,000 MT (vessel parcel)                   +880 MT   ← binding
Rounding value 250 MT                         not binding
PLANNED ORDER RECEIPT                         1,000 MT

Lead time 90 days → 13 buckets
REQUIRED RELEASE WEEK                   W26 (22 Jun)  ⚠ 10 weeks past
EARLIEST ACHIEVABLE, IMPORT             W49 (30 Nov)
EARLIEST ACHIEVABLE, LOCAL TWIN         W41 (5 Oct)   ← RM-30112, same item category
```

**Tier 3 — the checks a planner would do next, without leaving the panel.**

- **Where the 800 MT came from:** the soap demand, the noodle factor, the oil content, both conversion yields, the blend
  ratio and the source split — each shown as its own step.
- **Where the 2,080 MT came from:** the roll from opening stock, receipt by receipt.
- **Provenance of every input:** system, field, value, who last changed it and when. Master data set in March 2024 and
  never revisited is a fact the planner should be able to see.
- **Item-category check:** the other material codes carrying the same chemistry, with their own lead times, stock and
  fences — so the local twin is on the screen at the moment the decision is made, not remembered afterwards.
- **Horizontal check:** the other oils in the same blend, with their own status — so a planner never pulls in one
  component of a blend whose partner cannot follow.
- **Reality check:** maintained lead time versus measured, with the last eight receipts listed.

**Non-goal.** No LLM in Phase 1. Tier 1 is a template filled from the calculation, and it is deterministic: the same
numbers always produce the same sentence. The sponsor deferred the intelligence layer, and a generated narrative that
cannot be reproduced is the opposite of a trust layer.

### 7.6 Screen 6 — Exception Queue

The exceptions of §11, prioritised by consequence, not by count.

Ranking inputs: time to breach · quantity at risk · days of cover at risk · whether it is reachable by ordering · supply
confidence · value at risk · whether a horizontal block makes action futile.

Grouped by _what the planner would do about them_, not by exception type — because a planner's morning is a sequence of
phone calls, not a taxonomy:

- **Cannot be fixed by ordering** (inside the frozen zone) — needs expedite, substitution or resequencing
- **Fix by switching source** — an alternate material code in the same item category has a short enough lead time to
  reach it
- **Fix by moving an existing PO** — pull-in, push-out
- **Fix by placing an order this week** — the last responsible order date is now
- **Fix by getting a confirmation** — Tier-2 supply propping up a critical week
- **Fix the data** — master-data gaps and drift

Every exception is dismissible with a reason, and dismissals are retained. A recurring dismissal is itself a finding: it
usually means a norm is wrong, which is the bridge to Phase 2.

### 7.7 Screen 7 — Simulate & Override

The planner changes one input and sees the consequence before committing.

**Simulate.** Adjustable: lead time · safety stock · demand in a bucket · a scheduled receipt's date or quantity · MOQ
or rounding · lot-sizing policy. Side by side: before, after, and the delta in first-breach date, quantity at risk, peak
inventory, days of cover and value.

The demo case: change RM-30114's lead time from the maintained 90 days to the measured 104 days. The lead-time fence
moves from W49 to W51, two more weeks fall into the frozen zone, and the exposure the planner thought they were closing
at the end of November closes in mid-December instead. On a 90-day import, two weeks is a vessel. That single toggle is
the strongest possible argument for Phase 2, made without a slide.

**Override.** A planner can override any input for a specific material with a mandatory reason code and free text.
Overrides are scoped, dated, expiring, attributed and fully audited; before-and-after is always shown. An override never
silently changes SAP — write-back is a separate, governed action.

This is the sponsor's _"decision support, not a black box"_ requirement made concrete.

### 7.8 Screen 8 — PO Control Tower

> _"It gives me an intelligence out of that entire data — a kind of reporting which I can check… how many POs have been
> generated from plant, from HO. All those kind of intelligences that I would want to look at."_

Screens 1 to 7 answer _what should I do about this material_. This one answers _how is the whole book behaving_, and its
reader is not the daily planner. It is deliberately the last screen in the document because it is worthless until the
seven before it are generating the data it counts.

**The open book — where every live schedule line currently sits.** Illustrative, pilot category:

| State                         |   Lines |    Share |
| ----------------------------- | ------: | -------: |
| Awaiting vendor confirmation  |     229 |    36.3% |
| Confirmed, not yet dispatched |     214 |    33.9% |
| Dispatched / in transit       |     141 |    22.3% |
| **Past due, no GRN**          |  **47** | **7.5%** |
| **Total open schedule lines** | **631** |     100% |

The first row is the one that should stop a category manager. **36% of the open book is supply nobody has confirmed** —
and until this screen exists, there is no number for it at all. That single figure is the strongest available argument
for a vendor collaboration portal, and it is produced as a by-product of Phase 1 rather than as a project of its own.

**The closed book — what actually happened.** Last 90 days, lines received:

| Outcome vs requested date |   Lines | Share |
| ------------------------- | ------: | ----: |
| On time (within ±2 days)  |     197 | 40.5% |
| Late 3–7 days             |     118 | 24.3% |
| Late 8–14 days            |      96 | 19.8% |
| Late more than 14 days    |      75 | 15.4% |
| **Total received**        | **486** |  100% |

With quantity fill at 96.8%, line-level on-time-in-full comes out at **35.4%**. Whether that number is good or bad is
not for this document to say — but it is currently unknown, and a planning organisation that does not know it is tuning
norms in the dark.

**Drilldowns.** Every figure on this screen breaks down by plant · category · material · vendor · buyer, and by **who
raised the PO — plant or HO**, which the sponsor asked for by name. The distributions from Screen 4 aggregate here: a
vendor's median lead time and its spread, side by side with the value they hold in the open book.

**Deliberately excluded.** No narrative summary, no recommended actions, no risk scores, no anomaly detection. This
screen counts things that happened and shows them accurately. The layer that interprets them is the intelligence layer
the sponsor parked, and putting a preview of it here would blur exactly the boundary this document has been careful to
keep — _"we will have to have the base system"_. Counting is Phase 1. Concluding is later.

---

## 8. The five-minute explainability standard

The sponsor's brief was that a planner glancing at this for five minutes must be able to trust it. That is a testable
standard, not a sentiment. Eight rules, applied to every screen:

1. **Every number is either an input or a result, and the screen says which.** An input has a source. A result has a
   formula. Nothing is unattributed.
2. **Every formula shows its operands, and every operand is itself clickable.** Explanation recurses until it reaches a
   source system field.
3. **Every recommendation renders as one plain sentence before any table.** If it cannot be said in one sentence, it is
   not understood well enough to be shown.
4. **Arithmetic must foot on screen.** Displayed components sum to displayed totals. Rounding is shown as its own line,
   never absorbed silently.
5. **Every input carries provenance:** source system, field, value, as-of, last changed by, last changed when.
6. **Nothing appears without a unit and a date.** "800" is not information. "800 MT, week 39" is.
7. **Colour never carries meaning alone.** Every status has an icon and a word. Planners print these screens, and
   printers are not kind to amber.
8. **Every override records who, when, what, why, before and after** — and expires.

**Acceptance test for the prototype.** Sit a GCPL planner who has never seen the tool in front of Screen 2 with a
material at risk. Within five minutes and without assistance, they must be able to state: _when_ it breaches, _by how
much_, _why_ the system recommends what it recommends, _whether that recommendation is even placeable in time_, and
_what they would do about it_. If they cannot, the screen has failed regardless of what it contains.

---

## 9. Phase 2 — Dynamic Norms Calculator

> _"There are no intelligent ways of us understanding… it is heuristic, tribal knowledge. Vendor lead time plus transit
> time, addition of that is our order norms. There's no science to it."_

Phase 2 is a calculator a planner or category manager **runs**, producing proposals that override the inputs the MRP
engine consumes. It is not an automatic optimiser and it does not change anything on its own.

### 9.1 What a norm is made of

Today's GCPL norm is roughly _vendor lead time + transit time_, set once from experience, and expressed as a coverage
target — 90 days for the long-lead oils, 60 for others, measured as stock on hand plus open PO. That formulation has no
term for **variability**, which is what safety stock exists to absorb. It answers "how long does it usually take" and
never "how badly can it go".

A norm that reflects reality has four parts:

| Component            | Covers                                | Driven by                                                           |
| -------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| **Pipeline stock**   | Consumption during the lead time      | Average demand × average lead time                                  |
| **Cycle stock**      | The gap between orders                | MOQ, campaign length, review period                                 |
| **Safety stock**     | Variability in demand _and_ in supply | Demand variability, **lead-time variability**, target service level |
| **Strategic buffer** | Known future events                   | Seasonal build, shutdown cover, price-hedge position                |

The fourth is a management decision and stays a manual input. The first three are computable — once the data exists.

### 9.2 Measuring lead time honestly

Phase 2 begins by defining what "lead time" means, because today it means different things to different people. Four
intervals are measured separately, because each has a different owner and a different fix:

| Interval                     | From → To                                                | Who owns it                           |
| ---------------------------- | -------------------------------------------------------- | ------------------------------------- |
| Vendor response              | PO release → vendor acknowledgement                      | Sourcing                              |
| Vendor readiness             | Acknowledgement → dispatch                               | Vendor                                |
| Transit + clearance          | Dispatch → gate-in (for imports: sailing, port, customs) | Logistics                             |
| Receipt to available         | Gate-in → GRN → quality release against COA              | Plant / QC                            |
| **Total planning lead time** | **PO release → available for consumption**               | **This is the number MRP should use** |

Most planning systems use the vendor's quoted manufacturing time and silently omit the rest. That is a large, systematic
understatement, and it is why plans that look fine on paper break at the dock. Measuring the four intervals separately
is what turns "the supplier is late" into a statement about which of four owners is late.

The sponsor flagged the recency-bias problem directly: _"if you go and ask them in a week… past seven days for that
vendor, people's opinion might change because of recent impact."_ The calculator therefore uses an explicit, visible,
configurable window (default: last 12 months or last 12 receipts, whichever is longer), shows every observation, and
lets the planner exclude an outlier **with a reason** that is recorded. The judgement stays human; the arithmetic stops
being folklore.

### 9.3 Worked — RM-30114 (PFAD Import)

**Maintained today:** lead time 90 days, safety stock 1,400 MT, norm expressed as 90 days cover.

**Measured, last 8 receipts (days from PO release to QC release):** 88, 112, 97, 121, 103, 94, 118, 99

- Average: **104.0 days** (14 days longer than maintained)
- Standard deviation: **11.8 days**

**Demand:** average 850 MT/week, standard deviation 150 MT/week → 121.4 MT/day, daily variability 56.7 MT.

**Safety stock at a 95% service level** must absorb both sources of variability:

| Source                                           | Contribution to variance |     Share |
| ------------------------------------------------ | -----------------------: | --------: |
| Demand variability over the lead time            |                  334,286 | **13.9%** |
| **Lead-time variability against average demand** |            **2,064,286** | **86.1%** |
| Total                                            |                2,398,572 |      100% |

Combined standard deviation ≈ 1,549 MT. At a 95% service level (z = 1.65):

> **Proposed safety stock: 2,555 MT — against 1,400 MT maintained.**

And the reorder point, which is the norm GCPL actually maintains:

|                   |    Maintained |      Proposed |                      Gap |
| ----------------- | ------------: | ------------: | -----------------------: |
| Lead time         |       90 days |      104 days |                 +14 days |
| Pipeline stock    |     10,929 MT |     12,629 MT |                +1,700 MT |
| Safety stock      |      1,400 MT |      2,555 MT |                +1,155 MT |
| **Reorder point** | **12,329 MT** | **15,184 MT** |            **+2,855 MT** |
|                   |               |               | **≈ 23.5 days of cover** |

**The finding that matters is not the number. It is the decomposition.**

**86% of the required safety stock exists because the supplier's lead time is unreliable, not because demand is
volatile.** That inverts the usual response. The instinctive fix is to carry more stock. The decomposition says the
cheaper fix is upstream:

> If lead-time variability were halved — from 11.8 to 5.9 days, through vendor scheduling discipline, earlier
> confirmation, or leaning harder on the local twin — the required safety stock falls from **2,555 MT to 1,522 MT**. A
> **1,033 MT permanent reduction in working capital**, achieved by making the supply more predictable rather than by
> buying more oil.

That argument has particular force here, because the same chemistry is available locally on a 30-day lead time. The
trade-off between the import price advantage and the inventory the import's variability forces GCPL to carry is
currently made on price alone. Phase 2 puts both sides of it in rupees.

That is the argument the norms calculator exists to make, and it is unmakeable today because the data does not exist. It
becomes makeable the moment Phase 1 has run for one ordering cycle.

### 9.4 Source split — putting science under the 60:40

> _"The SOQ maintenance on each of the vendors — there is no science to it, it is 60:40."_

Phase 1 already applies the split as a scheduling constraint. Phase 2 proposes what it should be, from measured evidence
rather than habit:

| Input                                 | Measured from                                     |
| ------------------------------------- | ------------------------------------------------- |
| On-time delivery                      | Committed date vs GRN date, per vendor            |
| Quantity fill                         | Committed quantity vs GRN quantity                |
| Lead-time average and **variability** | The four intervals in §9.2                        |
| Quality rejection rate                | QA outcomes                                       |
| Responsiveness                        | Time to acknowledge, acceptance rate for pull-ins |
| Capacity headroom                     | Observed maximum vs committed                     |
| Landed cost                           | Price + freight + duty                            |

A vendor with a lower price but double the lead-time variability is not cheaper — they are cheaper per MT and dearer in
the safety stock they force GCPL to carry. Phase 2 quantifies that trade-off in rupees, which is the first time the
sourcing conversation and the inventory conversation can be held in the same currency.

For the oils the split is not only between vendors but between **sources of the same chemistry** — a local material code
and an import material code under one item category, with a 60-day lead-time difference between them. The same scoring
applies, and the answer is a ratio the buying team can defend.

### 9.5 Running the calculator

```
Select scope (category / plant / vendor / material)
   → Set the measurement window and service-level target
   → Review measured inputs, exclude outliers with reason
   → See proposed vs maintained, side by side, per material
   → See the impact: inventory value, days of cover, service level,
     first-breach dates across the portfolio
   → Approve / reject / override per material, with reason
   → Route for governance approval
   → Write back (or export) to SAP
```

**Governance, because norms move money:**

- Proposals are never auto-applied. The calculator has no write authority of its own.
- Guardrails: a maximum permitted change per cycle, per material, defined by category.
- Approval thresholds by inventory-value impact.
- Full audit: proposed value, approved value, who, when, why, and the data window used.
- Every subsequent MRP run states which norm version it used, so a plan can always be reconciled to the norms in force
  when it ran.
- **Back-test before adoption:** replay the last two quarters with proposed norms against actual demand and actual
  receipts, and report what would have changed — stock-outs avoided, inventory carried. Nobody should adopt a norm
  change on a formula alone.

### 9.6 Prerequisites — stated plainly

Phase 2 needs data Phase 1 creates. If Phase 2 is attempted first, it will be a formula applied to folklore.

| Needed                            | Source                        | Status today                   |
| --------------------------------- | ----------------------------- | ------------------------------ |
| PO release date per line          | Phase 1 or SAP                | Available                      |
| Vendor-committed date per line    | **Phase 1 adherence capture** | **Does not exist**             |
| Dispatch date                     | Vendor / logistics signal     | Not systematised — see §13     |
| GRN date and quantity             | SAP                           | Available                      |
| QA release date                   | SAP QM                        | Assumed available — to confirm |
| Demand history at material level  | SAP                           | Available                      |
| Reason codes for schedule changes | **Phase 1 override capture**  | **Does not exist**             |

---

## 10. Data and signals register

| Signal                           | What it is                           | Likely source                     | Confidence | Phase 1 fallback                                            |
| -------------------------------- | ------------------------------------ | --------------------------------- | ---------- | ----------------------------------------------------------- |
| MPS / independent demand         | FG production plan by plant and date | SAP PP                            | High       | Excel upload                                                |
| BOM with yield and scrap         | Component structure                  | SAP PP                            | High       | Excel upload                                                |
| Stock on hand by status          | Unrestricted / QA / blocked          | SAP MM                            | High       | Excel upload                                                |
| Open POs and schedule lines      | Committed supply                     | SAP MM                            | High       | Excel upload                                                |
| GRN history                      | Actual receipts                      | SAP MM                            | High       | Extract                                                     |
| Maintained norms                 | LT, SS, MOQ, rounding, source split  | SAP material/info records         | High       | Excel upload                                                |
| **Vendor acknowledgement**       | Vendor confirms line, date, quantity | **None today**                    | **—**      | **Planner marks it in the tool; vendor portal is Phase 2+** |
| **Dispatch / in-transit**        | Deterministic "it has left" signal   | No TMS at GCPL                    | **—**      | **Planner entry, or email/document extraction**             |
| Vendor calendar and capacity     | Shutdowns, weekly ceilings           | Sourcing                          | Medium     | Manual master                                               |
| Warehouse volumetric caps        | Floor space by item                  | Plant logistics                   | Medium     | Manual master                                               |
| Artwork / version cut-over dates | Promo and pack changes               | Marketing / packaging development | Medium     | Manual master                                               |

**On the inbound signal, the sponsor was explicit and correct twice over.** GRN history gives supplier _trends_, not a
deterministic arrival date. There is no TMS, and vendor self-upload would not be reliable because _"not every vendor
will upload data."_

So Phase 1 does not pretend. It does three things instead:

1. **Tiers what it knows** (§6.4) so an unconfirmed line never reads as a confirmed one.
2. **Lets the planner record what they learn** from a phone call, in ten seconds, in the tool rather than in a
   spreadsheet — which is the cheapest possible way to start building the dataset that does not exist today.
3. **Shows the maintained-versus-measured drift** so the planner can see the size of what they do not know.

Structured vendor acknowledgement — a portal, an EDI feed, an email parser — is the highest-value integration to scope
next, and the sponsor's own reference point for it was the same pattern the industry has converged on. It is
deliberately not in Phase 1.

---

## 11. Pilot scope

The sponsor proposed the boundary himself: _"We'll see if we can do a POC in terms of the entire process itself, or
let's say maybe we pick up a category."_

Recommended pilot: **one category, one plant, complete depth.**

- One FG family with real demand seasonality
- Its full BOM to RM and PM — no truncation, because horizontal dependency between components is half the value
- 3–5 vendors including at least one long-lead import and one local packaging vendor
- 12 months of GRN history for the drift and norms work
- Both a directly-manufactured FG and, if available, a contract-manufactured one — the component-staging back-schedule
  is materially different and worth proving early

Depth over breadth. A category planned completely proves the engine. Fifty categories planned partially proves nothing,
and hides the exact interactions — sibling components, shared packaging, quarantine, volumetric limits — that make FMCG
planning hard.

---

## 12. The five-minute demo

| Time | Screen             | What the sponsor sees                                                                                                                                                                                          | Which of their words it answers                                                    |
| ---- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 0:00 | Planning Position  | 8 stock-outs, 23 breaches, **6 unreachable**. Drift panel: _"4 materials lost more than 2 days of cover since Friday's run."_                                                                                  | _"Three or four days later, suddenly my covers are at risk"_                       |
| 0:45 | Material Workbench | RM-30114, PFAD Import. The chart: balance falls through safety stock in W39, goes negative in W42. The lead-time fence sits at **W49 — ten weeks to the right of the breach.**                                 | _"MRP is just a netting calculation — show me it clean"_                           |
| 1:30 | The grid           | Row by row: gross requirement 800 · scheduled receipts 0 · projected 2,080 · safety stock 1,400 · **net requirement 120** — and a 1,000 MT order, because 880 MT of it is the minimum parcel, not the need     | _"Gross requirement, planned receipt, current inventory — how much negative am I"_ |
| 2:15 | Explain            | One sentence, then the arithmetic back through the source split, blend ratio, both yields and the noodle factor to a soap number the sponsor recognises. Then provenance: safety stock last changed March 2024 | _"This gives you that trust layer"_                                                |
| 2:45 | Supply Timeline    | PO 4700221: line 1 confirmed W38, **line 2 unconfirmed W41**. The plan only survives because of a line nobody has confirmed.                                                                                   | _"Not assumptions that give you a rosy picture"_                                   |
| 3:15 | Drift toggle       | Maintained 90 days vs measured 104. The fence slides from W49 to W51. On a 90-day import, two weeks is a vessel.                                                                                               | _"No science to it — it's tribal knowledge"_                                       |
| 3:45 | Schedule Builder   | PM-88431: ideal six deliveries vs committed six deliveries, and the ledger naming **the warehouse ceiling, not the vendor**, as the binding constraint                                                         | _"How do you break the PO into the parts I need?"_                                 |
| 4:30 | Action             | Pull line 2 in to W39, split into two deliveries, record the reason. Chart and grid recompute. Residual exposure stated honestly.                                                                              | _"Adherence against that is what you look at after GRN"_                           |

**The closing line of the demo is a preview of Phase 2:** _every decision just taken — what was asked for, what was
committed, what actually arrived — is now recorded. In one ordering cycle, that is the dataset that tells you what your
lead times and safety stocks should actually be._

---

## 13. Open questions register

Assumptions the prototype runs on, and what must be confirmed. Grouped by who can answer.

**Demand and MPS**

1. Is there a single agreed MPS per plant, or do planning and production hold different versions?
2. Is demand for the pilot category forecast-driven or distributor-pull? Both were described in the workshop and they
   behave differently.
3. What is the current planning horizon in SAP, and does it cover the longest RM lead time?
4. How are promotional and seasonal volumes represented — inside the MPS, or as separate uplifts?

**BOM and manufacturing** 5. How deep is a typical FG BOM — is there a distinct bulk/semi-finished level, or does FG
explode straight to RM and PM? 6. Are yield and scrap maintained today, at operation or component level, and are the
values trusted? 7. How many materials are shared across multiple FGs and plants? This drives the LLC logic's real
value. 8. Are alternative BOMs and production versions actively used? 9. What share of the pilot category is
contract-manufactured, and does GCPL supply the components?

**Supply and scheduling** 10. Does SAP hold multiple schedule lines per PO today, or one date per PO? 11. Is there
**any** vendor acknowledgement captured anywhere — email, portal, spreadsheet? 12. Is a dispatch or in-transit signal
available from any vendor, in any form? 13. Are vendor capacity ceilings and shutdown calendars documented, or held
informally? 14. Are warehouse volumetric limits by item known, or managed by eye at the dock? 15. Where does the source
split live — info records, a spreadsheet, or a person?

**Norms and master data** 16. Where exactly are lead time and safety stock maintained, and who has change authority? 17.
Is there any change history on these fields? _(This determines whether "last changed" can be shown at all.)_ 18. What
service-level target should the norms calculator solve for, and does it vary by category or by A/B/C class? 19. Is QA
release date captured with a timestamp distinct from GRN?

**Process and people** 20. How many planners cover the pilot category, and what is the current MRP run cadence? 21. What
does the parallel Excel actually contain? It is the sharpest available specification of what SAP is failing to show, and
it should be collected verbatim. 22. Who approves a norm change today, and how long does it take? 23. Which decisions
must a planner never be able to take alone?

**Commercial and system** 24. Does the prototype read from SAP directly, from an extract, or from uploads? 25. Is
write-back to SAP in scope at any phase, or is the output always an export? 26. How does this sit alongside existing
tools, and what is the boundary?

---

## 14. Deferred, with prerequisites

Named so the sequencing is deliberate rather than accidental. Each was discussed in the workshop.

| Deferred capability                              | Why deferred                                                                                           | Prerequisite                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| **Intelligence / LLM narrative layer**           | Sponsor deferred it explicitly: _"we will have to have the base system"_                               | Phase 1 in production                                           |
| **Autonomous PO release**                        | Requires trust that has to be earned by a running system, plus a governance framework                  | Phase 1 + a track record of accepted recommendations            |
| **Transitions module** (packaging change in/out) | Named problem #2. Needs the netting grid to sequence run-out against run-in                            | Phase 1 grid + artwork cut-over master data                     |
| **Seasonal absent-item detection**               | The 18-month placeholder-SKU problem. Powerful but a distinct product                                  | Phase 1 BOM explosion + predecessor/successor attribute mapping |
| **Vendor collaboration portal**                  | The highest-value integration after Phase 1, and the only way to get true Tier-1 confirmation at scale | Phase 1 schedule lines to send                                  |
| **Multi-echelon / inter-plant redeployment**     | Assumes network stock transfer is a live lever at GCPL — not confirmed                                 | Q26 answered                                                    |
| **Capacity load balancing and pre-build**        | Belongs with production scheduling, not material planning                                              | Line capacity master data                                       |
| **Forecast accuracy analytics**                  | No demand-planning workflow in scope                                                                   | A demand-planning system of record                              |
| **Scenario libraries and comparison**            | Phase 1 has single-parameter simulation only                                                           | Phase 1 simulation in use                                       |

---

## 15. Success criteria

How the client should judge the prototype. If it does not pass these, it has not earned Phase 2.

**Comprehension**

- A planner new to the tool can state, unaided, within five minutes: when a material breaches, by how much, why, whether
  it can be fixed by ordering, and what they would do.
- Every number on every screen can be traced to a source field in at most four clicks.

**Correctness**

- For the pilot category, every projected balance reconciles exactly to a hand-worked netting on the same inputs.
- Displayed components sum to displayed totals everywhere, with rounding shown as its own line.
- Where the prototype disagrees with SAP, the difference is explainable by a named input difference — never by an
  unexplained gap.

**Decision value**

- The system identifies at least one **unreachable requirement** the planner did not know about.
- The system identifies at least one **material lead-time drift greater than 20%** against maintained master data.
- The system identifies at least one case where the binding constraint on a delivery schedule is **not** the one the
  planner assumed.

**Behaviour**

- A planner can produce a sendable delivery schedule for a PO in under two minutes.
- For the pilot category and pilot window, no planner needs to build a parallel Excel to answer "where are my covers".

**Foundation**

- After one ordering cycle, the adherence dataset — requested date, committed date, actual GRN, reason codes — is
  complete enough for the Phase 2 norms calculator to run on real data.

---

## 16. Glossary

| Term                        | Meaning                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| **BOM**                     | Bill of Materials — what goes into what, and how much                                              |
| **Days of cover**           | How many days current stock lasts at planned consumption                                           |
| **Frozen zone**             | The window inside lead time where no new order can arrive                                          |
| **Gross requirement**       | Total demand for a material in a bucket, before any supply                                         |
| **Lead-time fence**         | The earliest date a newly placed order can land                                                    |
| **LLC**                     | Low-Level Code — the processing sequence that guarantees demand is fully aggregated before netting |
| **MOQ**                     | Minimum order quantity a vendor will accept                                                        |
| **MPS**                     | Master Production Schedule — independent demand, resolved into a producible plan                   |
| **Net requirement**         | The shortfall after existing stock and committed supply                                            |
| **Norm**                    | A planning parameter: lead time, safety stock, reorder point, lot size, source split               |
| **PAB / Projected balance** | Where inventory is heading, bucket by bucket                                                       |
| **Planned order**           | A system proposal. Nothing has been ordered                                                        |
| **PM**                      | Packaging material                                                                                 |
| **RM**                      | Raw material                                                                                       |
| **Rounding value**          | The multiple every order must be a whole number of — pallet, drum, truck                           |
| **Safety stock**            | Buffer held against demand and supply variability                                                  |
| **Scheduled receipt**       | An open PO expected to arrive                                                                      |
| **Schedule line**           | One delivery within a PO: a quantity on a date                                                     |
| **Source split**            | How a requirement is divided across vendors (the 60:40)                                            |
| **Tier 1 / 2 / 3**          | Confirmed / committed / planned supply confidence                                                  |

---

_Prepared by Heizen for GCPL Supply Chain Planning. All figures are illustrative and constructed to be internally
consistent; they are not GCPL data._
