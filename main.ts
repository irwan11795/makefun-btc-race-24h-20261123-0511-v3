// cbBTC 24h race bot v3 — core-long + range (Hermes' "default-long core + brake").
//
// Design (built fresh for slot 3; v2 "range-only" is the base it must beat):
//  - CORE 50%: buy 50% of the cash on the first scored bar and HOLD it. The
//    core exists to kill v2's biggest live risk — non-participation (79% of
//    the cash idle; a grind-up day with no -60 bps dip scores ~$0). On the
//    dev window buy-and-hold is +3.64%, so a 50% core captures ~+$18 of it.
//  - BRAKE (one-way, no re-entry): the core is sold if EITHER its worth
//    falls 300 bps under its own running peak (trailing stop, locks in the
//    gain) OR the 240-bar return slides to -400 bps (trend brake, the same
//    trigger v1/v2 used for the washout buy). On dev neither fires: B&H max
//    drawdown is 1.98% (< 3%) and ret240 never goes below -122 bps, so the
//    brake costs nothing on dev and only pays on a live dump day. One-way
//    on purpose: a re-entering brake can whipsaw (sell -3%, re-buy the
//    reclaim, sell again) and burn more than it saves; the range leg keeps
//    trading the freed cash after a brake exit, so the bot is never dead.
//  - RANGE on the other 50% of the cash: v2's trigger unchanged — buy 50%
//    of the FREE cash when close <= SMA90 - 60 bps and ret240 > -300 bps;
//    exit on reclaim (close >= SMA90 + 60 bps), TP +150 bps, stop -60 bps,
//    max 2 stops then the leg retires, 360-bar cap. On dev v2's range leg
//    made +$13.61 on $500/trade; at $250/trade it should make ~half that.
//  - No washout leg, no momentum leg: the brake replaces the washout buy
//    (protection instead of speculation on the same -400 bps signal), and
//    momentum alone lost -$9.21 on dev, so it stays out entirely.
//
// One CBBTC position holds both legs, so each leg tracks its own qty/cost
// and fills are attributed by position delta. A buy is never sent in the
// same batch as a sell, so a fill delta is never polluted by a settlement.
//
// Everything is bigint arithmetic. The bot reads nothing but the bars the
// harness sends: no clock, no network, no randomness, no files.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const CBBTC = 'CBBTC';
const SLIP_BPS = 100;
const BPS = 10000n;

// One place for every tuned number.
const CFG = {
  // Core: half the cash in on the first scored bar, held to the close.
  coreSizePct: 50n,
  // Brake: trailing stop off the core's peak worth, and the trend brake.
  coreTrailBps: 300n,
  coreTrendBps: -400n,
  // Range: v2's numbers, sized off the FREE cash (what the core leaves).
  rangeFloorBps: -300n,
  rangeDiscountBps: 60n,
  rangeTakeBps: 150n,
  rangeStopBps: 60n,
  rangeMaxBars: 360,
  rangeSizePct: 100n,
  rangeMaxStops: 2,
} as const;

// Mutable race state. One position, two legs — tracked separately.
const S = {
  closes: [] as bigint[],
  // Core leg.
  coreQty: 0n,
  coreCost: 0n,
  corePeakWorth: 0n,
  coreBought: false,
  coreBrakedOut: false,
  // Range leg.
  rangeQty: 0n,
  rangeCost: 0n,
  rangeBarsHeld: 0,
  rangeStops: 0,
  // Pending fill attribution (one buy outstanding at most).
  pendingLeg: null as 'C' | 'R' | null,
  pendingQty: 0n,
  pendingCost: 0n,
  // Position as last observed (for fill deltas).
  prevQty: 0n,
  prevCost: 0n,
};

// 240-bar return in bps, or null while the history is too short.
function ret240(): bigint | null {
  const n = S.closes.length;
  if (n < 241) return null;
  const now = S.closes[n - 1];
  const then = S.closes[n - 241];
  return (now * BPS) / then - BPS;
}

// Mean of the last 90 closes, or null while the history is too short.
function avg90(): bigint | null {
  const n = S.closes.length;
  if (n < 90) return null;
  let total = 0n;
  for (let i = n - 90; i < n; i++) total += S.closes[i];
  return total / 90n;
}

// One order that sells `qty` of the position.
function sellQty(qty: bigint): OrderInput[] {
  if (qty <= 0n) return [];
  return [{ side: 'sell', symbol: CBBTC, qty, max_slippage_bps: SLIP_BPS }];
}

