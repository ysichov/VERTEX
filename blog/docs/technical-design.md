# Technical design

## Current executable slice

```text
PricingFacade
  ├─ DataProvider (legacy state boundary)
  ├─ PricingFactory → RoadPricing strategy
  └─ ConfigGenerator → dynamic modifier pipeline
       ├─ Fuel
       ├─ Customs
       ├─ Hazard
       ├─ Discount
       └─ Tax
```

`ZCL_CALC_LOG` records the amount after every business operation, giving VERTEX an explicit flow to visualize.

## DDIC Customizing layer

| Table | Purpose | Debug failure mode |
| --- | --- | --- |
| `ZLOG_BASE_TARIFF` | Rate and validity interval | overlapping records |
| `ZLOG_SHIPMENT` | Scenario shipment input and pricing date | missing scenario input |
| `ZLOG_GEO_MATRIX` | route customs rate and fallback | missing wildcard fallback |
| `ZLOG_PIPELINE` | modifier class order | tax before discount |
| `ZLOG_FUEL_RATE` | fuel index by date | wrong rate or date |
| `ZLOG_RULE` | priority business actions | erroneous priority |

## Scenario preparation and pricing order

`ZVERTEX_DEMO_SETUP` and `ZVERTEX_DEBUG_LAB` expose `CLEAN`, `PRECISION`, `STATE`, `PIPELINE` and `MULTI` with English selection texts. Prepare the selected scenario before executing it. `ZCL_CALC_CONFIG_REPO` reads that scenario's own pipeline. Setup restores shared reference tables as well as the selected scenario's shipment, rules and pipeline.

The discount base is `AMOUNT - TAX_AMOUNT`. Discount therefore never reduces VAT already charged. A correct pipeline discounts the net amount before computing VAT. The intentionally incorrect pipeline computes VAT on the undiscounted amount, then discounts only the net amount. Its final amount exceeds `CLEAN` by the VAT on the discount, about 135.82 EUR for the generated input. Reference totals are derived from the formulas and require confirmation in SAP.

Directly typed Customizing fields use semantic data elements with short, medium and long field labels. Dictionary field descriptions also identify the purpose of fields backed by standard data elements.

## Invariants for future automated tests

- A clean scenario must never retain state from a previous shipment.
- A pipeline must execute discount before VAT.
- Monetary percentages retain full precision until the display/persistence boundary.
- Configuration selection must be deterministic where validity ranges overlap.
