import { useTranslation } from 'react-i18next';
import type { Subscription } from '../../types';
import { formatTraffic } from '../../utils/formatTraffic';
import { uiLocale } from '../../utils/uiLocale';
import { networkCategory } from './networkCategory';

export function NetworkTrafficSummary({
  subscription,
}: {
  subscription: Pick<Subscription, 'network_category' | 'lte_quota'>;
}) {
  const { t } = useTranslation();
  const category = networkCategory(subscription.network_category);
  if (!category) return null;

  const quota = subscription.lte_quota;
  const totalBytes = quota ? quota.limit_bytes + quota.topup_bytes : 0;
  const percent =
    quota && totalBytes > 0 ? Math.min(100, Math.max(0, (quota.used_bytes / totalBytes) * 100)) : 0;
  const resetDate = quota?.period_ends_at ? new Date(quota.period_ends_at) : null;
  const nextTopupExpiry = quota?.topups
    ?.filter((topup) => topup.remaining_bytes > 0)
    .map((topup) => new Date(topup.expires_at))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((left, right) => left.getTime() - right.getTime())[0];
  const formatBytes = (bytes: number) => formatTraffic(bytes / 1024 ** 3);

  return (
    <div className="space-y-3 text-sm" aria-label={t('subscription.network.trafficTitle')}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-dark-300">Wi-Fi</span>
        <span className="font-medium text-dark-100">{t('subscription.network.unlimited')}</span>
      </div>
      {category === 'wifi_lte' &&
        (quota ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-dark-300">LTE</span>
              <span className="font-medium tabular-nums text-dark-100">
                {t('subscription.network.remaining', {
                  traffic: formatBytes(quota.remaining_bytes),
                })}
              </span>
            </div>
            {quota.accounting_state && quota.accounting_state !== 'ready' && (
              <p className="text-xs text-dark-400" role="status">
                {t(
                  quota.accounting_state === 'pending' || quota.accounting_state === 'missing'
                    ? 'subscription.network.accountingPending'
                    : 'subscription.network.accountingStale',
                )}
              </p>
            )}
            <div
              role="progressbar"
              aria-label={t('subscription.network.lteUsage')}
              aria-valuenow={Math.round(percent)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={t('subscription.network.used', {
                used: formatBytes(quota.used_bytes),
                total: formatBytes(totalBytes),
              })}
              className="h-1.5 overflow-hidden rounded-full bg-dark-700/40"
            >
              <div
                className={`h-full rounded-full transition-all ${quota.exhausted ? 'bg-warning-400' : 'bg-accent-400'}`}
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="flex flex-wrap justify-between gap-1 text-xs text-dark-400">
              <span>
                {t('subscription.network.included', { traffic: formatBytes(quota.limit_bytes) })}
              </span>
              {quota.topup_bytes > 0 && (
                <span>
                  {t('subscription.network.added', { traffic: formatBytes(quota.topup_bytes) })}
                </span>
              )}
            </div>
            {resetDate && Number.isFinite(resetDate.getTime()) && (
              <p className="text-xs text-dark-400">
                {t('subscription.network.resetDate', {
                  date: resetDate.toLocaleDateString(uiLocale()),
                })}
              </p>
            )}
            {quota.next_period_limit_bytes != null && (
              <p className="text-xs text-dark-400">
                {t('subscription.network.nextAllowance', {
                  traffic: formatBytes(quota.next_period_limit_bytes),
                })}
              </p>
            )}
            {nextTopupExpiry && (
              <p className="text-xs text-dark-400">
                {t('subscription.network.topupExpiry', {
                  date: nextTopupExpiry.toLocaleDateString(uiLocale()),
                })}
              </p>
            )}
            {quota.exhausted && (
              <p className="text-xs text-warning-400">{t('subscription.network.exhausted')}</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-dark-400">{t('subscription.network.lteUnavailable')}</p>
        ))}
    </div>
  );
}
