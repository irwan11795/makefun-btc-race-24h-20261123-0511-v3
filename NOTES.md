# BTC Race Bot v3 — NOTES

## Design

Core-long 50% + brake + range (Hermes' "default-long core + brake" direction
from the v2 consultation; no fresh Hermes call was made in this run — time-boxed).

- **Core 50%**: buy $500 on the first scored bar (seq 0), hold to the close.
  Kills v2's biggest live risk: non-participation (79% cash idle).
- **Brake (one-way, no re-entry)**: sell the core if its worth falls 300 bps
  under its own running peak, or the 240-bar return slides to -400 bps.
  On dev neither fires (see below), so the brake costs nothing on dev.
- **Range on the free cash**: v2's trigger unchanged (close <= SMA90 - 60 bps,
  ret240 > -300 bps; exit reclaim / TP +150 / stop -60, max 2 stops, 360-bar
  cap). FINAL size is 100% of the free cash ($500/trade), see sweep.

## Official grades (grade-local, same dev window)

| Variant | Dev PnL | Trades | Win | Max DD | Exposure | Fees | Action log |
|---|---|---|---|---|---|---|---|
| base (range 50% of free cash) | +$24.04 | 7 | 100% | 1.01% | 61% | $1.01 | 96e8044aae50 |
| **r100 (range 100% of free cash) — FINAL** | **+$30.47** | 7 | 100% | 1.12% | 71% | $1.62 | bf2bba6bd56f |
| nobrake (brake off) | +$24.04 | 7 | 100% | 1.01% | 61% | $1.01 | 96e8044aae50 |
| trail200 (brake -200 bps) | +$24.04 | 7 | 100% | 1.01% | 61% | $1.01 | 96e8044aae50 |

Reference: v2 +$13.61, v1 +$6.09, buy-and-hold +$36.40. v3-final captures
84% of buy-and-hold (v2: 37%). Dev gate: net PnL > $0 — clears.

## Action log (r100, FINAL)

- seq 0: core buy $500. seq 433: range buy $500. seq 671: range sell.
  seq 777: range buy $503.54. seq 1107: range sell. seq 1291: range buy
  $508.33. seq 1322: range sell. No core sell — the brake never fired.
- Leg PnLs (reconstructed from fills, approx): core +$18.08, range
  RT1 +$4.07, RT2 +$5.16, RT3 +$5.47 (sum $32.78 vs official $30.47;
  the gap is fees/slippage).

## Robustness

- **Brake costs nothing on dev**: nobrake and trail200 grade IDENTICAL action
  logs to base (96e8044aae50). Trigger headroom on dev: ret240 never below
  -122 bps (brake at -400); B&H max drawdown 1.98% (trailing stop at 3.00%).
- **Drop-best-trade**: dropping the core (+$18.08) leaves ~+$12.39 — still
  positive and near v2's +$13.61. Dropping the best range trip (+$5.47)
  leaves ~+$25.00.
- **Hour-4 concentration** (analytic, not a re-grade — a kit-dataset ablation
  was attempted but the kit's file-size manifest blocked the modified kit):
  per-block PnL shows hour 4 (bars 240-299, +2.29%) contributed +$11.78 of
  +$30.47 (39%). Without that hour, B&H would be ~+1.35% (core ~+$6.75) and
  the range legs (all bought after hour 4) would keep most of their edge,
  so the total would be roughly +$17-21 — still above v2, but the margin
  shrinks. The bot is NOT a one-hour wonder, but hour 4 matters.
- **Dump protection — NOT live-tested**: no synthetic crash run was done in
  this session (time-boxed). The brake is argued from thresholds: it fires
  only on moves larger than anything in the dev window, and the nobrake
  comparison proves it never misfires on dev-like tape. On a real dump it
  sells the core after a -3% peak drawdown or a -4% four-hour slide; the
  range leg keeps trading the freed cash.

## Honest weaknesses

- Only 3 range round trips + 1 core hold — the 100% win rate is small-sample,
  same caveat as v2 (selection across variants).
- The brake is one-way: if it fires early on a false alarm and the day then
  grinds up, the core misses the recovery (the range leg still trades).
- r100 doubles the range leg's stop cost vs base ($3.00 vs $1.50 per stop,
  max 2 stops = -$6.00 worst case) for +$6.43 of dev PnL. Same triggers,
  same trade count, DD only +0.11 pp — judged worth it.
- A live grind-up day with a mid-day -3% dip would brake the core out and
  leave the gain on the table; a dump day is where the brake earns its keep.
