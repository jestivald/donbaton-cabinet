import type { NetworkCategory, Subscription, Tariff } from '../../types';

export type TariffCategoryTab = NetworkCategory | 'legacy';

/** Unknown/absent categories stay reachable without claiming any LTE entitlement. */
export function networkCategory(value: unknown): NetworkCategory | null {
  return value === 'wifi' || value === 'wifi_lte' ? value : null;
}

export function tariffCategory(tariff: Pick<Tariff, 'network_category'>): TariffCategoryTab {
  return networkCategory(tariff.network_category) ?? 'legacy';
}

export function defaultTariffCategory(
  tariffs: Tariff[],
  subscription: Pick<Subscription, 'network_category' | 'tariff_id'> | null,
): TariffCategoryTab {
  const available = new Set(tariffs.map(tariffCategory));
  const currentTariff = tariffs.find(
    (tariff) => tariff.is_current || tariff.id === subscription?.tariff_id,
  );
  const current =
    networkCategory(subscription?.network_category) ??
    (currentTariff ? tariffCategory(currentTariff) : null);
  if (current && available.has(current)) return current;
  if (available.has('wifi_lte')) return 'wifi_lte';
  if (available.has('wifi')) return 'wifi';
  return 'legacy';
}

export function canBuyTraffic(
  subscription: Pick<Subscription, 'network_category' | 'lte_quota' | 'traffic_limit_gb'>,
): boolean {
  const category = networkCategory(subscription.network_category);
  if (category === 'wifi') return false;
  if (category === 'wifi_lte') return subscription.lte_quota != null;
  return subscription.traffic_limit_gb > 0;
}
