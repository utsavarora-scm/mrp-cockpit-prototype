# Planning & Supply Schedule

The layer that turns an MRP result into an **executable purchase-order and delivery schedule** — one that stays current
between runs, says exactly what should arrive where and when, distinguishes supply that is genuinely committed from
supply that is merely assumed, and then measures what actually happened.

> This is not a better netting calculation, and it is not an exception cockpit sitting over one. The calculation already
> works. What is missing is the layer that turns its output into something a planner can send to a vendor, and the
> record of what came back.

Built from `GCPL-MRP-PO-Scheduling-PRD-v3.md`, which is in this repository.

## Running it

```bash
pnpm install
pnpm dev          # http://localhost:3003
```

There is no database and nothing to seed: the entire dataset is generated from a fixed seed on first request, so it is
identical on every machine and every run. Reset drops the session's overrides and keeps the generated base.

```bash
pnpm test:unit    # 220 tests — the engines' maths, the dataset's calibration, and the two
                  # worked examples asserted through the app's own projection modules
pnpm typecheck
pnpm lint:check   # `pnpm lint` runs eslint --fix and rewrites files; this one only reports
pnpm build
```

## The journey it is built around

```
See the position  →  Find the risk  →  Understand the calculation
      →  See the supply timeline  →  Build the PO schedule
      →  Decide and act  →  Record what was decided
```

| Screen                             | Route                      | What its reader concludes                                                                                                         |
| ---------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Planning position                  | `/`                        | What needs me today — six tiles that filter, a drift panel saying what moved since the last run, a table sorted by time to breach |
| Material workbench                 | `/material/[item]/[plant]` | Where inventory is heading, why, and whether the order the system is asking for can still be placed                               |
| Explain                            | drawer, from any number    | One sentence, then the arithmetic, then the checks a planner would do next                                                        |
| Supply timeline & schedule builder | `/schedule/[item]/[plant]` | The ideal schedule, the committable one, and every unit of difference attributed to a named constraint                            |
| Adherence                          | `/adherence`               | What actually happened, split across the four intervals a lead time is made of                                                    |
| Exception queue                    | `/exceptions`              | Grouped by what you would do about them, ranked by consequence                                                                    |
| Simulate & override                | dialog, from the workbench | One parameter changed, both sides genuine planning runs, a reason mandatory                                                       |
| PO control tower                   | `/control-tower`           | How the whole book is behaving — including the share of it nobody has acknowledged                                                |

## The decisions worth knowing about

**A purchase order is netted against its delivery lines, not one date on its header.** 2,300 MT arriving as 1,150 in
week 38 and 1,150 in week 41 covers a completely different set of weeks from 2,300 arriving in week 41.

**Three balances, not one.** Before planned orders (the honest position on what exists), on acknowledged supply only
(what survives if nothing unconfirmed turns up), and after every order that can still be placed. Showing only the last —
which most planning tools do — hides the problem behind its own proposed solution.

**Supply carries a confidence tier and the tier is always visible.** A breach avoided only by a receipt nobody can still
order is raised as a breach. One avoided only by a line nobody has acknowledged is raised as _supply unconfirmed_,
naming the line, the vendor and the quantity.

**Material in quality inspection is on site and is not stock.** It enters the balance on the day it is expected to
clear, drawn as its own dated line.

**Yield and scrap are separate.** A process property that divides and a material property that multiplies. A planner
disputing a requirement has to be able to see which of the two they are arguing with.

**A bought lead time is calendar days; a made one is working days.** A vessel sails through the weekend and a customs
queue does not observe one. Walking working days for a 90-day import overstates it by more than two weeks and moves the
lead-time fence past the point where it means anything.

**No unattributed deltas.** If the schedule builder cannot name the constraint that moved a unit, it does not move it.
And a line that cannot be met is emitted, flagged, with the gap in days — never quietly pushed out to the first date
that works.

**No language model anywhere.** Every sentence on every screen is a template filled from the calculation, so the same
numbers always produce the same words. A generated narrative that cannot be reproduced is the opposite of a trust layer.

## Layout

```
apps/web                     Next.js App Router — screens, API routes, session
apps/web/lib/server          One projection module per screen, over a shared run context
packages/domain              Shared types; dates, formatting, supply tiers, reason codes
packages/planning-engine     The engines. Pure, no I/O, no framework, fully tested
packages/data-packs          The seeded dataset and its calibration
packages/ui                  The shared shadcn component library
```

`packages/planning-engine` imports nothing from the app, holds no database client and never reads a clock —
`planningDate` is always injected. That is what makes its worked examples openable in front of someone who wants to
check the arithmetic.

