# MRP Command Centre — Client Feedback & Prototype Solution

## 1. Objective

Based on the client discussion, the MRP prototype should focus less on rebuilding the core MRP calculation and more on
making the MRP **visible, explainable, actionable, and connected to actual supply execution**.

The client already indicated that the basic MRP/netting calculation is not the primary problem. The larger gaps are
around planning inputs, PO scheduling, inbound visibility, exceptions, and understanding why the system is recommending
something.

> **Prototype principle:** Do not try to build a complete MRP system. Demonstrate a simple planning cockpit that helps a
> planner understand the current position, identify the problem, understand the calculation, and take action.

Source: client discussion on Aug 27.

---

# 2. What the Client Wants to See

From the discussion, the strongest requirements are:

### A. Planning position at a glance

The planner should immediately understand:

- Current inventory
- Demand / gross requirement
- Open PO quantity
- Scheduled / planned receipts
- Projected inventory
- Safety stock / inventory norm
- Shortfall or excess

### B. PO scheduling

A PO should not only show a total quantity.

For example:

**PO = 1,000 units**

The planner should be able to see:

| Delivery   | Quantity | Expected Date | Status    |
| ---------- | -------: | ------------- | --------- |
| Delivery 1 |      500 | 05 Sep        | Confirmed |
| Delivery 2 |      500 | 10 Sep        | Pending   |

This directly addresses the client's question around how a PO is divided into the required delivery buckets.

### C. Inbound visibility

The planner should be able to distinguish:

**PO created → Supplier committed → In transit → Expected → GRN**

This should make it clear whether supply is actually expected to arrive when the MRP assumes it will.

### D. MRP calculation explainability

When the system recommends an order quantity, the planner should be able to click into it and see:

- Demand
- Safety stock
- Inventory norm
- Current stock
- Open PO
- In-transit stock
- Effective stock
- Net requirement
- Recommended order quantity

The goal is a **trust layer around MRP**.

### E. Exceptions

The cockpit should surface the exceptions that need attention instead of making the planner search through every MRP
line.

Example exception types:

- Lead-time deviation
- Projected stock-out
- Safety-stock misalignment
- Excess inventory
- PO delivery delay
- Missing / incomplete planning data

### F. Actual vs. maintained planning assumptions

The system should compare planning assumptions with execution data.

Example:

**Maintained lead time:** 21 days  
**Actual average lead time:** 38 days  
**Deviation:** +17 days

The prototype should show this as an exception and explain its potential impact.

### G. Planner action

The planner should be able to take a simple action from the cockpit:

- Expedite
- Reschedule
- Raise PO
- Transfer inventory
- Override planning parameter
- Accept / dismiss exception

For the prototype, these actions can remain simulated.

---

# 3. Recommended Simple Prototype Solution

## The core experience

Build the prototype around one simple workflow:

```text
MRP Overview
     ↓
Identify Risk
     ↓
Open Material / PO
     ↓
Understand Supply Timeline
     ↓
Explain MRP Calculation
     ↓
Identify Exception
     ↓
Take / Simulate Action
```

This gives the client an end-to-end story without requiring a complete MRP engine.

---

# 4. Screen 1 — MRP Command Centre

## Purpose

Give the planner an immediate view of the health of the MRP plan.

### Top KPI cards

Show 5–6 cards:

```text
MRP Materials          12,450
At Risk                 428
Projected Stock-outs     86
Excess Materials        214
Open POs              1,284
Delayed Inbound          72
```

The numbers can be prototype/illustrative data.

### Planning health section

Show:

- Inventory coverage
- Demand coverage
- Supply coverage
- Safety-stock coverage
- Projected stock-out count

### Main table

Use a material-level exception-oriented table:

| Material | Plant   | Demand | Stock | Open PO | Expected Inbound | Projected Balance | Status  |
| -------- | ------- | -----: | ----: | ------: | ---------------: | ----------------: | ------- |
| RM-1001  | Plant A |  1,200 |   300 |     800 |              500 |              -100 | At Risk |
| RM-1002  | Plant A |    800 |   900 |       0 |                0 |               100 | Healthy |
| RM-1003  | Plant B |  2,000 |   500 |   1,500 |            1,000 |              -500 | At Risk |

