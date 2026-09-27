import { useTranslation } from 'react-i18next';
import type { Subscription, Tariff } from '../../../types';
import { uiLocale } from '../../../utils/uiLocale';
import { describeTariffSwitch } from '../tariffSwitch';

// ──────────────────────────────────────────────────────────────────
// TariffSwitchNotice
//
// Что произойдёт при покупке другого сетевого тарифа поверх живой
// подписки. Цена на экране остаётся обычной ценой периода — блок
// объясняет ровно то, чего в ней не видно: остаток текущего тарифа не
// сгорает, устройства и категория меняются сразу (в окне прежних условий
// лимит устройств уменьшается только после их окончания, без сброса), новый
// объём LTE ждёт конца прежних оплаченных условий, а разницу при удешевлении
// никто не возвращает.
// ──────────────────────────────────────────────────────────────────

export interface TariffSwitchNoticeProps {
  /** Живая платная подписка, с которой уходит клиент (см. livePaidSubscription). */
  liveSubscription: Subscription | null | undefined;
  /** Её тариф из того же каталога — источник цены и лимита устройств. */
  currentTariff: Tariff | null | undefined;
  tariff: Tariff;
  periodDays: number;
}

export function TariffSwitchNotice({
  liveSubscription,
  currentTariff,
  tariff,
  periodDays,
}: TariffSwitchNoticeProps) {
  const { t } = useTranslation();
  const summary = describeTariffSwitch({
    subscription: liveSubscription,
    currentTariff,
    tariff,
    periodDays,
  });
  if (!summary) return null;

  const devices = (limit: number) => (limit > 0 ? String(limit) : '∞');
  const lines: string[] = [];

  if (summary.remainingDays > 0 && summary.periodDays > 0) {
    lines.push(
      t('subscription.switchTariff.carryOver', {
        remaining: summary.remainingDays,
        period: summary.periodDays,
        total: summary.totalDays,
      }),
    );
  }
  const capacity = (limit: number) => (limit > 0 ? limit : Number.POSITIVE_INFINITY);
  if (summary.devicesKeptUntil && capacity(summary.devicesTo) < capacity(summary.devicesFrom)) {
    // Окно прежних условий: до даты лимит не уменьшается, устройства не сбрасываются.
    lines.push(
      t('subscription.switchTariff.devicesAfterLegacy', {
        from: devices(summary.devicesFrom),
        to: devices(summary.devicesTo),
        date: summary.devicesKeptUntil.toLocaleDateString(uiLocale()),
      }),
    );
  } else {
    lines.push(
      t('subscription.switchTariff.devicesNow', {
        from: devices(summary.devicesFrom),
        to: devices(summary.devicesTo),
      }),
    );
  }
  if (summary.lte.mode === 'none') {
    lines.push(t('subscription.switchTariff.lteNone'));
  } else if (summary.lte.gb != null) {
    lines.push(
      summary.lte.mode === 'after_legacy' && summary.lte.legacyUntil
        ? t('subscription.switchTariff.lteAfterLegacy', {
            date: summary.lte.legacyUntil.toLocaleDateString(uiLocale()),
            gb: summary.lte.gb,
            days: summary.lte.cycleDays,
          })
        : t('subscription.switchTariff.lteImmediate', { gb: summary.lte.gb }),
    );
  }
  if (summary.devicesReset) {
    lines.push(t('subscription.switchTariff.devicesReset'));
  }
  if (summary.cheaper) {
    lines.push(t('subscription.switchTariff.noRefund'));
  }

  return (
    <div className="mb-4 rounded-xl border border-accent-500/30 bg-accent-500/10 p-4">
      <div className="mb-2 text-sm font-medium text-accent-400">
        {t('subscription.switchTariff.noticeTitle')}
      </div>
      <ul className="space-y-1.5 text-sm text-dark-300">
        {lines.map((line) => (
          <li key={line} className="flex items-start gap-2">
            <span className="text-accent-400">•</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
