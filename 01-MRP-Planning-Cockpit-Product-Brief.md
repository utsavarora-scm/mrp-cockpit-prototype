# MRP Planning Cockpit — Product Brief

**For:** Heizen internal review, then GCPL Procurement & Supply Planning **Purpose of this document:** explain what we
are building, why, and what the demo will show **Audience:** non-technical. No code, no schemas, no integration detail.
**Author:** Utsav Arora · Version 1.0 · 30 August 2026

> _Working name. "MRP Planning Cockpit" is a placeholder — worth settling before the video, since it appears on every
> screen._

---

## 1. In one paragraph

GCPL's MRP arithmetic works. What doesn't work is everything feeding it: inventory norms set by hand years ago and never
revisited, vendor lead times that live in people's heads, and purchase orders that go out as a single lump quantity with
no delivery schedule. So planners rebuild the answer in Excel, override the system, and the system's output gets
ignored.

The MRP Planning Cockpit computes those inputs instead of displaying them. It reads GCPL's own purchase order and goods
receipt history to work out what lead times and inventory norms actually should be, generates the requirement, and turns
it into a purchase order broken into delivery lines with dates the vendor can actually meet. Every number opens up to
show its working, and every number can be overridden — with the reason captured.

It works the same way across both of GCPL's operating models: **direct manufacture with direct procurement** (soaps,
personal wash) and **contract manufacture with booked capacity** (household insecticides). The mechanics differ — a
purchase order in one case, a capacity call-off in the other — but the underlying failure is identical: a norm that was
set once and never moved.

---

## 2. Why we're doing this now

**What happened.** At the 27 August workshop, we showed the Procurement and Supply Planning team three things: an
inventory decision platform built for a retail client, the current MRP exception cockpit, and a seasonal absent-items
detector from a confectionery engagement. Parts landed. The overall conclusion did not.

**What they asked for instead.** In their words:

> _"Forget that we have an MRP. If you want to take me through what kind of a solution you can have — an end-to-end
> solution where you entirely build the MRP for us with the scheduling piece of it. It can generate all the POs from
> your system, and then it gives me intelligence out of that entire data."_

And they named the starting point:

> _"Let us look first at our base systems… and then ideally doing the PO scheduling piece of it, plus intelligence on
> dynamic norms."_ _"We'll see if we can do a POC on the entire process, or maybe a category. We pick up a category…
> building up the norms, and then the scheduling part of it."_

**What happens next.** We produce a 3–4 minute demo video. If it lands, we get a green light for deep client discovery,
and discovery becomes the paid Phase 1 build on one category.

**So the demo has exactly one job:** convince them we understand their problem well enough to be trusted with a
discovery engagement. It is not a product launch. It does not need to be complete. It needs to be _right about the
things they told us_.

---

## 3. What the client actually said

Four problems, in their language. Everything in this document traces back to one of these.

|        | Problem                                               | Their words                                                                                                                                                                                                                                           |
| ------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1** | **Inventory norms are guesswork and stale**           | _"The stock months maintained in the system and the ones in reality are divergent… they were the same knowledge each category manager has. He gave the number based on vendor lead time and transit time. There's no science to that."_               |
| **P2** | **Transitions have no system**                        | _"When we are doing a packaging change for one FG code — we don't have any system where we know at this point this should go out, at this point this material should come in."_                                                                       |
| **P3** | **Vendor lead times have no science and no feedback** | _"Monitoring after the POs are placed and the GRNs that are happening — whether whatever was aligned is adhering, or there is a deviation. That entire intelligence coming from the PO data is not there right now."_                                 |
| **P4** | **POs have no delivery schedule**                     | _"If I have a purchase order of 1,000 quantity, 500 arriving in five days and another 500 in ten — this visibility the system doesn't have. Nowhere data in the system."_ And: _"First task itself for our environment is: how do you break the PO?"_ |

Two constraints they volunteered:

- **No transport management system, and vendors don't reliably send data.** Anything we build must work with partial
  information and degrade gracefully.
- **Changing a norm is expensive.** It needs approvals, so planners route around the system into Excel. A tool that
  makes norms _better_ but not _cheaper to change_ will be routed around too.

