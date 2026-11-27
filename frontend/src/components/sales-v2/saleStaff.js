// Completed sales belong to the checkout operator, not necessarily the draft creator.
export function saleStaff(doc, c) {
  const completed = doc.status === 'COMPLETED' && Boolean(doc.completedName);
  const name = (completed ? doc.completedName : doc.actorName) || '—';
  const role = completed ? doc.completedRole : doc.actorRole;
  const label = role === 'OWNER' || role === 'CASHIER' ? c('saleCashier') : role ? c(role) : c('saleStaff');
  return { name, label };
}
