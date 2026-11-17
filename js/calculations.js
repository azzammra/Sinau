// ============================================================================
// js/calculations.js — Centralized Financial & Calendar Calculation Layer
// ============================================================================
const CURRENT_REAL_MONTH = '2026-11';
const CURRENT_REAL_DATE = '2026-11-16';
const MIN_ALLOWED_MONTH = '2026-11';
const MAX_ALLOWED_MONTH = '2061-11';
const MIN_ALLOWED_DATE = '2026-11-01';
const MAX_ALLOWED_DATE = '2061-11-30';

const clampMonthKey = (monthStr) => {
  if (!monthStr || typeof monthStr !== 'string' || !/^\d{4}-\d{2}$/.test(monthStr)) {
    return CURRENT_REAL_MONTH;
  }
  if (monthStr < MIN_ALLOWED_MONTH) return MIN_ALLOWED_MONTH;
  if (monthStr > MAX_ALLOWED_MONTH) return MAX_ALLOWED_MONTH;
  return monthStr;
};

const clampDateStr = (dateStr) => {
  if (!dateStr || typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return CURRENT_REAL_DATE;
  }
  if (dateStr < MIN_ALLOWED_DATE) return MIN_ALLOWED_DATE;
  if (dateStr > MAX_ALLOWED_DATE) return MAX_ALLOWED_DATE;
  return dateStr;
};

const INDONESIAN_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const INDONESIAN_MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'
];

