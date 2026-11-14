/**
 * Column types for the Postgres store. Every column is text unless listed here; dates and
 * timestamps stay text (YYYY-MM-DD / ISO) because the business rules compare them as strings.
 * Shared by tools/pg_schema.js (migration), server/pg.js (load/save) and the Edge Function.
 */
var RestoPgTypes = (function () {
  'use strict';
  var COLUMN_TYPES = {};
  [
    'amount', 'batchQty', 'batches', 'byproductValue', 'campaignCommissionPct', 'commission', 'commissionPct',
    'costPerUnit', 'costTotal', 'countLines', 'discount', 'exceptionCount', 'expectedQty', 'factor', 'inputCost',
    'leadTimeDays', 'listPrice', 'minLevel', 'minutes', 'newCost', 'oldCost', 'packagingCost', 'parLevel',
    'paymentTermsDays', 'platformDiscount', 'platformFundedPct', 'prepMinutes', 'price', 'producedQty', 'qty',
    'qtyOrdered', 'salesTotal', 'shelfLifeDays', 'sortOrder', 'stepNo', 'subtotal', 'total', 'totalCost', 'unitCost',
    'unitPrice', 'varianceAmount', 'vat', 'version', 'wasteValue', 'yieldPct'
  ].forEach(function (c) { COLUMN_TYPES[c] = 'numeric'; });
  ['active', 'voided', 'trackStock', 'critical', 'commissionOnDiscounted'].forEach(function (c) { COLUMN_TYPES[c] = 'boolean'; });

  /** "value" is text in Settings but a number in these tables. */
  var TABLE_TYPES = {
    StockMovements: { value: 'numeric' },
    Promotions: { value: 'numeric' }
  };

  function typeOf(table, column) {
    return (TABLE_TYPES[table] && TABLE_TYPES[table][column]) || COLUMN_TYPES[column] || 'text';
  }
  function keyOf(table) { return table === 'Settings' ? 'key' : 'id'; }

  return { COLUMN_TYPES: COLUMN_TYPES, TABLE_TYPES: TABLE_TYPES, typeOf: typeOf, keyOf: keyOf };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RestoPgTypes;
