// ============================================================================
// js/database.js — IndexedDB v3 Persistence Engine & Safe Schema Migration
// ============================================================================
const DB_NAME = 'PocketLedgerDB_v1';
const DB_VERSION = 3;
const APP_VERSION = '3.0.0-PWA';
const LS_FALLBACK_KEY = 'PocketLedger_LocalStorage_Mirror_v3';

const ALL_DB_STORES = [
  'transactions',
  'accounts',
  'categories',
  'budgets',
  'receipts',
  'savings',
  'investments',
  'settings',
  'rollover_records'
];

const DEFAULT_ACCOUNTS = [
  { id: 'tunai', name: 'Dompet Tunai', type: 'cash', initialBalance: 0, color: '#10b981', isSystem: true },
  { id: 'ewallet', name: 'E-Wallet / QRIS', type: 'ewallet', initialBalance: 0, color: '#14b8a6', isSystem: true },
  { id: 'bank', name: 'Rekening Bank Utama', type: 'bank', initialBalance: 750000, color: '#0ea5e9', isSystem: true },
  { id: 'tabungan_mandiri', name: 'Rekening Tabungan Khusus', type: 'savings', initialBalance: 500000, color: '#8b5cf6', isSystem: false }
];

const DEFAULT_CATEGORIES = [
  { id: 'makanan', name: 'Makan & Minum', type: 'expense', color: '#10b981', badgeBg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', isDefault: true },
  { id: 'transportasi', name: 'Transportasi', type: 'expense', color: '#14b8a6', badgeBg: 'bg-teal-500/15 text-teal-600 dark:text-teal-400', isDefault: true },
  { id: 'akademik', name: 'Akademik & Buku', type: 'expense', color: '#0ea5e9', badgeBg: 'bg-sky-500/15 text-sky-600 dark:text-sky-400', isDefault: true },
  { id: 'tagihan', name: 'Kos, Listrik & Kuota', type: 'expense', color: '#6366f1', badgeBg: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400', isDefault: true },
  { id: 'kebutuhan', name: 'Belanja Harian', type: 'expense', color: '#f59e0b', badgeBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', isDefault: true },
  { id: 'hiburan', name: 'Hiburan & Hobi', type: 'expense', color: '#ec4899', badgeBg: 'bg-pink-500/15 text-pink-600 dark:text-pink-400', isDefault: true },
  { id: 'kesehatan', name: 'Kesehatan & Darurat', type: 'expense', color: '#ef4444', badgeBg: 'bg-rose-500/15 text-rose-600 dark:text-rose-400', isDefault: true },
  { id: 'lainnya_keluar', name: 'Lainnya (Pengeluaran)', type: 'expense', color: '#64748b', badgeBg: 'bg-slate-500/15 text-slate-600 dark:text-slate-400', isDefault: true },
  { id: 'uang_saku', name: 'Uang Saku Bulanan', type: 'income', color: '#10b981', badgeBg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', isDefault: true },
  { id: 'freelance', name: 'Freelance & Proyek', type: 'income', color: '#0d9488', badgeBg: 'bg-teal-500/15 text-teal-600 dark:text-teal-400', isDefault: true },
  { id: 'beasiswa', name: 'Beasiswa & Lomba', type: 'income', color: '#0284c7', badgeBg: 'bg-sky-500/15 text-sky-600 dark:text-sky-400', isDefault: true },
  { id: 'bonus', name: 'Kiriman / Hadiah', type: 'income', color: '#8b5cf6', badgeBg: 'bg-violet-500/15 text-violet-600 dark:text-violet-400', isDefault: true },
  { id: 'lainnya_masuk', name: 'Pemasukan Lain', type: 'income', color: '#64748b', badgeBg: 'bg-slate-500/15 text-slate-600 dark:text-slate-400', isDefault: true }
];

const DEFAULT_SAVINGS_GOALS = [
  {
    id: 'sav_laptop_upgrade',
    name: 'Dana Darurat & Upgrade Perangkat Belajar',
    targetAmount: 3500000,
    initialSaved: 500000,
    monthlyContributionTarget: 300000,
    linkedAccountId: 'tabungan_mandiri',
    createdAt: '2026-11-01'
  }
];

const DEFAULT_INVESTMENTS = [
  {
    id: 'inv_reksadana_pasar_uang',
    name: 'Simulasi Reksa Dana Pasar Uang / Deposito Mahasiswa',
    initialCapital: 1000000,
    monthlyContribution: 200000,
    annualReturnRatePct: 5.5,
    durationMonths: 24
  }
];

const DEFAULT_ROLLOVER_RECORDS = [
  {
    id: '2026-11',
    sourceMonth: '2026-11',
    allocatedToSavings: 200000,
    allocatedToInvestments: 0,
    retainedForNextMonth: 215000,
    linkedTransferTxId: null,
    updatedAt: '2026-10-31T23:59:00.000Z'
  }
];

const openPocketLedgerDB = () => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB tidak tersedia'));
      return;
    }
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        ALL_DB_STORES.forEach((storeName) => {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: 'id' });
          }
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
};

const migrateToV3Schema = (rawBundle = {}) => {
  const defaultTaxConfig = {
    mode: 'pph21',
    grossMonthlyIncome: 8000000,
    ptkpAnnual: 54000000,
    deductionPct: 5,
    umkmMonthlyTurnover: 45000000,
    umkmRatePct: 0.5,
    zakatMonthlyIncome: 6000000,
    zakatDeductibleNeeds: 1500000,
    goldPricePerGram: 1400000,
    nisabGoldGrams: 85,
    zakatRatePct: 2.5
  };
  const defaultLoanConfig = {
    principal: 12000000,
    annualInterestRatePct: 9.0,
    durationMonths: 12,
    method: 'effective'
  };

  const rawSettings = Array.isArray(rawBundle.settings) ? rawBundle.settings[0] : rawBundle.settings;
  const settings = {
    ...INITIAL_SETTINGS,
    ...(rawSettings || {}),
    id: 'app_settings',
    taxConfig: { ...defaultTaxConfig, ...(rawSettings?.taxConfig || {}) },
    loanConfig: { ...defaultLoanConfig, ...(rawSettings?.loanConfig || {}) },
    schemaVersion: 3
  };

  const accounts =
    Array.isArray(rawBundle.accounts) && rawBundle.accounts.length > 0
      ? rawBundle.accounts.map((a) => ({ ...a, initialBalance: toIntIDR(a.initialBalance) }))
      : DEFAULT_ACCOUNTS.map((a) =>
          a.id === 'bank'
            ? { ...a, initialBalance: toIntIDR(settings.startingBalance ?? 750000) }
            : { ...a }
        );

  const categories =
    Array.isArray(rawBundle.categories) && rawBundle.categories.length > 0
      ? rawBundle.categories
      : [...DEFAULT_CATEGORIES];

  const transactions =
    Array.isArray(rawBundle.transactions) && rawBundle.transactions.length > 0
      ? rawBundle.transactions.map((t, i) => ({
          ...t,
          id: t.id || `tx_mig_${i}_${Date.now()}`,
          amount: toIntIDR(t.amount),
          account: t.account || 'tunai',
          toAccount: t.type === 'transfer' ? t.toAccount || 'ewallet' : null
        }))
      : [...INITIAL_TRANSACTIONS];

  const budgets =
    Array.isArray(rawBundle.budgets) && rawBundle.budgets.length > 0
      ? rawBundle.budgets.map((b) => ({
          ...b,
          budgetType: b.budgetType || 'monthly_once',
          monthlyAllowance: toIntIDR(b.monthlyAllowance),
          monthlySpendingBudget: toIntIDR(b.monthlySpendingBudget)
        }))
      : [...INITIAL_BUDGETS];

  if (!budgets.some((b) => b.budgetType === 'permanent')) {
    budgets.push({
      id: 'budget_perm_default',
      budgetType: 'permanent',
      effectiveFrom: '2026-11',
      month: '2026-11',
      monthlyAllowance: 1800000,
      monthlySpendingBudget: 1500000,
      weeklyAllocations: {},
      categoryBudgets: { ...INITIAL_BUDGETS[0].categoryBudgets },
      updatedAt: '2026-01-01T00:00:00.000Z'
    });
  }

  const receipts =
    Array.isArray(rawBundle.receipts) && rawBundle.receipts.length > 0
      ? rawBundle.receipts
      : [...INITIAL_RECEIPTS];

  const savings =
    Array.isArray(rawBundle.savings) && rawBundle.savings.length > 0
      ? rawBundle.savings
      : [...DEFAULT_SAVINGS_GOALS];

  const investments =
    Array.isArray(rawBundle.investments) && rawBundle.investments.length > 0
      ? rawBundle.investments
      : [...DEFAULT_INVESTMENTS];

  const rollover_records =
    Array.isArray(rawBundle.rollover_records) && rawBundle.rollover_records.length > 0
      ? rawBundle.rollover_records
      : [...DEFAULT_ROLLOVER_RECORDS];

  return {
    settings,
    accounts,
    categories,
    transactions,
    budgets,
    receipts,
    savings,
    investments,
    rollover_records
  };
};
