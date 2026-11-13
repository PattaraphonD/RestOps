/*
 * Restaurant Ops — shared pricing maths (no storage, no DOM).
 *
 * Loaded before core.js in the browser and copied to backend/Pricing.gs for Apps Script
 * by tools/build_backend.py. Plain ES5 only.
 *
 *  - roundPrice / effectiveRounding: turn a target-meeting price into a menu price (never rounds down)
 *  - channelEconomics: what a dish earns on one sales channel after commission and packaging
 *  - menuEngineering: Kasavana–Smith classification (star / plowhorse / puzzle / dog)
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

  return {
    ROUNDING_RULES: ROUNDING_RULES,
    effectiveRounding: effectiveRounding,
    roundPrice: roundPrice,
    channelEconomics: channelEconomics,
    menuEngineering: menuEngineering
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RestoPricing;