## Design notes

- **No database, and exactly one file.** The dataset is generated from seed `20260831` and the planning date is fixed at
  Monday 31 August 2026 (week 36) — a demo is rehearsed several times, and a figure that moves between takes is a figure
  nobody can quote. Planner _decisions_ are the one thing that cannot be regenerated: they are the dataset GCPL does not
  have today, and §6.5 asks for them to be recorded permanently. So they are appended to
  `apps/web/.data/decisions.jsonl` and replayed on boot — append-only, so the history stays whole and the state is the
  fold of it. Demo reset is the only operation that removes them. That is durable for the local, single-process
  deployment this targets; on ephemeral or serverless hosting the filesystem does not survive the instance, and it would
  need a real store.
- **No network calls, anywhere.** Committing a schedule produces the payload that _would_ be sent, and says so.
- **Nothing is anonymised after the fact.** No company, brand, trading-partner or customer name appears in the data, the
  code or the UI; a test asserts it.
- **Desktop, 1440px and up.** The dense grids need the width.

Conventions for anything built on top of this live in `.claude/skills/prototype/conventions.md`.

## Where this departs from the requirements document

Each of these is a deliberate decision with a reason, not a gap. Named here so nobody has to discover them by comparing
a screen against a table.

**Tier 2, not Tier 3, raises "unconfirmed supply".** The PRD contradicts itself: its exception table (§5 step 11) says a
breach avoided only by a _Tier-3_ receipt is unconfirmed supply, while §6.4 — the section that defines the tiers — says
a Tier-3-avoided breach _is still a breach_ and is raised as one, and that a **Tier-2**-avoided breach is raised as
supply unconfirmed. §6.4 wins.

**The pinned chain has no production offset and no buffer.** The four made stages between the soap and the imported oil
are lot-for-lot, hold nothing and take zero days. Every intermediate day of production time shifts the requirement
across a bucket boundary, and §15's correctness criterion is that a projected balance reconciles _exactly_ to a
hand-worked netting on the same inputs. None of those offsets is drawn on any screen; the ninety days that are belong to
the oil itself and are untouched.

**The bottle's own bill-of-material line carries no scrap.** A 1.2% uplift put the bottle's requirement a fraction of a
pallet away from the campaign it is quoted against, and the schedule builder then rounded a whole 10,000-unit pallet off
the warehouse headroom to stay under the ceiling — a ten-thousand-unit answer moving on a five-unit input. Its siblings
still carry theirs, so scrap stays visible where it costs nothing to read.

**RM-30114's weekly requirement lands within a few tonnes of the printed table, not exactly on it.** It is what every
soap bar pulls through a shared noodle, and the other bars are seeded rather than pinned, so the pinned ramp carries the
residual. PM-88431's figures are exact, cell for cell. What is exact everywhere is that the rows foot against each
other, which is the criterion §15 actually states.

**An override applies when its window contains the planning date.** A run is a snapshot of one day and a master-data
parameter is one value for the whole of it, so an override dated to start next month is recorded, shown as pending, and
does not touch this run.

## Proposed deferrals, pending sign-off

These are Phase 1 requirements this prototype does not attempt. They are **proposals, not settled decisions** — each is
recorded with its reference and what deferring it costs the demo, so the call gets made deliberately rather than
discovered.

| Requirement                                                                   | PRD       | Demo impact if deferred                                      |
| ----------------------------------------------------------------------------- | --------- | ------------------------------------------------------------ |
| Strategic monthly buckets, months 7–18                                        | §5 step 2 | None — the PRD itself calls this "not a netting horizon"     |
| Per-material-type horizons (RM 26w / PM 16w) and the horizon-too-short flag   | §5 step 2 | Low — one flag missing from the planning position            |
| Exact version capture for stock, MPS, BOM and norms, comparable runs retained | §5 step 1 | **Medium** — weakens the run header's provenance claim       |
| Placeholder materials borrowing a predecessor's BOM                           | §5 step 5 | None in the pilot category                                   |
| Production-version selection                                                  | §5 step 5 | None — one production version in the pack                    |
| Subcontracting need-by dates and job-work challan validity                    | §6.2      | None — no job work in the pilot                              |
| Artwork and version cut-over                                                  | §6.2, §14 | None — §14 defers the transitions module this belongs to     |
| Control-tower drill-down by category, buyer and true issue raiser             | §7.8      | **Medium** — screen 8 answers less of the sponsor's question |
| Explain from the adherence and control-tower screens                          | §7.5      | Low — those are measured history, not a netting calculation  |

Anything the client wants back moves into a follow-up workstream rather than being quietly absorbed.
