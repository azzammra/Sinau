// ============================================================================
// js/accounts.js — Account Management & Safe Deletion Checks
// ============================================================================
const canDeleteAccountSafely = (accountId, transactionsList) => {
  const usedCount = (transactionsList || []).filter(
    (tx) => tx.account === accountId || tx.toAccount === accountId
  ).length;
  return { safe: usedCount === 0, usedCount };
};
