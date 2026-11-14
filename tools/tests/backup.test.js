'use strict';
const { makeApi, test, testAsync, pglite, assert } = require('../test_core.js');

const TODAY = '2026-11-13';
function code(fn) { try { fn(); } catch (e) { return e.code + ': ' + e.message; } return 'OK'; }
const backupTask = (s) => s.tasks.find((t) => t.kind === 'backup');

function withData() {
  const api = makeApi();
  api.as('ingredients.save', { item: { name: 'Rice', unit: 'kg', costPerUnit: 30, minLevel: 1 } });
  return api;
}

test('backup: the owner downloads every table, without passwords', () => {
  const { as } = withData();
  const b = as('backup.export', { today: TODAY });
  assert.equal(b.format, 'restaurant-ops-backup');
  assert.equal(b.version, global.RestoCore.VERSION);
  assert.ok(b.exportedAt);
  assert.deepEqual(Object.keys(b.tables).sort(), Object.keys(global.RestoCore.SCHEMA).sort());
  assert.equal(b.tables.Ingredients[0].name, 'Rice');
  assert.ok(b.tables.Users.length >= 2);
  b.tables.Users.forEach((u) => { assert.equal(u.passwordHash, ''); assert.equal(u.salt, ''); });
  assert.deepEqual(b.counts.Ingredients, 1);
});

test('backup: only the owner can download it', () => {
  const { asStaff } = withData();
  assert.match(code(() => asStaff('backup.export', { today: TODAY })), /^FORBIDDEN/);
});

test('backup: the owner is reminded after a month without a backup', () => {
  const { as } = makeApi();
  assert.equal(backupTask(as('today.summary', { today: TODAY })), undefined, 'nothing to back up yet');
  as('ingredients.save', { item: { name: 'Rice', unit: 'kg', costPerUnit: 30, minLevel: 1 } });
  const never = backupTask(as('today.summary', { today: TODAY }));
  assert.deepEqual(never, { kind: 'backup', n: 1, days: null });
  as('backup.export', { today: TODAY });
  assert.equal(backupTask(as('today.summary', { today: TODAY })), undefined);
  assert.equal(backupTask(as('today.summary', { today: '2026-12-12' })), undefined, '29 days: not yet');
  assert.deepEqual(backupTask(as('today.summary', { today: '2026-12-13' })), { kind: 'backup', n: 1, days: 30 });
  const boot = as('bootstrap', {});
  assert.equal(boot.settings.lastBackupDate, TODAY);
  assert.ok(boot.settings.lastBackupAt);
});

test('backup: staff and managers never see the reminder', () => {
  const { asStaff } = withData();
  assert.equal(backupTask(asStaff('today.summary', { today: TODAY })), undefined);
});

testAsync('backup: restoring into an empty database brings everything back', async () => {
  const S = require('../pg_schema.js');
  const H = require('../../server/handler.js');
  const { as } = withData();
  as('suppliers.save', { item: { name: 'Fresh Co' } });
  as('expenses.add', { date: TODAY, category: 'Gas', amount: 300 });
  const b = JSON.parse(JSON.stringify(as('backup.export', { today: TODAY })));

  const pg = await pglite();
  await pg.db.exec(S.buildSql(global.RestoCore.SCHEMA, global.RestoCore.TEXT_COLUMNS));
  const deps = { transaction: pg.transaction, uuid: () => require('crypto').randomUUID(), now: () => new Date() };
  const r = await H.restoreBackup(deps, b);
  assert.equal(r.rows, Object.values(b.tables).reduce((a, rows) => a + rows.length, 0));
  const names = (await pg.query('select "name" from "Suppliers"')).map((x) => x.name);
  assert.deepEqual(names, ['Fresh Co']);
  assert.equal(Number((await pg.query('select "amount" from "Expenses"'))[0].amount), 300);

  // The owner then sets a new password and signs in; restoring twice is refused.
  await H.resetOwnerPassword(deps, 'back1234');
  assert.equal((await H.handleRequest({ action: 'auth.login', payload: { username: 'owner', password: 'back1234' } }, deps)).ok, true);
  await assert.rejects(() => H.restoreBackup(deps, b), /not empty/);
  await assert.rejects(() => H.restoreBackup(deps, { format: 'something else' }), /not a Restaurant Ops backup/);
  await pg.db.close();
});
