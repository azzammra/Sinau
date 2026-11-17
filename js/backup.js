// ============================================================================
// js/backup.js — Versioned JSON Backup, Pre-Import Validation & Safe Merge/Replace
// ============================================================================
const validateBackupPayload = (rawJsonText) => {
  try {
    const parsed = typeof rawJsonText === 'string' ? JSON.parse(rawJsonText) : rawJsonText;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.transactions)) {
      return { valid: false, error: 'Struktur JSON tidak memiliki array transactions yang valid.' };
    }
    return {
      valid: true,
      payload: parsed,
      summary: {
        version: parsed.version || 'Legacy v1/v2',
        exportedAt: parsed.exportedAt || '-',
        transactionsCount: (parsed.transactions || []).length,
        accountsCount: (parsed.accounts || []).length,
        categoriesCount: (parsed.categories || []).length,
        budgetsCount: (parsed.budgets || []).length,
        receiptsCount: (parsed.receipts || []).length,
        savingsCount: (parsed.savings || []).length,
        investmentsCount: (parsed.investments || []).length,
        rolloverCount: (parsed.rollover_records || []).length
      }
    };
  } catch (err) {
    return { valid: false, error: 'Berkas bukan format JSON yang valid.' };
  }
};

const mergeRecordArraysById = (existingArr, importedArr) => {
  const map = new Map();
  (existingArr || []).forEach((item) => {
    if (item && item.id) map.set(item.id, item);
  });
  (importedArr || []).forEach((item) => {
    if (item && item.id) map.set(item.id, item);
  });
  return Array.from(map.values());
};
