// Datos de ejemplo deterministas para los tests (identificadores fijos y legibles).
import { SCHEMA_VERSION, normalizeSettings } from '../app/js/core/model.js';

export function sampleState() {
  return {
    version: SCHEMA_VERSION,
    settings: normalizeSettings({}),
    accounts: [
      { id: 'accountAAA', name: 'Banco A', type: 'bank', icon: 'building-bank', letters: 'BA', color: 'blue', initial: 100000, includeInTotal: true, archived: false, order: 0 },
      { id: 'accountBBB', name: 'Efectivo', type: 'cash', icon: 'cash', letters: '', color: 'green', initial: 0, includeInTotal: true, archived: false, order: 1 },
      { id: 'accountCCC', name: 'Inversión', type: 'investment', icon: 'chart-line', letters: '', color: 'purple', initial: 50000, includeInTotal: false, archived: false, order: 2 },
    ],
    categories: [
      { id: 'catFoodXX', kind: 'expense', name: 'Comida', icon: 'shopping-cart', color: 'teal', archived: false, order: 0 },
      { id: 'catFunXXX', kind: 'expense', name: 'Ocio', icon: 'movie', color: 'pink', archived: false, order: 1 },
      { id: 'catSalary', kind: 'income', name: 'Nómina', icon: 'briefcase', color: 'green', archived: false, order: 2 },
    ],
    debts: [
      { id: 'debtOweXX', kind: 'owe', name: 'Hermano', note: '', dueDate: null },
      { id: 'debtOwedX', kind: 'owed', name: 'Laura', note: 'Cena', dueDate: '2026-12-01' },
    ],
    budgets: [
      { id: 'budgetTot', categoryId: null, amount: 10000 },
      { id: 'budgetFun', categoryId: 'catFunXXX', amount: 1500 },
    ],
    recurring: [],
    movements: [
      { id: 'mov00001', date: '2026-09-10', type: 'expense', amount: 5000, accountId: 'accountAAA', categoryId: 'catFoodXX', note: '', ts: 1 },
      { id: 'mov00002', date: '2026-10-01', type: 'income', amount: 200000, accountId: 'accountAAA', categoryId: 'catSalary', note: 'Octubre', ts: 2 },
      { id: 'mov00003', date: '2026-10-02', type: 'transfer', amount: 10000, accountId: 'accountAAA', toAccountId: 'accountBBB', note: '', ts: 3 },
      { id: 'mov00004', date: '2026-10-03', type: 'debt', amount: 30000, debtId: 'debtOweXX', flow: 'add', accountId: 'accountAAA', note: '', ts: 4 },
      { id: 'mov00005', date: '2026-10-04', type: 'debt', amount: 10000, debtId: 'debtOweXX', flow: 'pay', accountId: 'accountAAA', note: '', ts: 5 },
      { id: 'mov00006', date: '2026-10-05', type: 'debt', amount: 4000, debtId: 'debtOwedX', flow: 'add', accountId: 'accountBBB', note: '', ts: 6 },
      { id: 'mov00007', date: '2026-10-06', type: 'debt', amount: 1500, debtId: 'debtOwedX', flow: 'pay', accountId: null, note: '', ts: 7 },
      { id: 'mov00008', date: '2026-10-07', type: 'expense', amount: 2000, accountId: 'accountCCC', categoryId: 'catFunXXX', note: '', ts: 8 },
    ],
    connections: [],
    rules: [],
  };
}
