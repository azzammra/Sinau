// ============================================================================
// js/transactions.js — Transaction Filtering, Sorting & Validation
// ============================================================================
const filterAndSortTransactions = ({
  transactions,
  activeMonth,
  filterMonthScope,
  filterType,
  filterCategory,
  filterAccount = 'all',
  searchQuery,
  categoriesList
}) => {
  return (transactions || [])
    .filter((tx) => {
      if (filterMonthScope === 'active' && getMonthFromDate(tx.date) !== activeMonth) return false;
      if (filterType !== 'all' && tx.type !== filterType) return false;
      if (filterCategory !== 'all' && tx.category !== filterCategory) return false;
      if (filterAccount !== 'all' && tx.account !== filterAccount && tx.toAccount !== filterAccount) return false;
      if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const catName = findCategoryMeta(tx.category, categoriesList).name.toLowerCase();
        return (
          tx.title.toLowerCase().includes(q) ||
          (tx.note || '').toLowerCase().includes(q) ||
          catName.includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      if (b.date !== a.date) return b.date.localeCompare(a.date);
      return String(b.id).localeCompare(String(a.id));
    });
};