---

## 4. The idea, in plain language

Everything in this product sits on one loop. If something isn't on the loop, we're not building it.

```
    ┌──────────────────────────────────────────────────────────┐
    │                                                          │
    ▼                                                          │
 What do we      →   When should      →   Did it turn     →   How reliable
 need, and when?     it arrive?           up on time?          is this vendor,
                                                               really?
 (requirement)       (PO + delivery       (goods receipt        (lead time and
                      schedule)            vs promise)           its variability)
    ▲                                                          │
    │                                                          │
    └────────  What should the norm be?  ◀──────────────────────┘
                (computed, not guessed)
```

**Read it as a sentence:** you can't compute a sensible inventory norm without knowing how reliable your vendor really
is; you can't know that without comparing what arrived against what was promised; you can't compare against a promise if
the purchase order never had delivery dates in it.

That's why nothing works today. The loop is broken at the purchase order.

The buyer described this chain himself, in two separate sentences:

> _"As of now we don't have in the system a PO date to the lead time specifically mapped in the PO itself. It's more of
> an experience that comes in from people."_ _"Once we have your scheduling done, then you can ideally rely on that data
> to even calculate the supplier reliability factor, which currently is experiential data."_

**PO scheduling is therefore the keystone, not a feature.** It is the link that closes the loop and makes everything
else computable.

---

## 5. How we position this

### What we say

> This is the planning and procurement brain. It computes what your norms should be, works out the requirement, and
> builds the purchase schedule. It reads from whichever system holds your data today, and it isn't structurally tied to
> any of them.

### What we do not say

We do **not** describe this as "an intelligence layer that sits on top of SAP and Kinaxis."

That framing was correct for a different audience six weeks ago. It is wrong for this one. This buyer said _"forget that
we have an MRP — build it for us."_ Positioning as a layer over SAP answers a question he didn't ask, and quietly
commits him to a stack he may be leaving.

We also do not describe this as an SAP replacement. We never raise migration. If they raise it, we're ready.

### On exceptions

The current prototype leads with an exception cockpit. **That was a mistake and it gets removed.** The buyer deferred it
explicitly:

> _"These are post we have our setup being done, then we can ideally go to products which can tell you exceptions and
> insight. We will have to have the base system."_

Exceptions still appear — the cockpit's "needs attention" list is exactly that. But they are the _way into_ the story,
not the story. We never use the word "exception cockpit" again with this client.

---

## 6. The demo — two acts, ~5 minutes

This is the spine. Every screen exists to serve a beat here. Build backwards from this table.

### Why two categories

One material would make a tighter video. Two makes a stronger argument, for three reasons:

1. **It shows the same root cause producing two different failures.** Soaps: the norm is wrong because it ignores how
   much _lead time_ varies. Insecticides: the norm is wrong because it ignores the _calendar_. One diagnosis, two
   symptoms — which is a much harder thing to dismiss as a one-off finding.
2. **It reaches a second stakeholder group.** Household insecticides are contract-manufactured. That's a different set
   of people — 3P operations, capacity sourcing, quality — with a different set of concerns from the direct-procurement
   team that owns soaps. A demo that speaks only to direct procurement gets a narrower sponsor.
3. **It proves the model isn't category-specific.** If the engine only works on imported commodities, it's a point
   solution. Showing it handle booked capacity at a co-packer makes it a platform.

**Time cost:** roughly 90 seconds, taking the video to about 5:20. If you need to hold 4 minutes, Act 2 compresses to a
45-second coda — keep the seasonal norm finding, drop the pre-build deadline. But I'd argue for the full version. The
pre-build deadline is the sharpest single finding in the whole demo.

---

### Act 1 — Soaps: the norm that ignores lead-time variability

**Hero material:** an imported palm derivative. Long lead time, genuinely volatile, a real commodity they buy, procured
directly.

