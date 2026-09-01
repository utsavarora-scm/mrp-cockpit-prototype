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
pnpm test:unit    # 133 tests — the engines' maths and the dataset's calibration, asserted
pnpm typecheck
pnpm lint
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

- **No database.** The dataset is generated from seed `20260831` and the planning date is fixed at Monday 31 August 2026
  (week 36). A demo is rehearsed several times, and a figure that moves between takes is a figure nobody can quote.
- **No network calls, anywhere.** Committing a schedule produces the payload that _would_ be sent, and says so.
- **Nothing is anonymised after the fact.** No company, brand, trading-partner or customer name appears in the data, the
  code or the UI; a test asserts it.
- **Desktop, 1440px and up.** The dense grids need the width.

Conventions for anything built on top of this live in `.claude/skills/prototype/conventions.md`.
