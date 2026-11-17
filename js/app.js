// ============================================================================
// js/app.js — Main Application State, UI Renderer & Event Controllers (v3.0)
// ============================================================================

const state = {
  activeTab: 'dashboard', // 'dashboard' | 'scan' | 'transactions' | 'analytics' | 'settings'
  moreSubTab: 'budgets',  // 'budgets' | 'savings' | 'investments' | 'loans' | 'tax' | 'entities' | 'backup' | 'about'
  storageStatus: 'IndexedDB v3 (9 Store Lokal Aktif)',
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
  swUpdateAvailable: false,
  toast: null,
  // Core DB Collections
  settings: { ...INITIAL_SETTINGS },
  accounts: [...DEFAULT_ACCOUNTS],
  categories: [...DEFAULT_CATEGORIES],
  transactions: [...INITIAL_TRANSACTIONS],
  budgets: [...INITIAL_BUDGETS],
  receipts: [...INITIAL_RECEIPTS],
  savings: [...DEFAULT_SAVINGS_GOALS],
  investments: [...DEFAULT_INVESTMENTS],
  rollover_records: [...DEFAULT_ROLLOVER_RECORDS],
  // Filters
  searchQuery: '',
  filterMonthScope: 'active',
  filterType: 'all',
  filterCategory: 'all',
  filterAccount: 'all',
  // Analytics
  analyticsPeriod: 'daily', // 'daily' | 'weekly' | 'monthly' | 'annual'
  // Modals
  isTxModalOpen: false,
  editingTxId: null,
  txForm: {
    title: '', type: 'expense', category: 'makanan', amount: '',
    date: CURRENT_REAL_DATE, account: 'tunai', toAccount: 'ewallet', note: ''
  },
  deleteConfirmTarget: null,
  viewingReceiptModal: null,
  isResetModalOpen: false,
  isPwaGuideModalOpen: false,
  categoryDeleteModal: null, // { catId, catName, usedCount, replacementId }
  backupPreviewModal: null,  // { summary, payload }
  // Scanner & Local OCR
  rawUploadedImage: null,
  scannerImage: null,
  preprocessConfig: { rotation: 0, skew: 0, autoCrop: true, grayscale: true, contrast: 28, denoise: true },
  isOcrRunning: false,
  ocrInitRunning: false,
  ocrProgressText: '',
  ocrConfidence: null,
  ocrEngineUsed: 'Tesseract.js v5 (Lokal On-Device)',
  ocrExtracted: null,
  showRawOcrPanel: false,
  pendingRawSourceText: '',
  isCameraActive: false,
  cameraError: null
};

let activeChartInstances = [];
let cameraStream = null;
let deferredInstallPrompt = null;

// LocalStorage mirror for file:// fallback
const saveMirrorToLocalStorage = () => {
  try {
    localStorage.setItem(
      LS_FALLBACK_KEY,
      JSON.stringify({
        settings: state.settings,
        accounts: state.accounts,
        categories: state.categories,
        transactions: state.transactions,
        budgets: state.budgets,
        receipts: state.receipts,
        savings: state.savings,
        investments: state.investments,
        rollover_records: state.rollover_records
      })
    );
  } catch {}
};

