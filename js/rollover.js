// ============================================================================
// js/rollover.js — Cumulative Monthly Surplus Rollover & Deficit Isolation Engine
// ============================================================================
const computeRolloverChain = ({
  targetMonth,
  budgetsList,
  transactionsList,
  rolloverRecordsList,
  categoriesList,
  weekStartDay = 'monday'
}) => {
  const monthSet = new Set(['2026-11', clampMonthKey(targetMonth)]);
  (transactionsList || []).forEach((tx) => {
    if (tx.date && tx.date.length >= 7) monthSet.add(clampMonthKey(tx.date.slice(0, 7)));
  });
  (budgetsList || []).forEach((b) => {
    if (b.month) monthSet.add(b.month);
    if (b.startMonth) monthSet.add(b.startMonth);
  });
  (rolloverRecordsList || []).forEach((r) => {
    if (r.sourceMonth) monthSet.add(r.sourceMonth);
  });

  const sortedMonths = Array.from(monthSet).sort();
  const minMonth = sortedMonths[0] < MIN_ALLOWED_MONTH ? MIN_ALLOWED_MONTH : (sortedMonths[0] || '2026-11');
  const maxMonth = sortedMonths[sortedMonths.length - 1] > targetMonth ? sortedMonths[sortedMonths.length - 1] : targetMonth;

  const continuousMonths = [];
  let cursor = minMonth;
  let safety = 0;
  while (cursor <= maxMonth && safety < 240) {
    continuousMonths.push(cursor);
    cursor = shiftMonthKey(cursor, 1);
    safety += 1;
  }

  const monthlyExpenseMap = {};
  const monthlyIncomeMap = {};
  (transactionsList || []).forEach((tx) => {
    const m = getMonthFromDate(tx.date);
    const amt = toIntIDR(tx.amount);
    if (tx.type === 'expense') monthlyExpenseMap[m] = (monthlyExpenseMap[m] || 0) + amt;
    else if (tx.type === 'income') monthlyIncomeMap[m] = (monthlyIncomeMap[m] || 0) + amt;
  });

  const storedMap = {};
  (rolloverRecordsList || []).forEach((r) => {
    if (r.sourceMonth) storedMap[r.sourceMonth] = r;
  });

  const chainByMonth = {};
  let carryInFromPrevMonth = 0;

  continuousMonths.forEach((mKey) => {
    const resolvedBudget = resolveBudgetForMonth(mKey, budgetsList, categoriesList, weekStartDay);
    const baseBudget = toIntIDR(resolvedBudget.monthlySpendingBudget);
    const actualExpenses = toIntIDR(monthlyExpenseMap[mKey] || 0);
    const actualIncome = toIntIDR(monthlyIncomeMap[mKey] || 0);
    const hasActivity = actualExpenses > 0 || actualIncome > 0 || mKey === targetMonth || Boolean(storedMap[mKey]);

    const carryoverIn = hasActivity ? Math.max(0, carryInFromPrevMonth) : 0;
    const totalEffectiveBudget = baseBudget + carryoverIn;
    const netVariance = totalEffectiveBudget - actualExpenses;
    const storedDecision = storedMap[mKey] || null;

    let status = 'balanced';
    let eligibleRollover = 0;
    let deficitAmount = 0;
    let allocatedToSavings = 0;
    let allocatedToInvestments = 0;
    let retainedForNextMonth = 0;

    if (!hasActivity) {
      status = 'inactive';
      carryInFromPrevMonth = 0;
    } else if (netVariance > 0) {
      status = 'surplus';
      eligibleRollover = netVariance;
      const reqSav = Math.max(0, toIntIDR(storedDecision?.allocatedToSavings || 0));
      const reqInv = Math.max(0, toIntIDR(storedDecision?.allocatedToInvestments || 0));
      allocatedToSavings = Math.min(eligibleRollover, reqSav);
      allocatedToInvestments = Math.min(eligibleRollover - allocatedToSavings, reqInv);
      retainedForNextMonth = Math.max(0, eligibleRollover - allocatedToSavings - allocatedToInvestments);
      carryInFromPrevMonth = retainedForNextMonth;
    } else if (netVariance < 0) {
      status = 'deficit';
      deficitAmount = Math.abs(netVariance);
      eligibleRollover = 0;
      allocatedToSavings = 0;
      allocatedToInvestments = 0;
      retainedForNextMonth = 0;
      carryInFromPrevMonth = 0;
    } else {
      status = 'balanced';
      carryInFromPrevMonth = 0;
    }

    chainByMonth[mKey] = {
      id: mKey,
      sourceMonth: mKey,
      nextMonth: shiftMonthKey(mKey, 1),
      baseBudget,
      carryoverIn,
      totalEffectiveBudget,
      actualExpenses,
      actualIncome,
      netVariance,
      status,
      eligibleRollover,
      deficitAmount,
      allocatedToSavings,
      allocatedToInvestments,
      retainedForNextMonth,
      linkedTransferTxId: storedDecision?.linkedTransferTxId || null,
      appliedBudgetTypeLabel: resolvedBudget.appliedTypeLabel
    };
  });

  const totalRolloverAllocatedToSavings = Object.values(chainByMonth).reduce(
    (s, item) => s + toIntIDR(item.allocatedToSavings),
    0
  );
  const totalRolloverAllocatedToInvestments = Object.values(chainByMonth).reduce(
    (s, item) => s + toIntIDR(item.allocatedToInvestments),
    0
  );

  return {
    chainByMonth,
    activeMonthRollover: chainByMonth[targetMonth] || {
      id: targetMonth,
      sourceMonth: targetMonth,
      nextMonth: shiftMonthKey(targetMonth, 1),
      baseBudget: 1500000,
      carryoverIn: 0,
      totalEffectiveBudget: 1500000,
      actualExpenses: 0,
      actualIncome: 0,
      netVariance: 1500000,
      status: 'surplus',
      eligibleRollover: 1500000,
      deficitAmount: 0,
      allocatedToSavings: 0,
      allocatedToInvestments: 0,
      retainedForNextMonth: 1500000,
      linkedTransferTxId: null,
      appliedBudgetTypeLabel: 'Default Sistem'
    },
    totalRolloverAllocatedToSavings,
    totalRolloverAllocatedToInvestments
  };
};
