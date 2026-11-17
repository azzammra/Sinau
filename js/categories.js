// ============================================================================
// js/categories.js — Custom Category Management & Safe Historical Migration
// ============================================================================
const TRANSFER_CATEGORY = {
  id: 'transfer_internal',
  name: 'Transfer Antar Akun',
  type: 'transfer',
  color: '#94a3b8',
  badgeBg: 'bg-slate-500/15 text-slate-600 dark:text-slate-300'
};

const findCategoryMeta = (catId, categoriesList) => {
  if (catId === 'transfer_internal') return TRANSFER_CATEGORY;
  const found = (categoriesList || []).find((c) => c.id === catId);
  if (found) return found;
  return {
    id: catId || 'lainnya_keluar',
    name: catId || 'Lainnya',
    type: 'expense',
    color: '#64748b',
    badgeBg: 'bg-slate-500/15 text-slate-600 dark:text-slate-400'
  };
};

// Reassigns transactions from oldCategoryId to replacementCategoryId so deleting a category never corrupts records
const reassignCategoryInTransactions = (transactionsList, oldCategoryId, replacementCategoryId) => {
  return (transactionsList || []).map((tx) =>
    tx.category === oldCategoryId ? { ...tx, category: replacementCategoryId } : tx
  );
};
