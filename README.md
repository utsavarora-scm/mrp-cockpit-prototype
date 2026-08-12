# MRP Exception Cockpit

A planner's cockpit that sits **above** SAP S/4HANA, Kinaxis and o9 — finding every planning problem across all three
and ranking them by **what they cost**, not by count.

> This does not replace Kinaxis or SAP. It is the layer that tells a planner which of the 1,500 exceptions across those
> three systems is the one that costs the most this month — and then closes it.

## Running it

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Cold start to demo-ready is a few seconds. There is no database and nothing to seed: the entire dataset is generated
from a fixed seed at first request.

```bash
pnpm test:unit    # 47 tests — the engine's maths, asserted
pnpm calibrate    # prints the dataset's shape; the tuning instrument
pnpm typecheck
pnpm lint
```

## What it currently does

**The engine.** A deterministic time-phased MRP run over ~890 items across five sites and four BOM levels: netting, all
five lot-sizing rules, calendar-aware lead-time offsetting, multi-level explosion with scrap, phantom pass-through,
cycle detection, and a pegging graph that traces any component shortage up to the customer orders behind it. The whole
network re-plans in under 600 ms and produces byte-identical output every run.

**27 exception codes** across four classes — supply continuity, master data integrity, cross-system reconciliation and
feasibility — each carrying a currency figure built from pegged facts, and a narrative composed from evidence rather
than from a template.

**Four screens**, covering demo minutes 0:00–6:30:

|     | Screen                                                                         | Route                      |
| --- | ------------------------------------------------------------------------------ | -------------------------- |
| S1  | Planner Cockpit — KPI strip, Pareto, filterable exception queue                | `/`                        |
| S2  | Item 360 — projected balance, editable time-phased grid, parameter health rail | `/item/[itemId]/[plantId]` |
| S3  | Resolution Workbench — root cause, ranked fixes, simulate, writeback preview   | `/exceptions/[id]`         |
| S4  | Blast Radius — component → finished goods → customer orders                    | `/blast/[exceptionId]`     |

Master Data Health, Reconciliation, Scenario Compare, Integration and the Agent Log are the next pass; their tabs
explain what will be there and what is already computed.

## Layout

```
apps/web                     Next.js App Router — screens, API routes, session
packages/domain              Shared types; every impact coefficient in one openable file
packages/mrp-engine          The engine. Pure, no I/O, no framework, fully tested
packages/adapters            SystemOfRecordAdapter + mock SAP / Kinaxis / o9
packages/data-packs          Seeded dataset generators, selected by NEXT_PUBLIC_DATA_PACK
packages/ui                  The shared shadcn component library
```

`packages/mrp-engine` imports nothing from the app, holds no database client and never reads a clock — `planningDate` is
always injected. That is what makes `packages/mrp-engine/tests/worked-example.test.ts` openable in front of someone who
wants to check the arithmetic.

## Design notes

- **No database.** The dataset is generated from seed `20260811` and is identical on every machine. Reset drops the
  session overlay and keeps the generated base — around 300 ms.
- **No network calls, anywhere.** The adapter layer has no HTTP client in it. Commit produces the payloads that _would_
  be sent, and says so.
- **Nothing is anonymised after the fact.** No company, brand, trading-partner or customer name appears in the data, the
  code or the UI; a test asserts it.
- **Desktop, 1440px and up.** The dense grids and the graph need the width.

Conventions for anything built on top of this live in `.claude/skills/prototype/conventions.md`.
