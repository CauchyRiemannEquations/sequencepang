// Ranking keys are calendar dates, not instants in the viewer's timezone.
export function formatWeekRange(weekStart) {
  if (!weekStart) return '';
  if (typeof weekStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return weekStart;
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== weekStart) return weekStart;
  start.setUTCDate(start.getUTCDate() + 6);
  return `${weekStart} ~ ${start.toISOString().slice(0, 10)}`;
}
