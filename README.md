# BTC Race Bot v3 — Core-Long + Range

[![make.fun](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/c/btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/irwan11795/makefun-btc-race-24h-20261123-0511-v3/rank.svg)](https://make.fun/c/btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/irwan11795/makefun-btc-race-24h-20261123-0511-v3/reward.svg)](https://make.fun/c/btc-race-24h-20261123-0511)

Entry for [btc-race-24h-20261123-0511](https://make.fun/c/btc-race-24h-20261123-0511) (make.fun, $50, top 10).

## Design

Long-only cbBTC bot, three ideas in one position:

- **Core 50%**: buy half the cash on the first scored bar and hold it. The core exists to kill v2's biggest live risk — non-participation (79% of the cash idle; a grind-up day with no -60 bps dip scores ~$0). Buy-and-hold on the dev window is +3.64%.
- **Brake (one-way)**: the core is sold if its worth falls 300 bps under its own running peak (trailing stop) or the 240-bar return slides to -400 bps (trend brake). Neither fires on dev (B&H max drawdown 1.98%, ret240 never below -122 bps), so the brake costs nothing on dev and only pays on a live dump day.
- **Range on the other 50%**: v2's trigger unchanged — buy 50% of the free cash when close is 60 bps under the 90-bar average and the 240-bar return is above -300 bps; exit on reclaim, +150 bps take-profit, -60 bps stop (max 2 stops), 360-bar cap.

No washout leg, no momentum leg (momentum alone lost -$9.21 on dev).

## Files

- `main.ts` — the bot (Node 22, stdlib only, deterministic, bigint only)
- `vendor/makefun-bars.ts` — the kit's SDK shim, unchanged

## Results

See NOTES.md for the dev grade and robustness checks.
