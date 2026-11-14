'use strict';
// A full trading day exercised through the API, used to compare stores (memory vs Postgres).
// call(action, payload) → data (sync or async); throws on an error reply.
const DAY = '2026-11-13';

async function runScriptedDay(call) {
  const c = async (a, p) => call(a, p);
  await c('settings.save', { values: { restaurantName: 'Test Kitchen', targetFoodCostPct: '32', foodBudget: '' } });
  const chans = (await c('bootstrap', {})).channels;
  const dine = chans[0];
  const grab = await c('channels.save', { item: { name: 'Grab', type: 'delivery', commissionPct: 30, packagingCost: 5 } });

  const supA = await c('suppliers.save', { item: { name: 'Fresh Market', phone: '0812345678', leadTimeDays: 1, paymentTermsDays: 7 } });
  const supB = await c('suppliers.save', { item: { name: 'Dry Goods Co' } });
  const ing = async (name, extra) => c('ingredients.save', { item: Object.assign({ name, unit: 'kg', costPerUnit: 50, minLevel: 1 }, extra) });
  const rice = await ing('Rice', { costPerUnit: 30, supplierId: supB.id, code: 'DR-001', parLevel: 10 });
  const pork = await ing('Pork', { costPerUnit: 140, supplierId: supA.id, yieldPct: 90 });
  const egg = await ing('Egg', { unit: 'pcs', costPerUnit: 4, supplierId: supA.id, minLevel: 12 });
  const oil = await ing('Oil', { unit: 'L', costPerUnit: 60, supplierId: supB.id, allergens: [] });
  const chilli = await ing('Chilli', { costPerUnit: 80, supplierId: supA.id });
  const sauce = await c('ingredients.save', { item: { name: 'Chilli oil', unit: 'L', costPerUnit: 0, minLevel: 0.5, kind: 'prep', batchQty: 2, trackStock: true },
    prepRecipe: [{ ingredientId: oil.id, qty: 1.8, unit: 'L' }, { ingredientId: chilli.id, qty: 0.3, unit: 'kg' }] });

  // Opening stock and a delivery from a purchase order.
  await c('movements.add', { date: DAY, type: 'adjustment', reason: 'opening', lines: [rice, pork, egg, oil, chilli].map((i) => ({ ingredientId: i.id, qty: 20 })) });
  const po = await c('po.save', { item: { supplierId: supA.id, orderDate: DAY, expectedDate: DAY },
    lines: [{ ingredientId: pork.id, qtyOrdered: 5, unitPrice: 145 }, { ingredientId: egg.id, qtyOrdered: 60, unitPrice: 4.2 }] });
  await c('po.send', { id: po.id });
  const sent = await c('po.get', { id: po.id });
  await c('po.receive', { poId: po.id, date: DAY, deliveryRef: 'DN-1', lines: sent.lines.map((l, i) => ({ poLineId: l.id, qty: i === 0 ? 4 : l.qtyOrdered, unitPrice: l.unitPrice })) });
  await c('po.close', { id: po.id, reason: 'Supplier short' });
  const inv = await c('invoices.save', { item: { supplierId: supA.id, poId: po.id, invoiceNo: 'FM-100', invoiceDate: DAY },
    lines: [{ ingredientId: pork.id, qty: 4, unitPrice: 150 }, { ingredientId: egg.id, qty: 60, unitPrice: 4.2 }] });
  if (inv.status !== 'approved' && inv.status !== 'matched') await c('invoices.approve', { id: inv.id, note: 'Price rise agreed' });
  await c('invoices.pay', { id: inv.id, date: DAY, method: 'Transfer', reference: 'TRF100' });
  await c('purchases.add', { date: DAY, supplierId: supB.id, lines: [{ ingredientId: rice.id, qty: 10, unitCost: 32 }] });

  // Menu, channel price, a production run, a promotion and sales.
  const fried = await c('menu.save', { item: { name: 'Fried rice', price: 80 },
    recipe: [{ ingredientId: rice.id, qty: 0.2, unit: 'kg' }, { ingredientId: egg.id, qty: 1, unit: 'pcs' }, { ingredientId: sauce.id, qty: 0.02, unit: 'L' }] });
  const krapow = await c('menu.save', { item: { name: 'Pork krapow', price: 90 }, recipe: [{ ingredientId: pork.id, qty: 0.15, unit: 'kg' }, { ingredientId: rice.id, qty: 0.2, unit: 'kg' }] });
  await c('menu.applyPrices', { channelId: grab.id, items: [{ menuItemId: fried.id, price: 99 }] });
  await c('production.add', { date: DAY, prepId: sauce.id, batches: 1, producedQty: 1.9 });
  const promo = await c('promotions.save', { item: { name: 'Grab 20', type: 'percentOff', value: 20, channelIds: [grab.id],
    startDate: '2026-11-10', endDate: '2026-11-20', weekdays: [], platformFundedPct: 50, draft: false }, items: [{ menuItemId: krapow.id }] });
  await c('sales.add', { date: DAY, channelId: dine.id, lines: [{ menuItemId: fried.id, qty: 12 }, { menuItemId: krapow.id, qty: 8 }] });
  await c('sales.add', { date: DAY, channelId: grab.id, lines: [{ menuItemId: fried.id, qty: 5 }, { menuItemId: krapow.id, qty: 3, promoId: promo.id }] });

  // End of day: waste, count, expense, close.
  await c('movements.add', { date: DAY, type: 'waste', reason: 'Dropped', lines: [{ ingredientId: egg.id, qty: 2 }] });
  await c('movements.add', { date: DAY, type: 'count', reason: '', lines: [{ ingredientId: rice.id, qty: 24 }] });
  await c('expenses.add', { date: DAY, category: 'Gas', amount: 450, paymentMethod: 'Cash' });
  await c('day.close', { date: DAY, today: DAY, note: 'Gas low' });
  // A correction: rename a supplier (versioned update).
  await c('suppliers.save', { item: Object.assign({}, supB, { name: 'Dry Goods Company' }) });

  // Corrections and look-ups: a cancelled order, a disputed bill, voided entries, history lists.
  const rows = (x) => (Array.isArray(x) ? x : x.rows);
  await c('po.list', {});
  const po2 = await c('po.save', { item: { supplierId: supB.id, orderDate: DAY }, lines: [{ ingredientId: rice.id, qtyOrdered: 5, unitPrice: 31 }] });
  await c('po.cancel', { id: po2.id, reason: 'Ordered twice' });
  const inv2 = await c('invoices.save', { item: { supplierId: supB.id, invoiceNo: 'DG-7', invoiceDate: DAY }, lines: [{ ingredientId: rice.id, qty: 2, unitPrice: 31 }] });
  await c('invoices.list', {});
  await c('invoices.get', { id: inv2.id });
  await c('invoices.dispute', { id: inv2.id, note: 'Not delivered' });
  await c('sales.void', { id: rows(await c('sales.list', { from: DAY, to: DAY }))[0].id, reason: 'Wrong channel' });
  const manual = rows(await c('purchases.list', { from: DAY, to: DAY })).filter((p) => !p.poId);
  await c('purchases.void', { id: manual[0].id, reason: 'Entered twice' });
  await c('movements.list', { from: DAY, to: DAY, includeSales: true });
  await c('expenses.void', { id: rows(await c('expenses.list', { from: DAY, to: DAY }))[0].id, reason: 'Wrong amount' });

  // The owner changes their password and signs out (last: the token stops working).
  await c('auth.changePassword', { current: 'test1234', next: 'newpass123' });
  await c('auth.logout', {});
}

module.exports = { runScriptedDay, DAY };