// Buy `pct` percent of the spendable cash (capped by weight room).
function buyPct(state: BarsState, pct: bigint): OrderInput[] {
  const room = state.weightRoom(CBBTC);
  const want = (state.cash * pct) / 100n;
  const spend = want < room ? want : room;
  const minSpend = BigInt(state.hello.fees.min_notional_quote_units);
  if (spend <= 0n || spend < minSpend) return [];
  return [{ side: 'buy', symbol: CBBTC, notional_quote_units: spend, max_slippage_bps: SLIP_BPS }];
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    // Bank this bar before anything else, warm-up included: the
    // indicators need the warm-up history behind the scored window.
    for (const b of batch.bars) {
      if (b.symbol === CBBTC) S.closes.push(BigInt(b.c));
    }
    if (state.warmingUp) return [];

    const pos = state.positions.get(CBBTC);
    const close = state.close(CBBTC);
    const posQty = pos === undefined ? 0n : pos.qty;
    const posCost = pos === undefined ? 0n : pos.cost;

    // 1. Attribute a pending fill by position delta. A buy that never
    // landed leaves the leg unheld and (for the core) retryable.
    if (S.pendingLeg !== null) {
      if (posQty > S.pendingQty) {
        const dq = posQty - S.pendingQty;
        const dc = posCost - S.pendingCost;
        if (S.pendingLeg === 'C') {
          S.coreQty += dq;
          S.coreCost += dc;
        } else {
          S.rangeQty += dq;
          S.rangeCost += dc;
        }
      } else if (S.pendingLeg === 'C') {
        S.coreBought = false;
      }
      S.pendingLeg = null;
    }

    const orders: OrderInput[] = [];
    let soldAny = false;

    // 2. Exits. Core brake first: trailing stop off the core's peak worth,
    // or the 240-bar trend sliding to -400 bps. One-way: once braked out
    // the core never re-enters; the range leg keeps working the cash.
    if (S.coreQty > 0n && close !== null) {
      const worth = state.value(CBBTC, S.coreQty);
      if (worth > S.corePeakWorth) S.corePeakWorth = worth;
      const ret = ret240();
      const trailHit =
        S.corePeakWorth > 0n &&
        worth <= (S.corePeakWorth * (BPS - CFG.coreTrailBps)) / BPS;
      const trendHit = ret !== null && ret <= CFG.coreTrendBps;
      if (trailHit || trendHit) {
        orders.push(...sellQty(S.coreQty));
        S.coreQty = 0n;
        S.coreCost = 0n;
        S.corePeakWorth = 0n;
        S.coreBrakedOut = true;
        soldAny = true;
      }
    }

    // Range exit: reclaim, take-profit, stop (counts toward retirement),
    // or the 360-bar cap. Sells only the range leg's qty; the core stays.
    if (S.rangeQty > 0n && close !== null) {
      S.rangeBarsHeld += 1;
      const worth = state.value(CBBTC, S.rangeQty);
      const avg = avg90();
      const takeHit = worth >= (S.rangeCost * (BPS + CFG.rangeTakeBps)) / BPS;
      const reclaimHit =
        avg !== null && close * BPS >= avg * (BPS + CFG.rangeDiscountBps);
      const stopHit = worth <= (S.rangeCost * (BPS - CFG.rangeStopBps)) / BPS;
      const capHit = S.rangeBarsHeld >= CFG.rangeMaxBars;
      if (takeHit || reclaimHit || capHit) {
        orders.push(...sellQty(S.rangeQty));
        S.rangeQty = 0n;
        S.rangeCost = 0n;
        S.rangeBarsHeld = 0;
        soldAny = true;
      } else if (stopHit) {
        S.rangeStops += 1;
        orders.push(...sellQty(S.rangeQty));
        S.rangeQty = 0n;
        S.rangeCost = 0n;
        S.rangeBarsHeld = 0;
        soldAny = true;
      }
    }

    // 3. Entries — never in the same batch as a sell, so a fill delta is
    // never polluted by a settlement. Core first (one shot, first bar),
    // then the range leg on the free cash.
    if (!soldAny && close !== null) {
      if (S.coreQty === 0n && !S.coreBought && !S.coreBrakedOut) {
        const buy = buyPct(state, CFG.coreSizePct);
        if (buy.length > 0) {
          S.pendingLeg = 'C';
          S.pendingQty = posQty;
          S.pendingCost = posCost;
          S.coreBought = true;
          return buy;
        }
      }
      if (S.rangeQty === 0n && S.rangeStops < CFG.rangeMaxStops) {
        const ret = ret240();
        if (ret !== null && ret > CFG.rangeFloorBps) {
          const avg = avg90();
          if (avg !== null && close * BPS <= avg * (BPS - CFG.rangeDiscountBps)) {
            const buy = buyPct(state, CFG.rangeSizePct);
            if (buy.length > 0) {
              S.pendingLeg = 'R';
              S.pendingQty = posQty;
              S.pendingCost = posCost;
              S.rangeBarsHeld = 0;
              return buy;
            }
          }
        }
      }
    }

    S.prevQty = posQty;
    S.prevCost = posCost;
    return orders;
  },
});
