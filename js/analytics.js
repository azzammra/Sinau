// ============================================================================
// js/analytics.js — Daily, Weekly, Monthly, Annual Reports & Auto-Conclusions
// ============================================================================
const generateFinancialConclusion = ({ activeMonth, transactions, activeRollover }) => {
  const prevMonth = shiftMonthKey(activeMonth, -1);
  let currInc = 0;
  let currExp = 0;
  let prevExp = 0;

  (transactions || []).forEach((tx) => {
    const m = getMonthFromDate(tx.date);
    const amt = toIntIDR(tx.amount);
    if (m === activeMonth) {
      if (tx.type === 'income') currInc += amt;
      else if (tx.type === 'expense') currExp += amt;
    } else if (m === prevMonth && tx.type === 'expense') {
      prevExp += amt;
    }
  });

  const netCashflow = currInc - currExp;
  const monthLabel = formatIndoMonth(activeMonth);
  const budgetStatusText =
    activeRollover.netVariance >= 0
      ? `Surplus Anggaran ${formatIDR(activeRollover.netVariance)}`
      : `Defisit Anggaran ${formatIDR(Math.abs(activeRollover.netVariance))} (Defisit diisolasi & tidak memotong anggaran bulan depan)`;

  let trendText = '';
  if (prevExp > 0) {
    const diffPct = Math.round(((currExp - prevExp) / prevExp) * 100);
    if (diffPct > 0) {
      trendText = ` • Pengeluaran meningkat ${diffPct}% dibandingkan ${formatIndoMonth(prevMonth)}.`;
    } else if (diffPct < 0) {
      trendText = ` • Pengeluaran lebih hemat ${Math.abs(diffPct)}% dibandingkan ${formatIndoMonth(prevMonth)}.`;
    } else {
      trendText = ` • Pengeluaran stabil sama dengan ${formatIndoMonth(prevMonth)}.`;
    }
  }

  return {
    headline: `${monthLabel}: ${budgetStatusText}${trendText}`,
    netCashflowLabel: `Arus Kas Bersih (Pemasukan − Pengeluaran): ${formatIDR(netCashflow, true)}`,
    isDeficit: activeRollover.netVariance < 0
  };
};

const computeAnnualReportSeries = (yearNum, transactions) => {
  const yr = Number(yearNum) || 2026;
  const rows = [];
  let totalAnnualIncome = 0;
  let totalAnnualExpenses = 0;

  for (let m = 1; m <= 12; m += 1) {
    if (yr === 2026 && m < 11) continue;
    if (yr === 2061 && m > 11) continue;
    const mKey = formatMonthKey(yr, m);
    let inc = 0;
    let exp = 0;
    (transactions || []).forEach((tx) => {
      if (getMonthFromDate(tx.date) === mKey) {
        if (tx.type === 'income') inc += toIntIDR(tx.amount);
        else if (tx.type === 'expense') exp += toIntIDR(tx.amount);
      }
    });
    totalAnnualIncome += inc;
    totalAnnualExpenses += exp;
    rows.push({
      monthKey: mKey,
      monthShort: INDONESIAN_MONTHS_SHORT[m - 1],
      income: inc,
      expense: exp,
      net: inc - exp
    });
  }

  return {
    year: yr,
    rows,
    totalAnnualIncome,
    totalAnnualExpenses,
    annualNetSurplus: totalAnnualIncome - totalAnnualExpenses
  };
};
