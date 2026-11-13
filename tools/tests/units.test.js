'use strict';
const { test, assert } = require('../test_core.js');
const C = global.RestoCosting || require('../../app/js/costing.js');

function near(a, b, dp) { assert.ok(Math.abs(a - b) < Math.pow(10, -(dp || 6)) / 2, a + ' !~ ' + b); }

test('unitCode normalises and resolves aliases', () => {
  assert.equal(C.unitCode('กก.'), 'kg');
  assert.equal(C.unitCode(' KG '), 'kg');
  assert.equal(C.unitCode('ฟอง'), 'pcs');
  assert.equal(C.unitCode('bottle'), '');
});
test('convertQty same family', () => {
  assert.equal(C.convertQty(150, 'g', { unit: 'กก.', conversions: [] }), 0.15);
  near(C.convertQty(2, 'tbsp', { unit: 'L', conversions: [] }), 0.0295736, 6);
});
test('convertQty unknown units', () => {
  assert.equal(C.convertQty(3, 'bottle', { unit: 'bottle', conversions: [] }), 3);
  assert.equal(C.convertQty(3, 'pack', { unit: 'bottle', conversions: [] }), null);
});
test('convertQty via ingredient conversions', () => {
  const egg = { unit: 'pcs', conversions: [{ unit: 'g', factor: 1 / 55 }] };
  near(C.convertQty(110, 'g', egg), 2, 9);
  near(C.convertQty(0.11, 'kg', egg), 2, 9);
  assert.equal(C.convertQty(1, 'case', { unit: 'bottle', conversions: [{ unit: 'case', factor: 24 }] }), 24);
});
test('unitsFor lists stock unit then family', () => {
  const u = C.unitsFor({ unit: 'kg', conversions: [] });
  assert.equal(u[0], 'kg');
  assert.ok(u.indexOf('g') >= 0 && u.indexOf('lb') >= 0 && u.indexOf('ml') < 0);
});
