'use strict';
const { makeApi, test, assert } = require('../test_core.js');
const C = global.RestoCosting || require('../../app/js/costing.js');

function code(fn) { try { fn(); } catch (e) { return e.code + ': ' + e.message; } return 'OK'; }

function setup() {
  const api = makeApi();
  const { as } = api;
  const ch = as('bootstrap', {}).channels;
  const shrimp = as('ingredients.save', { item: { name: 'Shrimp', unit: 'kg', costPerUnit: 300, minLevel: 0, allergens: ['crustaceans'] } });
  const egg = as('ingredients.save', { item: { name: 'Egg', unit: 'pcs', costPerUnit: 5, minLevel: 0, allergens: ['eggs'] } });
  const oil = as('ingredients.save', { item: { name: 'Oil', unit: 'l', costPerUnit: 50, minLevel: 0 } });
  const paste = as('ingredients.save', { item: { name: 'Shrimp paste mix', unit: 'kg', costPerUnit: 0, minLevel: 0, kind: 'prep', batchQty: 1,
    allergens: ['soy'] }, prepRecipe: [{ ingredientId: shrimp.id, qty: 500, unit: 'g' }, { ingredientId: oil.id, qty: 100, unit: 'ml' }] });
  const dish = as('menu.save', { item: { name: 'Fried rice', price: 100 },
    recipe: [{ ingredientId: egg.id, qty: 1, unit: 'pcs' }, { ingredientId: paste.id, qty: 30, unit: 'g' }],
    prices: [{ channelId: ch[2].id, price: 120 }] });
  return Object.assign(api, { ch, shrimp, egg, oil, paste, dish });
}

test('humanQty switches units at sensible boundaries', () => {
  assert.deepEqual(C.humanQty(1500, 'g'), { qty: 1.5, unit: 'kg' });
  assert.deepEqual(C.humanQty(0.25, 'kg'), { qty: 250, unit: 'g' });
  assert.deepEqual(C.humanQty(1200, 'ml'), { qty: 1.2, unit: 'l' });
  assert.deepEqual(C.humanQty(0.03, 'l'), { qty: 30, unit: 'ml' });
  assert.deepEqual(C.humanQty(3, 'pcs'), { qty: 3, unit: 'pcs' });
  assert.deepEqual(C.humanQty(2.5, 'bottle'), { qty: 2.5, unit: 'bottle' });
  assert.deepEqual(C.humanQty(1 / 3, 'pcs'), { qty: 0.333, unit: 'pcs' });
});

test('allergensFor follows preps and survives a cycle', () => {
  const book = C.buildBook([
    { id: 'a', kind: 'raw', allergens: ['milk'] },
    { id: 'p', kind: 'prep', allergens: [], prepLines: [{ ingredientId: 'a' }, { ingredientId: 'q' }] },
    { id: 'q', kind: 'prep', allergens: ['sesame', 'gluten'], prepLines: [{ ingredientId: 'p' }] },
  ]);
  assert.deepEqual(C.allergensFor([{ ingredientId: 'p' }], book), ['gluten', 'milk', 'sesame']);
  assert.equal(C.ALLERGENS.length, 14);
});

test('allergens are stored on ingredients and derived for preps and dishes', () => {
  const { as, paste, dish } = setup();
  const lv = as('stock.levels', {});
  assert.deepEqual(lv.find((i) => i.name === 'Shrimp').allergens, ['crustaceans']);
  const p = lv.find((i) => i.id === paste.id);
  assert.deepEqual(p.allergens, ['soy']);
  assert.deepEqual(p.allergensAll, ['crustaceans', 'soy']);
  assert.deepEqual(as('bootstrap', {}).menu.find((m) => m.id === dish.id).allergens, ['crustaceans', 'eggs', 'soy']);
  assert.match(code(() => as('ingredients.save', { item: { name: 'X', unit: 'kg', costPerUnit: 1, minLevel: 0, allergens: ['pollen'] } })), /Unknown allergen\./);
});

test('sop.save on a dish changes only its SOP', () => {
  const { as, asStaff, ch, dish } = setup();
  const before = as('bootstrap', {}).menu.find((m) => m.id === dish.id);
  const r = as('sop.save', { ownerId: dish.id, version: before.version,
    notes: { portionNote: 'Plate on a warm dish', holdingNote: 'Serve within 5 minutes', equipment: 'Wok', prepMinutes: 4, photoUrl: 'https://example.com/a.jpg' },
    steps: [{ text: 'Heat the wok', minutes: 1 }, { text: 'Cook egg to 75 °C', critical: true }] });
  assert.equal(r.version, before.version + 1);
  const after = as('bootstrap', {}).menu.find((m) => m.id === dish.id);
  assert.equal(after.price, 100);
  assert.equal(after.recipe.length, 2);
  assert.equal(after.prices[ch[2].id], 120);
  assert.equal(after.portionNote, 'Plate on a warm dish');
  assert.equal(after.prepMinutes, 4);
  const steps = asStaff('sop.list', {})[dish.id];
  assert.deepEqual(steps.map((s) => [s.stepNo, s.text, s.critical]), [[1, 'Heat the wok', false], [2, 'Cook egg to 75 °C', true]]);
  assert.match(code(() => as('sop.save', { ownerId: dish.id, version: before.version, steps: [] })), /^CONFLICT/);
  assert.match(code(() => asStaff('sop.save', { ownerId: dish.id, version: after.version, steps: [] })), /^FORBIDDEN/);
});

test('sop.save validation', () => {
  const { as, egg, paste, dish } = setup();
  const v = () => as('bootstrap', {}).menu.find((m) => m.id === dish.id).version;
  assert.match(code(() => as('sop.save', { ownerId: dish.id, version: v(), steps: [{ text: ' ' }] })), /Step 1: write what to do\./);
  assert.match(code(() => as('sop.save', { ownerId: dish.id, version: v(), steps: Array(41).fill({ text: 'x' }) })), /Too many steps \(max 40\)\./);
  assert.match(code(() => as('sop.save', { ownerId: dish.id, version: v(), steps: [{ text: 'x', imageUrl: 'ftp://x' }] })), /Image link must start with http:\/\/ or https:\/\/\./);
  assert.match(code(() => as('sop.save', { ownerId: dish.id, version: v(), notes: { photoUrl: 'javascript:alert(1)' }, steps: [] })), /Image link must start/);
  assert.match(code(() => as('sop.save', { ownerId: dish.id, version: v(), steps: [{ text: 'x', minutes: 1.5 }] })), /Step 1 minutes must be a whole number\./);
  assert.match(code(() => as('sop.save', { ownerId: egg.id, version: 1, steps: [] })), /Only dishes and preps have an SOP\./);
  const lv = as('stock.levels', {}).find((i) => i.id === paste.id);
  assert.equal(code(() => as('sop.save', { ownerId: paste.id, version: lv.version, steps: [{ text: 'Blend' }] })), 'OK');
});

test('SOP messages translate fully to Thai', () => {
  ['Unknown allergen.', 'Step 3: write what to do.', 'Too many steps (max 40).', 'Image link must start with http:// or https://.',
    'Only dishes and preps have an SOP.', 'Step 2 minutes must be a whole number.', 'Prep time (minutes) must be a whole number.'].forEach((m) => {
    const out = RestoCore.translate(m, 'th');
    assert.equal(out.replace(/https?:\/\//g, '').replace(/[^A-Za-z]+/g, ' ').trim(), '', m + ' -> ' + out);
  });
});