| Time     | What happens on screen                                                                                                                                                                                                                                                    | What the viewer takes away                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **0:00** | Open the cockpit on the soaps category. Coverage against norm. Two numbers side by side: ₹ crores of **excess stock** and ₹ crores of **unprotected exposure** — at the same time                                                                                         | _They have too much and too little simultaneously. Same root cause._          |
| **0:25** | Click the biggest item. Projection chart: stock declining, crossing the norm band, going negative. Two lines drawn — what's **confirmed** and what's only **planned**                                                                                                     | _Someone finally separated what's really coming from what we hope is coming._ |
| **0:55** | This is not a demand spike. The norm says 45 days. Reconstructed from **your own 24 months of POs and GRNs**: 47 days average, swinging ±11 days                                                                                                                          | _They read our data. We didn't give them this number._                        |
| **1:25** | And the stock norm was set as though lead time never moved. Here is the same calculation with lead-time variability in it. The answer is **7.6× larger** — 98% of the buffer you need exists because the **lead time moves**, not because demand moves                    | _This is a supply chain person, not a software vendor._                       |
| **1:50** | Click through to the **14 receipts** behind that number. PO date, GRN date, gap, one row each                                                                                                                                                                             | _Nothing here is assumed. It's traceable._                                    |
| **2:10** | Now the requirement: 2,520 MT. Today this goes out as one purchase order. Here it is as **five delivery lines** — and here is why five, and why 500 each: shipment cap, minimum order quantity, rounding, plant storage, receiving capacity per day, paced to consumption | _This is the thing I asked for. And it can defend its own arithmetic._        |
| **2:45** | **Line 1 is red.** It needed to dispatch seven days before this vendor physically can. Lines 2–5 are fine. As a single lump PO you cannot see that only the first tranche is exposed                                                                                      | _That's why we're always expediting. It's arithmetic, not bad luck._          |

---

### Act 2 — Household insecticides: the norm that ignores the calendar

**Hero material:** a mosquito repellent liquid vaporiser refill, made at a contract manufacturer. Monsoon-seasonal,
capacity-constrained, third-party made.

| Time     | What happens on screen                                                                                                                                                                                                                              | What the viewer takes away                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **3:15** | Switch category. Same cockpit, same screens. But this projection chart looks nothing like the last one — **demand has a shape.** Monsoon peak at roughly four times the off-season run rate                                                         | _Different problem. Same tool._                                  |
| **3:40** | The maintained norm is 30 days, flat, all year round. Overlay it on real demand: that's **50 days of cover in April and 14 days in July.** It was never 30 days — it was 30 days _on average_, and the average describes no actual week of the year | _The second failure mode, same cause: a norm that doesn't move._ |
| **4:05** | And this one isn't made in our plant. It's a contract manufacturer with **4.5 lakh units a week** contracted. Peak demand is 7 lakh. **The season cannot be served from within the season** — 35 lakh units have to exist before it starts          | _They understand how our 3P business actually runs._             |
| **4:30** | Which makes this the number that matters: **the last date you can order active ingredient and packaging for the 2027 pre-build is 12 January.** Nineteen weeks from today. Nothing in the current stack computes that date, and nobody owns it      | _That is a hard deadline we would have missed._                  |

---

### Close

| Time     |                                                                                                                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **5:00** | Every number on both threads opens up — formula, inputs, where each came from. And every number is overrideable: change average daily demand from 60 to 70, watch the requirement move, record the reason |

**Closing line:** _"You told us the MRP maths is fine and the inputs are the problem. Two categories, two completely
different businesses, one cause: the inputs were set once and never moved. This computes them from data you already have
— and keeps them computed."_

### Why this beats the previous demo plan

The earlier iteration document proposed a similar seven-step story, but built around lead-time deviation as an
_exception_ to be viewed and actioned. The difference is what each beat proves:

| Earlier plan                              | This plan                                                        |
| ----------------------------------------- | ---------------------------------------------------------------- |
| "428 materials at risk"                   | ₹ excess and ₹ exposure — the money, and the contradiction       |
| Lead time 21 vs 38 days, source not shown | 47 days reconstructed from 14 named receipts you can click       |
| Inventory norm shown as a given input     | Norm **computed**, with the formula and the 7.6× finding         |
| PO arrives pre-split 500/500, editable    | PO **split by the engine**, with every constraint that shaped it |
| Expedite as a button                      | Why expediting is structurally inevitable at this lead time      |

---

## 7. The screens

