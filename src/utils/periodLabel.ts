/**
 * Человеческая подпись срока: «1 месяц», «3 месяца», «45 дней».
 *
 * Готовые подписи лежат в `landing.periodLabels.d<дни>` — их и берём, чтобы
 * лендинг, витрина подарка и продление называли один и тот же срок одинаково.
 * Для срока без готовой подписи: кратный 30 дням складываем в месяцы
 * (360 → «12 месяцев»), остальное оставляем в днях.
 */
export function formatPeriodLabel(
  days: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const key = `landing.periodLabels.d${days}`;
  const result = t(key);
  if (result !== key) return result;

  const months = Math.floor(days / 30);
  const remainder = days % 30;
  if (months > 0 && remainder === 0) {
    return t('landing.periodLabels.nMonths', { count: months });
  }
  return t('landing.periodLabels.nDays', { count: days });
}
