/** Business dates in Tajikistan (UTC+5), independent of the server timezone. */
export function consultantPeriods(now = new Date()) {
  const local = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const year = local.getUTCFullYear(),
    month = local.getUTCMonth(),
    day = local.getUTCDate();
  const start = (y: number, m: number, d = 1) =>
    new Date(Date.UTC(y, m, d) - 5 * 60 * 60 * 1000);
  const quarterMonth = Math.floor(month / 3) * 3;
  return {
    day: { from: start(year, month, day), to: start(year, month, day + 1) },
    month: { from: start(year, month), to: start(year, month + 1) },
    quarter: {
      from: start(year, quarterMonth),
      to: start(year, quarterMonth + 3),
    },
  };
}
