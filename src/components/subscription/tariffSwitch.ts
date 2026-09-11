import type { Subscription, Tariff } from '../../types';
import { networkCategory } from './networkCategory';

// ──────────────────────────────────────────────────────────────────
// Переход на другой сетевой тариф = обычная покупка
//
// Владелец выбрал модель без доплаты и без пропорций: клиент покупает
// другой тариф на ПОЛНЫЙ срок по обычной цене, а оставшиеся дни текущего
// тарифа не сгорают — бэкенд складывает их с новым сроком
// (`extend_subscription`, ветка is_tariff_change: end_date = сейчас +
// период + остаток). Условия нового тарифа — категория, устройства —
// действуют сразу; новый объём LTE подключается сразу, а в фазе прежних
// оплаченных условий — после её окончания.
//
// Здесь живут выводы, которыми пользуются и витрина тарифов, и форма
// покупки: что считать живой платной подпиской, где замок политики и что
// именно изменится при переходе.
// ──────────────────────────────────────────────────────────────────

export interface LivePaidFlags {
  /** Мультитариф: подписки живут параллельно, переносить остаток неоткуда. */
  isMultiTariff?: boolean;
  /** Бэкенд уже сказал `subscription_is_expired` в purchase-options. */
  expired?: boolean;
}

/**
 * Живая платная подписка — единственное состояние, в котором есть остаток
 * дней и действуют замки политики. Триал, истёкшая и мультитарифная
 * подписки покупают тариф как с нуля.
 */
export function livePaidSubscription(
  subscription: Subscription | null | undefined,
  flags: LivePaidFlags = {},
): Subscription | null {
  if (!subscription || flags.isMultiTariff || flags.expired) return null;
  if (subscription.is_trial || subscription.is_expired) return null;
  if (!(subscription.is_active || subscription.is_limited)) return null;
  return subscription;
}

/** Тариф подписки в текущем каталоге (он же источник категории и цены). */
export function findCurrentTariff(
  tariffs: Tariff[],
  subscription: Pick<Subscription, 'tariff_id'> | null | undefined,
): Tariff | null {
  return (
    tariffs.find((tariff) => tariff.is_current || tariff.id === subscription?.tariff_id) ?? null
  );
}

/** Категория подписки: собственное поле, иначе — категория её тарифа. */
export function currentNetworkCategory(
  subscription: Pick<Subscription, 'network_category'> | null | undefined,
  currentTariff: Pick<Tariff, 'network_category'> | null | undefined,
) {
  return (
    networkCategory(subscription?.network_category) ??
    networkCategory(currentTariff?.network_category)
  );
}

/**
 * Индивидуальные условия (`renewal_requires_expiry`): бэкенд не продаёт
 * такому клиенту другой тариф, пока оплаченный срок не закончится.
 */
export function renewalRequiresExpiry(subscription: Subscription | null | undefined): boolean {
  return subscription?.lte_quota?.renewal_requires_expiry === true;
}

/** Дата окончания прежних оплаченных условий — если бэкенд её прислал. */
export function renewalLockUntil(subscription: Subscription | null | undefined): Date | null {
  const raw = subscription?.lte_quota?.legacy_compatibility_until;
  if (!renewalRequiresExpiry(subscription) || !raw) return null;
  const until = new Date(raw);
  return Number.isFinite(until.getTime()) ? until : null;
}

/**
 * Архивные (без `network_category`) и сетевые тарифы бэкенд не смешивает,
 * пока подписка жива: leg↔managed остаётся запрещённым переходом.
 */
export function crossesArchiveBoundary(
  subscription: Pick<Subscription, 'network_category'> | null | undefined,
  currentTariff: Pick<Tariff, 'network_category'> | null | undefined,
  target: Pick<Tariff, 'network_category'>,
): boolean {
  const from = currentNetworkCategory(subscription, currentTariff);
  return Boolean(from) !== Boolean(networkCategory(target.network_category));
}