Four screens and two panels. That's the entire prototype.

The current build has nine destinations — reconciliation, integration, agent, blast radius, scenarios, master data, and
more. **All of them go.** Nine screens cannot be navigated in four minutes, and their existence is the main reason the
current prototype is incomprehensible.

---

### Screen 1 — Planning Cockpit _(landing)_

**Purpose.** Show the planner the position of the whole category in ten seconds, and what needs their attention today.

**What you see**

- Category selector (Soaps), plant filter
- Six figures across the top: materials under management · coverage against norm · materials below norm · materials in
  excess · **₹ excess capital** · **₹ unprotected exposure**
- One chart: where the coverage gap comes from — needs a PO / PO placed but arriving late / stock sitting at the wrong
  plant
- One table: **what needs attention**, ranked by rupees at stake. Material, plant, what's wrong in plain words, days
  until it bites, ₹ at stake, suggested next step

**What you do.** Click any row to open the material.

**What it proves.** That we can tell them where the money is, not just how many rows are red. The excess-and-exposure
pairing is the hook: both problems, at once, from the same broken norms.

---

### Screen 2 — Material View

**Purpose.** The complete planning picture for one material at one plant. This is where the projection chart lives, and
it's the most valuable single visual in the product.

**What you see**

- Header: material, plant, current status, projected stock-out date
- **The projection chart.** Stock level over time, the norm drawn as a band, receipts as bars, the stock-out region
  shaded. Critically, **two projection lines**: one counting only confirmed supply, one including planned supply. Never
  blended into a single optimistic number
- **The norm band must be able to move.** For a steady material it's a flat line. For a seasonal one it's a curve that
  rises ahead of the monsoon and falls after it. Drawing the flat maintained norm against the seasonal recommended curve
  is the entire Act 2 argument, in one picture
- Below it, the time-phased table: requirement, confirmed receipts, planned receipts, projected balance, days of
  coverage. Switchable between daily, weekly, and GCPL's own 7 / 15 / 30 / 45 / 90 / 180 day buckets
- Right side: the norms for this material (maintained vs recommended, with the gap), the vendors and how volume splits
  between them, current stock broken into unrestricted, blocked, quality-inspection and in-transit

**What you do.** Change any input cell and watch the projection recalculate. Jump to the norm detail or the purchase
schedule.

**What it proves.** Three of their questions answered on one screen: can we see projected inventory, how do planned and
confirmed receipts differ, and why is this material at risk.

> **On planned vs scheduled receipts.** The workshop showed genuine confusion about the difference, and the UI must
> resolve it rather than inherit it. **Confirmed** = the vendor has acknowledged it, or it's already in transit.
> **Planned** = our own forward projection, not yet acknowledged. The buyer was clear about why this matters: _"They
> should not be assumptions which are giving you a rosy picture, and then later you realise this is not actually going
> to happen."_

---

### Screen 3 — Supply Schedule

**Purpose.** Answer the single most-repeated question in the workshop: _how do you break the PO?_

**What you see**

- The requirement that triggered this order
- The purchase order: material, vendor, total quantity, release date
- **The delivery lines** — as a table and as a timeline. Each line: number, quantity, required-by date, dispatch-by
  date, vendor confirmed yes/no, status, confidence
- **A "why this split" panel** listing every constraint that shaped it, each with its value and whether it was binding:
  minimum order quantity, rounding increment, maximum shipment size, plant storage capacity, daily receiving capacity,
  shelf life, consumption pace, vendor and plant working calendars
- Infeasible lines shown in red with the shortfall in days

**Two variants, one screen.** For directly procured material the object is a purchase order with delivery lines. For
contract-manufactured material it's a **capacity call-off** against a booked weekly quantity — the same table, with
contracted capacity as the binding constraint instead of shipment size, and the co-packer's other committed volume shown
alongside.

**For seasonal materials, one addition: the pre-build strip.** A short timeline above the lines showing when the season
starts, what the contract manufacturer can produce inside it, the shortfall that must therefore be built ahead, when
that build has to begin, and — working backwards through the input material lead times — **the last date an order can be
placed to support it.** That date is the sharpest output in the product. It's the one idea worth carrying over from the
seasonal work we showed them in the workshop, and it was the part they said was genuinely useful.