Make **At Risk** rows clickable.

---

# 5. Screen 2 — Material Planning Detail

When the planner clicks a material, show the complete planning picture.

## Header

```text
RM-1001
Raw Material — Example Material
Plant A

Status: At Risk
Projected Stock-out: 08 Sep
```

## Inventory projection chart

Show inventory position over time:

```text
Inventory
  |
  |       /\          PO Receipt
  |      /  \_________
  |----- Safety Stock ----------------
  |    /
  |___/_______________________________ Time
       Today       08 Sep       15 Sep
```

The chart should show:

- Current stock
- Demand consumption
- Scheduled receipts
- Planned receipts
- Safety stock
- Projected stock-out

This is probably the **single most useful visual** to add to the prototype.

---

# 6. Screen 3 — PO Schedule

Within the material detail, add a dedicated **Supply / PO Schedule** section.

Example:

### PO #4500123

**Total PO:** 1,000 units

| Delivery | Qty | Planned Date | Supplier Confirmed | In Transit | Actual/Expected |
| -------- | --: | ------------ | ------------------ | ---------- | --------------- |
| 1        | 500 | 05 Sep       | Yes                | Yes        | 05 Sep          |
| 2        | 500 | 10 Sep       | No                 | No         | 10 Sep          |

Add a simple action:

**Edit Schedule**

The prototype can allow the planner to change:

- Delivery quantity
- Delivery date
- Supplier confirmation

No actual integration is required for the prototype.

---

# 7. Screen 4 — MRP Calculation / Trust Layer

Add a button:

> **Why this recommendation?**

Clicking it opens a side panel or modal.

### Example

**Recommended Order: 820 units**

Calculation:

```text
Order-up-to Level                  1,500
- Effective Stock                    680
-----------------------------------------
Net Requirement                      820
```

Then expand the effective stock:

```text
On-hand Stock                        300
+ Confirmed Inbound                   500
- Existing Commitments                120
-----------------------------------------
Effective Stock                       680
```

And show the source assumptions:

```text
Average Daily Demand                   60
Safety Stock                           300
Inventory Norm                       1,500
Lead Time                           21 days
```

This directly answers the client's concern:

> "Why is the system asking me to order this quantity?"

---

# 8. Screen 5 — Exception Detail

Add an **Exceptions** tab or panel.

### Example exception

## Lead Time Deviation

```text
Maintained Lead Time       21 days
Actual Average Lead Time   38 days
Deviation                  +17 days
```

### Impact

```text
Current MRP assumption:
Material expected on 05 Sep

Based on actual supplier performance:
Expected around 22 Sep

Potential impact:
Projected stock-out of 1,200 units
```

### Recommended actions

```text
[ Expedite PO ]

[ Update Lead Time ]

[ Simulate Impact ]
```

For the prototype, clicking an action can simply update the UI and show the resulting impact.

---

# 9. Screen 6 — Planner Override

For a recommendation or planning parameter, provide an override mechanism.

Example:

```text
System Value
Average Daily Demand: 60

Planner Override
[ 70 ]

Reason
[ Expected demand increase ]

--------------------------------

Original Requirement       820
Recalculated Requirement   960

[ Apply Override ]
[ Cancel ]
```

This demonstrates that the system is **decision support**, not a black-box system forcing a planner to accept its
recommendation.

---

# 10. What Should NOT Be Built in the Prototype

Keep the prototype intentionally narrow.

Do **not** try to build:

- A complete SAP replacement
- A complete manufacturing MRP engine
- Full supplier integration
- Real PO creation
- Real GRN integration
- Full TMS integration
- Complete capacity planning
- Production scheduling engine
- Complex ML models
- Full master-data management

These can be shown as future capabilities.

For the prototype, simulate the underlying data and focus on the **planner experience**.

---

# 11. Recommended Prototype Navigation

Keep the navigation extremely simple:

```text
MRP Command Centre
│
├── Overview
│
├── Materials
│   └── Material Detail
│       ├── Inventory Projection
│       ├── PO Schedule
│       ├── MRP Calculation
│       └── Exceptions
│
├── Exceptions
│   ├── Stock-out
│   ├── Lead Time
│   ├── Safety Stock
│   └── Inbound
│
└── Scenarios
```

