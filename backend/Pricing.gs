// GENERATED from app/js/pricing.js by tools/build_backend.py. Do not edit here;
// edit app/js/pricing.js and run the script again.

/*
 * Restaurant Ops — shared pricing maths (no storage, no DOM).
 *
 * Loaded before core.js in the browser and copied to backend/Pricing.gs for Apps Script
 * by tools/build_backend.py. Plain ES5 only.
 *
 *  - roundPrice / effectiveRounding: turn a target-meeting price into a menu price (never rounds down)
 *  - channelEconomics: what a dish earns on one sales channel after commission and packaging
 *  - menuEngineering: Kasavana–Smith classification (star / plowhorse / puzzle / dog)
 *  - promoEconomics / counterOffer: is a promotion still worth it, and how far can a discount go
 */
var RestoPricing = (function () {
  'use strict';

  var ROUNDING_RULES = ['none', '1', '5', '10', '0.99', '9-ending'];
  var EPS = 1e-9;

  function round(n, dp) {
    var f = Math.pow(10, dp === undefined ? 2 : dp);
    return Math.round((Number(n) || 0) * f + (n >= 0 ? EPS : -EPS)) / f;
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /** The rounding rule in force: a valid setting wins, otherwise a sensible default for the currency. */
  function effectiveRounding(setting, currency) {
    var s = String(setting === undefined || setting === null ? '' : setting).trim();
    if (ROUNDING_RULES.indexOf(s) >= 0) return s;
    var c = String(currency || '').toUpperCase();
    if (c === 'THB') return '5';
    if (c === 'JPY' || c === 'KRW' || c === 'VND' || c === 'IDR') return '10';
    return '0.99';
  }

  /** Smallest "nice" price that is not below p. Returns null for missing / non-positive prices. */
  function roundPrice(p, rule) {
    if (p === null || p === undefined || p === '') return null;
    p = Number(p);
    if (!isFinite(p) || p <= 0) return null;
    switch (rule) {
      case '1': return Math.ceil(p - EPS);
      case '5': return Math.ceil(p / 5 - EPS) * 5;
      case '10': return Math.ceil(p / 10 - EPS) * 10;
      case '0.99': return round(Math.max(0, Math.ceil(p - 0.99 - EPS)) + 0.99, 2);
      case '9-ending': {
        var x = Math.ceil(p - EPS);
        return x + ((9 - (x % 10)) + 10) % 10;
      }
      default: return Math.ceil(p * 100 - EPS) / 100;
    }
  }

  /**
   * net revenue = price × (1 − commission%); CM = net − food cost − packaging;
   * suggested = (food cost + packaging) ÷ (target% × (1 − commission%)), rounded up by `rounding`.
   * meetsTarget = (food cost + packaging) ÷ net ≤ target%, so a price at or above the unrounded suggestion meets it.
   */
  function channelEconomics(o) {
    var price = num(o.price), food = num(o.foodCost), pack = num(o.packaging);
    var c = num(o.commissionPct), target = num(o.targetPct);
    var net = price > 0 ? price * (1 - c / 100) : 0;
    var fcNet = net > 0 ? round(food / net * 100, 1) : null;
    var cost = food + pack;
    var suggested = null;
    if (target > 0 && c < 100 && cost > 0 && food > 0) suggested = roundPrice(cost / (target / 100 * (1 - c / 100)), o.rounding);
    return {
      netRevenue: round(net), cm: round(net - food - pack), foodCostPctNet: fcNet, suggested: suggested,
      // Packaging is part of the cost the target has to cover, exactly as in the suggested price.
      meetsTarget: net > 0 && cost / net * 100 <= target + EPS
    };
  }

  /**
   * items: [{ id, qty, cm }] where cm is the period's total contribution margin for that dish.
   * Popular  = menu mix % ≥ 70 % × (1 ÷ number of dishes sold).
   * High CM  = CM per dish ≥ the sales-weighted average CM.
   */
  function menuEngineering(items) {
    var sold = (items || []).filter(function (i) { return num(i.qty) > 0; });
    var totalQty = 0, totalCm = 0;
    sold.forEach(function (i) { totalQty += num(i.qty); totalCm += num(i.cm); });
    var threshold = sold.length ? 0.7 * (100 / sold.length) : 0;
    var avg = totalQty > 0 ? totalCm / totalQty : 0;
    return {
      threshold: round(threshold, 1),
      avgCm: round(avg, 2),
      items: sold.map(function (i) {
        var mix = num(i.qty) / totalQty * 100;
        var per = num(i.cm) / num(i.qty);
        var popular = mix >= threshold - EPS;
        var high = per >= avg - EPS;
        return {
          id: i.id, mixPct: round(mix, 1), cmPerDish: round(per, 2), popular: popular, highMargin: high,
          cls: popular ? (high ? 'star' : 'plowhorse') : (high ? 'puzzle' : 'dog')
        };
      })
    };
  }

  /* ------------------------------------------------------------ promotions */

  var PROMO_TYPES = ['percentOff', 'amountOff', 'fixedPrice', 'bundle', 'buyXGetY'];

  /** "2+1" → { x: 2, y: 1 }; anything else → null. */
  function parseBxgy(v) {
    var m = /^(\d+)\s*\+\s*(\d+)$/.exec(String(v === null || v === undefined ? '' : v).trim());
    if (!m) return null;
    var x = Number(m[1]), y = Number(m[2]);
    return x >= 1 && y >= 1 ? { x: x, y: y } : null;
  }

  /** What the customer pays for one dish under a per-dish promotion (never below 0). */
  function promoPrice(type, value, listPrice) {
    var list = num(listPrice), v = num(value), out = list;
    if (type === 'percentOff') out = list * (1 - v / 100);
    else if (type === 'amountOff') out = list - v;
    else if (type === 'fixedPrice') out = v;
    else if (type === 'buyXGetY') { var b = parseBxgy(value); out = b ? list * b.x / (b.x + b.y) : list; }
    return round(Math.max(0, out), 2);
  }

  /** Per-unit bundle price of each component: by list share, or equal per unit when nothing has a list price. */
  function bundleSplit(items, bundlePrice) {
    var total = 0, units = 0;
    (items || []).forEach(function (i) { total += num(i.listPrice) * num(i.qty || 1); units += num(i.qty || 1); });
    return (items || []).map(function (i) {
      var u = total > 0 ? num(bundlePrice) * num(i.listPrice) / total : (units > 0 ? num(bundlePrice) / units : 0);
      return { id: i.id, unitPrice: round(u, 4) };
    });
  }

  /** One unit (a dish, or a whole bundle) before and during a promotion. */
  function promoRow(o) {
    var list = num(o.listPrice), promo = Math.max(0, num(o.promoPrice)), food = num(o.foodCost), pack = num(o.packaging);
    var ch = o.channel || {};
    var cut = Math.max(0, list - promo);
    var platform = cut * Math.min(100, Math.max(0, num(o.platformFundedPct))) / 100;
    var disc = cut - platform;
    // What the restaurant is credited = what the customer pays + the app's share of the discount.
    // (Equals list − our share of the discount; also right when a set costs more than its dishes' list prices.)
    var credited = promo + platform;
    var campaign = o.campaignCommissionPct;
    var rate = campaign === null || campaign === undefined || campaign === '' ? num(ch.commissionPct) : num(campaign);
    var base = ch.commissionOnDiscounted === false ? list : promo;
    var commission = rate / 100 * base;
    var cmBefore = list * (1 - num(ch.commissionPct) / 100) - food - pack;
    var net = credited - commission;
    var cmDuring = net - food - pack;
    var costPct = net > 0 ? (food + pack) / net * 100 : null;
    var target = num(o.targetPct);
    return {
      id: o.id, name: o.name, listPrice: round(list), promoPrice: round(promo), discount: round(disc), platformDiscount: round(platform),
      credited: round(credited), commission: round(commission), foodCost: round(food), packaging: round(pack),
      cmBefore: round(cmBefore), cmDuring: round(cmDuring),
      costPctDuring: costPct === null ? null : round(costPct, 1),
      foodCostPctDuring: net > 0 ? round(food / net * 100, 1) : null,
      uplift: cmDuring > 0 && cmBefore > 0 ? round(cmBefore / cmDuring - 1, 4) : null,
      verdict: cmDuring < -EPS ? 'loss' : (costPct !== null && costPct <= target + 5 + EPS ? 'profitable' : 'thin')
    };
  }

  /**
   * Profit of a promotion on one channel. Per-dish types give one row per dish; a bundle gives one row.
   * overall = the rows summed (verdict and uplift recomputed); worst = up to 3 weakest non-profitable rows.
   */
  function promoEconomics(o) {
    var ch = o.channel || {}, items = o.items || [];
    var common = { channel: ch, platformFundedPct: o.platformFundedPct, campaignCommissionPct: o.campaignCommissionPct, targetPct: o.targetPct };
    var rows;
    if (o.type === 'bundle') {
      var list = 0, food = 0, qty = 0;
      items.forEach(function (i) { var q = num(i.qty || 1); list += num(i.listPrice) * q; food += num(i.foodCost) * q; qty += q; });
      rows = [promoRow(merge(common, { id: 'bundle', name: items.map(function (i) { return i.name; }).join(' + '),
        listPrice: list, promoPrice: num(o.value), foodCost: food, packaging: qty * num(ch.packagingCost) }))];
    } else {
      rows = items.map(function (i) {
        return promoRow(merge(common, { id: i.id, name: i.name, listPrice: i.listPrice,
          promoPrice: promoPrice(o.type, o.value, i.listPrice), foodCost: i.foodCost, packaging: num(ch.packagingCost) }));
      });
    }
    var t = { listPrice: 0, promoPrice: 0, discount: 0, platformDiscount: 0, credited: 0, commission: 0, foodCost: 0, packaging: 0, cmBefore: 0 };
    rows.forEach(function (r) { for (var k in t) t[k] += r[k]; });
    var overall = rows.length ? promoRow(merge(common, { id: 'overall', name: '', listPrice: t.listPrice, promoPrice: t.promoPrice,
      foodCost: t.foodCost, packaging: t.packaging })) : null;
    if (overall) {
      // Summing per-row money keeps rounding consistent with what the rows show.
      ['discount', 'platformDiscount', 'credited', 'commission', 'cmBefore'].forEach(function (k) { overall[k] = round(t[k]); });
      overall.cmDuring = round(t.credited - t.commission - t.foodCost - t.packaging);
      var net = t.credited - t.commission;
      overall.costPctDuring = net > 0 ? round((t.foodCost + t.packaging) / net * 100, 1) : null;
      overall.foodCostPctDuring = net > 0 ? round(t.foodCost / net * 100, 1) : null;
      overall.uplift = overall.cmDuring > 0 && overall.cmBefore > 0 ? round(overall.cmBefore / overall.cmDuring - 1, 4) : null;
      overall.verdict = overall.cmDuring < -EPS ? 'loss'
        : (overall.costPctDuring !== null && overall.costPctDuring <= num(o.targetPct) + 5 + EPS ? 'profitable' : 'thin');
    }
    var worst = rows.filter(function (r) { return r.verdict !== 'profitable'; })
      .sort(function (a, b) { return a.cmDuring - b.cmDuring; }).slice(0, 3).map(function (r) { return r.id; });
    return { rows: rows, overall: overall, worst: worst };
  }

  /**
   * The largest % off (0–90, in 0.5 steps) a delivery-app campaign can offer:
   *  onTarget  — every remaining dish stays 'profitable' (dishes already off target at 0 % are left out)
   *  breakEven — every remaining dish still makes money (dishes already losing money at 0 % are left out)
   */
  function counterOffer(o) {
    var at = function (pct) { return promoEconomics(merge(o, { type: 'percentOff', value: pct })).rows; };
    var start = at(0);
    function search(ok) {
      var keep = {}, excluded = [];
      start.forEach(function (r) { if (ok(r)) keep[r.id] = true; else excluded.push(r.id); });
      if (!Object.keys(keep).length) return { maxPct: null, excluded: excluded };
      var best = 0;
      for (var p = 0.5; p <= 90 + EPS; p += 0.5) {
        var pass = at(p).every(function (r) { return !keep[r.id] || ok(r); });
        if (!pass) break;
        best = round(p, 1);
      }
      return { maxPct: best, excluded: excluded };
    }
    return {
      onTarget: search(function (r) { return r.verdict === 'profitable'; }),
      breakEven: search(function (r) { return r.cmDuring >= -EPS; })
    };
  }

  /**
   * Profit board: every dish on every channel.
   * o = { dishes: [{ id, price, foodCost, prices: { channelId: price }, hasRecipe }],
   *       channels: [{ id, commissionPct, packagingCost }], targetPct, rounding, overheadPerDish (null = unknown) }
   * cm = net after commission − food − packaging; realProfit = cm − running cost per dish.
   * suggested = the higher of the target price and the break-even price, only when above the current price.
   */
  function profitBoard(o) {
    var target = num(o.targetPct), oh = o.overheadPerDish === null || o.overheadPerDish === undefined ? null : num(o.overheadPerDish);
    var counts = { all: 0, loss: 0, overTarget: 0, noRecipe: 0 };
    var rows = (o.dishes || []).map(function (d) {
      var food = num(d.foodCost), base = num(d.price);
      var row = { id: d.id, price: base, foodCost: food, noRecipe: !d.hasRecipe || !(food > 0),
        foodCostPct: base > 0 && food > 0 ? round(food / base * 100, 1) : null, overTarget: false,
        cells: {}, loss: false, lossChannels: [], worstReal: null };
      counts.all++;
      if (row.noRecipe) { counts.noRecipe++; return row; }
      row.overTarget = row.foodCostPct !== null && row.foodCostPct > target + EPS;
      (o.channels || []).forEach(function (c) {
        var own = d.prices && d.prices[c.id] !== undefined && d.prices[c.id] !== null && d.prices[c.id] !== '';
        var price = own ? num(d.prices[c.id]) : base;
        var e = channelEconomics({ price: price, foodCost: food, packaging: c.packagingCost, commissionPct: c.commissionPct,
          targetPct: target, rounding: o.rounding });
        var real = oh === null ? null : round(e.cm - oh);
        var keep = 1 - num(c.commissionPct) / 100;
        var breakEven = oh !== null && keep > 0 ? roundPrice((food + num(c.packagingCost) + oh) / keep, o.rounding) : null;
        // Missing the target → target price; losing money → break-even price; both → the higher one.
        var wanted = !e.meetsTarget && e.suggested !== null ? e.suggested : null;
        if (breakEven !== null && (wanted !== null || real < -EPS)) wanted = Math.max(wanted || 0, breakEven);
        row.cells[c.id] = { price: price, own: !!own, netRevenue: e.netRevenue, cm: e.cm, realProfit: real,
          foodCostPctNet: e.foodCostPctNet, meetsTarget: e.meetsTarget,
          suggested: wanted !== null && wanted > price + EPS ? wanted : null };
        if (real !== null) {
          if (row.worstReal === null || real < row.worstReal) row.worstReal = real;
          if (real < -EPS) row.lossChannels.push(c.id);
        }
      });
      row.loss = row.lossChannels.length > 0;
      if (row.loss) counts.loss++;
      if (row.overTarget) counts.overTarget++;
      return row;
    });
    return { rows: rows, counts: counts, overheadPerDish: oh };
  }

  function merge(a, b) {
    var out = {}, k;
    for (k in a) out[k] = a[k];
    for (k in b) out[k] = b[k];
    return out;
  }

  return {
    ROUNDING_RULES: ROUNDING_RULES,
    effectiveRounding: effectiveRounding,
    roundPrice: roundPrice,
    channelEconomics: channelEconomics,
    menuEngineering: menuEngineering,
    PROMO_TYPES: PROMO_TYPES,
    parseBxgy: parseBxgy,
    promoPrice: promoPrice,
    bundleSplit: bundleSplit,
    promoEconomics: promoEconomics,
    counterOffer: counterOffer,
    profitBoard: profitBoard
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RestoPricing;