**What you do.** Drag a line to a different date, change a quantity — everything downstream recalculates and any newly
broken constraint lights up. Override any line with a reason.

**What it proves.** This is the keystone. The earlier iteration showed a PO already split 500/500 and let the planner
edit it. This buyer will ask _"why two of 500 and not three of 333?"_ — he interrogated the last demo to destruction on
exactly that class of question. This screen answers it before he asks.

---

### Screen 4 — Norm Review

**Purpose.** Their first named pain. Show what every norm is, what it should be, why, and make changing it cheap.

**What you see**

- A table of every material at every plant: maintained order days, recommended order days, maintained stock days,
  recommended stock days, the gap, ₹ impact, how confident we are, when it was last changed and by whom. Sorted by
  rupees
- Open a row and you get the reasoning: a histogram of actual lead times with the maintained norm drawn across it as a
  line, demand variability, the production campaign cycle, and the calculation written out with the real numbers
  substituted in
- Underneath, the individual goods receipts that produced the recommendation — every one clickable

**What you do.** Select many rows and propose them as a batch. Review, approve or amend, and write back in one action.

**What it proves.** Two things. First, that we compute the norm rather than display it — the gap the earlier iteration
missed entirely. Second, that we understood _why_ norms rot: not because nobody knows they're wrong, but because
changing one costs more than living with it. Batch approval is the answer to that, and it's a Phase 1 requirement, not a
nicety.

---

### Panel A — "Explain this"

Available on **every computed number, everywhere.**

Shows the formula in readable form, each input with its value, where each input came from, and when it was last updated.
Two clicks maximum from any number to its complete derivation.

This is the single most successful thing in the workshop demo — the drill-down on _"why 820 units?"_. It is the reason
planners will trust the output instead of rebuilding it in Excel. Treat it as a requirement on every screen, not a
feature on one.

---

### Panel B — Override

Available on every computed number too.

Shows the system's value, an input for the planner's value, a required reason, and the recalculated result before they
commit.

Overrides are recorded — who, what, when, why, before and after. This matters more than it looks: the Excel behaviour
they described is invisible today, and capturing it creates the dataset that tells us which norms are systematically
wrong. A material overridden nine times out of ten has a broken norm, and that's a finding, not a complaint about the
planner.

---

## 8. What the product does — capabilities in plain language

Grouped by the loop from Section 4.

**Working out what's needed** Takes the demand plan, current stock, and supply already on order, and calculates the
requirement over time — including exploding finished-goods demand down through the bill of materials to raw and
packaging materials. Displays it in daily, weekly or GCPL's standard buckets.

**Working out what the norm should be** _(P1)_ Reconstructs actual vendor lead times from historical purchase orders and
goods receipts. Measures how much they vary, not just their average. Computes recommended order days and stock days from
demand variability, lead-time variability, production campaign cycle, minimum order quantities and shelf life — then
compares against what's maintained and prices the gap in rupees. Weights recent performance more heavily than old, with
the weighting visible and adjustable rather than hidden.

**Making the norm move with the season** For materials with a demand shape — monsoon insecticides being the obvious case
— produces a norm that varies by week rather than a single annual figure, sized against the demand each period will
actually see. A flat norm on a seasonal product is wrong twice a year in opposite directions, and this is what fixes it.

**Turning a requirement into a purchase schedule** _(P4)_ Decides the order quantity, then splits it into delivery lines
paced to consumption, respecting minimum order quantity, rounding, maximum shipment size, plant storage, daily receiving
capacity, shelf life and working calendars. Calculates the dispatch date each line needs. Flags any line that can't
physically be met, with the shortfall in days.

**Planning the pre-season build for contract-manufactured products** Compares peak-season requirement against contracted
capacity at the co-packer, works out how much must exist before the season opens, when that build has to start, and —
chaining back through input material lead times — the last date an order can be placed to support it. Applies to any
capacity-constrained seasonal product, not only insecticides.

**Tracking whether vendors delivered** _(P3)_ Matches goods receipts back to the delivery line they were meant to
satisfy. Measures date and quantity variance. Builds a lead-time profile per vendor and per vendor-material combination
— because a vendor reliable on one material is frequently unreliable on another. Feeds all of it back into the norms.