const toIntIDR = (val) => {
  if (typeof val === 'number') return Math.round(val);
  if (!val) return 0;
  const cleaned = String(val).replace(/[^0-9-]/g, '');
  const parsed = parseInt(cleaned, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatIDR = (val, showSign = false) => {
  const num = toIntIDR(val);
  const absFormatted = new Intl.NumberFormat('id-ID').format(Math.abs(num));
  if (num < 0) return `-Rp ${absFormatted}`;
  if (showSign && num > 0) return `+Rp ${absFormatted}`;
  return `Rp ${absFormatted}`;
};

const escapeHtml = (str) => {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const parseMonthParts = (monthStr) => {
  if (!monthStr || typeof monthStr !== 'string' || !/^\d{4}-\d{2}$/.test(monthStr)) {
    return { year: 2026, month: 11 };
  }
  const [y, m] = monthStr.split('-').map(Number);
  return { year: y || 2026, month: Math.min(12, Math.max(1, m || 11)) };
};

const formatMonthKey = (year, month) => {
  const y = Math.max(2026, Math.min(2061, Number(year) || 2026));
  const m = Math.max(1, Math.min(12, Number(month) || 11));
  return clampMonthKey(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`);
};

const shiftMonthKey = (monthStr, deltaMonths) => {
  const { year, month } = parseMonthParts(monthStr);
  const totalMonths = year * 12 + (month - 1) + deltaMonths;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = ((totalMonths % 12) + 12) % 12 + 1;
  return formatMonthKey(nextYear, nextMonth);
};

const getDaysInMonth = (year, month) => new Date(year, month, 0).getDate();

const getCalendarWeeksForMonth = (monthStr, weekStartDay = 'monday') => {
  const { year, month } = parseMonthParts(monthStr);
  const totalDays = getDaysInMonth(year, month);
  const monthShort = INDONESIAN_MONTHS_SHORT[month - 1] || 'Nov';
  const weeks = [];
  let currentStartDay = 1;
  let weekNum = 1;

  while (currentStartDay <= totalDays) {
    const dateObj = new Date(year, month - 1, currentStartDay);
    const jsDay = dateObj.getDay();
    const daysToEndOfWeek =
      weekStartDay === 'sunday' ? 6 - jsDay : jsDay === 0 ? 0 : 7 - jsDay;
    const currentEndDay = Math.min(totalDays, currentStartDay + daysToEndOfWeek);
    const startDate = `${formatMonthKey(year, month)}-${String(currentStartDay).padStart(2, '0')}`;
    const endDate = `${formatMonthKey(year, month)}-${String(currentEndDay).padStart(2, '0')}`;
    const rangeLabel =
      currentStartDay === currentEndDay
        ? `${currentStartDay} ${monthShort}`
        : `${currentStartDay}–${currentEndDay} ${monthShort}`;

    weeks.push({
      weekNum,
      startDay: currentStartDay,
      endDay: currentEndDay,
      startDate,
      endDate,
      daysCount: currentEndDay - currentStartDay + 1,
      rangeLabel
    });

    currentStartDay = currentEndDay + 1;
    weekNum += 1;
  }
  return weeks;
};

const getWeekOfMonth = (dateStr, weekStartDay = 'monday') => {
  if (!dateStr || typeof dateStr !== 'string' || dateStr.length < 10) return 1;
  const monthStr = dateStr.slice(0, 7);
  const day = parseInt(dateStr.slice(8, 10), 10) || 1;
  const weeks = getCalendarWeeksForMonth(monthStr, weekStartDay);
  const matched = weeks.find((w) => day >= w.startDay && day <= w.endDay);
  return matched ? matched.weekNum : 1;
};

const getMonthFromDate = (dateStr) => {
  if (!dateStr || dateStr.length < 7) return CURRENT_REAL_MONTH;
  return dateStr.slice(0, 7);
};

const formatIndoDate = (dateStr) => {
  if (!dateStr) return '-';
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    return `${d} ${INDONESIAN_MONTHS_SHORT[(m || 1) - 1] || 'Nov'} ${y}`;
  } catch {
    return dateStr;
  }
};

const formatIndoMonth = (monthStr) => {
  if (!monthStr) return '-';
  const { year, month } = parseMonthParts(monthStr);
  return `${INDONESIAN_MONTHS[month - 1] || 'November'} ${year}`;
};

const calculateAccountBalances = (accounts, transactions) => {
  const balances = {};
  let totalInitialBalance = 0;

  (accounts || []).forEach((acc) => {
    const initBal = toIntIDR(acc.initialBalance || 0);
    balances[acc.id] = initBal;
    totalInitialBalance += initBal;
  });

  let totalAllTimeIncome = 0;
  let totalAllTimeExpenses = 0;
  let totalAllTimeTransfers = 0;

  (transactions || []).forEach((tx) => {
    const amt = toIntIDR(tx.amount);
    if (tx.type === 'income') {
      totalAllTimeIncome += amt;
      if (balances[tx.account] === undefined) balances[tx.account] = 0;
      balances[tx.account] += amt;
    } else if (tx.type === 'expense') {
      totalAllTimeExpenses += amt;
      if (balances[tx.account] === undefined) balances[tx.account] = 0;
      balances[tx.account] -= amt;
    } else if (tx.type === 'transfer') {
      totalAllTimeTransfers += amt;
      if (balances[tx.account] === undefined) balances[tx.account] = 0;
      balances[tx.account] -= amt;
      if (tx.toAccount) {
        if (balances[tx.toAccount] === undefined) balances[tx.toAccount] = 0;
        balances[tx.toAccount] += amt;
      }
    }
  });

  const totalCurrentCashBalance = totalInitialBalance + totalAllTimeIncome - totalAllTimeExpenses;
  return {
    balances,
    totalInitialBalance,
    totalAllTimeIncome,
    totalAllTimeExpenses,
    totalAllTimeTransfers,
    totalCurrentCashBalance
  };
};

const calculateSavingsProjection = ({
  targetAmount,
  currentSavings,
  monthlyContribution,
  linkedRolloverSavings = 0,
  linkedTransferDeposits = 0
}) => {
  const target = Math.max(0, toIntIDR(targetAmount));
  const baseSaved = Math.max(0, toIntIDR(currentSavings));
  const rolloverSaved = Math.max(0, toIntIDR(linkedRolloverSavings));
  const transferSaved = Math.max(0, toIntIDR(linkedTransferDeposits));
  const effectiveCurrentSaved = baseSaved + rolloverSaved + transferSaved;
  const monthlyContrib = Math.max(0, toIntIDR(monthlyContribution));
  const remainingTarget = Math.max(0, target - effectiveCurrentSaved);
  const progressPct = target > 0 ? Math.min(100, Math.round((effectiveCurrentSaved / target) * 100)) : 0;
  const estimatedMonths =
    remainingTarget === 0
      ? 0
      : monthlyContrib > 0
      ? Math.ceil(remainingTarget / monthlyContrib)
      : null;

  return {
    targetAmount: target,
    effectiveCurrentSaved,
    remainingTarget,
    monthlyContribution: monthlyContrib,
    progressPct,
    estimatedMonths
  };
};

const calculateInvestmentProjection = ({
  initialCapital,
  monthlyContribution,
  annualReturnRatePct,
  durationMonths
}) => {
  const P0 = Math.max(0, toIntIDR(initialCapital));
  const PMT = Math.max(0, toIntIDR(monthlyContribution));
  const annualPct = Math.max(0, Number(annualReturnRatePct) || 0);
  const n = Math.max(1, Math.min(600, parseInt(durationMonths, 10) || 12));
  const rm = annualPct / 100 / 12;

  let accumulated = P0;
  const schedule = [];
  for (let m = 1; m <= n; m += 1) {
    accumulated = accumulated * (1 + rm) + PMT;
    if (m % 6 === 0 || m === n) {
      const contributedSoFar = P0 + PMT * m;
      const valRounded = Math.round(accumulated);
      schedule.push({
        month: m,
        label: `Bln ${m}`,
        contributed: contributedSoFar,
        projectedValue: valRounded,
        growth: valRounded - contributedSoFar
      });
    }
  }

  const finalAccumulated = Math.round(accumulated);
  const totalContributed = P0 + PMT * n;
  const estimatedGrowth = finalAccumulated - totalContributed;

  return {
    initialCapital: P0,
    monthlyContribution: PMT,
    annualReturnRatePct: annualPct,
    durationMonths: n,
    accumulatedValue: finalAccumulated,
    totalContributed,
    estimatedGrowth,
    compoundingAssumption: 'Bunga majemuk bulanan (r_bulan = r_tahun / 12)',
    schedule
  };
};

const calculateLoanInstallment = ({
  principal,
  annualInterestRatePct,
  durationMonths,
  method = 'flat'
}) => {
  const P = Math.max(0, toIntIDR(principal));
  const annualPct = Math.max(0, Number(annualInterestRatePct) || 0);
  const n = Math.max(1, Math.min(360, parseInt(durationMonths, 10) || 12));
  const monthlyRate = annualPct / 100 / 12;

  const flatMonthlyPrincipal = P / n;
  const flatMonthlyInterest = P * monthlyRate;
  const flatMonthlyInstallment = Math.round(flatMonthlyPrincipal + flatMonthlyInterest);
  const flatTotalRepayment = flatMonthlyInstallment * n;
  const flatTotalInterest = Math.max(0, flatTotalRepayment - P);

  let effectiveMonthlyInstallment = 0;
  if (monthlyRate === 0) {
    effectiveMonthlyInstallment = Math.round(P / n);
  } else {
    const factor = Math.pow(1 + monthlyRate, n);
    effectiveMonthlyInstallment = Math.round((P * (monthlyRate * factor)) / (factor - 1));
  }

  let remEff = P;
  let effectiveTotalInterest = 0;
  for (let m = 1; m <= n; m += 1) {
    const intPart = Math.round(remEff * monthlyRate);
    const prinPart = m === n ? remEff : Math.max(0, effectiveMonthlyInstallment - intPart);
    remEff = Math.max(0, remEff - prinPart);
    effectiveTotalInterest += intPart;
  }
  const effectiveTotalRepayment = P + effectiveTotalInterest;
  const isEffective = method === 'effective';

  return {
    principal: P,
    annualInterestRatePct: annualPct,
    durationMonths: n,
    selectedMethod: method,
    monthlyInstallment: isEffective ? effectiveMonthlyInstallment : flatMonthlyInstallment,
    totalRepayment: isEffective ? effectiveTotalRepayment : flatTotalRepayment,
    totalInterest: isEffective ? effectiveTotalInterest : flatTotalInterest,
    comparison: {
      flat: {
        monthlyInstallment: flatMonthlyInstallment,
        totalRepayment: flatTotalRepayment,
        totalInterest: flatTotalInterest
      },
      effective: {
        monthlyInstallment: effectiveMonthlyInstallment,
        totalRepayment: effectiveTotalRepayment,
        totalInterest: effectiveTotalInterest
      }
    }
  };
};

const calculateTaxAndZakat = ({
  mode = 'pph21',
  grossMonthlyIncome = 8000000,
  ptkpAnnual = 54000000,
  deductionPct = 5,
  umkmMonthlyTurnover = 45000000,
  umkmRatePct = 0.5,
  zakatMonthlyIncome = 6000000,
  zakatDeductibleNeeds = 1500000,
  goldPricePerGram = 1400000,
  nisabGoldGrams = 85,
  zakatRatePct = 2.5
}) => {
  if (mode === 'umkm') {
    const monthlyOmzet = Math.max(0, toIntIDR(umkmMonthlyTurnover));
    const annualOmzet = monthlyOmzet * 12;
    const rate = Math.max(0, Number(umkmRatePct) || 0.5) / 100;
    const monthlyTax = Math.round(monthlyOmzet * rate);
    return {
      mode: 'umkm',
      monthlyBase: monthlyOmzet,
      annualBase: annualOmzet,
      monthlyObligation: monthlyTax,
      annualObligation: monthlyTax * 12,
      summaryLabel: `PPh Final UMKM (${umkmRatePct}% dari Omzet Bruto)`,
      notes: 'Asumsi tarif PPh Final UMKM dapat disesuaikan. WP Orang Pribadi dengan peredaran bruto sampai Rp500 juta/tahun dapat bebas pajak sesuai aturan berlaku.'
    };
  }

  if (mode === 'zakat') {
    const gross = Math.max(0, toIntIDR(zakatMonthlyIncome));
    const deduct = Math.max(0, toIntIDR(zakatDeductibleNeeds));
    const netMonthly = Math.max(0, gross - deduct);
    const netAnnual = netMonthly * 12;
    const nisabAnnual = Math.round(toIntIDR(goldPricePerGram) * (Number(nisabGoldGrams) || 85));
    const nisabMonthly = Math.round(nisabAnnual / 12);
    const wajibZakat = netAnnual >= nisabAnnual;
    const rate = (Number(zakatRatePct) || 2.5) / 100;
    const monthlyZakat = wajibZakat ? Math.round(netMonthly * rate) : 0;
    return {
      mode: 'zakat',
      monthlyBase: netMonthly,
      annualBase: netAnnual,
      nisabMonthly,
      nisabAnnual,
      wajibZakat,
      monthlyObligation: monthlyZakat,
      annualObligation: monthlyZakat * 12,
      summaryLabel: wajibZakat
        ? `Wajib Zakat (${zakatRatePct}% — Memenuhi Nisab ${nisabGoldGrams}g Emas)`
        : `Belum Mencapai Nisab (${nisabGoldGrams}g Emas = ${formatIDR(nisabAnnual)}/thn)`,
      notes: 'Parameter harga emas, nisab, dan pengurang kebutuhan pokok dapat diperbarui sewaktu-waktu.'
    };
  }

  const grossMonthly = Math.max(0, toIntIDR(grossMonthlyIncome));
  const grossAnnual = grossMonthly * 12;
  const biayaJabatan = Math.min(6000000, Math.round(grossAnnual * ((Number(deductionPct) || 5) / 100)));
  const netAnnual = Math.max(0, grossAnnual - biayaJabatan);
  const ptkp = Math.max(0, toIntIDR(ptkpAnnual));
  const pkp = Math.max(0, Math.floor((netAnnual - ptkp) / 1000) * 1000);

  let remainingPkp = pkp;
  let annualTax = 0;
  const brackets = [
    { limit: 60000000, rate: 0.05 },
    { limit: 190000000, rate: 0.15 },
    { limit: 250000000, rate: 0.25 },
    { limit: 4500000000, rate: 0.30 },
    { limit: Infinity, rate: 0.35 }
  ];
  for (const b of brackets) {
    if (remainingPkp <= 0) break;
    const slice = Math.min(remainingPkp, b.limit);
    annualTax += Math.round(slice * b.rate);
    remainingPkp -= slice;
  }
  return {
    mode: 'pph21',
    monthlyBase: grossMonthly,
    annualBase: grossAnnual,
    biayaJabatan,
    ptkpAnnual: ptkp,
    pkpAnnual: pkp,
    monthlyObligation: Math.round(annualTax / 12),
    annualObligation: annualTax,
    summaryLabel: pkp > 0 ? 'Estimasi PPh 21 Progresif Tahunan' : 'Penghasilan Netto di Bawah PTKP (PPh Rp 0)',
    notes: 'Menggunakan lapisan tarif progresif atas PKP tahunan. Nilai PTKP dan persentase pengurang dapat diubah sesuai golongan wajib pajak.'
  };
};