const loadMirrorFromLocalStorage = () => {
  try {
    const raw = localStorage.getItem(LS_FALLBACK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const dbGetAll = async (storeName) => {
  try {
    const db = await openPocketLedgerDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    const mirror = loadMirrorFromLocalStorage();
    if (mirror && mirror[storeName]) {
      return Array.isArray(mirror[storeName]) ? mirror[storeName] : [mirror[storeName]];
    }
    return [];
  }
};

const dbPut = async (storeName, item) => {
  saveMirrorToLocalStorage();
  try {
    const db = await openPocketLedgerDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(item);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {}
};

const dbDelete = async (storeName, id) => {
  saveMirrorToLocalStorage();
  try {
    const db = await openPocketLedgerDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {}
};

const dbReplaceStore = async (storeName, items) => {
  saveMirrorToLocalStorage();
  try {
    const db = await openPocketLedgerDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.clear();
      (items || []).forEach((it) => store.put(it));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
};

// Centralized Accounting Snapshot
const computeMasterSnapshot = () => {
  const weekStartDay = state.settings.weekStartDay || 'monday';
  const activeMonth = state.settings.activeMonth;
  const calWeeks = getCalendarWeeksForMonth(activeMonth, weekStartDay);
  const monthBudget = resolveBudgetForMonth(activeMonth, state.budgets, state.categories, weekStartDay);

  const accountSummary = calculateAccountBalances(state.accounts, state.transactions);
  const rolloverChain = computeRolloverChain({
    targetMonth: activeMonth,
    budgetsList: state.budgets,
    transactionsList: state.transactions,
    rolloverRecordsList: state.rollover_records,
    categoriesList: state.categories,
    weekStartDay
  });
  const activeRollover = rolloverChain.activeMonthRollover;

  let monthlyIncome = 0;
  let monthlyExpenses = 0;
  const weeklySpending = {};
  const weeklyIncome = {};
  calWeeks.forEach((w) => {
    weeklySpending[w.weekNum] = 0;
    weeklyIncome[w.weekNum] = 0;
  });

  const categorySpending = {};
  state.categories.filter((c) => c.type === 'expense').forEach((c) => {
    categorySpending[c.id] = 0;
  });

  state.transactions.forEach((tx) => {
    const amt = toIntIDR(tx.amount);
    if (getMonthFromDate(tx.date) === activeMonth) {
      const wNum = getWeekOfMonth(tx.date, weekStartDay);
      if (tx.type === 'income') {
        monthlyIncome += amt;
        weeklyIncome[wNum] = (weeklyIncome[wNum] || 0) + amt;
      } else if (tx.type === 'expense') {
        monthlyExpenses += amt;
        weeklySpending[wNum] = (weeklySpending[wNum] || 0) + amt;
        const cKey = categorySpending[tx.category] !== undefined ? tx.category : 'lainnya_keluar';
        categorySpending[cKey] = (categorySpending[cKey] || 0) + amt;
      }
    }
  });

  const baseSpendingBudget = toIntIDR(monthBudget.monthlySpendingBudget);
  const effectiveSpendingBudget = activeRollover.totalEffectiveBudget;
  const remainingMonthlyBudget = effectiveSpendingBudget - monthlyExpenses;

  const maxWeek = calWeeks.length || 4;
  const currentWeekIndex = Math.min(maxWeek, Math.max(1, state.settings.activeWeek || 1));
  const currentWeeklySpending = weeklySpending[currentWeekIndex] || 0;
  const currentWeeklyAllocation = toIntIDR(monthBudget.weeklyAllocations?.[currentWeekIndex] || 0);
  const remainingWeeklyBudget = currentWeeklyAllocation - currentWeeklySpending;
  const totalWeeklyAllocated = calWeeks.reduce(
    (s, w) => s + toIntIDR(monthBudget.weeklyAllocations?.[w.weekNum] || 0),
    0
  );

  // Compute total savings across savings accounts + rollover savings allocations (without double-counting)
  const savingsAccountsTotal = state.accounts
    .filter((a) => a.type === 'savings')
    .reduce((s, a) => s + Math.max(0, toIntIDR(accountSummary.balances[a.id] || 0)), 0);

  // Only add un-transferred rollover savings so physical transfers to savings account are never double-counted
  const untransferredRolloverSavings = Object.values(rolloverChain.chainByMonth)
    .filter((r) => !r.linkedTransferTxId)
    .reduce((s, r) => s + toIntIDR(r.allocatedToSavings || 0), 0);

  const totalEffectiveSavings = savingsAccountsTotal + untransferredRolloverSavings;

  return {
    startingBalance: accountSummary.totalInitialBalance,
    totalAllTimeIncome: accountSummary.totalAllTimeIncome,
    totalAllTimeExpenses: accountSummary.totalAllTimeExpenses,
    currentBalance: accountSummary.totalCurrentCashBalance,
    accountBalances: accountSummary.balances,
    monthlyIncome,
    monthlyExpenses,
    monthlySpendingBudget: baseSpendingBudget,
    effectiveSpendingBudget,
    remainingMonthlyBudget,
    calWeeks,
    monthBudget,
    activeRollover,
    rolloverChain,
    savingsAccountsTotal,
    untransferredRolloverSavings,
    totalEffectiveSavings,
    weeklySpending,
    weeklyIncome,
    currentWeekIndex,
    currentWeeklySpending,
    currentWeeklyAllocation,
    remainingWeeklyBudget,
    totalWeeklyAllocated,
    categorySpending
  };
};

const showToast = (message, type = 'success') => {
  state.toast = { message, type };
  renderApp();
  setTimeout(() => {
    state.toast = null;
    renderApp();
  }, 3800);
};

// ============================================================================
// GLOBAL WINDOW CONTROLLERS
// ============================================================================
window.plSwitchTab = (tabId) => {
  if (state.activeTab === 'scan' && tabId !== 'scan') window.plStopCamera();
  state.activeTab = tabId;
  renderApp();
};

window.plSwitchMoreSubTab = (subTabId) => {
  state.moreSubTab = subTabId;
  renderApp();
};

window.plToggleTheme = async () => {
  const nextTheme = state.settings.theme === 'dark' ? 'light' : 'dark';
  state.settings.theme = nextTheme;
  document.documentElement.classList.toggle('dark', nextTheme === 'dark');
  await dbPut('settings', state.settings);
  renderApp();
};

window.plNavigateMonth = async (delta) => {
  if (delta < 0 && state.settings.activeMonth <= MIN_ALLOWED_MONTH) {
    showToast('Batas awal penggunaan aplikasi adalah November 2026.', 'error');
    return;
  }
  if (delta > 0 && state.settings.activeMonth >= MAX_ALLOWED_MONTH) {
    showToast('Batas akhir penggunaan aplikasi adalah November 2061.', 'error');
    return;
  }
  state.settings.activeMonth = shiftMonthKey(state.settings.activeMonth, delta);
  state.settings.activeWeek = 1;
  await dbPut('settings', state.settings);
  renderApp();
};

window.plSelectMonthPart = async (monthNum) => {
  const { year } = parseMonthParts(state.settings.activeMonth);
  state.settings.activeMonth = formatMonthKey(year, Number(monthNum));
  state.settings.activeWeek = 1;
  await dbPut('settings', state.settings);
  renderApp();
};

window.plSelectYearPart = async (yearNum) => {
  const { month } = parseMonthParts(state.settings.activeMonth);
  state.settings.activeMonth = formatMonthKey(Number(yearNum), month);
  state.settings.activeWeek = 1;
  await dbPut('settings', state.settings);
  renderApp();
};

window.plJumpCurrentMonth = async () => {
  state.settings.activeMonth = CURRENT_REAL_MONTH;
  state.settings.activeWeek = getWeekOfMonth(CURRENT_REAL_DATE, state.settings.weekStartDay);
  await dbPut('settings', state.settings);
  showToast(`Kembali ke periode saat ini: ${formatIndoMonth(CURRENT_REAL_MONTH)}`);
};

window.plSelectWeek = async (weekNum) => {
  state.settings.activeWeek = Number(weekNum);
  await dbPut('settings', state.settings);
  renderApp();
};

window.plSetWeekStartDay = async (val) => {
  state.settings.weekStartDay = val === 'sunday' ? 'sunday' : 'monday';
  await dbPut('settings', state.settings);
  showToast(`Hari awal minggu kalender diubah ke ${val === 'sunday' ? 'Minggu' : 'Senin'}.`);
};

// Transactions CRUD
window.plOpenAddTxModal = (type = 'expense') => {
  state.editingTxId = null;
  const defaultDate =
    state.settings.activeMonth === CURRENT_REAL_MONTH
      ? CURRENT_REAL_DATE
      : `${state.settings.activeMonth}-01`;
  const firstExpCat = state.categories.find((c) => c.type === 'expense')?.id || 'makanan';
  const firstIncCat = state.categories.find((c) => c.type === 'income')?.id || 'uang_saku';
  state.txForm = {
    title: '',
    type,
    category: type === 'income' ? firstIncCat : type === 'transfer' ? 'transfer_internal' : firstExpCat,
    amount: '',
    date: defaultDate,
    account: state.accounts[0]?.id || 'tunai',
    toAccount: state.accounts[1]?.id || 'ewallet',
    note: ''
  };
  state.isTxModalOpen = true;
  renderApp();
};

window.plOpenEditTxModal = (txId) => {
  const tx = state.transactions.find((t) => t.id === txId);
  if (!tx) return;
  state.editingTxId = tx.id;
  state.txForm = {
    title: tx.title,
    type: tx.type,
    category: tx.category,
    amount: String(toIntIDR(tx.amount)),
    date: tx.date,
    account: tx.account || 'tunai',
    toAccount: tx.toAccount || 'ewallet',
    note: tx.note || ''
  };
  state.isTxModalOpen = true;
  renderApp();
};

window.plCloseTxModal = () => { state.isTxModalOpen = false; renderApp(); };

window.plSetTxFormType = (type) => {
  const firstExpCat = state.categories.find((c) => c.type === 'expense')?.id || 'makanan';
  const firstIncCat = state.categories.find((c) => c.type === 'income')?.id || 'uang_saku';
  state.txForm.type = type;
  state.txForm.category = type === 'income' ? firstIncCat : type === 'transfer' ? 'transfer_internal' : firstExpCat;
  renderApp();
};

window.plUpdateTxField = (field, val) => { state.txForm[field] = val; };

window.plSubmitTxForm = async (e) => {
  if (e) e.preventDefault();
  const cleanAmount = toIntIDR(state.txForm.amount);
  if (!state.txForm.title.trim() || cleanAmount <= 0) {
    showToast('Mohon isi judul transaksi dan nominal lebih dari Rp 0.', 'error');
    return;
  }
  if (state.txForm.type === 'transfer' && state.txForm.account === state.txForm.toAccount) {
    showToast('Akun asal dan tujuan transfer tidak boleh sama.', 'error');
    return;
  }
  const existingTx = state.editingTxId ? state.transactions.find((t) => t.id === state.editingTxId) : null;
  const record = {
    id: state.editingTxId || `tx_${Date.now()}`,
    title: state.txForm.title.trim(),
    type: state.txForm.type,
    category: state.txForm.type === 'transfer' ? 'transfer_internal' : state.txForm.category,
    amount: cleanAmount,
    date: clampDateStr(state.txForm.date || CURRENT_REAL_DATE),
    account: state.txForm.account,
    toAccount: state.txForm.type === 'transfer' ? state.txForm.toAccount : null,
    note: state.txForm.note.trim(),
    receiptId: existingTx?.receiptId || null,
    rolloverRefId: existingTx?.rolloverRefId || null
  };
  if (state.editingTxId) {
    state.transactions = state.transactions.map((t) => (t.id === state.editingTxId ? record : t));
  } else {
    state.transactions = [record, ...state.transactions];
  }
  state.isTxModalOpen = false;
  await dbPut('transactions', record);
  showToast('Transaksi disimpan & seluruh saldo/anggaran telah diperbarui.');
};

window.plConfirmDeleteTx = (txId) => {
  state.deleteConfirmTarget = state.transactions.find((t) => t.id === txId) || null;
  renderApp();
};
window.plCancelDeleteTx = () => { state.deleteConfirmTarget = null; renderApp(); };
window.plExecuteDeleteTx = async () => {
  if (!state.deleteConfirmTarget) return;
  const id = state.deleteConfirmTarget.id;
  state.transactions = state.transactions.filter((t) => t.id !== id);
  state.deleteConfirmTarget = null;
  await dbDelete('transactions', id);
  showToast('Transaksi dihapus dan saldo telah diperbarui.');
};

window.plViewReceipt = (rcptId) => {
  state.viewingReceiptModal = state.receipts.find((r) => r.id === rcptId) || null;
  renderApp();
};
window.plCloseReceiptModal = () => { state.viewingReceiptModal = null; renderApp(); };

// Filters & Analytics
window.plSetSearch = (val) => { state.searchQuery = val; renderApp(); };
window.plSetFilterScope = (val) => { state.filterMonthScope = val; renderApp(); };
window.plSetFilterType = (val) => { state.filterType = val; renderApp(); };
window.plSetFilterCategory = (val) => { state.filterCategory = val; renderApp(); };
window.plSetFilterAccount = (val) => { state.filterAccount = val; renderApp(); };
window.plSetAnalyticsPeriod = (period) => { state.analyticsPeriod = period; renderApp(); };

// First-Use Offline OCR Initialization & Progress
window.plInitOfflineOcr = async () => {
  state.ocrInitRunning = true;
  state.ocrProgressText = 'Menyiapkan mesin pemindai struk...';
  renderApp();

  try {
    await new Promise((r) => setTimeout(r, 350));
    state.ocrProgressText = 'Download bahasa OCR: Indonesia (ind+eng)...';
    renderApp();

    if (window.Tesseract && typeof window.Tesseract.createWorker === 'function') {
      try {
        const worker = await window.Tesseract.createWorker('ind+eng');
        await worker.terminate();
      } catch {
        // Fallback if sandboxed iframe restricts worker blob creation
      }
    }
    await new Promise((r) => setTimeout(r, 400));
    state.settings.ocrInitialized = true;
    state.settings.ocrLangStatus = 'Mesin OCR siap digunakan secara offline.';
    state.ocrProgressText = 'Mesin OCR siap digunakan secara offline.';
    await dbPut('settings', state.settings);
    showToast('Mesin OCR siap digunakan secara offline.');
  } catch {
    state.settings.ocrLangStatus = 'Gagal mengunduh bahasa Indonesia; menggunakan fallback bahasa Inggris / Kanvas Lokal.';
    showToast('Koneksi terputus saat mengunduh model OCR. Klik Coba Lagi saat terhubung.', 'error');
  } finally {
    state.ocrInitRunning = false;
    renderApp();
  }
};

// OCR Pipeline Execution
window.plRunOcrPipeline = async (rawImg, optionalText = '') => {
  if (!rawImg) return;
  state.isOcrRunning = true;
  state.ocrProgressText = 'Menyiapkan mesin pemindai struk & preprocessing gambar...';
  renderApp();

  const processed = await preprocessReceiptImage(rawImg, state.preprocessConfig);
  state.scannerImage = processed;

  let recognizedText = '';
  let confidence = 0;
  let engineLabel = 'Tesseract.js v5 (Lokal On-Device)';

  try {
    if (window.Tesseract) {
      state.ocrProgressText = 'Membaca teks struk dengan OCR lokal (Indonesia + Inggris)...';
      renderApp();
      const res = await window.Tesseract.recognize(processed, 'ind+eng');
      recognizedText = res?.data?.text?.trim() || '';
      confidence = Math.round(res?.data?.confidence || 86);
      state.settings.ocrInitialized = true;
      state.settings.ocrLangStatus = 'Mesin OCR siap digunakan secara offline.';
    } else {
      throw new Error('Tesseract belum dimuat');
    }
  } catch {
    if (optionalText) {
      recognizedText = optionalText;
      confidence = 94;
      engineLabel = 'Ekstraktor Kanvas Lokal (Fallback Offline)';
    } else {
      recognizedText = '';
      confidence = 0;
      engineLabel = 'Mode Manual / Offline';
    }
  }

  state.ocrConfidence = confidence;
  state.ocrEngineUsed = engineLabel;
  state.ocrExtracted = parseReceiptOcrText(recognizedText, state.settings.activeMonth);
  state.isOcrRunning = false;
  state.ocrProgressText = '';
  renderApp();
};

window.plHandleReceiptFile = (inputEl) => {
  const file = inputEl?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target?.result;
    if (typeof dataUrl === 'string') {
      state.rawUploadedImage = dataUrl;
      state.pendingRawSourceText = '';
      window.plRunOcrPipeline(dataUrl, '');
    }
  };
  reader.readAsDataURL(file);
};

window.plLoadPresetReceipt = (presetId) => {
  const preset = OCR_PRESET_TEMPLATES.find((p) => p.id === presetId);
  if (!preset) return;
  const rawText = preset.rawReceiptLines.join('\n');
  const pngUrl = renderReceiptTextToPngDataUrl(preset.rawReceiptLines);
  state.rawUploadedImage = pngUrl;
  state.pendingRawSourceText = rawText;
  window.plRunOcrPipeline(pngUrl, rawText);
};

window.plRotateReceipt = () => {
  state.preprocessConfig.rotation = (state.preprocessConfig.rotation + 90) % 360;
  if (state.rawUploadedImage) window.plRunOcrPipeline(state.rawUploadedImage, state.pendingRawSourceText);
  else renderApp();
};
window.plUpdatePreprocess = (field, val) => { state.preprocessConfig[field] = val; renderApp(); };
window.plReprocessReceipt = () => {
  if (!state.rawUploadedImage) {
    showToast('Pilih atau unggah gambar struk terlebih dahulu.', 'error');
    return;
  }
  window.plRunOcrPipeline(state.rawUploadedImage, state.pendingRawSourceText);
};

window.plStartCamera = async () => {
  state.cameraError = null;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    state.cameraError = 'Kamera langsung tidak didukung di lingkungan ini. Gunakan tombol Unggah Gambar.';
    renderApp();
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    state.isCameraActive = true;
    renderApp();
    const videoEl = document.getElementById('pl-camera-video');
    if (videoEl) videoEl.srcObject = cameraStream;
  } catch {
    state.cameraError = 'Izin kamera ditolak atau diblokir oleh iframe. Gunakan tombol Unggah Gambar.';
    renderApp();
  }
};

window.plStopCamera = () => {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  state.isCameraActive = false;
  renderApp();
};

window.plCaptureCamera = () => {
  const videoEl = document.getElementById('pl-camera-video');
  if (!videoEl) return;
  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth || 640;
  canvas.height = videoEl.videoHeight || 800;
  canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/png');
  window.plStopCamera();
  state.rawUploadedImage = dataUrl;
  state.pendingRawSourceText = '';
  window.plRunOcrPipeline(dataUrl, '');
};

window.plUpdateOcrField = (field, val) => {
  if (!state.ocrExtracted) return;
  state.ocrExtracted[field] =
    field === 'amount' || field === 'subtotal' || field === 'tax' || field === 'discount'
      ? toIntIDR(val)
      : val;
  if (field === 'tax' || field === 'discount' || field === 'subtotal') {
    state.ocrExtracted.amount = Math.max(
      0,
      toIntIDR(state.ocrExtracted.subtotal) + toIntIDR(state.ocrExtracted.tax) - toIntIDR(state.ocrExtracted.discount)
    );
    renderApp();
  }
};

window.plUpdateOcrItem = (itemId, field, val) => {
  if (!state.ocrExtracted) return;
  state.ocrExtracted.items = state.ocrExtracted.items.map((it) =>
    it.id === itemId ? { ...it, [field]: field === 'name' ? val : toIntIDR(val) } : it
  );
  const sub = state.ocrExtracted.items.reduce((s, it) => s + toIntIDR(it.qty) * toIntIDR(it.price), 0);
  state.ocrExtracted.subtotal = sub;
  state.ocrExtracted.amount = Math.max(0, sub + toIntIDR(state.ocrExtracted.tax) - toIntIDR(state.ocrExtracted.discount));
  renderApp();
};

window.plAddOcrItem = () => {
  if (!state.ocrExtracted) return;
  state.ocrExtracted.items.push({ id: `item_${Date.now()}`, name: 'Item Baru', qty: 1, price: 10000 });
  const sub = state.ocrExtracted.items.reduce((s, it) => s + toIntIDR(it.qty) * toIntIDR(it.price), 0);
  state.ocrExtracted.subtotal = sub;
  state.ocrExtracted.amount = Math.max(0, sub + toIntIDR(state.ocrExtracted.tax) - toIntIDR(state.ocrExtracted.discount));
  renderApp();
};

window.plRemoveOcrItem = (itemId) => {
  if (!state.ocrExtracted) return;
  state.ocrExtracted.items = state.ocrExtracted.items.filter((it) => it.id !== itemId);
  const sub = state.ocrExtracted.items.reduce((s, it) => s + toIntIDR(it.qty) * toIntIDR(it.price), 0);
  state.ocrExtracted.subtotal = sub;
  state.ocrExtracted.amount = Math.max(0, sub + toIntIDR(state.ocrExtracted.tax) - toIntIDR(state.ocrExtracted.discount));
  renderApp();
};

window.plToggleRawOcr = () => { state.showRawOcrPanel = !state.showRawOcrPanel; renderApp(); };
window.plReparseRawOcr = () => {
  if (!state.ocrExtracted) return;
  const reparsed = parseReceiptOcrText(state.ocrExtracted.rawOcrText, state.settings.activeMonth);
  state.ocrExtracted = { ...reparsed, rawOcrText: state.ocrExtracted.rawOcrText };
  showToast('Teks mentah OCR berhasil dianalisis ulang.');
};
window.plCancelOcr = () => { state.ocrExtracted = null; state.scannerImage = null; state.rawUploadedImage = null; renderApp(); };

window.plConfirmSaveReceipt = async () => {
  if (!state.ocrExtracted) return;
  const amt = toIntIDR(state.ocrExtracted.amount);
  if (!state.ocrExtracted.merchant.trim() || amt <= 0) {
    showToast('Pastikan nama merchant dan total nominal valid.', 'error');
    return;
  }
  const receiptId = `rcpt_${Date.now()}`;
  const rcptRecord = {
    id: receiptId,
    merchant: state.ocrExtracted.merchant.trim(),
    date: state.ocrExtracted.date || CURRENT_REAL_DATE,
    time: state.ocrExtracted.time || '12:00',
    amount: amt,
    subtotal: toIntIDR(state.ocrExtracted.subtotal),
    tax: toIntIDR(state.ocrExtracted.tax),
    discount: toIntIDR(state.ocrExtracted.discount),
    paymentMethod: state.ocrExtracted.paymentMethod || 'Tunai',
    category: state.ocrExtracted.category || 'kebutuhan',
    items: state.ocrExtracted.items,
    imageData: state.scannerImage || state.rawUploadedImage,
    rawOcrText: state.ocrExtracted.rawOcrText || '',
    ocrConfidence: state.ocrConfidence ?? 90,
    ocrMode: state.ocrEngineUsed
  };
  const itemSummary = state.ocrExtracted.items.map((i) => `${i.name} (${i.qty}x)`).join(', ');
  const newTx = {
    id: `tx_${Date.now()}`,
    title: `Struk: ${rcptRecord.merchant}`,
    type: 'expense',
    category: rcptRecord.category,
    amount: amt,
    date: rcptRecord.date,
    account: state.ocrExtracted.account || 'tunai',
    toAccount: null,
    note: itemSummary ? `[${rcptRecord.paymentMethod}] ${itemSummary}` : 'Transaksi dari pindai struk OCR',
    receiptId
  };
  state.receipts = [rcptRecord, ...state.receipts];
  state.transactions = [newTx, ...state.transactions];
  state.ocrExtracted = null;
  state.scannerImage = null;
  state.rawUploadedImage = null;
  await Promise.all([dbPut('receipts', rcptRecord), dbPut('transactions', newTx)]);
  state.activeTab = 'dashboard';
  showToast('Struk & transaksi pengeluaran berhasil dikonfirmasi dan disimpan!');
};

// Budget & Rollover Controllers
const upsertActiveMonthBudgetRecord = async (mutatorFn) => {
  const mKey = state.settings.activeMonth;
  const resolved = resolveBudgetForMonth(mKey, state.budgets, state.categories, state.settings.weekStartDay);
  let targetRecord = state.budgets.find((b) => b.budgetType === 'monthly_once' && b.month === mKey);
  if (!targetRecord) {
    targetRecord = {
      id: mKey,
      budgetType: 'monthly_once',
      month: mKey,
      monthlyAllowance: resolved.monthlyAllowance,
      monthlySpendingBudget: resolved.monthlySpendingBudget,
      weeklyAllocations: { ...resolved.weeklyAllocations },
      categoryBudgets: { ...resolved.categoryBudgets },
      updatedAt: new Date().toISOString()
    };
    state.budgets.push(targetRecord);
  }
  mutatorFn(targetRecord);
  targetRecord.updatedAt = new Date().toISOString();
  await dbPut('budgets', targetRecord);
  renderApp();
};

window.plUpdateStartingBalance = async (val) => {
  const clean = toIntIDR(val);
  state.settings.startingBalance = clean;
  // Sync with primary bank account initialBalance
  state.accounts = state.accounts.map((a) => (a.id === 'bank' ? { ...a, initialBalance: clean } : a));
  const bankAcc = state.accounts.find((a) => a.id === 'bank');
  await Promise.all([dbPut('settings', state.settings), bankAcc ? dbPut('accounts', bankAcc) : Promise.resolve()]);
  renderApp();
};

window.plUpdateMonthlyBudgetField = async (field, val) => {
  await upsertActiveMonthBudgetRecord((rec) => {
    rec[field] = toIntIDR(val);
  });
};

window.plSaveCustomBudgetRule = async (e) => {
  if (e) e.preventDefault();
  const typeEl = document.getElementById('pl-brule-type');
  const limitEl = document.getElementById('pl-brule-limit');
  const startEl = document.getElementById('pl-brule-start');
  const endEl = document.getElementById('pl-brule-end');

  const budgetType = typeEl?.value || 'monthly_once';
  const limitVal = toIntIDR(limitEl?.value || 1500000);
  const startMonth = startEl?.value || state.settings.activeMonth;
  const endMonth = endEl?.value || shiftMonthKey(startMonth, 5);

  if (limitVal <= 0) {
    showToast('Batas anggaran harus lebih besar dari Rp 0.', 'error');
    return;
  }

  const currentResolved = resolveBudgetForMonth(state.settings.activeMonth, state.budgets, state.categories, state.settings.weekStartDay);
  const newRule = {
    id:
      budgetType === 'monthly_once'
        ? startMonth
        : budgetType === 'permanent'
        ? 'budget_perm_default'
        : `budget_range_${startMonth}_${endMonth}`,
    budgetType,
    month: budgetType === 'monthly_once' ? startMonth : undefined,
    startMonth: budgetType === 'date_range' ? startMonth : undefined,
    endMonth: budgetType === 'date_range' ? endMonth : undefined,
    effectiveFrom: budgetType === 'permanent' ? startMonth : undefined,
    monthlyAllowance: currentResolved.monthlyAllowance,
    monthlySpendingBudget: limitVal,
    weeklyAllocations: {},
    categoryBudgets: { ...currentResolved.categoryBudgets },
    updatedAt: new Date().toISOString()
  };

  const idx = state.budgets.findIndex((b) => b.id === newRule.id);
  if (idx >= 0) state.budgets[idx] = newRule;
  else state.budgets.push(newRule);

  await dbPut('budgets', newRule);
  showToast('Aturan anggaran berhasil disimpan & diterapkan sesuai prioritas!');
};

window.plDeleteBudgetRule = async (ruleId) => {
  if (ruleId === 'budget_perm_default') {
    showToast('Anggaran permanen dasar tidak dapat dihapus, namun nominalnya dapat diubah.', 'error');
    return;
  }
  state.budgets = state.budgets.filter((b) => b.id !== ruleId);
  await dbDelete('budgets', ruleId);
  showToast('Aturan anggaran dihapus.');
};

// Rollover Allocation Controllers
window.plSaveRolloverAllocation = async (monthKey) => {
  const savEl = document.getElementById('pl-roll-sav');
  const invEl = document.getElementById('pl-roll-inv');
  const reqSav = Math.max(0, toIntIDR(savEl?.value || 0));
  const reqInv = Math.max(0, toIntIDR(invEl?.value || 0));

  const snap = computeMasterSnapshot();
  const activeRoll = snap.activeRollover;
  if (activeRoll.eligibleRollover <= 0) {
    showToast('Tidak ada surplus anggaran positif pada bulan ini untuk di-rollover.', 'error');
    return;
  }
  if (reqSav + reqInv > activeRoll.eligibleRollover) {
    showToast('Total alokasi ke Tabungan + Investasi tidak boleh melebihi Surplus Anggaran.', 'error');
    return;
  }

  const retained = activeRoll.eligibleRollover - reqSav - reqInv;
  const existing = state.rollover_records.find((r) => r.sourceMonth === monthKey);
  const record = {
    id: monthKey,
    sourceMonth: monthKey,
    allocatedToSavings: reqSav,
    allocatedToInvestments: reqInv,
    retainedForNextMonth: retained,
    linkedTransferTxId: existing?.linkedTransferTxId || null,
    updatedAt: new Date().toISOString()
  };

  const idx = state.rollover_records.findIndex((r) => r.sourceMonth === monthKey);
  if (idx >= 0) state.rollover_records[idx] = record;
  else state.rollover_records.push(record);

  await dbPut('rollover_records', record);
  showToast(`Alokasi Rollover ${formatIndoMonth(monthKey)} berhasil disimpan (Sisa ditahan ke bulan depan: ${formatIDR(retained)}).`);
};

window.plTransferRolloverToSavingsAccount = async (monthKey) => {
  const snap = computeMasterSnapshot();
  const activeRoll = snap.activeRollover;
  const savAmt = toIntIDR(activeRoll.allocatedToSavings);
  if (savAmt <= 0) {
    showToast('Tetapkan nominal Alokasi Rollover ke Tabungan lebih dari Rp 0 terlebih dahulu.', 'error');
    return;
  }
  if (activeRoll.linkedTransferTxId) {
    showToast('Dana rollover bulan ini sudah pernah ditransfer ke Akun Tabungan (Pencegahan Hitung Ganda Aktif).', 'error');
    return;
  }
  const savingsAcc = state.accounts.find((a) => a.type === 'savings') || state.accounts[state.accounts.length - 1];
  const sourceAcc = state.accounts.find((a) => a.id === 'bank') || state.accounts[0];
  const txId = `tx_roll_sav_${monthKey}_${Date.now()}`;
  const transferTx = {
    id: txId,
    title: `Transfer Surplus Rollover ${formatIndoMonth(monthKey)} ke Tabungan`,
    type: 'transfer',
    category: 'transfer_internal',
    amount: savAmt,
    date: `${monthKey}-28`,
    account: sourceAcc.id,
    toAccount: savingsAcc.id,
    note: `Pemindahan kas surplus anggaran ${formatIndoMonth(monthKey)} (Anti-Double-Counting)`,
    receiptId: null,
    rolloverRefId: monthKey
  };
  state.transactions = [transferTx, ...state.transactions];
  const rec = state.rollover_records.find((r) => r.sourceMonth === monthKey) || {
    id: monthKey,
    sourceMonth: monthKey,
    allocatedToSavings: savAmt,
    allocatedToInvestments: activeRoll.allocatedToInvestments,
    retainedForNextMonth: activeRoll.retainedForNextMonth
  };
  rec.linkedTransferTxId = txId;
  const idx = state.rollover_records.findIndex((r) => r.sourceMonth === monthKey);
  if (idx >= 0) state.rollover_records[idx] = rec;
  else state.rollover_records.push(rec);

  await Promise.all([dbPut('transactions', transferTx), dbPut('rollover_records', rec)]);
  showToast('Transfer kas fisik ke Akun Tabungan tercatat tanpa hitung ganda!');
};

window.plSyncAllowanceIncome = async () => {
  const snap = computeMasterSnapshot();
  const allowance = toIntIDR(snap.monthBudget.monthlyAllowance);
  if (allowance <= 0) return;
  const existing = state.transactions.find(
    (t) => getMonthFromDate(t.date) === state.settings.activeMonth && t.type === 'income' && t.category === 'uang_saku'
  );
  const record = existing
    ? { ...existing, amount: allowance }
    : {
        id: `tx_allow_${Date.now()}`,
        title: `Uang Saku Bulanan (${formatIndoMonth(state.settings.activeMonth)})`,
        type: 'income',
        category: 'uang_saku',
        amount: allowance,
        date: `${state.settings.activeMonth}-01`,
        account: 'bank',
        toAccount: null,
        note: 'Sinkronisasi uang saku bulanan',
        receiptId: null
      };
  if (existing) state.transactions = state.transactions.map((t) => (t.id === existing.id ? record : t));
  else state.transactions = [record, ...state.transactions];
  await dbPut('transactions', record);
  showToast('Uang Saku Bulanan berhasil disinkronkan ke transaksi pemasukan!');
};

window.plSubmitAdditionalIncome = async (e) => {
  if (e) e.preventDefault();
  const title = document.getElementById('pl-add-inc-title')?.value?.trim() || '';
  const amt = toIntIDR(document.getElementById('pl-add-inc-amt')?.value || 0);
  const cat = document.getElementById('pl-add-inc-cat')?.value || 'freelance';
  const date = document.getElementById('pl-add-inc-date')?.value || `${state.settings.activeMonth}-16`;
  if (!title || amt <= 0) {
    showToast('Isi sumber pemasukan dan nominal dengan benar.', 'error');
    return;
  }
  const newTx = {
    id: `tx_inc_${Date.now()}`,
    title,
    type: 'income',
    category: cat,
    amount: amt,
    date,
    account: 'bank',
    toAccount: null,
    note: 'Pemasukan tambahan via Pengaturan Anggaran',
    receiptId: null
  };
  state.transactions = [newTx, ...state.transactions];
  await dbPut('transactions', newTx);
  showToast('Pemasukan tambahan berhasil disimpan!');
};

window.plUpdateWeeklyAllocation = async (weekNum, val) => {
  await upsertActiveMonthBudgetRecord((rec) => {
    rec.weeklyAllocations[weekNum] = toIntIDR(val);
  });
};

window.plDivideWeeklyEqual = async () => {
  const calWeeks = getCalendarWeeksForMonth(state.settings.activeMonth, state.settings.weekStartDay);
  await upsertActiveMonthBudgetRecord((rec) => {
    const total = toIntIDR(rec.monthlySpendingBudget);
    const base = Math.floor(total / calWeeks.length);
    const rem = total - base * calWeeks.length;
    calWeeks.forEach((w, idx) => {
      rec.weeklyAllocations[w.weekNum] = idx === calWeeks.length - 1 ? base + rem : base;
    });
  });
  showToast(`Anggaran dibagi rata ke ${calWeeks.length} minggu kalender.`);
};

window.plDivideWeeklyProportional = async () => {
  const calWeeks = getCalendarWeeksForMonth(state.settings.activeMonth, state.settings.weekStartDay);
  const { year, month } = parseMonthParts(state.settings.activeMonth);
  const totalDays = getDaysInMonth(year, month);
  await upsertActiveMonthBudgetRecord((rec) => {
    const total = toIntIDR(rec.monthlySpendingBudget);
    let acc = 0;
    calWeeks.forEach((w, idx) => {
      if (idx === calWeeks.length - 1) {
        rec.weeklyAllocations[w.weekNum] = Math.max(0, total - acc);
      } else {
        const share = Math.round(((total * (w.daysCount / totalDays)) / 1000)) * 1000;
        rec.weeklyAllocations[w.weekNum] = share;
        acc += share;
      }
    });
  });
  showToast(`Anggaran dibagi proporsional menurut jumlah hari tiap minggu (${totalDays} hari).`);
};

window.plUpdateCategoryBudget = async (catId, val) => {
  await upsertActiveMonthBudgetRecord((rec) => {
    rec.categoryBudgets[catId] = toIntIDR(val);
  });
};

// Specialized Financial Tools Controllers (Savings, Investments, Loans, Tax)
window.plUpdateSavingsGoal = async (field, val) => {
  const goal = state.savings[0] || { ...DEFAULT_SAVINGS_GOALS[0] };
  goal[field] = field === 'name' || field === 'linkedAccountId' ? val : toIntIDR(val);
  state.savings = [goal];
  await dbPut('savings', goal);
  renderApp();
};

window.plUpdateInvestmentSim = async (field, val) => {
  const inv = state.investments[0] || { ...DEFAULT_INVESTMENTS[0] };
  inv[field] =
    field === 'name'
      ? val
      : field === 'annualReturnRatePct'
      ? Number(val) || 0
      : toIntIDR(val);
  state.investments = [inv];
  await dbPut('investments', inv);
  renderApp();
};

window.plUpdateLoanConfig = async (field, val) => {
  state.settings.loanConfig = {
    ...(state.settings.loanConfig || INITIAL_SETTINGS.loanConfig),
    [field]: field === 'method' ? val : field === 'annualInterestRatePct' ? Number(val) || 0 : toIntIDR(val)
  };
  await dbPut('settings', state.settings);
  renderApp();
};

window.plUpdateTaxConfig = async (field, val) => {
  state.settings.taxConfig = {
    ...(state.settings.taxConfig || INITIAL_SETTINGS.taxConfig),
    [field]:
      field === 'mode'
        ? val
        : field === 'umkmRatePct' || field === 'zakatRatePct' || field === 'deductionPct' || field === 'nisabGoldGrams'
        ? Number(val) || 0
        : toIntIDR(val)
  };
  await dbPut('settings', state.settings);
  renderApp();
};

// Custom Accounts & Categories CRUD + Safe Reassignment
window.plAddCustomAccount = async (e) => {
  if (e) e.preventDefault();
  const name = document.getElementById('pl-new-acc-name')?.value?.trim() || '';
  const type = document.getElementById('pl-new-acc-type')?.value || 'bank';
  const initBal = toIntIDR(document.getElementById('pl-new-acc-bal')?.value || 0);
  if (!name) {
    showToast('Masukkan nama akun baru.', 'error');
    return;
  }
  const newAcc = {
    id: `acc_${Date.now()}`,
    name,
    type,
    initialBalance: initBal,
    color: '#10b981',
    isSystem: false
  };
  state.accounts.push(newAcc);
  await dbPut('accounts', newAcc);
  showToast(`Akun "${name}" berhasil ditambahkan!`);
};

window.plUpdateAccountInitBalance = async (accId, val) => {
  const clean = toIntIDR(val);
  state.accounts = state.accounts.map((a) => (a.id === accId ? { ...a, initialBalance: clean } : a));
  const target = state.accounts.find((a) => a.id === accId);
  if (accId === 'bank') state.settings.startingBalance = clean;
  await Promise.all([
    target ? dbPut('accounts', target) : Promise.resolve(),
    dbPut('settings', state.settings)
  ]);
  renderApp();
};

window.plDeleteAccount = async (accId) => {
  const check = canDeleteAccountSafely(accId, state.transactions);
  if (!check.safe) {
    showToast(`Akun ini digunakan oleh ${check.usedCount} transaksi dan tidak dapat dihapus langsung.`, 'error');
    return;
  }
  if (state.accounts.length <= 1) {
    showToast('Minimal harus ada 1 akun aktif.', 'error');
    return;
  }
  state.accounts = state.accounts.filter((a) => a.id !== accId);
  await dbDelete('accounts', accId);
  showToast('Akun berhasil dihapus.');
};

window.plAddCustomCategory = async (e) => {
  if (e) e.preventDefault();
  const name = document.getElementById('pl-new-cat-name')?.value?.trim() || '';
  const type = document.getElementById('pl-new-cat-type')?.value || 'expense';
  if (!name) {
    showToast('Masukkan nama kategori baru.', 'error');
    return;
  }
  const newCat = {
    id: `cat_${Date.now()}`,
    name,
    type,
    color: type === 'income' ? '#10b981' : '#14b8a6',
    badgeBg:
      type === 'income'
        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
        : 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
    isDefault: false
  };
  state.categories.push(newCat);
  await dbPut('categories', newCat);
  showToast(`Kategori "${name}" berhasil dibuat!`);
};

window.plRequestDeleteCategory = async (catId) => {
  const target = state.categories.find((c) => c.id === catId);
  if (!target) return;
  const sameTypeCats = state.categories.filter((c) => c.type === target.type && c.id !== catId);
  if (sameTypeCats.length === 0) {
    showToast('Minimal harus tersisa 1 kategori untuk jenis ini.', 'error');
    return;
  }
  const usedCount = state.transactions.filter((t) => t.category === catId).length;
  if (usedCount === 0) {
    state.categories = state.categories.filter((c) => c.id !== catId);
    await dbDelete('categories', catId);
    showToast(`Kategori "${target.name}" berhasil dihapus.`);
    return;
  }
  // Open Safe Reassignment Modal so historical transactions are never corrupted
  state.categoryDeleteModal = {
    catId,
    catName: target.name,
    catType: target.type,
    usedCount,
    replacementId: sameTypeCats[0].id
  };
  renderApp();
};

window.plCancelCategoryDelete = () => {
  state.categoryDeleteModal = null;
  renderApp();
};

window.plConfirmCategoryReassignAndDelete = async () => {
  if (!state.categoryDeleteModal) return;
  const { catId, replacementId } = state.categoryDeleteModal;
  state.transactions = reassignCategoryInTransactions(state.transactions, catId, replacementId);
  state.categories = state.categories.filter((c) => c.id !== catId);
  state.categoryDeleteModal = null;
  await Promise.all([
    dbReplaceStore('transactions', state.transactions),
    dbDelete('categories', catId)
  ]);
  showToast('Transaksi historis berhasil dipindahkan & kategori dihapus dengan aman!');
};

// Backup & Restore with Pre-Import Validation & Merge/Replace Confirmation
window.plExportJson = () => {
  const payload = {
    appName: 'PocketLedger',
    version: APP_VERSION,
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    accounts: state.accounts,
    categories: state.categories,
    budgets: state.budgets,
    transactions: state.transactions,
    receipts: state.receipts,
    savings: state.savings,
    investments: state.investments,
    rollover_records: state.rollover_records
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `PocketLedger_Backup_v3_${state.settings.activeMonth}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Berkas cadangan JSON v3.0 berhasil diunduh!');
};

window.plImportJsonFile = (inputEl) => {
  const file = inputEl?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const check = validateBackupPayload(ev.target?.result);
    if (!check.valid) {
      showToast(check.error, 'error');
      return;
    }
    state.backupPreviewModal = check;
    renderApp();
  };
  reader.readAsText(file);
};

window.plCancelBackupPreview = () => {
  state.backupPreviewModal = null;
  renderApp();
};

window.plExecuteBackupImport = async (mode = 'merge') => {
  if (!state.backupPreviewModal) return;
  const migrated = migrateToV3Schema(state.backupPreviewModal.payload);

  if (mode === 'replace') {
    state.settings = migrated.settings;
    state.accounts = migrated.accounts;
    state.categories = migrated.categories;
    state.transactions = migrated.transactions;
    state.budgets = migrated.budgets;
    state.receipts = migrated.receipts;
    state.savings = migrated.savings;
    state.investments = migrated.investments;
    state.rollover_records = migrated.rollover_records;
  } else {
    // Safe Merge without duplicate IDs
    state.accounts = mergeRecordArraysById(state.accounts, migrated.accounts);
    state.categories = mergeRecordArraysById(state.categories, migrated.categories);
    state.transactions = mergeRecordArraysById(state.transactions, migrated.transactions);
    state.budgets = mergeRecordArraysById(state.budgets, migrated.budgets);
    state.receipts = mergeRecordArraysById(state.receipts, migrated.receipts);
    state.savings = mergeRecordArraysById(state.savings, migrated.savings);
    state.investments = mergeRecordArraysById(state.investments, migrated.investments);
    state.rollover_records = mergeRecordArraysById(state.rollover_records, migrated.rollover_records);
  }

  state.backupPreviewModal = null;
  await Promise.all([
    dbReplaceStore('settings', [state.settings]),
    dbReplaceStore('accounts', state.accounts),
    dbReplaceStore('categories', state.categories),
    dbReplaceStore('transactions', state.transactions),
    dbReplaceStore('budgets', state.budgets),
    dbReplaceStore('receipts', state.receipts),
    dbReplaceStore('savings', state.savings),
    dbReplaceStore('investments', state.investments),
    dbReplaceStore('rollover_records', state.rollover_records)
  ]);

  showToast(
    mode === 'replace'
      ? 'Seluruh database berhasil diganti dari berkas cadangan!'
      : 'Data cadangan berhasil digabungkan (Merge) tanpa duplikat!'
  );
};

window.plOpenResetModal = () => { state.isResetModalOpen = true; renderApp(); };
window.plCloseResetModal = () => { state.isResetModalOpen = false; renderApp(); };
window.plExecuteReset = async () => {
  const defaults = migrateToV3Schema({});
  Object.assign(state, defaults);
  state.isResetModalOpen = false;
  await Promise.all(
    ALL_DB_STORES.map((s) =>
      dbReplaceStore(s, s === 'settings' ? [state.settings] : state[s])
    )
  );
  showToast('Aplikasi dikembalikan ke data awal v3.0.');
};

window.plOpenPwaModal = async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt = null;
    return;
  }
  state.isPwaGuideModalOpen = true;
  renderApp();
};
window.plClosePwaModal = () => { state.isPwaGuideModalOpen = false; renderApp(); };

// ============================================================================
// CHART.JS VISUALIZATIONS
// ============================================================================
const destroyActiveCharts = () => {
  activeChartInstances.forEach((c) => {
    try { c.destroy(); } catch {}
  });
  activeChartInstances = [];
};

const mountChartsAfterRender = (snap) => {
  destroyActiveCharts();
  if (typeof window.Chart === 'undefined') return;
  const textColor = state.settings.theme === 'dark' ? '#94a3b8' : '#475569';

  if (state.activeTab === 'dashboard') {
    const ctxEl = document.getElementById('pl-dashboard-pie-chart');
    if (ctxEl && snap.monthlyExpenses > 0) {
      const activeCats = state.categories
        .filter((c) => c.type === 'expense')
        .map((c) => ({ name: c.name, color: c.color, val: toIntIDR(snap.categorySpending[c.id] || 0) }))
        .filter((c) => c.val > 0);
      const chart = new window.Chart(ctxEl, {
        type: 'doughnut',
        data: {
          labels: activeCats.map((c) => c.name),
          datasets: [{ data: activeCats.map((c) => c.val), backgroundColor: activeCats.map((c) => c.color), borderWidth: 0 }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '62%',
          plugins: { legend: { position: 'bottom', labels: { color: textColor, boxWidth: 10, font: { size: 11 } } } }
        }
      });
      activeChartInstances.push(chart);
    }
  }

  if (state.activeTab === 'analytics') {
    const ctxEl = document.getElementById('pl-analytics-main-chart');
    if (!ctxEl) return;

    if (state.analyticsPeriod === 'daily') {
      const mapByDate = {};
      state.transactions
        .filter((tx) => getMonthFromDate(tx.date) === state.settings.activeMonth && tx.type !== 'transfer')
        .forEach((tx) => {
          if (!mapByDate[tx.date]) mapByDate[tx.date] = { date: tx.date, inc: 0, exp: 0 };
          if (tx.type === 'income') mapByDate[tx.date].inc += toIntIDR(tx.amount);
          if (tx.type === 'expense') mapByDate[tx.date].exp += toIntIDR(tx.amount);
        });
      const rows = Object.values(mapByDate).sort((a, b) => a.date.localeCompare(b.date));
      activeChartInstances.push(
        new window.Chart(ctxEl, {
          type: 'bar',
          data: {
            labels: rows.map((r) => r.date),
            datasets: [
              { label: 'Pemasukan', data: rows.map((r) => r.inc), backgroundColor: '#10b981', borderRadius: 6 },
              { label: 'Pengeluaran', data: rows.map((r) => r.exp), backgroundColor: '#f43f5e', borderRadius: 6 }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: { ticks: { color: textColor } }, y: { ticks: { color: textColor } } },
            plugins: { legend: { labels: { color: textColor } } }
          }
        })
      );
    } else if (state.analyticsPeriod === 'weekly') {
      const labels = snap.calWeeks.map((w) => `M${w.weekNum} (${w.rangeLabel})`);
      const allocs = snap.calWeeks.map((w) => toIntIDR(snap.monthBudget.weeklyAllocations?.[w.weekNum] || 0));
      const spents = snap.calWeeks.map((w) => toIntIDR(snap.weeklySpending[w.weekNum] || 0));
      activeChartInstances.push(
        new window.Chart(ctxEl, {
          type: 'bar',
          data: {
            labels,
            datasets: [
              { label: 'Alokasi Anggaran Mingguan', data: allocs, backgroundColor: '#14b8a6', borderRadius: 6 },
              { label: 'Realisasi Pengeluaran', data: spents, backgroundColor: '#f59e0b', borderRadius: 6 }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: { ticks: { color: textColor } }, y: { ticks: { color: textColor } } },
            plugins: { legend: { labels: { color: textColor } } }
          }
        })
      );
    } else if (state.analyticsPeriod === 'annual') {
      const { year } = parseMonthParts(state.settings.activeMonth);
      const annual = computeAnnualReportSeries(year, state.transactions);
      activeChartInstances.push(
        new window.Chart(ctxEl, {
          type: 'bar',
          data: {
            labels: annual.rows.map((r) => r.monthShort),
            datasets: [
              { label: `Pemasukan ${year}`, data: annual.rows.map((r) => r.income), backgroundColor: '#10b981', borderRadius: 5 },
              { label: `Pengeluaran ${year}`, data: annual.rows.map((r) => r.expense), backgroundColor: '#f43f5e', borderRadius: 5 }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: { ticks: { color: textColor } }, y: { ticks: { color: textColor } } },
            plugins: { legend: { labels: { color: textColor } } }
          }
        })
      );
    } else {
      const monthSet = new Set([
        clampMonthKey(shiftMonthKey(state.settings.activeMonth, -1)),
        clampMonthKey(state.settings.activeMonth),
        clampMonthKey(shiftMonthKey(state.settings.activeMonth, 1)),
        clampMonthKey(shiftMonthKey(state.settings.activeMonth, 2))
      ]);
      state.transactions.forEach((tx) => {
        if (tx.date && tx.date.length >= 7) monthSet.add(tx.date.slice(0, 7));
      });
      const months = Array.from(monthSet).sort();
      const incSeries = [];
      const expSeries = [];
      months.forEach((m) => {
        let iSum = 0; let eSum = 0;
        state.transactions.forEach((tx) => {
          if (getMonthFromDate(tx.date) === m) {
            if (tx.type === 'income') iSum += toIntIDR(tx.amount);
            if (tx.type === 'expense') eSum += toIntIDR(tx.amount);
          }
        });
        incSeries.push(iSum);
        expSeries.push(eSum);
      });
      activeChartInstances.push(
        new window.Chart(ctxEl, {
          type: 'line',
          data: {
            labels: months.map((m) => formatIndoMonth(m)),
            datasets: [
              { label: 'Total Pemasukan', data: incSeries, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.18)', fill: true, tension: 0.3 },
              { label: 'Total Pengeluaran', data: expSeries, borderColor: '#f43f5e', backgroundColor: 'rgba(244,63,94,0.18)', fill: true, tension: 0.3 }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: { ticks: { color: textColor } }, y: { ticks: { color: textColor } } },
            plugins: { legend: { labels: { color: textColor } } }
          }
        })
      );
    }
  }
};

// ============================================================================
// MAIN RENDER FUNCTION
// ============================================================================
const renderApp = () => {
  const root = document.getElementById('app-root');
  if (!root) return;

  const snap = computeMasterSnapshot();
  const { year: activeYear, month: activeMonthNum } = parseMonthParts(state.settings.activeMonth);
  const isDark = state.settings.theme === 'dark';

  const dynamicYears = [];
  for (let y = 2026; y <= 2061; y += 1) dynamicYears.push(y);

  // 5 Primary Navigation Menus (Dashboard, Scan Receipt, Transactions, Analytics, More)
  const navItems = [
    { id: 'dashboard', label: 'Dasbor', icon: 'wallet' },
    { id: 'scan', label: 'Pindai Struk', icon: 'camera' },
    { id: 'transactions', label: 'Transaksi', icon: 'layers' },
    { id: 'analytics', label: 'Analitik', icon: 'chart' },
    { id: 'settings', label: 'Lainnya (More)', icon: 'sliders' }
  ];

  const headerHtml = `
    <header class="sticky top-0 z-30 backdrop-blur-md bg-white/90 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-md">
            ${iconSvg('wallet', 'w-5 h-5')}
          </div>
          <div>
            <div class="flex flex-wrap items-center gap-1.5">
              <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white">PocketLedger</h1>
              <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">PWA v3.0</span>
              <span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${state.isOnline ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/25' : 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30'}">
                ${state.isOnline ? 'Online' : 'Offline Lokal'}
              </span>
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(state.storageStatus)}</p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="flex items-center bg-slate-100 dark:bg-slate-800 rounded-xl p-1 border border-slate-200 dark:border-slate-700">
            <button type="button" onclick="window.plNavigateMonth(-1)" class="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 cursor-pointer" title="Bulan Sebelumnya">
              ${iconSvg('left', 'w-4 h-4')}
            </button>
            <select aria-label="Pilih Bulan" onchange="window.plSelectMonthPart(this.value)" class="bg-transparent text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 px-1.5 py-1 focus:outline-none cursor-pointer">
              ${INDONESIAN_MONTHS.map((m, idx) => {
              const mNum = idx + 1;
              if (activeYear === 2026 && mNum < 11) return '';
              if (activeYear === 2061 && mNum > 11) return '';
              return `<option value="${mNum}" ${activeMonthNum === mNum ? 'selected' : ''} class="bg-white dark:bg-slate-900">${m}</option>`;
            }).join('')}
            </select>
            <select aria-label="Pilih Tahun" onchange="window.plSelectYearPart(this.value)" class="bg-transparent text-xs sm:text-sm font-mono font-bold text-emerald-600 dark:text-emerald-400 px-1.5 py-1 focus:outline-none cursor-pointer">
              ${dynamicYears.map((yr) => `<option value="${yr}" ${activeYear === yr ? 'selected' : ''} class="bg-white dark:bg-slate-900">${yr}</option>`).join('')}
            </select>
            <button type="button" onclick="window.plNavigateMonth(1)" class="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 cursor-pointer" title="Bulan Berikutnya">
              ${iconSvg('right', 'w-4 h-4')}
            </button>
            ${state.settings.activeMonth !== CURRENT_REAL_MONTH ? `<button type="button" onclick="window.plJumpCurrentMonth()" class="ml-1 px-2 py-1 rounded-lg bg-teal-500/15 text-teal-600 dark:text-teal-400 text-[11px] font-bold cursor-pointer">Bulan Ini</button>` : ''}
          </div>

          <div class="hidden lg:flex items-center bg-slate-100 dark:bg-slate-800 rounded-xl p-1 border border-slate-200 dark:border-slate-700">
            ${snap.calWeeks.map((w) => `
              <button type="button" onclick="window.plSelectWeek(${w.weekNum})" title="Minggu ${w.weekNum}: ${w.rangeLabel}" class="px-2 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${snap.currentWeekIndex === w.weekNum ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 dark:text-slate-400'}">
                M${w.weekNum}
              </button>
            `).join('')}
          </div>

          <button type="button" onclick="window.plOpenPwaModal()" class="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-teal-500/15 text-teal-700 dark:text-teal-300 border border-teal-500/30 text-xs font-semibold cursor-pointer">
            ${iconSvg('phone', 'w-4 h-4')}
            <span class="hidden sm:inline">Instal PWA</span>
          </button>

          <button type="button" onclick="window.plOpenAddTxModal('expense')" class="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-semibold shadow-sm cursor-pointer">
            ${iconSvg('plus', 'w-4 h-4')}
            <span class="hidden sm:inline">Catat Transaksi</span>
          </button>

          <button type="button" onclick="window.plToggleTheme()" class="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 cursor-pointer" title="Ubah Tema">
            ${isDark ? iconSvg('sun', 'w-4 h-4 text-amber-400') : iconSvg('moon', 'w-4 h-4')}
          </button>
        </div>
      </div>

      <div class="max-w-7xl mx-auto px-4 sm:px-6 hidden md:flex items-center gap-1 border-t border-slate-100 dark:border-slate-800/70 pt-1">
        ${navItems.map((it) => `
          <button type="button" onclick="window.plSwitchTab('${it.id}')" class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all cursor-pointer ${state.activeTab === it.id ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5' : 'border-transparent text-slate-600 dark:text-slate-400'}">
            ${iconSvg(it.icon, 'w-4 h-4')}
            <span>${it.label}</span>
          </button>
        `).join('')}
      </div>
    </header>
  `;

  let mainContentHtml = '';

  // =========================================================================
  // TAB 1: DASHBOARD (Strict Separation of Cash Balance vs Budget & Rollover)
  // =========================================================================
  if (state.activeTab === 'dashboard') {
    const recentTx = state.transactions
      .filter((t) => getMonthFromDate(t.date) === state.settings.activeMonth)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 6);
    const activeWeekObj = snap.calWeeks.find((w) => w.weekNum === snap.currentWeekIndex);
    const primaryGoal = state.savings[0] || DEFAULT_SAVINGS_GOALS[0];
    const savCalc = calculateSavingsProjection({
      targetAmount: primaryGoal.targetAmount,
      currentSavings: snap.totalEffectiveSavings,
      monthlyContribution: primaryGoal.monthlyContributionTarget
    });

    mainContentHtml = `
      <div class="space-y-6">
        <!-- Cash Balance Hero (Strictly Separated from Remaining Budget) -->
        <div class="bg-gradient-to-r from-emerald-900/95 via-teal-900/95 to-slate-900 text-white rounded-2xl p-5 sm:p-6 shadow-lg border border-emerald-500/20">
          <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <div class="flex flex-wrap items-center gap-2 mb-2">
                <span class="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider font-semibold text-emerald-300 bg-emerald-500/20 px-2.5 py-1 rounded-full">
                  ${iconSvg('shield', 'w-3.5 h-3.5')}
                  Total Saldo Kas Aktual (Uang Riil Tercatat)
                </span>
                <span class="text-[11px] text-teal-200 bg-white/10 px-2.5 py-0.5 rounded-full">
                  Terpisah dari Kuota Sisa Anggaran
                </span>
              </div>
              <div class="text-3xl sm:text-4xl font-extrabold tracking-tight font-mono mt-1">${formatIDR(snap.currentBalance)}</div>
              <p class="text-xs sm:text-sm text-emerald-100/80 mt-2 font-mono">
                Kas Akhir = Saldo Awal Akun (${formatIDR(snap.startingBalance)}) + Total Pemasukan (${formatIDR(snap.totalAllTimeIncome)}) − Total Pengeluaran (${formatIDR(snap.totalAllTimeExpenses)})
              </p>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-slate-900/60 p-3 rounded-xl border border-white/10">
              ${state.accounts.map((a) => `
                <div class="px-2.5 py-1.5 rounded-lg bg-white/5">
                  <div class="text-[11px] text-slate-300 truncate">${escapeHtml(a.name)}</div>
                  <div class="text-xs sm:text-sm font-bold font-mono text-emerald-300 mt-0.5">${formatIDR(snap.accountBalances[a.id] || 0)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- 5 Core Financial Overview Cards (Income, Expenses, Remaining Budget, Rollover, Savings) -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Pemasukan (${formatIndoMonth(state.settings.activeMonth)})</span>
            <div class="text-xl font-bold font-mono mt-2 text-emerald-600 dark:text-emerald-400">${formatIDR(snap.monthlyIncome)}</div>
            <div class="text-[11px] text-slate-500 mt-1.5 flex justify-between">
              <span>Target Saku:</span>
              <span class="font-mono font-semibold">${formatIDR(snap.monthBudget.monthlyAllowance)}</span>
            </div>
          </div>

          <div class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Pengeluaran (${formatIndoMonth(state.settings.activeMonth)})</span>
            <div class="text-xl font-bold font-mono mt-2 text-rose-600 dark:text-rose-400">${formatIDR(snap.monthlyExpenses)}</div>
            <div class="text-[11px] text-slate-500 mt-1.5 flex justify-between">
              <span>Anggaran Dasar:</span>
              <span class="font-mono font-semibold">${formatIDR(snap.monthlySpendingBudget)}</span>
            </div>
          </div>

          <div class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Sisa Anggaran Efektif</span>
            <div class="text-xl font-bold font-mono mt-2 ${snap.remainingMonthlyBudget < 0 ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400'}">${formatIDR(snap.remainingMonthlyBudget)}</div>
            <div class="text-[11px] text-slate-500 mt-1.5 truncate" title="${escapeHtml(snap.monthBudget.appliedTypeLabel)}">
              ${escapeHtml(snap.monthBudget.appliedTypeLabel)}
            </div>
          </div>

          <div class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status Rollover Bulan Ini</span>
            <div class="text-xl font-bold font-mono mt-2 ${snap.activeRollover.status === 'deficit' ? 'text-rose-500' : 'text-teal-600 dark:text-teal-400'}">
              ${snap.activeRollover.status === 'deficit' ? `Defisit ${formatIDR(snap.activeRollover.deficitAmount)}` : formatIDR(snap.activeRollover.eligibleRollover)}
            </div>
            <div class="text-[11px] text-slate-500 mt-1.5 flex justify-between">
              <span>Carryover Masuk:</span>
              <span class="font-mono font-semibold">+${formatIDR(snap.activeRollover.carryoverIn)}</span>
            </div>
          </div>

          <div onclick="window.plSwitchTab('settings'); window.plSwitchMoreSubTab('savings')" class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm cursor-pointer hover:border-emerald-500/40">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Ringkasan Tabungan (${savCalc.progressPct}%)</span>
            <div class="text-xl font-bold font-mono mt-2 text-violet-600 dark:text-violet-400">${formatIDR(savCalc.effectiveCurrentSaved)}</div>
            <div class="text-[11px] text-slate-500 mt-1.5 flex justify-between">
              <span>Target:</span>
              <span class="font-mono font-semibold">${formatIDR(savCalc.targetAmount)}</span>
            </div>
          </div>
        </div>

        <!-- Weekly Calendar Allocations -->
        <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <div>
              <h2 class="text-base font-bold">Status Alokasi Mingguan Kalender (${formatIndoMonth(state.settings.activeMonth)} — ${snap.calWeeks.length} Minggu Kalender)</h2>
              <p class="text-xs text-slate-500">Minggu aktif M${snap.currentWeekIndex} (${activeWeekObj?.rangeLabel || ''}): Terpakai ${formatIDR(snap.currentWeeklySpending)} dari ${formatIDR(snap.currentWeeklyAllocation)}.</p>
            </div>
            <button type="button" onclick="window.plSwitchTab('settings'); window.plSwitchMoreSubTab('budgets')" class="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer">Kelola Anggaran &amp; Rollover →</button>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            ${snap.calWeeks.map((w) => {
              const spent = toIntIDR(snap.weeklySpending[w.weekNum] || 0);
              const alloc = toIntIDR(snap.monthBudget.weeklyAllocations?.[w.weekNum] || 0);
              const pct = alloc > 0 ? Math.min(100, Math.round((spent / alloc) * 100)) : 0;
              const over = spent > alloc && alloc > 0;
              return `
                <div onclick="window.plSelectWeek(${w.weekNum})" class="p-3.5 rounded-xl border transition-all cursor-pointer ${snap.currentWeekIndex === w.weekNum ? 'border-emerald-500 bg-emerald-500/5' : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40'}">
                  <div class="flex justify-between text-xs font-semibold">
                    <span>Minggu ${w.weekNum}: ${w.rangeLabel} (${w.daysCount} hr)</span>
                    <span class="${over ? 'text-rose-500 font-bold' : 'text-emerald-500'}">${pct}%</span>
                  </div>
                  <div class="mt-2 font-mono text-sm font-bold">${formatIDR(spent)} <span class="text-xs font-normal text-slate-500">/ ${formatIDR(alloc)}</span></div>
                  <div class="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div class="h-full rounded-full ${over ? 'bg-rose-500' : 'bg-teal-500'}" style="width: ${pct}%"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Category Chart & Recent Transactions -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div class="lg:col-span-5 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div class="flex items-center justify-between mb-3">
              <h2 class="text-base font-bold">Grafik Kategori Pengeluaran</h2>
              <button type="button" onclick="window.plSwitchTab('analytics')" class="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer">Detail Analitik</button>
            </div>
            ${snap.monthlyExpenses > 0
              ? `<div class="relative h-64 w-full"><canvas id="pl-dashboard-pie-chart"></canvas></div>`
              : `<div class="py-16 text-center text-sm text-slate-500">Belum ada pengeluaran pada bulan ini.</div>`
            }
          </div>

          <div class="lg:col-span-7 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-base font-bold">Transaksi Terbaru (${formatIndoMonth(state.settings.activeMonth)})</h2>
              <div class="flex items-center gap-2">
                <button type="button" onclick="window.plSwitchTab('scan')" class="px-3 py-1.5 rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400 text-xs font-semibold cursor-pointer">Pindai Struk</button>
                <button type="button" onclick="window.plSwitchTab('transactions')" class="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer">Lihat Semua →</button>
              </div>
            </div>
            <div class="divide-y divide-slate-100 dark:divide-slate-800">
              ${recentTx.length > 0 ? recentTx.map((tx) => {
                const cat = findCategoryMeta(tx.category, state.categories);
                return `
                  <div class="py-3 flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <p class="text-sm font-semibold truncate">${escapeHtml(tx.title)}</p>
                        ${tx.receiptId ? `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-600 dark:text-teal-400">Struk</span>` : ''}
                      </div>
                      <div class="text-xs text-slate-500 mt-0.5">${formatIndoDate(tx.date)} • <span class="px-1.5 py-0.5 rounded text-[11px] ${cat.badgeBg}">${escapeHtml(cat.name)}</span></div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <span class="text-sm font-bold font-mono ${tx.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : tx.type === 'transfer' ? 'text-slate-500' : 'text-rose-600 dark:text-rose-400'}">
                        ${tx.type === 'income' ? '+' + formatIDR(tx.amount) : tx.type === 'transfer' ? formatIDR(tx.amount) : '-' + formatIDR(tx.amount)}
                      </span>
                      <button type="button" onclick="window.plOpenEditTxModal('${tx.id}')" class="p-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer">${iconSvg('edit', 'w-3.5 h-3.5')}</button>
                    </div>
                  </div>
                `;
              }).join('') : `<div class="py-10 text-center text-sm text-slate-500">Belum ada transaksi di periode ini.</div>`}
            </div>
          </div>
        </div>
      </div>
    `;
  } else if (state.activeTab === 'scan') {
    // =========================================================================
    // TAB 2: RECEIPT SCANNER & OFFLINE OCR INITIALIZATION
    // =========================================================================
    const ext = state.ocrExtracted;
    const expCats = state.categories.filter((c) => c.type === 'expense');

    mainContentHtml = `
      <div class="space-y-6">
        <div class="bg-teal-500/10 border border-teal-500/30 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-sm font-bold">Pemindai Struk &amp; Mesin OCR Lokal (Tesseract.js + Preprocessing Kanvas)</h2>
              <span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30">${escapeHtml(state.settings.ocrLangStatus || state.ocrEngineUsed)}</span>
            </div>
            <p class="text-xs text-slate-600 dark:text-slate-300 mt-1">
              Pemrosesan berlangsung di perangkat tanpa API berbayar. Unduh/inisialisasi bahasa OCR (Indonesia + Inggris ~5 MB) satu kali saat online agar tersimpan di cache browser untuk penggunaan offline berikutnya.
            </p>
          </div>
          <button type="button" onclick="window.plInitOfflineOcr()" class="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold shrink-0 cursor-pointer">
            ${state.ocrInitRunning ? 'Mengunduh Bahasa OCR...' : state.settings.ocrInitialized ? 'Verifikasi Ulang Cache OCR' : 'Siapkan Mesin OCR Offline'}
          </button>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div class="lg:col-span-5 space-y-4">
            <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <h3 class="text-sm font-bold">1. Ambil Foto atau Unggah Gambar Struk</h3>
              <div class="grid grid-cols-2 gap-3">
                <button type="button" onclick="${state.isCameraActive ? 'window.plStopCamera()' : 'window.plStartCamera()'}" class="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-semibold cursor-pointer">
                  ${iconSvg('camera', 'w-4 h-4')}
                  <span>${state.isCameraActive ? 'Tutup Kamera' : 'Buka Kamera'}</span>
                </button>
                <label class="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs sm:text-sm font-semibold border border-slate-200 dark:border-slate-700 cursor-pointer">
                  ${iconSvg('upload', 'w-4 h-4 text-teal-500')}
                  <span>Unggah Gambar</span>
                  <input type="file" accept="image/*" capture="environment" onchange="window.plHandleReceiptFile(this)" class="hidden" />
                </label>
              </div>

              ${state.cameraError ? `<div class="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-600 dark:text-amber-300">${escapeHtml(state.cameraError)}</div>` : ''}

              ${state.isCameraActive ? `
                <div class="space-y-2">
                  <div class="relative rounded-xl overflow-hidden bg-black aspect-[3/4] max-h-72 mx-auto flex items-center justify-center">
                    <video id="pl-camera-video" autoplay playsinline muted class="w-full h-full object-cover"></video>
                  </div>
                  <button type="button" onclick="window.plCaptureCamera()" class="w-full py-2.5 rounded-xl bg-teal-600 text-white text-xs font-bold uppercase cursor-pointer">Jepret &amp; Ekstrak Struk</button>
                </div>
              ` : ''}

              <div class="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold">Preprocessing Gambar OCR</span>
                  <button type="button" onclick="window.plReprocessReceipt()" class="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold cursor-pointer">Proses Ulang OCR</button>
                </div>
                <div class="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label class="block text-[11px] text-slate-500 mb-1">Rotasi (${state.preprocessConfig.rotation}°)</label>
                    <button type="button" onclick="window.plRotateReceipt()" class="w-full py-1.5 px-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-semibold flex items-center justify-center gap-1 cursor-pointer">
                      ${iconSvg('rotate', 'w-3.5 h-3.5')} <span>Putar 90°</span>
                    </button>
                  </div>
                  <div>
                    <label class="block text-[11px] text-slate-500 mb-1">Kontras (+${state.preprocessConfig.contrast})</label>
                    <input type="range" min="0" max="55" step="5" value="${state.preprocessConfig.contrast}" onchange="window.plUpdatePreprocess('contrast', Number(this.value))" class="w-full accent-emerald-500" />
                  </div>
                </div>
              </div>

              <div class="pt-2 border-t border-slate-100 dark:border-slate-800">
                <p class="text-xs font-semibold text-slate-500 mb-2">Uji OCR Nyata dengan Struk Bitmap (Dirender ke Canvas &amp; Dibaca OCR):</p>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  ${OCR_PRESET_TEMPLATES.map((p) => `
                    <button type="button" onclick="window.plLoadPresetReceipt('${p.id}')" class="text-left p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500/50 bg-slate-50/70 dark:bg-slate-800/50 cursor-pointer">
                      <div class="text-xs font-semibold truncate">${escapeHtml(p.label)}</div>
                      <div class="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono truncate">${escapeHtml(p.merchant)}</div>
                    </button>
                  `).join('')}
                </div>
              </div>

              <div class="pt-2 border-t border-slate-100 dark:border-slate-800">
                <p class="text-xs font-semibold text-slate-500 mb-2">Pratinjau Gambar Struk (Hasil Preprocessing):</p>
                ${state.scannerImage
                  ? `<div class="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-2 flex justify-center max-h-80"><img src="${state.scannerImage}" alt="Pratinjau Struk" class="max-h-72 w-auto object-contain rounded-lg" /></div>`
                  : `<div class="h-40 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-800 flex items-center justify-center text-xs text-slate-500 p-4 text-center">Belum ada struk dipilih. Unggah foto struk atau klik salah satu struk uji di atas.</div>`
                }
              </div>
            </div>
          </div>

          <div class="lg:col-span-7 space-y-4">
            <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div>
                  <h3 class="text-sm font-bold">2. Hasil Ekstraksi OCR (Dapat Diedit Sebelum Disimpan)</h3>
                  <p class="text-xs text-slate-500">Validasi otomatis mengutamakan GRAND TOTAL / TOTAL BAYAR &amp; mengabaikan nomor telepon</p>
                </div>
                ${ext ? `
                  <div class="flex items-center gap-2">
                    <span class="text-[11px] font-mono font-bold px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">Akurasi OCR: ${state.ocrConfidence ?? 90}%</span>
                    <span class="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">Total: ${formatIDR(ext.amount)}</span>
                  </div>
                ` : ''}
              </div>

              ${state.isOcrRunning || state.ocrInitRunning
                ? `<div class="py-16 text-center"><p class="text-sm font-semibold text-emerald-500">${escapeHtml(state.ocrProgressText || 'Memproses OCR lokal...')}</p></div>`
                : ext
                ? `
                  <div class="space-y-4">
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div class="sm:col-span-2">
                        <label class="block text-xs font-semibold text-slate-500 mb-1">Nama Toko / Merchant</label>
                        <input type="text" value="${escapeHtml(ext.merchant)}" oninput="window.plUpdateOcrField('merchant', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm" />
                      </div>
                      <div>
                        <label class="block text-xs font-semibold text-slate-500 mb-1">Metode Bayar</label>
                        <input type="text" value="${escapeHtml(ext.paymentMethod || 'Tunai')}" oninput="window.plUpdateOcrField('paymentMethod', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm" />
                      </div>
                      <div>
                        <label class="block text-xs font-semibold text-slate-500 mb-1">Tanggal Struk</label>
                        <input type="date" min="2026-11-01" max="2061-11-30" value="${escapeHtml(ext.date)}" onchange="window.plUpdateOcrField('date', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm" />
                      </div>
                      <div>
                        <label class="block text-xs font-semibold text-slate-500 mb-1">Kategori</label>
                        <select onchange="window.plUpdateOcrField('category', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm">
                          ${expCats.map((c) => `<option value="${c.id}" ${ext.category === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
                        </select>
                      </div>
                      <div>
                        <label class="block text-xs font-semibold text-slate-500 mb-1">Akun Pembayaran</label>
                        <select onchange="window.plUpdateOcrField('account', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm">
                          ${state.accounts.map((a) => `<option value="${a.id}" ${ext.account === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
                        </select>
                      </div>
                    </div>

                    <div class="border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-2">
                      <div class="flex items-center justify-between">
                        <span class="text-xs font-bold">Daftar Item Dibeli (${ext.items.length} item)</span>
                        <button type="button" onclick="window.plAddOcrItem()" class="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer">+ Tambah Baris Item</button>
                      </div>
                      <div class="space-y-2 max-h-56 overflow-y-auto">
                        ${ext.items.map((it) => `
                          <div class="grid grid-cols-12 gap-2 items-center bg-slate-50 dark:bg-slate-800/60 p-2 rounded-lg">
                            <input type="text" value="${escapeHtml(it.name)}" onchange="window.plUpdateOcrItem('${it.id}', 'name', this.value)" class="col-span-6 px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs" />
                            <input type="number" min="1" value="${it.qty}" onchange="window.plUpdateOcrItem('${it.id}', 'qty', this.value)" class="col-span-2 px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono text-center" />
                            <input type="number" min="0" step="500" value="${it.price}" onchange="window.plUpdateOcrItem('${it.id}', 'price', this.value)" class="col-span-3 px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono text-right" />
                            <button type="button" onclick="window.plRemoveOcrItem('${it.id}')" class="col-span-1 flex justify-center text-rose-500 cursor-pointer">${iconSvg('trash', 'w-3.5 h-3.5')}</button>
                          </div>
                        `).join('')}
                      </div>
                    </div>

                    <div class="border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-2">
                      <div class="flex items-center justify-between">
                        <button type="button" onclick="window.plToggleRawOcr()" class="text-xs font-bold text-teal-600 dark:text-teal-400 hover:underline cursor-pointer">
                          ${state.showRawOcrPanel ? 'Sembunyikan Teks Asli OCR' : 'Periksa Teks Asli Hasil Pembacaan OCR'}
                        </button>
                        ${state.showRawOcrPanel ? `<button type="button" onclick="window.plReparseRawOcr()" class="px-2.5 py-1 rounded-lg bg-teal-600 text-white text-[11px] font-semibold cursor-pointer">Ekstrak Ulang dari Teks</button>` : ''}
                      </div>
                      ${state.showRawOcrPanel ? `
                        <textarea rows="5" oninput="window.plUpdateOcrField('rawOcrText', this.value)" class="w-full p-2.5 rounded-lg bg-slate-950 text-emerald-300 font-mono text-xs border border-slate-700">${escapeHtml(ext.rawOcrText || '')}</textarea>
                      ` : ''}
                    </div>

                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <div>
                        <label class="block text-xs font-semibold text-slate-500 mb-1">Total Nominal Struk / GRAND TOTAL (IDR Bulat)</label>
                        <input type="number" value="${ext.amount}" oninput="window.plUpdateOcrField('amount', this.value)" class="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-base font-bold font-mono text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div class="flex items-center gap-2 self-end">
                        <button type="button" onclick="window.plCancelOcr()" class="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold cursor-pointer">Batal</button>
                        <button type="button" onclick="window.plConfirmSaveReceipt()" class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-bold shadow-md cursor-pointer">Konfirmasi &amp; Simpan Transaksi</button>
                      </div>
                    </div>
                  </div>
                `
                : `<div class="py-12 text-center text-sm text-slate-500">Pilih atau unggah struk di sebelah kiri untuk menjalankan OCR lokal.</div>`
              }
            </div>

            <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <h3 class="text-sm font-bold mb-3">Arsip Struk Tersimpan di IndexedDB (${state.receipts.length})</h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                ${state.receipts.map((r) => `
                  <div class="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-800/30">
                    <div class="min-w-0">
                      <p class="text-xs font-bold truncate">${escapeHtml(r.merchant)}</p>
                      <p class="text-[11px] text-slate-500">${formatIndoDate(r.date)} • ${r.items?.length || 0} item</p>
                      <p class="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">${formatIDR(r.amount)}</p>
                    </div>
                    <button type="button" onclick="window.plViewReceipt('${r.id}')" class="p-2 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 text-xs font-semibold flex items-center gap-1 shrink-0 cursor-pointer">
                      ${iconSvg('eye', 'w-3.5 h-3.5')} <span>Lihat</span>
                    </button>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  } else if (state.activeTab === 'transactions') {
    // =========================================================================
    // TAB 3: TRANSACTIONS MANAGEMENT
    // =========================================================================
    const filtered = filterAndSortTransactions({
      transactions: state.transactions,
      activeMonth: state.settings.activeMonth,
      filterMonthScope: state.filterMonthScope,
      filterType: state.filterType,
      filterCategory: state.filterCategory,
      filterAccount: state.filterAccount,
      searchQuery: state.searchQuery,
      categoriesList: state.categories
    });

    mainContentHtml = `
      <div class="space-y-5">
        <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 class="text-base font-bold">Manajemen Transaksi (${formatIndoMonth(state.settings.activeMonth)})</h2>
              <p class="text-xs text-slate-500">Tambah, ubah, hapus, dan saring pemasukan, pengeluaran, serta transfer antar-akun (Transfer tidak dihitung sebagai pemasukan/beban).</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" onclick="window.plOpenAddTxModal('income')" class="px-3 py-2 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-bold cursor-pointer">+ Tambah Pemasukan</button>
              <button type="button" onclick="window.plOpenAddTxModal('expense')" class="px-3 py-2 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 text-xs font-bold cursor-pointer">+ Tambah Pengeluaran</button>
              <button type="button" onclick="window.plOpenAddTxModal('transfer')" class="px-3 py-2 rounded-xl bg-slate-500/15 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer">Transfer Antar Akun</button>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <input type="text" value="${escapeHtml(state.searchQuery)}" oninput="window.plSetSearch(this.value)" placeholder="Cari nama transaksi atau catatan..." class="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm" />
            <select onchange="window.plSetFilterScope(this.value)" class="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm">
              <option value="active" ${state.filterMonthScope === 'active' ? 'selected' : ''}>Bulan Aktif (${formatIndoMonth(state.settings.activeMonth)})</option>
              <option value="all" ${state.filterMonthScope === 'all' ? 'selected' : ''}>Semua Periode Bulan &amp; Tahun</option>
            </select>
            <select onchange="window.plSetFilterType(this.value)" class="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm">
              <option value="all" ${state.filterType === 'all' ? 'selected' : ''}>Semua Jenis</option>
              <option value="income" ${state.filterType === 'income' ? 'selected' : ''}>Pemasukan</option>
              <option value="expense" ${state.filterType === 'expense' ? 'selected' : ''}>Pengeluaran</option>
              <option value="transfer" ${state.filterType === 'transfer' ? 'selected' : ''}>Transfer Akun (Non-Beban)</option>
            </select>
            <select onchange="window.plSetFilterCategory(this.value)" class="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm">
              <option value="all" ${state.filterCategory === 'all' ? 'selected' : ''}>Semua Kategori</option>
              ${state.categories.map((c) => `<option value="${c.id}" ${state.filterCategory === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
            <select onchange="window.plSetFilterAccount(this.value)" class="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm">
              <option value="all" ${state.filterAccount === 'all' ? 'selected' : ''}>Semua Akun</option>
              ${state.accounts.map((a) => `<option value="${a.id}" ${state.filterAccount === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div class="px-5 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex justify-between text-xs font-semibold text-slate-500">
            <span>Menampilkan ${filtered.length} transaksi</span>
            <span>Nominal (IDR Bulat)</span>
          </div>
          <div class="divide-y divide-slate-100 dark:divide-slate-800">
            ${filtered.map((tx) => {
              const cat = findCategoryMeta(tx.category, state.categories);
              const accName = state.accounts.find((a) => a.id === tx.account)?.name || tx.account;
              const toAccName = tx.toAccount ? state.accounts.find((a) => a.id === tx.toAccount)?.name || tx.toAccount : '';
              const wNum = getWeekOfMonth(tx.date, state.settings.weekStartDay);
              return `
                <div class="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div class="space-y-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-sm font-bold">${escapeHtml(tx.title)}</span>
                      <span class="px-2 py-0.5 rounded-md text-[11px] font-semibold ${cat.badgeBg}">${escapeHtml(cat.name)}</span>
                      <span class="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500">Minggu ke-${wNum}</span>
                    </div>
                    <div class="text-xs text-slate-500">${formatIndoDate(tx.date)} • ${escapeHtml(tx.type === 'transfer' ? `${accName} → ${toAccName}` : accName)} ${tx.note ? `• "${escapeHtml(tx.note)}"` : ''}</div>
                  </div>
                  <div class="flex items-center justify-between sm:justify-end gap-3">
                    <span class="text-sm sm:text-base font-bold font-mono ${tx.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : tx.type === 'transfer' ? 'text-slate-500' : 'text-rose-600 dark:text-rose-400'}">
                      ${tx.type === 'income' ? '+' + formatIDR(tx.amount) : tx.type === 'transfer' ? formatIDR(tx.amount) + ' (Transfer)' : '-' + formatIDR(tx.amount)}
                    </span>
                    <div class="flex items-center gap-1">
                      ${tx.receiptId ? `<button type="button" onclick="window.plViewReceipt('${tx.receiptId}')" class="p-2 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 cursor-pointer" title="Lihat Struk">${iconSvg('receipt', 'w-4 h-4')}</button>` : ''}
                      <button type="button" onclick="window.plOpenEditTxModal('${tx.id}')" class="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer">${iconSvg('edit', 'w-4 h-4')}</button>
                      <button type="button" onclick="window.plConfirmDeleteTx('${tx.id}')" class="p-2 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 cursor-pointer">${iconSvg('trash', 'w-4 h-4')}</button>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  } else if (state.activeTab === 'analytics') {
    // =========================================================================
    // TAB 4: ANALYTICS (Daily, Weekly, Monthly, Annual + Financial Conclusion)
    // =========================================================================
    const conclusion = generateFinancialConclusion({
      activeMonth: state.settings.activeMonth,
      transactions: state.transactions,
      activeRollover: snap.activeRollover
    });
    const annualSummary = computeAnnualReportSeries(activeYear, state.transactions);

    mainContentHtml = `
      <div class="space-y-6">
        <!-- Concise Financial Conclusion Banner Derived from Stored Records -->
        <div class="p-4 rounded-2xl border ${conclusion.isDeficit ? 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'} flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div class="text-xs font-bold uppercase tracking-wider opacity-80">Kesimpulan Analitik Otomatis</div>
            <div class="text-sm sm:text-base font-bold mt-0.5">${escapeHtml(conclusion.headline)}</div>
          </div>
          <div class="text-xs font-mono font-bold px-3 py-1.5 rounded-xl bg-white/60 dark:bg-slate-900/60 shrink-0">
            ${escapeHtml(conclusion.netCashflowLabel)}
          </div>
        </div>

        <div class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-bold">Laporan &amp; Analitik Keuangan (${formatIndoMonth(state.settings.activeMonth)})</h2>
            <p class="text-xs text-slate-500">Harian, Mingguan, Bulanan, dan Tahunan (${activeYear}: Pemasukan ${formatIDR(annualSummary.totalAnnualIncome)} vs Pengeluaran ${formatIDR(annualSummary.totalAnnualExpenses)})</p>
          </div>
          <div class="flex flex-wrap items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
            <button type="button" onclick="window.plSetAnalyticsPeriod('daily')" class="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${state.analyticsPeriod === 'daily' ? 'bg-emerald-600 text-white' : 'text-slate-500'}">Laporan Harian</button>
            <button type="button" onclick="window.plSetAnalyticsPeriod('weekly')" class="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${state.analyticsPeriod === 'weekly' ? 'bg-emerald-600 text-white' : 'text-slate-500'}">Laporan Mingguan</button>
            <button type="button" onclick="window.plSetAnalyticsPeriod('monthly')" class="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${state.analyticsPeriod === 'monthly' ? 'bg-emerald-600 text-white' : 'text-slate-500'}">Laporan Bulanan</button>
            <button type="button" onclick="window.plSetAnalyticsPeriod('annual')" class="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${state.analyticsPeriod === 'annual' ? 'bg-emerald-600 text-white' : 'text-slate-500'}">Laporan Tahunan (${activeYear})</button>
          </div>
        </div>

        <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div class="relative h-72 w-full">
            <canvas id="pl-analytics-main-chart"></canvas>
          </div>
        </div>

        <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <h3 class="text-sm font-bold">Rincian Pengeluaran per Kategori vs Anggaran Kategori (${formatIndoMonth(state.settings.activeMonth)})</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${state.categories.filter((c) => c.type === 'expense').map((cat) => {
              const actual = toIntIDR(snap.categorySpending[cat.id] || 0);
              const budget = toIntIDR(snap.monthBudget.categoryBudgets?.[cat.id] || 0);
              const pct = budget > 0 ? Math.min(100, Math.round((actual / budget) * 100)) : 0;
              const over = actual > budget && budget > 0;
              return `
                <div class="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2">
                  <div class="flex justify-between text-xs font-bold">
                    <span>${escapeHtml(cat.name)}</span>
                    <span class="font-mono">${formatIDR(actual)} / ${formatIDR(budget)}</span>
                  </div>
                  <div class="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                    <div class="h-full rounded-full" style="width: ${pct}%; background-color: ${over ? '#ef4444' : cat.color}"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  } else if (state.activeTab === 'settings') {
    // =========================================================================
    // TAB 5: MORE MENU (Anggaran & Rollover, Tabungan, Investasi, Pinjaman, Pajak, Akun/Kategori, Backup, Tentang)
    // =========================================================================
    const moreTabs = [
      { id: 'budgets', label: 'Anggaran & Rollover' },
      { id: 'savings', label: 'Tabungan (Savings)' },
      { id: 'investments', label: 'Kalkulator Investasi' },
      { id: 'loans', label: 'Pinjaman & Cicilan' },
      { id: 'tax', label: 'Kalkulator Pajak & Zakat' },
      { id: 'entities', label: 'Akun & Kategori Kustom' },
      { id: 'backup', label: 'Cadangan & Pemulihan' },
      { id: 'about', label: 'Pengaturan & Tentang' }
    ];

    const primaryGoal = state.savings[0] || DEFAULT_SAVINGS_GOALS[0];
    const savResult = calculateSavingsProjection({
      targetAmount: primaryGoal.targetAmount,
      currentSavings: snap.totalEffectiveSavings,
      monthlyContribution: primaryGoal.monthlyContributionTarget
    });

    const primaryInv = state.investments[0] || DEFAULT_INVESTMENTS[0];
    const invResult = calculateInvestmentProjection(primaryInv);

    const loanCfg = state.settings.loanConfig || INITIAL_SETTINGS.loanConfig;
    const loanResult = calculateLoanInstallment(loanCfg);

    const taxCfg = state.settings.taxConfig || INITIAL_SETTINGS.taxConfig;
    const taxResult = calculateTaxAndZakat(taxCfg);

    mainContentHtml = `
      <div class="space-y-6">
        <!-- Sub-Menu Bar Inside "More" -->
        <div class="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-wrap items-center gap-2">
          ${moreTabs.map((mt) => `
            <button type="button" onclick="window.plSwitchMoreSubTab('${mt.id}')" class="px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${state.moreSubTab === mt.id ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'}">
              ${mt.label}
            </button>
          `).join('')}
        </div>

        <!-- 1. BUDGETS (Tipe A/B/C), ROLLOVER ENGINE & QUICK INCOME (Always rendered when in 'budgets' sub-tab) -->
        ${state.moreSubTab === 'budgets' ? `
          <div class="space-y-6">
            <!-- Rollover Engine & Surplus Allocation Card -->
            <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-emerald-500/30 shadow-sm space-y-4">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span class="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">Mesin Rollover Kumulatif &amp; Isolasi Defisit</span>
                  <h2 class="text-base font-bold mt-1">Evaluasi &amp; Alokasi Rollover (${formatIndoMonth(state.settings.activeMonth)})</h2>
                  <p class="text-xs text-slate-500">Hanya sisa anggaran positif (Surplus) yang dapat diteruskan. Defisit dicatat secara analitik dan tidak pernah memotong anggaran bulan depan.</p>
                </div>
                <div class="text-right font-mono text-xs">
                  <div>Anggaran Dasar: <strong>${formatIDR(snap.activeRollover.baseBudget)}</strong></div>
                  <div>Carryover Masuk: <strong class="text-teal-500">+${formatIDR(snap.activeRollover.carryoverIn)}</strong></div>
                  <div>Total Anggaran Efektif: <strong>${formatIDR(snap.activeRollover.totalEffectiveBudget)}</strong></div>
                </div>
              </div>

              ${snap.activeRollover.status === 'deficit' ? `
                <div class="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300">
                  <strong>Status Defisit Analitik (-${formatIDR(snap.activeRollover.deficitAmount)}):</strong> Pengeluaran aktual (${formatIDR(snap.activeRollover.actualExpenses)}) melampaui anggaran efektif (${formatIDR(snap.activeRollover.totalEffectiveBudget)}). Sesuai aturan isolasi defisit, nilai Rollover ke bulan ${formatIndoMonth(snap.activeRollover.nextMonth)} dikunci pada <strong>Rp 0</strong> agar tidak mengurangi kuota anggaran bulan depan.
                </div>
              ` : `
                <div class="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                  <div>
                    <label class="block text-[11px] font-semibold text-slate-500 mb-1">Surplus Siap Alokasi</label>
                    <div class="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400">${formatIDR(snap.activeRollover.eligibleRollover)}</div>
                  </div>
                  <div>
                    <label class="block text-[11px] font-semibold text-slate-500 mb-1">Alokasi ke Tabungan (IDR)</label>
                    <input id="pl-roll-sav" type="number" step="25000" value="${snap.activeRollover.allocatedToSavings}" class="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono font-bold" />
                  </div>
                  <div>
                    <label class="block text-[11px] font-semibold text-slate-500 mb-1">Alokasi ke Investasi (IDR)</label>
                    <input id="pl-roll-inv" type="number" step="25000" value="${snap.activeRollover.allocatedToInvestments}" class="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono font-bold" />
                  </div>
                  <div>
                    <label class="block text-[11px] font-semibold text-slate-500 mb-1">Ditahan ke ${formatIndoMonth(snap.activeRollover.nextMonth)}</label>
                    <div class="text-sm font-bold font-mono text-teal-600 dark:text-teal-400 mt-1">${formatIDR(snap.activeRollover.retainedForNextMonth)}</div>
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <button type="button" onclick="window.plSaveRolloverAllocation('${state.settings.activeMonth}')" class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer">Simpan Alokasi Rollover</button>
                  <button type="button" onclick="window.plTransferRolloverToSavingsAccount('${state.settings.activeMonth}')" class="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold cursor-pointer">
                    ${snap.activeRollover.linkedTransferTxId ? '✓ Kas Sudah Ditransfer ke Tabungan' : 'Transfer Kas Fisik ke Akun Tabungan (Anti-Double-Count)'}
                  </button>
                </div>
              `}
            </div>

            <!-- 3-Tier Budget Rule Creator (Type A, Type B, Type C) -->
            <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <div>
                <h2 class="text-base font-bold">Sistem Anggaran 3 Tipe (Tipe A Bulanan, Tipe B Rentang Bulan, Tipe C Permanen)</h2>
                <p class="text-xs text-slate-500">Aturan Prioritas: Tipe A (Bulan Tunggal) &gt; Tipe B (Rentang Tanggal) &gt; Tipe C (Permanen). Anggaran aktif saat ini: <strong>${escapeHtml(snap.monthBudget.appliedTypeLabel)}</strong>.</p>
              </div>
              <form onsubmit="window.plSaveCustomBudgetRule(event)" class="grid grid-cols-1 sm:grid-cols-5 gap-3 bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                <div>
                  <label class="block text-[11px] font-semibold text-slate-500 mb-1">Tipe Anggaran</label>
                  <select id="pl-brule-type" class="w-full px-2.5 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold">
                    <option value="monthly_once">Tipe A — Satu Bulan</option>
                    <option value="date_range">Tipe B — Rentang Bulan</option>
                    <option value="permanent">Tipe C — Permanen</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[11px] font-semibold text-slate-500 mb-1">Batas Belanja (IDR)</label>
                  <input id="pl-brule-limit" type="number" step="50000" value="${snap.monthlySpendingBudget}" class="w-full px-2.5 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono font-bold" />
                </div>
                <div>
                  <label class="block text-[11px] font-semibold text-slate-500 mb-1">Mulai / Bulan (YYYY-MM)</label>
                  <input id="pl-brule-start" type="month" min="2026-11" max="2061-11" value="${state.settings.activeMonth}" class="w-full px-2.5 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono" />
                </div>
                <div>
                  <label class="block text-[11px] font-semibold text-slate-500 mb-1">Sampai (Khusus Tipe B)</label>
                  <input id="pl-brule-end" type="month" min="2026-11" max="2061-11" value="${shiftMonthKey(state.settings.activeMonth, 5)}" class="w-full px-2.5 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono" />
                </div>
                <div class="flex items-end">
                  <button type="submit" class="w-full py-2 px-3 rounded-lg bg-emerald-600 text-white text-xs font-bold cursor-pointer">Simpan Aturan</button>
                </div>
              </form>

              <div class="space-y-2">
                <div class="text-xs font-bold text-slate-500">Daftar Aturan Anggaran Tersimpan (${state.budgets.length}):</div>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  ${state.budgets.map((b) => `
                    <div class="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                      <div>
                        <div class="font-bold">${b.budgetType === 'date_range' ? `Tipe B: ${b.startMonth} s.d. ${b.endMonth}` : b.budgetType === 'permanent' ? `Tipe C: Permanen (${b.effectiveFrom || '2026-01'})` : `Tipe A: Bulan ${b.month}`}</div>
                        <div class="font-mono text-emerald-600 dark:text-emerald-400 font-bold mt-0.5">${formatIDR(b.monthlySpendingBudget)}</div>
                      </div>
                      ${b.id !== 'budget_perm_default' ? `<button type="button" onclick="window.plDeleteBudgetRule('${b.id}')" class="p-1.5 text-rose-500 cursor-pointer">${iconSvg('trash', 'w-4 h-4')}</button>` : ''}
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>

            <!-- Quick Monthly Config & Additional Income (Preserving IDs for regression check) -->
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div class="lg:col-span-6 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                <h2 class="text-base font-bold">Konfigurasi Cepat (${formatIndoMonth(state.settings.activeMonth)})</h2>
                <div class="space-y-3">
                  <div>
                    <label class="block text-xs font-semibold text-slate-500 mb-1">Saldo Awal Rekening Utama (IDR)</label>
                    <input type="number" step="10000" value="${state.settings.startingBalance}" onchange="window.plUpdateStartingBalance(this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-500 mb-1">Uang Saku Bulanan (IDR)</label>
                    <div class="flex gap-2">
                      <input type="number" step="50000" value="${snap.monthBudget.monthlyAllowance}" onchange="window.plUpdateMonthlyBudgetField('monthlyAllowance', this.value)" class="flex-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
                      <button type="button" onclick="window.plSyncAllowanceIncome()" class="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold cursor-pointer">Catat ke Pemasukan</button>
                    </div>
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-500 mb-1">Batas Pengeluaran Bulanan (IDR)</label>
                    <input type="number" step="50000" value="${snap.monthBudget.monthlySpendingBudget}" onchange="window.plUpdateMonthlyBudgetField('monthlySpendingBudget', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
                  </div>
                </div>
              </div>

              <div class="lg:col-span-6 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                <h2 class="text-base font-bold">Tambah Pemasukan Tambahan</h2>
                <form onsubmit="window.plSubmitAdditionalIncome(event)" class="space-y-3">
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label class="block text-xs font-semibold text-slate-500 mb-1">Sumber Pemasukan</label>
                      <input id="pl-add-inc-title" type="text" placeholder="Honor Proyek Web" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm" />
                    </div>
                    <div>
                      <label class="block text-xs font-semibold text-slate-500 mb-1">Nominal (IDR)</label>
                      <input id="pl-add-inc-amt" type="number" placeholder="350000" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono" />
                    </div>
                    <div>
                      <label class="block text-xs font-semibold text-slate-500 mb-1">Kategori</label>
                      <select id="pl-add-inc-cat" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm">
                        ${state.categories.filter((c) => c.type === 'income').map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
                      </select>
                    </div>
                    <div>
                      <label class="block text-xs font-semibold text-slate-500 mb-1">Tanggal</label>
                      <input id="pl-add-inc-date" type="date" min="2026-11-01" max="2061-11-30" value="${state.settings.activeMonth}-16" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm" />
                    </div>
                  </div>
                  <button type="submit" class="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-bold cursor-pointer">+ Simpan Pemasukan Tambahan</button>
                </form>
              </div>
            </div>

            <!-- Weekly Allocations & Category Budgets -->
            <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <h2 class="text-base font-bold">Alokasi Anggaran Mingguan (${snap.calWeeks.length} Minggu Kalender) &amp; Per Kategori</h2>
                <div class="flex items-center gap-2">
                  <button type="button" onclick="window.plDivideWeeklyProportional()" class="px-3 py-2 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-bold cursor-pointer">Bagi Proporsional Hari</button>
                  <button type="button" onclick="window.plDivideWeeklyEqual()" class="px-3 py-2 rounded-xl bg-teal-500/15 text-teal-600 dark:text-teal-400 text-xs font-bold cursor-pointer">Bagi Rata Mingguan</button>
                </div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                ${snap.calWeeks.map((w) => `
                  <div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1">
                    <label class="text-xs font-bold block">Minggu ${w.weekNum} (${w.rangeLabel})</label>
                    <input type="number" step="25000" value="${snap.monthBudget.weeklyAllocations?.[w.weekNum] || 0}" onchange="window.plUpdateWeeklyAllocation(${w.weekNum}, this.value)" class="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono font-bold" />
                  </div>
                `).join('')}
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                ${state.categories.filter((c) => c.type === 'expense').map((cat) => `
                  <div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-1">
                    <label class="text-xs font-bold block">${escapeHtml(cat.name)}</label>
                    <input type="number" step="25000" value="${snap.monthBudget.categoryBudgets?.[cat.id] || 0}" onchange="window.plUpdateCategoryBudget('${cat.id}', this.value)" class="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono font-bold" />
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        ` : ''}

        <!-- 2. SAVINGS CALCULATOR & GOAL TRACKER -->
        ${state.moreSubTab === 'savings' ? `
          <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
            <div>
              <h2 class="text-base font-bold">Kalkulator &amp; Pelacak Target Tabungan (Savings)</h2>
              <p class="text-xs text-slate-500">Terhubung otomatis dengan saldo Akun Tabungan (${formatIDR(snap.savingsAccountsTotal)}) dan Alokasi Rollover Tabungan yang belum ditransfer (${formatIDR(snap.untransferredRolloverSavings)}) tanpa hitung ganda.</p>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label class="block text-xs font-semibold text-slate-500 mb-1">Nama Target Tabungan</label>
                <input type="text" value="${escapeHtml(primaryGoal.name)}" onchange="window.plUpdateSavingsGoal('name', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-semibold" />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-500 mb-1">Target Nominal Tabungan (IDR)</label>
                <input type="number" step="100000" value="${primaryGoal.targetAmount}" onchange="window.plUpdateSavingsGoal('targetAmount', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-500 mb-1">Rencana Setoran Bulanan (IDR)</label>
                <input type="number" step="50000" value="${primaryGoal.monthlyContributionTarget}" onchange="window.plUpdateSavingsGoal('monthlyContributionTarget', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
              </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-4 gap-4 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700">
              <div>
                <div class="text-xs text-slate-500">Tabungan Terkumpul Saat Ini</div>
                <div class="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">${formatIDR(savResult.effectiveCurrentSaved)}</div>
              </div>
              <div>
                <div class="text-xs text-slate-500">Sisa Target Tabungan</div>
                <div class="text-xl font-bold font-mono text-amber-600 dark:text-amber-400 mt-1">${formatIDR(savResult.remainingTarget)}</div>
              </div>
              <div>
                <div class="text-xs text-slate-500">Progres Capaian</div>
                <div class="text-xl font-bold font-mono text-teal-600 dark:text-teal-400 mt-1">${savResult.progressPct}%</div>
              </div>
              <div>
                <div class="text-xs text-slate-500">Estimasi Waktu Tercapai</div>
                <div class="text-xl font-bold font-mono mt-1">${savResult.estimatedMonths !== null ? `${savResult.estimatedMonths} Bulan` : 'Atur Setoran'}</div>
              </div>
            </div>
          </div>
        ` : ''}

        <!-- 3. INVESTMENT PROJECTION CALCULATOR -->
        ${state.moreSubTab === 'investments' ? `
          <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
            <div>
              <h2 class="text-base font-bold">Kalkulator Proyeksi Pertumbuhan Investasi</h2>
              <p class="text-xs text-slate-500">Asumsi Perhitungan: ${escapeHtml(invResult.compoundingAssumption)}. <em>Penafian: Seluruh angka di bawah adalah proyeksi matematis berdasarkan asumsi pengguna, bukan jaminan imbal hasil dan bukan nasihat keuangan.</em></p>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label class="block text-xs font-semibold text-slate-500 mb-1">Modal Awal (IDR)</label>
                <input type="number" step="100000" value="${primaryInv.initialCapital}" onchange="window.plUpdateInvestmentSim('initialCapital', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-500 mb-1">Setoran Rutin Bulanan (IDR)</label>
                <input type="number" step="50000" value="${primaryInv.monthlyContribution}" onchange="window.plUpdateInvestmentSim('monthlyContribution', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-500 mb-1">Estimasi Imbal Hasil (%/Tahun)</label>
                <input type="number" step="0.5" value="${primaryInv.annualReturnRatePct}" onchange="window.plUpdateInvestmentSim('annualReturnRatePct', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-500 mb-1">Durasi Investasi (Bulan)</label>
                <input type="number" min="1" max="360" value="${primaryInv.durationMonths}" onchange="window.plUpdateInvestmentSim('durationMonths', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
              </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700">
              <div>
                <div class="text-xs text-slate-500">Estimasi Nilai Akumulasi Akhir (Proyeksi)</div>
                <div class="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">${formatIDR(invResult.accumulatedValue)}</div>
              </div>
              <div>
                <div class="text-xs text-slate-500">Total Modal Pokok Disetor</div>
                <div class="text-2xl font-bold font-mono mt-1">${formatIDR(invResult.totalContributed)}</div>
              </div>
              <div>
                <div class="text-xs text-slate-500">Estimasi Pertumbuhan Hasil Investasi</div>
                <div class="text-2xl font-bold font-mono text-teal-600 dark:text-teal-400 mt-1">+${formatIDR(invResult.estimatedGrowth)}</div>
              </div>
            </div>
          </div>
        ` : ''}

        <!-- 4. LOAN & INSTALLMENT CALCULATOR (Flat vs Effective) -->
        ${state.moreSubTab === 'loans' ? `
          <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
            <div>
              <h2 class="text-base font-bold">Kalkulator Pinjaman &amp; Simulasi Cicilan (Bunga Flat vs Efektif/Anuitas)</h2>
              <p class="text-xs text-slate-500">Bandingkan angsuran bulanan dan total beban bunga antara metode Bunga Flat (dihitung dari pokok awal) dan Bunga Efektif/Anuitas (dihitung dari sisa pokok pinjaman).</p>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label class="block text-xs font-semibold text-slate-500 mb-1">Pokok Pinjaman (IDR)</label>
                <input type="number" step="500000" value="${loanCfg.principal}" onchange="window.plUpdateLoanConfig('principal', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-500 mb-1">Suku Bunga (%/Tahun)</label>
                <input type="number" step="0.5" value="${loanCfg.annualInterestRatePct}" onchange="window.plUpdateLoanConfig('annualInterestRatePct', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-500 mb-1">Tenor Pinjaman (Bulan)</label>
                <input type="number" min="1" max="240" value="${loanCfg.durationMonths}" onchange="window.plUpdateLoanConfig('durationMonths', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-500 mb-1">Metode Perhitungan</label>
                <select onchange="window.plUpdateLoanConfig('method', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold">
                  <option value="effective" ${loanCfg.method === 'effective' ? 'selected' : ''}>Bunga Efektif / Anuitas</option>
                  <option value="flat" ${loanCfg.method === 'flat' ? 'selected' : ''}>Bunga Flat</option>
                </select>
              </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="p-4 rounded-2xl border ${loanCfg.method === 'flat' ? 'border-emerald-500 bg-emerald-500/5' : 'border-slate-200 dark:border-slate-800'} space-y-2">
                <div class="text-xs font-bold uppercase text-slate-500">Metode Bunga Flat</div>
                <div class="text-lg font-bold font-mono">Cicilan: ${formatIDR(loanResult.comparison.flat.monthlyInstallment)} / bln</div>
                <div class="text-xs font-mono text-slate-500">Total Bayar: ${formatIDR(loanResult.comparison.flat.totalRepayment)} • Total Bunga: ${formatIDR(loanResult.comparison.flat.totalInterest)}</div>
              </div>
              <div class="p-4 rounded-2xl border ${loanCfg.method === 'effective' ? 'border-emerald-500 bg-emerald-500/5' : 'border-slate-200 dark:border-slate-800'} space-y-2">
                <div class="text-xs font-bold uppercase text-slate-500">Metode Bunga Efektif / Anuitas</div>
                <div class="text-lg font-bold font-mono">Cicilan: ${formatIDR(loanResult.comparison.effective.monthlyInstallment)} / bln</div>
                <div class="text-xs font-mono text-slate-500">Total Bayar: ${formatIDR(loanResult.comparison.effective.totalRepayment)} • Total Bunga: ${formatIDR(loanResult.comparison.effective.totalInterest)}</div>
              </div>
            </div>
          </div>
        ` : ''}

        <!-- 5. CONFIGURABLE TAX & ZAKAT CALCULATOR -->
        ${state.moreSubTab === 'tax' ? `
          <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
            <div>
              <h2 class="text-base font-bold">Kalkulator Pajak &amp; Zakat Penghasilan Terkonfigurasi</h2>
              <p class="text-xs text-slate-500">${escapeHtml(taxResult.notes)}</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" onclick="window.plUpdateTaxConfig('mode', 'pph21')" class="px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer ${taxCfg.mode === 'pph21' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}">Simulasi PPh 21 OP</button>
              <button type="button" onclick="window.plUpdateTaxConfig('mode', 'umkm')" class="px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer ${taxCfg.mode === 'umkm' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}">PPh Final UMKM</button>
              <button type="button" onclick="window.plUpdateTaxConfig('mode', 'zakat')" class="px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer ${taxCfg.mode === 'zakat' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}">Zakat Penghasilan / Maal</button>
            </div>

            ${taxCfg.mode === 'pph21' ? `
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label class="block text-xs font-semibold text-slate-500 mb-1">Penghasilan Bruto Bulanan (IDR)</label>
                  <input type="number" step="500000" value="${taxCfg.grossMonthlyIncome}" onchange="window.plUpdateTaxConfig('grossMonthlyIncome', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-500 mb-1">PTKP Tahunan Terkonfigurasi (IDR)</label>
                  <input type="number" step="4500000" value="${taxCfg.ptkpAnnual}" onchange="window.plUpdateTaxConfig('ptkpAnnual', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-500 mb-1">Pengurang / Biaya Jabatan (%)</label>
                  <input type="number" step="0.5" value="${taxCfg.deductionPct}" onchange="window.plUpdateTaxConfig('deductionPct', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
                </div>
              </div>
            ` : taxCfg.mode === 'umkm' ? `
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-semibold text-slate-500 mb-1">Omzet Bruto Bulanan UMKM (IDR)</label>
                  <input type="number" step="1000000" value="${taxCfg.umkmMonthlyTurnover}" onchange="window.plUpdateTaxConfig('umkmMonthlyTurnover', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-500 mb-1">Tarif PPh Final UMKM (%)</label>
                  <input type="number" step="0.1" value="${taxCfg.umkmRatePct}" onchange="window.plUpdateTaxConfig('umkmRatePct', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
                </div>
              </div>
            ` : `
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label class="block text-xs font-semibold text-slate-500 mb-1">Penghasilan Bulanan (IDR)</label>
                  <input type="number" step="500000" value="${taxCfg.zakatMonthlyIncome}" onchange="window.plUpdateTaxConfig('zakatMonthlyIncome', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-500 mb-1">Kebutuhan Pokok Pengurang (IDR)</label>
                  <input type="number" step="250000" value="${taxCfg.zakatDeductibleNeeds}" onchange="window.plUpdateTaxConfig('zakatDeductibleNeeds', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-500 mb-1">Harga Emas acuan Nisab 85g (IDR/g)</label>
                  <input type="number" step="50000" value="${taxCfg.goldPricePerGram}" onchange="window.plUpdateTaxConfig('goldPricePerGram', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
                </div>
              </div>
            `}

            <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div class="text-xs font-bold text-emerald-600 dark:text-emerald-400">${escapeHtml(taxResult.summaryLabel)}</div>
                <div class="text-xs text-slate-500 mt-0.5">Dasar Perhitungan Tahunan: ${formatIDR(taxResult.annualBase)}</div>
              </div>
              <div class="text-right font-mono">
                <div class="text-xl font-bold text-slate-900 dark:text-white">${formatIDR(taxResult.monthlyObligation)} / bln</div>
                <div class="text-xs text-slate-500">${formatIDR(taxResult.annualObligation)} / tahun</div>
              </div>
            </div>
          </div>
        ` : ''}

        <!-- 6. CUSTOM ACCOUNTS & CATEGORIES MANAGER -->
        ${state.moreSubTab === 'entities' ? `
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <h2 class="text-base font-bold">Manajemen Akun Kas, Bank, E-Wallet &amp; Tabungan</h2>
              <form onsubmit="window.plAddCustomAccount(event)" class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input id="pl-new-acc-name" type="text" placeholder="Nama Akun Baru" class="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs" />
                <select id="pl-new-acc-type" class="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                  <option value="cash">Tunai (Cash)</option>
                  <option value="bank">Bank</option>
                  <option value="ewallet">E-Wallet</option>
                  <option value="savings">Tabungan</option>
                </select>
                <div class="flex gap-1">
                  <input id="pl-new-acc-bal" type="number" placeholder="Saldo Awal" class="w-full px-2 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono" />
                  <button type="submit" class="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold cursor-pointer">+</button>
                </div>
              </form>
              <div class="space-y-2">
                ${state.accounts.map((a) => `
                  <div class="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                    <div>
                      <div class="font-bold">${escapeHtml(a.name)} <span class="text-[10px] uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">${a.type}</span></div>
                      <div class="text-slate-500 font-mono mt-0.5">Saldo Saat Ini: <strong>${formatIDR(snap.accountBalances[a.id] || 0)}</strong></div>
                    </div>
                    <div class="flex items-center gap-2">
                      <input type="number" step="25000" value="${a.initialBalance || 0}" onchange="window.plUpdateAccountInitBalance('${a.id}', this.value)" title="Saldo Awal Akun" class="w-28 px-2 py-1 rounded bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-right" />
                      ${!a.isSystem ? `<button type="button" onclick="window.plDeleteAccount('${a.id}')" class="p-1.5 text-rose-500 cursor-pointer">${iconSvg('trash', 'w-4 h-4')}</button>` : ''}
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>

            <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <h2 class="text-base font-bold">Manajemen Kategori Kustom (Dengan Migrasi Aman)</h2>
              <form onsubmit="window.plAddCustomCategory(event)" class="flex gap-2">
                <input id="pl-new-cat-name" type="text" placeholder="Nama Kategori Baru (mis. SPP / Kos)" class="flex-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs" />
                <select id="pl-new-cat-type" class="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                  <option value="expense">Pengeluaran</option>
                  <option value="income">Pemasukan</option>
                </select>
                <button type="submit" class="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold cursor-pointer">+ Tambah</button>
              </form>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
                ${state.categories.map((c) => `
                  <div class="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                    <div>
                      <span class="font-bold">${escapeHtml(c.name)}</span>
                      <span class="block text-[10px] text-slate-500">${c.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}</span>
                    </div>
                    <button type="button" onclick="window.plRequestDeleteCategory('${c.id}')" class="p-1.5 text-rose-500 hover:bg-rose-500/10 rounded-lg cursor-pointer" title="Hapus / Pindahkan Kategori">${iconSvg('trash', 'w-3.5 h-3.5')}</button>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        ` : ''}

        <!-- 7. BACKUP & RESTORE (Always keep core buttons accessible) -->
        ${state.moreSubTab === 'backup' || state.moreSubTab === 'budgets' ? `
          <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <h2 class="text-base font-bold">Cadangan &amp; Pemulihan Data (JSON Backup v3.0 — Pratinjau &amp; Validasi Aman)</h2>
            <p class="text-xs text-slate-500">Impor JSON memeriksa struktur berkas terlebih dahulu dan menampilkan dialog konfirmasi sebelum menggabungkan (Merge) atau mengganti (Replace) data.</p>
            <div class="flex flex-wrap items-center gap-3">
              <button type="button" onclick="window.plExportJson()" class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs sm:text-sm font-bold cursor-pointer">
                ${iconSvg('download', 'w-4 h-4')} <span>Ekspor Cadangan JSON</span>
              </button>
              <label class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 text-white text-xs sm:text-sm font-bold cursor-pointer">
                ${iconSvg('upload', 'w-4 h-4')} <span>Impor Berkas JSON</span>
                <input type="file" accept=".json,application/json" onchange="window.plImportJsonFile(this)" class="hidden" />
              </label>
              <button type="button" onclick="window.plOpenResetModal()" class="px-4 py-2.5 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs sm:text-sm font-bold cursor-pointer">Reset ke Data Sampel Awal</button>
            </div>
          </div>
        ` : ''}

        <!-- 8. SETTINGS & ABOUT APPLICATION -->
        ${state.moreSubTab === 'about' ? `
          <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <h2 class="text-base font-bold">Pengaturan Kalender &amp; Tentang Aplikasi PocketLedger v3.0</h2>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold text-slate-500 mb-1">Hari Awal Minggu Kalender</label>
                <select onchange="window.plSetWeekStartDay(this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold">
                  <option value="monday" ${state.settings.weekStartDay === 'monday' ? 'selected' : ''}>Senin – Minggu</option>
                  <option value="sunday" ${state.settings.weekStartDay === 'sunday' ? 'selected' : ''}>Minggu – Sabtu</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-500 mb-1">Loncat ke Tahun Kalender</label>
                <input type="number" min="2026" max="2061" value="${activeYear}" onchange="window.plSelectYearPart(this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono font-bold" />
              </div>
            </div>
            <div class="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs space-y-1.5 text-slate-600 dark:text-slate-300">
              <div><strong>Versi Aplikasi:</strong> ${APP_VERSION} (Database Skema v3 — 9 Object Stores Lokal)</div>
              <div><strong>Target Repositori GitHub Pages:</strong> <code>Pockets</code> (Path relatif penuh <code>./</code> untuk subdirektori GitHub Pages)</div>
              <div><strong>Kebijakan Privasi &amp; Offline:</strong> 100% data finansial disimpan di perangkat pengguna melalui IndexedDB tanpa pengiriman ke server eksternal.</div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // Bottom Mobile Navigation (5 Primary Menus)
  const mobileNavHtml = `
    <nav class="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 px-2 py-1.5 pl-one-hand-nav">
      <div class="grid grid-cols-5 gap-1 max-w-md mx-auto">
        ${navItems.map((it) => `
          <button type="button" onclick="window.plSwitchTab('${it.id}')" class="flex flex-col items-center justify-center py-1.5 px-1 rounded-xl cursor-pointer ${state.activeTab === it.id ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 font-bold' : 'text-slate-500'}">
            ${iconSvg(it.icon, 'w-5 h-5')}
            <span class="text-[10px] mt-0.5 truncate max-w-full">${it.label}</span>
          </button>
        `).join('')}
      </div>
    </nav>
  `;

  // Modals (Transaction Add/Edit, Delete, View Receipt, Safe Category Delete, Backup Preview, Reset, PWA Guide)
  const txModalHtml = state.isTxModalOpen ? `
    <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 class="text-base font-bold">${state.editingTxId ? 'Edit Transaksi' : 'Tambah Transaksi Baru'}</h3>
          <button type="button" onclick="window.plCloseTxModal()" class="p-1.5 text-slate-400 cursor-pointer">${iconSvg('x', 'w-5 h-5')}</button>
        </div>
        <form onsubmit="window.plSubmitTxForm(event)" class="p-5 space-y-4">
          <div class="grid grid-cols-3 gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            <button type="button" onclick="window.plSetTxFormType('expense')" class="py-2 rounded-lg text-xs font-bold cursor-pointer ${state.txForm.type === 'expense' ? 'bg-rose-600 text-white' : 'text-slate-500'}">Pengeluaran</button>
            <button type="button" onclick="window.plSetTxFormType('income')" class="py-2 rounded-lg text-xs font-bold cursor-pointer ${state.txForm.type === 'income' ? 'bg-emerald-600 text-white' : 'text-slate-500'}">Pemasukan</button>
            <button type="button" onclick="window.plSetTxFormType('transfer')" class="py-2 rounded-lg text-xs font-bold cursor-pointer ${state.txForm.type === 'transfer' ? 'bg-slate-700 text-white' : 'text-slate-500'}">Transfer Akun</button>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-500 mb-1">Judul / Deskripsi Transaksi</label>
            <input type="text" required value="${escapeHtml(state.txForm.title)}" oninput="window.plUpdateTxField('title', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-slate-500 mb-1">Nominal (IDR Bulat)</label>
              <input type="number" required min="1" value="${escapeHtml(state.txForm.amount)}" oninput="window.plUpdateTxField('amount', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono font-bold" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-500 mb-1">Tanggal</label>
              <input type="date" min="2026-11-01" max="2061-11-30" required value="${escapeHtml(state.txForm.date)}" onchange="window.plUpdateTxField('date', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm" />
            </div>
          </div>
          ${state.txForm.type !== 'transfer' ? `
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-semibold text-slate-500 mb-1">Kategori</label>
                <select onchange="window.plUpdateTxField('category', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm">
                  ${state.categories.filter((c) => c.type === state.txForm.type).map((c) => `<option value="${c.id}" ${state.txForm.category === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-500 mb-1">Akun</label>
                <select onchange="window.plUpdateTxField('account', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm">
                  ${state.accounts.map((a) => `<option value="${a.id}" ${state.txForm.account === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
                </select>
              </div>
            </div>
          ` : `
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-semibold text-slate-500 mb-1">Dari Akun</label>
                <select onchange="window.plUpdateTxField('account', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm">
                  ${state.accounts.map((a) => `<option value="${a.id}" ${state.txForm.account === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-500 mb-1">Ke Akun</label>
                <select onchange="window.plUpdateTxField('toAccount', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm">
                  ${state.accounts.map((a) => `<option value="${a.id}" ${state.txForm.toAccount === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
                </select>
              </div>
            </div>
          `}
          <div>
            <label class="block text-xs font-semibold text-slate-500 mb-1">Catatan (Opsional)</label>
            <input type="text" value="${escapeHtml(state.txForm.note)}" oninput="window.plUpdateTxField('note', this.value)" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm" />
          </div>
          <div class="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button type="button" onclick="window.plCloseTxModal()" class="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold cursor-pointer">Batal</button>
            <button type="submit" class="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs sm:text-sm font-bold cursor-pointer">Simpan Transaksi</button>
          </div>
        </form>
      </div>
    </div>
  ` : '';

  const deleteModalHtml = state.deleteConfirmTarget ? `
    <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-2xl">
        <h3 class="text-base font-bold text-rose-500">Hapus Transaksi Ini?</h3>
        <p class="text-xs text-slate-600 dark:text-slate-300">Transaksi "${escapeHtml(state.deleteConfirmTarget.title)}" senilai ${formatIDR(state.deleteConfirmTarget.amount)} akan dihapus.</p>
        <div class="flex justify-end gap-2">
          <button type="button" onclick="window.plCancelDeleteTx()" class="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold cursor-pointer">Batal</button>
          <button type="button" onclick="window.plExecuteDeleteTx()" class="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold cursor-pointer">Ya, Hapus</button>
        </div>
      </div>
    </div>
  ` : '';

  const categoryDeleteModalHtml = state.categoryDeleteModal ? `
    <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-2xl">
        <h3 class="text-base font-bold text-amber-500">Migrasi Aman Kategori "${escapeHtml(state.categoryDeleteModal.catName)}"</h3>
        <p class="text-xs text-slate-600 dark:text-slate-300">Kategori ini sedang digunakan oleh <strong>${state.categoryDeleteModal.usedCount} transaksi historis</strong>. Pilih kategori pengganti agar tidak ada catatan transaksi yang rusak:</p>
        <select onchange="state.categoryDeleteModal.replacementId = this.value" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold">
          ${state.categories
            .filter((c) => c.type === state.categoryDeleteModal.catType && c.id !== state.categoryDeleteModal.catId)
            .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
            .join('')}
        </select>
        <div class="flex justify-end gap-2">
          <button type="button" onclick="window.plCancelCategoryDelete()" class="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold cursor-pointer">Batal</button>
          <button type="button" onclick="window.plConfirmCategoryReassignAndDelete()" class="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold cursor-pointer">Pindahkan Transaksi &amp; Hapus</button>
        </div>
      </div>
    </div>
  ` : '';

  const backupPreviewModalHtml = state.backupPreviewModal ? `
    <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-2xl">
        <h3 class="text-base font-bold text-emerald-500">Pratinjau &amp; Konfirmasi Impor Cadangan JSON</h3>
        <div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs space-y-1 font-mono">
          <div>Versi Cadangan: <strong>${escapeHtml(state.backupPreviewModal.summary.version)}</strong></div>
          <div>Jumlah Transaksi: <strong>${state.backupPreviewModal.summary.transactionsCount}</strong></div>
          <div>Jumlah Akun &amp; Kategori: <strong>${state.backupPreviewModal.summary.accountsCount} akun, ${state.backupPreviewModal.summary.categoriesCount} kategori</strong></div>
          <div>Jumlah Aturan Anggaran: <strong>${state.backupPreviewModal.summary.budgetsCount}</strong></div>
          <div>Jumlah Arsip Struk: <strong>${state.backupPreviewModal.summary.receiptsCount}</strong></div>
        </div>
        <p class="text-xs text-slate-500">Pilih metode pemulihan:</p>
        <div class="flex flex-col sm:flex-row justify-end gap-2">
          <button type="button" onclick="window.plCancelBackupPreview()" class="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold cursor-pointer">Batal</button>
          <button type="button" onclick="window.plExecuteBackupImport('merge')" class="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold cursor-pointer">Gabungkan Tanpa Duplikat (Merge)</button>
          <button type="button" onclick="window.plExecuteBackupImport('replace')" class="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold cursor-pointer">Ganti Seluruh Data (Replace)</button>
        </div>
      </div>
    </div>
  ` : '';

  const viewReceiptModalHtml = state.viewingReceiptModal ? `
    <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center">
          <div>
            <h3 class="text-base font-bold">${escapeHtml(state.viewingReceiptModal.merchant)}</h3>
            <p class="text-xs text-slate-500">${formatIndoDate(state.viewingReceiptModal.date)}</p>
          </div>
          <button type="button" onclick="window.plCloseReceiptModal()" class="p-1.5 text-slate-400 cursor-pointer">${iconSvg('x', 'w-5 h-5')}</button>
        </div>
        ${state.viewingReceiptModal.imageData ? `<div class="rounded-xl bg-slate-100 dark:bg-slate-800 p-2 flex justify-center"><img src="${state.viewingReceiptModal.imageData}" alt="Struk" class="max-h-60 object-contain rounded" /></div>` : ''}
        <div class="space-y-1 text-xs font-mono border-t border-slate-100 dark:border-slate-800 pt-3">
          ${(state.viewingReceiptModal.items || []).map((it) => `<div class="flex justify-between"><span>${escapeHtml(it.name)} (${it.qty}x)</span><span>${formatIDR(toIntIDR(it.qty) * toIntIDR(it.price))}</span></div>`).join('')}
          <div class="flex justify-between text-sm font-bold pt-2 border-t border-slate-100 dark:border-slate-800 text-emerald-600 dark:text-emerald-400">
            <span>TOTAL</span><span>${formatIDR(state.viewingReceiptModal.amount)}</span>
          </div>
        </div>
      </div>
    </div>
  ` : '';

  const resetModalHtml = state.isResetModalOpen ? `
    <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-2xl">
        <h3 class="text-base font-bold">Reset ke Data Sampel Awal?</h3>
        <p class="text-xs text-slate-500">Seluruh data transaksi, anggaran, dan struk akan dikembalikan ke data sampel awal v3.0.</p>
        <div class="flex justify-end gap-2">
          <button type="button" onclick="window.plCloseResetModal()" class="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold cursor-pointer">Batal</button>
          <button type="button" onclick="window.plExecuteReset()" class="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold cursor-pointer">Ya, Reset</button>
        </div>
      </div>
    </div>
  ` : '';

  const pwaModalHtml = state.isPwaGuideModalOpen ? `
    <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-2xl">
        <div class="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-3">
          <h3 class="text-base font-bold">Panduan Instalasi PWA Android &amp; Deployment GitHub Pages (Pockets)</h3>
          <button type="button" onclick="window.plClosePwaModal()" class="p-1.5 text-slate-400 cursor-pointer">${iconSvg('x', 'w-5 h-5')}</button>
        </div>
        <div class="space-y-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          <p><strong>1. Unggah ke Repositori GitHub "Pockets":</strong> Ekstrak berkas <code>Pockets_GitHub_Repo.zip</code> lalu unggah seluruh berkas (<code>index.html</code>, <code>manifest.json</code>, <code>service-worker.js</code>, folder <code>css/</code>, <code>js/</code>, dan <code>assets/</code>) ke repositori GitHub Anda dan aktifkan <strong>GitHub Pages</strong>.</p>
          <p><strong>2. Instalasi di Android:</strong> Buka URL HTTPS GitHub Pages Anda di Chrome Android, lalu ketuk <strong>Instal Aplikasi / Tambahkan ke Layar Utama</strong>.</p>
          <p><strong>3. Kesiapan Offline OCR:</strong> Buka tab <strong>Pindai Struk</strong> dan ketuk <strong>Siapkan Mesin OCR Offline</strong> saat terhubung ke internet agar model bahasa tersimpan di cache perangkat.</p>
        </div>
        <div class="flex justify-end">
          <button type="button" onclick="window.plClosePwaModal()" class="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold cursor-pointer">Mengerti</button>
        </div>
      </div>
    </div>
  ` : '';

  const toastHtml = state.toast ? `
    <div class="fixed bottom-20 md:bottom-6 right-4 z-50 max-w-sm bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl border border-slate-700 flex items-center gap-3">
      <span class="text-xs sm:text-sm font-medium">${escapeHtml(state.toast.message)}</span>
    </div>
  ` : '';

  root.innerHTML = `
    ${headerHtml}
    <main class="max-w-7xl mx-auto px-4 sm:px-6 py-6">${mainContentHtml}</main>
    ${mobileNavHtml}
    ${txModalHtml}
    ${deleteModalHtml}
    ${categoryDeleteModalHtml}
    ${backupPreviewModalHtml}
    ${viewReceiptModalHtml}
    ${resetModalHtml}
    ${pwaModalHtml}
    ${toastHtml}
  `;

  mountChartsAfterRender(snap);
};

// Bootstrap on DOMContentLoaded
window.addEventListener('online', () => { state.isOnline = true; showToast('Koneksi kembali online.'); });
window.addEventListener('offline', () => { state.isOnline = false; showToast('Mode Offline aktif.'); });
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstallPrompt = e; });

window.addEventListener('DOMContentLoaded', async () => {
  try {
    await openPocketLedgerDB();
    const rawBundle = {};
    for (const storeName of ALL_DB_STORES) {
      rawBundle[storeName] = await dbGetAll(storeName);
    }
    const migrated = migrateToV3Schema(rawBundle);
    Object.assign(state, migrated);

    await Promise.all(
      ALL_DB_STORES.map((s) =>
        dbReplaceStore(s, s === 'settings' ? [state.settings] : state[s])
      )
    );
  } catch {
    const mirror = loadMirrorFromLocalStorage();
    if (mirror) {
      const migrated = migrateToV3Schema(mirror);
      Object.assign(state, migrated);
    }
  }
  document.documentElement.classList.toggle('dark', state.settings.theme === 'dark');
  renderApp();
});