export interface TariffSwitchLte {
  /** `none` — тариф без LTE; `after_legacy` — новый объём после прежних условий. */
  mode: 'immediate' | 'after_legacy' | 'none';
  gb: number | null;
  cycleDays: number;
  legacyUntil: Date | null;
}

export interface TariffSwitchSummary {
  remainingDays: number;
  periodDays: number;
  totalDays: number;
  devicesFrom: number;
  devicesTo: number;
  /** Панель сбрасывает привязки только при уменьшении лимита устройств. */
  devicesReset: boolean;
  /** Новый тариф дешевле текущего — разницу за остаток никто не вернёт. */
  cheaper: boolean;
  lte: TariffSwitchLte;
}

/** 0 в API — «безлимит», а не «ноль устройств». */
function deviceCapacity(limit: number | null | undefined): number {
  return !limit || limit <= 0 ? Number.POSITIVE_INFINITY : limit;
}

/**
 * Цена тарифа за день: сначала выбранный период (его клиент и видит),
 * иначе — самый выгодный из доступных, иначе посуточная ставка.
 */
function dailyRateKopeks(tariff: Tariff, periodDays: number): number | null {
  const exact = periodDays > 0 ? tariff.periods.find((period) => period.days === periodDays) : null;
  if (exact) return exact.price_kopeks / periodDays;
  const rates = tariff.periods
    .filter((period) => period.days > 0)
    .map((period) => period.price_kopeks / period.days);
  if (rates.length > 0) return Math.min(...rates);
  const perDay = tariff.price_per_day_kopeks ?? tariff.daily_price_kopeks ?? 0;
  return perDay > 0 ? perDay : null;
}

/**
 * Что изменится при покупке другого сетевого тарифа поверх живой платной
 * подписки. `null` — переходом это не является (нет подписки, тот же
 * тариф, триал, архивный тариф с любой стороны).
 */
export function describeTariffSwitch({
  subscription,
  currentTariff,
  tariff,
  periodDays,
  now = new Date(),
}: {
  subscription: Subscription | null | undefined;
  currentTariff: Tariff | null | undefined;
  tariff: Tariff;
  periodDays: number;
  now?: Date;
}): TariffSwitchSummary | null {
  if (!subscription || tariff.is_current) return null;
  const currentId = subscription.tariff_id ?? currentTariff?.id ?? null;
  if (currentId === null || currentId === tariff.id) return null;
  const from = currentNetworkCategory(subscription, currentTariff);
  const to = networkCategory(tariff.network_category);
  if (!from || !to) return null;

  const remainingDays = Math.max(0, Math.round(subscription.days_left ?? 0));
  const period = Math.max(0, Math.round(periodDays));
  const devicesFrom = subscription.device_limit ?? 0;
  const devicesTo = tariff.device_limit ?? 0;

  const quota = subscription.lte_quota;
  const legacyRaw = quota?.period_mode?.startsWith('legacy_')
    ? (quota?.legacy_compatibility_until ?? null)
    : null;
  const legacyUntil = legacyRaw ? new Date(legacyRaw) : null;
  const legacyActive =
    legacyUntil !== null &&
    Number.isFinite(legacyUntil.getTime()) &&
    legacyUntil.getTime() > now.getTime();

  const currentRate = currentTariff ? dailyRateKopeks(currentTariff, period) : null;
  const newRate = dailyRateKopeks(tariff, period);

  return {
    remainingDays,
    periodDays: period,
    totalDays: remainingDays + period,
    devicesFrom,
    devicesTo,
    devicesReset: deviceCapacity(devicesTo) < deviceCapacity(devicesFrom),
    cheaper: currentRate !== null && newRate !== null && newRate < currentRate,
    lte: {
      mode: to === 'wifi' ? 'none' : legacyActive ? 'after_legacy' : 'immediate',
      gb: tariff.lte_traffic_limit_gb ?? null,
      cycleDays: tariff.lte_period_days && tariff.lte_period_days > 0 ? tariff.lte_period_days : 30,
      legacyUntil: legacyActive ? legacyUntil : null,
    },
  };
}
