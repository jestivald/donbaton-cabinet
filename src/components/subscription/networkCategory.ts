import type { NetworkCategory, Subscription, Tariff } from '../../types';

export type TariffCategoryTab = NetworkCategory | 'legacy';

/** Unknown/absent categories stay reachable without claiming any LTE entitlement. */
export function networkCategory(value: unknown): NetworkCategory | null {
  return value === 'wifi' || value === 'wifi_lte' ? value : null;
}

export function tariffCategory(tariff: Pick<Tariff, 'network_category'>): TariffCategoryTab {
  return networkCategory(tariff.network_category) ?? 'legacy';
}

function subscriptionCategory(
  tariffs: Tariff[],
  subscription: Pick<Subscription, 'network_category' | 'tariff_id'>,
): TariffCategoryTab | null {
  const currentTariff = tariffs.find(
    (tariff) => tariff.is_current || tariff.id === subscription.tariff_id,
  );
  return (
    networkCategory(subscription.network_category) ??
    (currentTariff ? tariffCategory(currentTariff) : null)
  );
}

/**
 * The tab the catalog opens on.
 *
 * A live paid subscription opens the catalog on its own category — that is
 * where renewal lives and where a move to another plan starts from, while
 * every other tab stays clickable. `liveSubscription` is that — and ONLY
 * that — subscription, passed by the caller that owns the check. Whenever the
 * customer has no live paid plan (no subscription, expired, trial,
 * multi-tariff), the catalog opens on Wi-Fi + LTE, then Wi-Fi, then legacy.
 */
export function defaultTariffCategory(
  tariffs: Tariff[],
  liveSubscription: Pick<Subscription, 'network_category' | 'tariff_id'> | null,
): TariffCategoryTab {
  const available = new Set(tariffs.map(tariffCategory));
  const current = liveSubscription && subscriptionCategory(tariffs, liveSubscription);
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
  if (category === 'wifi_lte')
    return subscription.lte_quota != null && !subscription.lte_quota.is_unlimited;
  return subscription.traffic_limit_gb > 0;
}