**Trust and control** _(cross-cutting)_ Explains every number. Lets any number be overridden with a reason. Records
every override. Routes norm changes through a batch approval flow so that fixing fifty norms is one review, not fifty.

---

## 9. The three things that make this different

Worth being able to say in one breath.

**1. It computes the norm rather than showing it.** Every planning tool displays safety stock. This one works out what
safety stock _should be_ — and finds that GCPL's norms are static in a business that isn't: set as though lead time
never varies, which breaks on imported commodities, and as though demand is flat, which breaks on anything seasonal. One
cause, two failures, both quantified. See Appendix A.

**2. It generates the purchase schedule rather than displaying one.** Not "here's a PO already split into two, feel free
to edit." Here's the split, here are the seven constraints that produced it, here's the one line that physically cannot
be met. For contract-manufactured product it does the same against booked capacity, and tells you the last date you can
order for the pre-season build.

**3. It runs on their own history, so nothing is assumed.** Every lead time traces to named goods receipts. The last
demo died on _"where does this input come from? Somebody has to punch in."_ Nothing in this one requires an answer we
can't give.

---

## 10. What we are deliberately not building

For the prototype:

- Any real integration, real purchase order creation, or writing to any live system
- Authentication, user management, permissions
- Transport management or in-transit tracking integration — they have no TMS and told us vendor data is unreliable
- Finite capacity scheduling or line-level optimisation. Act 2 compares peak requirement against contracted capacity and
  works out the pre-build — that's arithmetic, not a scheduling engine, and we should be clear about the difference if
  asked
- Demand forecasting — we consume the plan, we don't generate it
- Machine learning models. The norms work is statistics, and the buyer called it correctly: _"mostly it is data science,
  that is more the flavour than product building."_ Statistics we do; ML we don't need and can't justify yet
- Mobile layouts

Deferred to later phases, but named so they can see we heard them:

- **Transitions / packaging changeovers (P2).** A real pain, not in the demo. Phase 2
- **The exception cockpit.** Phase 3, at their explicit instruction
- Vendor confirmation capture by email, automated write-back, autonomous low-risk actions

---

## 11. What happens after the demo

**Discovery (2–3 weeks).** Map the process for one category end to end. Extract 18–24 months of purchase order and goods
receipt history and test whether lead times actually reconstruct from it. Inventory the norms — how many, who owns them,
when each was last changed. Confirm how "stock months" and "order months" are defined and where they live. Establish who
approves a norm change today and how long it takes.

**The load-bearing question:** is their PO/GRN history clean enough to reconstruct lead times? If it isn't, the norms
thesis needs rework — and we need to know that in week two, not month four.

**Phase 1 build.** One category, end to end: requirement calculation, computed norms, purchase scheduling, and the
delivery-versus-promise feedback loop. The business case stands on working capital released by corrected norms alone.

**On which category.** The buyer said _"we pick up a category"_ — singular, and we should hold them to that. Showing two
in the demo is deliberate: it lets them choose which, and tells us something either way. Soaps means they're
prioritising working capital and direct procurement. Insecticides means the contract-manufacturing and seasonal-capacity
problem is the live pain, and brings a different sponsor to the table. Both are good outcomes. Building both at once is
not.

---

## Appendix A — The two numbers that carry the demo

### A.1 — Soaps: the norm that ignores lead-time variability

The hero material: an imported palm derivative at one plant. From their own history — average consumption 42 MT/day,
varying by 9 MT/day. Lead time reconstructed from 14 receipts over 18 months: **47 days on average, varying by 11
days.** Maintained norm: 45 days, last changed March 2024.

**How the norm was almost certainly set** — treating lead time as fixed:

> buffer = 1.96 × 9 MT × √47 days = **121 MT**, about **2.9 days** of cover

**What it should be** — accounting for the fact that lead time varies too:

> buffer = 1.96 × √( 47 × 9² + 42² × 11² ) = **914 MT**, about **21.8 days** of cover

