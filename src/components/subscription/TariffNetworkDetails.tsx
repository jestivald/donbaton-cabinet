import { useTranslation } from 'react-i18next';
import type { Tariff } from '../../types';
import { networkCategory } from './networkCategory';

export function TariffNetworkDetails({ tariff }: { tariff: Tariff }) {
  const { t } = useTranslation();
  const category = networkCategory(tariff.network_category);
  if (!category) return <span>{tariff.traffic_limit_label}</span>;

  return (
    <span className="inline-flex flex-col gap-1">
      <span>{t('subscription.network.wifiUnlimited')}</span>
      {category === 'wifi_lte' && (
        <span className="text-accent-400">
          {tariff.lte_traffic_limit_gb != null
            ? t('subscription.network.lteIncluded', { gb: tariff.lte_traffic_limit_gb })
            : t('subscription.network.lteUnavailable')}
          {tariff.lte_period_days != null && tariff.lte_period_days > 0 && (
            <span className="ml-1 text-dark-400">
              {t('subscription.network.ltePeriod', { days: tariff.lte_period_days })}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
