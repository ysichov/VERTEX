# Debugger test example: verified findings

This note records the verified behavior of the public `debugger_tests` example
(`https://github.com/ysichov/debugger_tests`) for preparing VERTEX debugging
demonstrations. It distinguishes actual scenario behavior from false alarms.

## CLEAN run

The saved SAP run used selection-screen scenario `CLEAN`. The report passes that
scenario to the data provider, which reads `ZLOG_SHIPMENT`; the pricing strategy
then selects the tariff valid for the shipment route and pricing date.

The saved values are:

- Shipment: `1200 kg`, `1287 km`, pricing date `2026-09-01`.
- Selected tariff: `5.42 EUR` per unit, valid from `2026-06-01`.
- Base amount: `1200 × 5.42 × 1287 / 1000 = 8370.648 EUR`.
- `HAZARDOUS` is initial, so the 1.08 hazard multiplier is correctly skipped.
- CLEAN final amount: approximately `11,302.00364 EUR`.

There is no base-price arithmetic discrepancy in this run. The earlier claim
that the base amount should be `8365.608` was a multiplication error. The
hazard-related diagnosis that CLEAN applied the surcharge was also incorrect.

## Scenario behaviors

- `CLEAN`: control run; no intentional calculation defect. Hazard is false.
- `PRECISION`: fuel percentage is rounded to two decimals before multiplication
  (`0.089302...` becomes `0.09`), creating a small, traceable result difference.
- `STATE`: setup marks the shipment hazardous, so the 8% surcharge is expected
  for this scenario. It is only an error if the demonstration requirement says
  the cargo must be non-hazardous.
- `PIPELINE`: setup places VAT before discount. VAT is calculated on the
  undiscounted amount and is not recalculated after the discount. This is the
  clearest intentional business-logic defect to investigate.
- `MULTI`: combines the precision behavior, hazardous shipment and incorrect
  VAT/discount order.

For the saved CLEAN and PIPELINE runs, CLEAN ends at about `11,302.00364 EUR`
and PIPELINE at about `11,437.82785 EUR`. The difference is the overstated VAT
on the discount (about `135.82421 EUR`).

## Setup caveat

`MULTI` setup inserts an additional USD tariff whose validity overlaps the
EUR tariff. The road strategy orders matching tariffs by `VALID_FROM` descending,
so the later-starting EUR tariff wins for the saved shipment date. The USD row
does not affect that run; the configured exchange rate is not used by the
pricing strategy. Do not present this row as a demonstrated currency-conversion
failure without first changing the example to exercise it.

## Investigation path

To verify a future run, follow the actual data path rather than inferring from
the final amount:

1. Selection-screen radio button → `LV_SCENARIO` → `IV_SCENARIO`.
2. `ZLOG_SHIPMENT` row selected by scenario ID.
3. `ZLOG_BASE_TARIFF` rows matching route and pricing date, including the row
   selected by the strategy's ordering.
4. Operand values and calculated amount at the base-price assignment.
5. Each modifier's input, branch condition, and output in the timeline.

For the example implementation, see `src/zvertex_demo_setup.prog.abap`,
`src/zcl_calc_data_provider.clas.abap`, `src/zcl_price_road.clas.abap`, and the
modifier classes in the `debugger_tests` repository.
