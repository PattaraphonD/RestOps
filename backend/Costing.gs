// GENERATED from app/js/costing.js by tools/build_backend.py. Do not edit here;
// edit app/js/costing.js and run the script again.

// Shared pure costing maths (plain ES5, no DOM, no Google APIs).
// Also copied into the Apps Script project by tools/build_backend.py.
var RestoCosting = (function () {
  'use strict';

  var UNITS = {
    mg: { family: 'mass', factor: 0.001 },
    g: { family: 'mass', factor: 1 },
    kg: { family: 'mass', factor: 1000 },
    oz: { family: 'mass', factor: 28.3495 },
    lb: { family: 'mass', factor: 453.592 },
    ml: { family: 'volume', factor: 1 },
    l: { family: 'volume', factor: 1000 },
    tsp: { family: 'volume', factor: 4.92892 },
    tbsp: { family: 'volume', factor: 14.7868 },
    cup: { family: 'volume', factor: 236.588 },
    floz: { family: 'volume', factor: 29.5735 },
    pt: { family: 'volume', factor: 473.176 },
    qt: { family: 'volume', factor: 946.353 },
    gal: { family: 'volume', factor: 3785.41 },
    pcs: { family: 'count', factor: 1 },
    dozen: { family: 'count', factor: 12 }
  };

  var ALIASES = {
    kg: ['kgs', 'kilo', 'kilogram', 'กก', 'กิโล', 'กิโลกรัม'],
    g: ['gr', 'gram', 'grams', 'กรัม'],
    ml: ['cc', 'มล', 'มิลลิลิตร'],
    l: ['ltr', 'liter', 'litre', 'ลิตร'],
    tsp: ['teaspoon', 'ช้อนชา'],
    tbsp: ['tablespoon', 'ช้อนโต๊ะ'],
    cup: ['cups', 'ถ้วย'],
    lb: ['lbs', 'pound'],
    pcs: ['pc', 'piece', 'pieces', 'ea', 'each', 'ชิ้น', 'ฟอง', 'ลูก', 'ตัว', 'อัน'],
    dozen: ['doz', 'โหล']
  };

  var LOOKUP = {};
  (function () {
    var code, i;
    for (code in UNITS) {
      if (Object.prototype.hasOwnProperty.call(UNITS, code)) LOOKUP[code] = code;
    }
    for (code in ALIASES) {
      if (Object.prototype.hasOwnProperty.call(ALIASES, code)) {
        for (i = 0; i < ALIASES[code].length; i++) LOOKUP[ALIASES[code][i]] = code;
      }
    }
  })();

  function norm(text) {
    var s = String(text == null ? '' : text).toLowerCase().replace(/^\s+|\s+$/g, '');
    return s.replace(/[.\s]+$/, '');
  }

  function unitCode(text) {
    var k = norm(text);
    return k && Object.prototype.hasOwnProperty.call(LOOKUP, k) ? LOOKUP[k] : '';
  }

  function sameUnit(a, b) {
    var ca = unitCode(a), cb = unitCode(b);
    if (ca && cb) return ca === cb;
    return norm(a) === norm(b);
  }

  function convertQty(qty, fromUnit, ing) {
    var toUnit = ing && ing.unit;
    var from = unitCode(fromUnit), to = unitCode(toUnit);
    var convs, i, c, cc;
    if (!norm(fromUnit) || sameUnit(fromUnit, toUnit)) return qty;
    if (from && to && UNITS[from].family === UNITS[to].family) {
      return qty * UNITS[from].factor / UNITS[to].factor;
    }
    convs = (ing && ing.conversions) || [];
    for (i = 0; i < convs.length; i++) {
      c = convs[i];
      if (sameUnit(fromUnit, c.unit)) return qty * c.factor;
      cc = unitCode(c.unit);
      if (from && cc && UNITS[from].family === UNITS[cc].family) {
        return qty * UNITS[from].factor / UNITS[cc].factor * c.factor;
      }
    }
    return null;
  }

  function unitsFor(ing) {
    var out = [];
    function add(u) {
      var i;
      if (!norm(u)) return;
      for (i = 0; i < out.length; i++) if (sameUnit(out[i], u)) return;
      out.push(u);
    }
    function addFamily(u) {
      var code = unitCode(u), k;
      if (!code) return;
      for (k in UNITS) {
        if (Object.prototype.hasOwnProperty.call(UNITS, k) && UNITS[k].family === UNITS[code].family) add(k);
      }
    }
    var convs = (ing && ing.conversions) || [], i;
    add(ing && ing.unit);
    addFamily(ing && ing.unit);
    for (i = 0; i < convs.length; i++) {
      add(convs[i].unit);
      addFamily(convs[i].unit);
    }
    return out;
  }

  function grossQty(netQty, yieldPct) {
    var y = Number(yieldPct);
    if (yieldPct === '' || yieldPct == null || isNaN(y) || y < 1 || y > 1000) y = 100;
    return netQty / (y / 100);
  }

  function buildBook(ingredients) {
    var byId = {}, i, ing;
    for (i = 0; i < (ingredients || []).length; i++) {
      ing = ingredients[i];
      if (ing && ing.id != null) byId[ing.id] = ing;
    }
    return { byId: byId };
  }

  function hasYield(v) {
    return !(v === '' || v == null || isNaN(Number(v)) || Number(v) === 0);
  }

  function lineCost(line, book, costs) {
    var ing = book && book.byId ? book.byId[line.ingredientId] : null;
    var stockQty, y, g, unitCost;
    if (!ing) return { stockQty: 0, grossQty: 0, cost: 0, error: 'missing' };
    stockQty = convertQty(Number(line.qty) || 0, line.unit, ing);
    if (stockQty === null) return { stockQty: 0, grossQty: 0, cost: 0, error: 'unit' };
    y = hasYield(line.yieldPct) ? line.yieldPct : ing.yieldPct;
    g = grossQty(stockQty, y);
    if (ing.kind === 'prep' && costs && costs[ing.id] != null) unitCost = costs[ing.id];
    else unitCost = Number(ing.costPerUnit) || 0;
    return { stockQty: stockQty, grossQty: g, cost: g * unitCost, error: '' };
  }

  function prepCosts(book) {
    var memo = {}, height = {}, visiting = {}, out = {}, id;
    function visit(p) {
      var lines = p.prepLines || [], i, child, total = 0, h = 1, r, batch;
      if (Object.prototype.hasOwnProperty.call(memo, p.id)) return;
      visiting[p.id] = true;
      for (i = 0; i < lines.length; i++) {
        child = book.byId[lines[i].ingredientId];
        if (child && child.kind === 'prep') {
          if (visiting[child.id]) throw { code: 'CYCLE', prep: p.name, via: child.name };
          visit(child);
          if (height[child.id] + 1 > h) h = height[child.id] + 1;
        }
      }
      if (h > 4) throw { code: 'DEPTH', prep: p.name };
      for (i = 0; i < lines.length; i++) {
        r = lineCost(lines[i], book, memo);
        total += r.cost;
      }
      batch = Number(p.batchQty);
      memo[p.id] = batch > 0 ? total / batch : 0;
      height[p.id] = h;
      visiting[p.id] = false;
    }
    for (id in book.byId) {
      if (Object.prototype.hasOwnProperty.call(book.byId, id) && book.byId[id].kind === 'prep') visit(book.byId[id]);
    }
    for (id in memo) if (Object.prototype.hasOwnProperty.call(memo, id)) out[id] = memo[id];
    return out;
  }

  function explode(line, multiplier, book) {
    var acc = {}, order = [];
    function add(id, qty) {
      if (!Object.prototype.hasOwnProperty.call(acc, id)) { acc[id] = 0; order.push(id); }
      acc[id] += qty;
    }
    function walk(ln, mult, depth) {
      var ing = book.byId[ln.ingredientId], stockQty, y, g, batch, scale, i;
      if (!ing || depth > 8) return;
      stockQty = convertQty(Number(ln.qty) || 0, ln.unit, ing);
      if (stockQty === null) return;
      y = hasYield(ln.yieldPct) ? ln.yieldPct : ing.yieldPct;
      g = grossQty(stockQty, y);
      if (ing.kind === 'prep' && ing.trackStock === false) {
        batch = Number(ing.batchQty);
        if (!(batch > 0)) return;
        scale = g / batch;
        for (i = 0; i < (ing.prepLines || []).length; i++) walk(ing.prepLines[i], mult * scale, depth + 1);
      } else {
        add(ing.id, g * mult);
      }
    }
    walk(line, multiplier, 0);
    return order.map(function (id) { return { ingredientId: id, qty: acc[id] }; });
  }

  function runCost(run, costOf) {
    var inputCost = 0, byproductValue = 0, i, total, produced;
    var ins = (run && run.inputs) || [], bys = (run && run.byproducts) || [];
    for (i = 0; i < ins.length; i++) inputCost += (Number(ins[i].qty) || 0) * (Number(costOf(ins[i].ingredientId)) || 0);
    for (i = 0; i < bys.length; i++) byproductValue += (Number(bys[i].qty) || 0) * (Number(costOf(bys[i].ingredientId)) || 0);
    total = inputCost - byproductValue;
    if (total < 0) total = 0;
    produced = Number(run && run.producedQty) || 0;
    function r(v, dp) { var m = Math.pow(10, dp); return Math.round(v * m) / m; }
    return {
      inputCost: r(inputCost, 2),
      byproductValue: r(byproductValue, 2),
      totalCost: r(total, 2),
      unitCost: produced > 0 ? r(total / produced, 4) : 0
    };
  }

  /* ------------------------------------------------------------ SOP helpers */

  // The 14 major allergens (EU list), in display order.
  var ALLERGENS = ['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk', 'nuts', 'celery', 'mustard',
    'sesame', 'sulphites', 'lupin', 'molluscs'];

  /** Allergens in a list of recipe lines, following preps (each ingredient visited once, so cycles end). */
  function allergensFor(lines, book) {
    var found = {}, seen = {};
    function walk(id) {
      if (seen[id]) return;
      seen[id] = true;
      var ing = book.byId[id];
      if (!ing) return;
      (ing.allergens || []).forEach(function (a) { found[a] = true; });
      if (ing.kind === 'prep') (ing.prepLines || []).forEach(function (l) { walk(l.ingredientId); });
    }
    (lines || []).forEach(function (l) { walk(l.ingredientId); });
    return ALLERGENS.filter(function (a) { return found[a]; });
  }

  /** A quantity in the unit a cook reads most easily: 1500 g → 1.5 kg, 0.25 kg → 250 g. */
  function humanQty(qty, unit) {
    var q = Number(qty) || 0, code = unitCode(unit);
    if (code === 'g' && q >= 1000) { q = q / 1000; unit = 'kg'; }
    else if (code === 'ml' && q >= 1000) { q = q / 1000; unit = 'l'; }
    else if (code === 'kg' && q > 0 && q < 1) { q = q * 1000; unit = 'g'; }
    else if (code === 'l' && q > 0 && q < 1) { q = q * 1000; unit = 'ml'; }
    return { qty: Math.round(q * 1000) / 1000, unit: unit };
  }

  return {
    ALLERGENS: ALLERGENS,
    allergensFor: allergensFor,
    humanQty: humanQty,
    UNITS: UNITS,
    unitCode: unitCode,
    sameUnit: sameUnit,
    convertQty: convertQty,
    unitsFor: unitsFor,
    grossQty: grossQty,
    buildBook: buildBook,
    lineCost: lineCost,
    prepCosts: prepCosts,
    explode: explode,
    runCost: runCost
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RestoCosting;
