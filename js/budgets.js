// ============================================================================
// js/budgets.js — 3-Tier Flexible Budget Engine (Type A, Type B, Type C)
// ============================================================================
const resolveBudgetForMonth = (monthKey, budgetsList, categoriesList = [], weekStartDay = 'monday') => {
  const calWeeks = getCalendarWeeksForMonth(monthKey, weekStartDay);
  const { year, month } = parseMonthParts(monthKey);
  const totalDays = getDaysInMonth(year, month);
  const list = Array.isArray(budgetsList) ? budgetsList : [];

  const typeACandidates = list.filter(
    (b) => (b.budgetType === 'monthly_once' || (!b.budgetType && b.month)) && b.month === monthKey
  );

  const typeBCandidates = list
    .filter(
      (b) =>
        b.budgetType === 'date_range' &&
        b.startMonth &&
        b.endMonth &&
        b.startMonth <= monthKey &&
        monthKey <= b.endMonth
    )
    .sort((a, b) => {
      const spanA =
        (parseMonthParts(a.endMonth).year - parseMonthParts(a.startMonth).year) * 12 +
        (parseMonthParts(a.endMonth).month - parseMonthParts(a.startMonth).month);
      const spanB =
        (parseMonthParts(b.endMonth).year - parseMonthParts(b.startMonth).year) * 12 +
        (parseMonthParts(b.endMonth).month - parseMonthParts(b.startMonth).month);
      if (spanA !== spanB) return spanA - spanB;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });

  const typeCCandidates = list
    .filter((b) => b.budgetType === 'permanent' && (b.effectiveFrom || '1970-01') <= monthKey)
    .sort((a, b) => String(b.effectiveFrom || '').localeCompare(String(a.effectiveFrom || '')));

  const winningRule = typeACandidates[0] || typeBCandidates[0] || typeCCandidates[0] || null;
  const fallbackPermanent = typeCCandidates[0] || null;

  const defaultLimit = 1500000;
  const monthlySpendingBudget = winningRule
    ? toIntIDR(winningRule.monthlySpendingBudget ?? winningRule.totalSpendingLimit ?? defaultLimit)
    : defaultLimit;
  const monthlyAllowance = winningRule ? toIntIDR(winningRule.monthlyAllowance ?? 1800000) : 1800000;

  const expenseCats = (categoriesList || []).filter((c) => c.type === 'expense');
  const categoryBudgets = {};
  expenseCats.forEach((cat) => {
    const fromWinner = winningRule?.categoryBudgets?.[cat.id];
    const fromPermanent = fallbackPermanent?.categoryBudgets?.[cat.id];
    categoryBudgets[cat.id] = toIntIDR(fromWinner !== undefined ? fromWinner : fromPermanent || 0);
  });

  const weeklyAllocations = {};
  let hasStoredWeeks = false;
  if (winningRule && winningRule.weeklyAllocations) {
    calWeeks.forEach((w) => {
      if (winningRule.weeklyAllocations[w.weekNum] !== undefined) hasStoredWeeks = true;
      weeklyAllocations[w.weekNum] = toIntIDR(winningRule.weeklyAllocations[w.weekNum] || 0);
    });
  }
  if (!hasStoredWeeks) {
    let acc = 0;
    calWeeks.forEach((w, idx) => {
      if (idx === calWeeks.length - 1) {
        weeklyAllocations[w.weekNum] = Math.max(0, monthlySpendingBudget - acc);
      } else {
        const share = Math.round(((monthlySpendingBudget * (w.daysCount / totalDays)) / 5000)) * 5000;
        weeklyAllocations[w.weekNum] = share;
        acc += share;
      }
    });
  }

  const appliedTypeLabel = !winningRule
    ? 'Default Sistem'
    : winningRule.budgetType === 'date_range'
    ? `Tipe B — Rentang (${formatIndoMonth(winningRule.startMonth)} – ${formatIndoMonth(winningRule.endMonth)})`
    : winningRule.budgetType === 'permanent'
    ? `Tipe C — Permanen (Sejak ${formatIndoMonth(winningRule.effectiveFrom || '2026-01')})`
    : `Tipe A — Bulan Tunggal (${formatIndoMonth(monthKey)})`;

  return {
    id: winningRule?.id || `budget_${monthKey}`,
    month: monthKey,
    budgetType: winningRule?.budgetType || 'monthly_once',
    appliedRuleId: winningRule?.id || null,
    appliedTypeLabel,
    monthlyAllowance,
    monthlySpendingBudget,
    weeklyAllocations,
    categoryBudgets
  };
};