For the current prototype, **Overview → Material Detail → Exception → Action** is enough.

---

# 12. The Main Demo Scenario

Use one material as the hero scenario.

### Step 1 — Planner opens MRP Command Centre

System says:

> **428 materials are at risk.**

### Step 2 — Planner opens one material

System shows:

> Projected stock-out on 08 Sep.

### Step 3 — Planner looks at supply

They see:

> PO for 1,000 units  
> 500 expected on 05 Sep  
> 500 expected on 10 Sep

### Step 4 — System highlights a problem

Supplier's actual lead time is 38 days versus 21 days maintained.

### Step 5 — Planner asks "Why?"

System explains the MRP calculation.

### Step 6 — Planner simulates the change

Changing lead time from 21 → 38 days shows:

> Projected stock-out increases from 0 → 1,200 units.

### Step 7 — Planner takes action

Options:

> Expedite PO  
> Reschedule delivery  
> Increase safety stock  
> Update lead time

This creates a very strong 3–4 minute prototype story.

---

# 13. Client Feedback → Prototype Mapping

| Client Feedback / Question                   | Prototype Response                                               |
| -------------------------------------------- | ---------------------------------------------------------------- |
| How is MRP calculated?                       | **Why this recommendation?** calculation panel                   |
| How is PO scheduling done?                   | **PO Schedule** with delivery buckets                            |
| How do we know what is actually coming?      | **Inbound timeline**                                             |
| How do planned vs scheduled receipts differ? | Separate **Planned / Confirmed / In Transit** statuses           |
| Can we see projected inventory?              | **Inventory projection chart**                                   |
| Can historical data improve assumptions?     | **Actual vs maintained lead-time view**                          |
| What exceptions should I focus on?           | **Prioritized Exceptions tab**                                   |
| Why is this material at risk?                | **Exception detail + root cause**                                |
| Can I override the system?                   | **Planner Override**                                             |
| What happens if assumptions change?          | **Impact simulation**                                            |
| Can we eventually generate the PO schedule?  | **Edit Schedule / recommended schedule**                         |
| Can the system use existing systems/data?    | Position prototype as an **intelligence layer**, not replacement |

---

# 14. What I Would Prioritize for the Next Prototype Iteration

If development time is limited, build these in this exact order:

### P0 — Must Have

1. **MRP Command Centre overview**
2. **Material-level planning detail**
3. **Inventory projection over time**
4. **PO delivery schedule**
5. **MRP calculation explainability**
6. **Exception identification**

### P1 — Strongly Recommended

7. **Actual vs maintained lead time**
8. **Planner override**
9. **Simulate impact**
10. **Basic recommended actions**

### P2 — Future

11. Automated PO generation
12. Supplier confirmation integration
13. TMS integration
14. GRN feedback loop
15. AI-driven parameter optimization
16. Autonomous low-risk MRP actions

---

# 15. Final Product Positioning

The simplest way to position the prototype is:

> **MRP Command Centre is a planning intelligence layer that sits on top of the existing MRP ecosystem. It gives
> planners a single view of demand, inventory and supply, explains MRP recommendations, identifies where planning
> assumptions differ from actual execution, and helps planners decide and act on the most important exceptions.**

The core product loop is:

```text
              EXISTING SYSTEMS
        SAP / Kinaxis / TMS / ERP
                    │
                    ▼
             ┌───────────────┐
             │ MRP Command   │
             │    Centre     │
             └───────┬───────┘
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
      Visibility  Explain    Exceptions
          │          │          │
          └──────────┼──────────┘
                     ▼
               Simulation
                     │
                     ▼
                Planner
                 Action
                     │
                     ▼
              Actual Execution
                     │
                     └──────► Feedback
```

### The key prototype message

**Don't make the prototype look like another MRP transaction screen.**

Make it look like a **planner's decision cockpit**:

> **"Tell me what is wrong → tell me why → show me the impact → tell me what I can do."**

That is the clearest interpretation of what the client was asking for in the meeting.
