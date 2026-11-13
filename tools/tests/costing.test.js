const { test, assert } = require('../test_core.js');
const C = require('../../app/js/costing.js');

function near(a, b) { return Math.abs(a - b) < 1e-9; }

function mkBook() {
  return C.buildBook([
    { id: 'fish', name: 'Fish', unit: 'kg', costPerUnit: 200, yieldPct: 45, kind: 'raw' },
    { id: 'onion', name: 'Onion', unit: 'kg', costPerUnit: 20, yieldPct: 80, kind: 'raw' },
    { id: 'oil', name: 'Oil', unit: 'L', costPerUnit: 50, yieldPct: 100, kind: 'raw' },
    { id: 'chili', name: 'Chili', unit: 'kg', costPerUnit: 90, yieldPct: 100, kind: 'raw' },
    { id: 'co', name: 'Chilli oil', unit: 'L', costPerUnit: 0, kind: 'prep', batchQty: 2, trackStock: true,
      prepLines: [{ ingredientId: 'oil', qty: 1, unit: 'L' }, { ingredientId: 'chili', qty: 200, unit: 'g' }] },
    { id: 'tom', name: 'Tom yum base', unit: 'L', costPerUnit: 0, kind: 'prep', batchQty: 1, trackStock: true,
      prepLines: [{ ingredientId: 'co', qty: 0.25, unit: 'L' }] },
    { id: 'zero', name: 'Zero', unit: 'L', kind: 'prep', batchQty: 0, prepLines: [{ ingredientId: 'oil', qty: 1, unit: 'L' }] }
  ]);
}

test('grossQty', function () {
  assert.ok(near(C.grossQty(0.72, 72), 1));
  assert.strictEqual(C.grossQty(1, ''), 1);
  assert.strictEqual(C.grossQty(1, 250), 0.4);
  assert.strictEqual(C.grossQty(1, 0), 1);
  assert.strictEqual(C.grossQty(1, 5000), 1);
  assert.strictEqual(C.grossQty(1, 'abc'), 1);
});

test('lineCost fish yield', function () {
  var r = C.lineCost({ ingredientId: 'fish', qty: 180, unit: 'g' }, mkBook(), {});
  assert.ok(near(r.grossQty, 0.4));
  assert.ok(near(r.cost, 80));
});

test('lineCost yield override', function () {
  var r = C.lineCost({ ingredientId: 'onion', qty: 0.9, unit: 'kg', yieldPct: 90 }, mkBook(), {});
  assert.ok(near(r.grossQty, 1));
});

test('lineCost missing and unit error', function () {
  var b = mkBook();
  var r = C.lineCost({ ingredientId: 'nope', qty: 1, unit: 'g' }, b, {});
  assert.strictEqual(r.cost, 0);
  assert.strictEqual(r.error, 'missing');
  r = C.lineCost({ ingredientId: 'fish', qty: 1, unit: 'L' }, b, {});
  assert.strictEqual(r.error, 'unit');
  assert.strictEqual(r.cost, 0);
});

test('prepCosts simple, nested, zero batch', function () {
  var costs = C.prepCosts(mkBook());
  assert.ok(near(costs.co, 34));
  assert.ok(near(costs.tom, 8.5));
  assert.strictEqual(costs.zero, 0);
});

test('lineCost uses prep cost, falls back to costPerUnit', function () {
  var b = mkBook();
  var r = C.lineCost({ ingredientId: 'co', qty: 1, unit: 'L' }, b, { co: 34 });
  assert.ok(near(r.cost, 34));
  b.byId.co.costPerUnit = 7;
  r = C.lineCost({ ingredientId: 'co', qty: 1, unit: 'L' }, b, {});
  assert.ok(near(r.cost, 7));
});

test('cycle detected', function () {
  var b = C.buildBook([
    { id: 'a', name: 'A', unit: 'L', kind: 'prep', batchQty: 1, prepLines: [{ ingredientId: 'b', qty: 1, unit: 'L' }] },
    { id: 'b', name: 'B', unit: 'L', kind: 'prep', batchQty: 1, prepLines: [{ ingredientId: 'a', qty: 1, unit: 'L' }] }
  ]);
  var err = null;
  try { C.prepCosts(b); } catch (e) { err = e; }
  assert.ok(err && err.code === 'CYCLE');
});

function chain(n) {
  var list = [{ id: 'r', name: 'Raw', unit: 'kg', costPerUnit: 1, kind: 'raw' }], i;
  for (i = 1; i <= n; i++) {
    list.push({ id: 'p' + i, name: 'P' + i, unit: 'kg', kind: 'prep', batchQty: 1,
      prepLines: [{ ingredientId: i === n ? 'r' : 'p' + (i + 1), qty: 1, unit: 'kg' }] });
  }
  return C.buildBook(list);
}

test('depth limit', function () {
  var err = null;
  try { C.prepCosts(chain(5)); } catch (e) { err = e; }
  assert.ok(err && err.code === 'DEPTH');
  assert.ok(near(C.prepCosts(chain(4)).p1, 1));
});

test('explode', function () {
  var b = mkBook();
  var out = C.explode({ ingredientId: 'co', qty: 0.25, unit: 'L' }, 1, b);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].ingredientId, 'co');
  b.byId.co.trackStock = false;
  out = C.explode({ ingredientId: 'co', qty: 0.25, unit: 'L' }, 1, b);
  var m = {};
  out.forEach(function (x) { m[x.ingredientId] = x.qty; });
  assert.ok(near(m.oil, 0.125));
  assert.ok(near(m.chili, 0.025));
  out = C.explode({ ingredientId: 'co', qty: 0.25, unit: 'L' }, 2, b);
  assert.ok(near(out.filter(function (x) { return x.ingredientId === 'oil'; })[0].qty, 0.25));
});

test('runCost', function () {
  var r = C.runCost({
    inputs: [{ ingredientId: 'x', qty: 3 }],
    byproducts: [{ ingredientId: 'y', qty: 1 }],
    producedQty: 5
  }, function (id) { return id === 'x' ? 10 : 5; });
  assert.deepStrictEqual(r, { inputCost: 30, byproductValue: 5, totalCost: 25, unitCost: 5 });
});