**The two answers differ by 7.6×.** And of the total under that square root, the lead-time term contributes 213,444 out
of 217,251 — **98% of the buffer they need exists because the lead time moves, not because demand moves.**

At roughly ₹95,000 per MT, that's **₹8.7 crore** of safety stock for one material — against a maintained norm that
provides a small fraction of it.

This is Act 1's centrepiece. Their problem here was never demand volatility. It's that they're buying an imported
commodity on a lead time that swings by eleven days, while holding a buffer sized as though it never moved. It's their
arithmetic, on their data, and it explains the firefighting they already know they're doing.

---

### A.2 — Household insecticides: the norm that ignores the calendar

The hero material: a mosquito repellent liquid vaporiser refill, contract-manufactured.

**Demand has a shape.** Peak season runs 14 weeks, the second week of June through mid-September, averaging **7.0 lakh
units a week**. The remaining 38 weeks average **2.0 lakh**. Annual average: 3.35 lakh a week.

**The flat norm, in practice.** A maintained norm of 30 days, sized off the annual average, holds about **14.3 lakh
units**. What that actually buys you:

|       | Weekly demand | Cover the norm provides |
| ----- | ------------- | ----------------------- |
| April | 2.0 lakh      | 7.2 weeks = **50 days** |
| July  | 7.0 lakh      | 2.0 weeks = **14 days** |

> **It was never a 30-day norm. It was 30 days on average — and the average describes no actual week of the year.** In
> April it ties up capital in stock nobody needs for months. In July it leaves the peak barely a fortnight of cover.

**The capacity arithmetic.** Contracted capacity at the co-packer is **4.5 lakh units a week**.

```
Season requirement          14 weeks × 7.0 lakh   =  98 lakh units
Producible during season    14 weeks × 4.5 lakh   =  63 lakh units
─────────────────────────────────────────────────────────────────
Must exist before it starts                          35 lakh units
```

**Therefore the pre-build.** Off-season surplus capacity is 4.5 − 2.0 = **2.5 lakh a week**, so building 35 lakh units
takes **14 weeks**. Season opens 8 June, so production must start **2 March**. Active ingredient and packaging run about
**7 weeks** ahead of that.

> **Last order date for the 2027 pre-build: 12 January. Nineteen weeks from today.**

That single date is the sharpest output in the entire demo. It isn't in SAP, it isn't in a planner's spreadsheet, and no
one currently owns it — but miss it and the monsoon is lost before it starts. It's also the one idea worth carrying
forward from the seasonal work we showed in the workshop, where the client's own verdict was that the approach was
_"definitely helpful"_ for commodity inputs whose specification doesn't change.

**Why both acts matter together:** Act 1's norm is wrong because lead time moves. Act 2's is wrong because demand moves.
Same disease — a number set once and never revisited — presenting in two businesses that share almost nothing else.

---

## Appendix B — Every screen traces to something they said

| Screen or panel                      | Answers                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| Planning Cockpit                     | _"What should I focus on?"_ — and prices it                                    |
| Material View — projection chart     | _"Can we see projected inventory?"_                                            |
| Material View — two projection lines | _"How do planned and scheduled receipts differ?"_                              |
| Material View — bucket toggle        | Their existing 7/15/30/45/90/180 day working buckets                           |
| Supply Schedule                      | **P4** — _"First task itself: how do you break the PO?"_                       |
| Supply Schedule — constraints panel  | _"Why this quantity, on this date?"_                                           |
| Supply Schedule — call-off variant   | The contract-manufacturing model, and its separate stakeholder group           |
| Supply Schedule — pre-build strip    | Seasonal capacity that can't be served from within the season                  |
| Material View — moving norm band     | A flat norm on a monsoon product is wrong twice a year, in opposite directions |
| Norm Review                          | **P1** — _"There's no science to that"_                                        |
| Norm Review — receipts underneath    | **P3** — _"That intelligence coming from the PO data is not there"_            |
| Norm Review — batch approval         | _Norm changes are too expensive to make, so we don't_                          |
| Explain this                         | _"Why is the system asking me to order this quantity?"_                        |
| Override                             | _Decision support, not a black box_                                            |
| — _(deferred)_                       | **P2** transitions — named in Section 10, Phase 2                              |
