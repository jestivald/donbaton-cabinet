import { useId, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useTranslation } from 'react-i18next';
import { BestValueBadge, bestValueFrame } from '../BestValueBadge';
import { useNavigate } from 'react-router';
import { useTheme } from '../../../hooks/useTheme';
import { useCurrency } from '../../../hooks/useCurrency';
import { usePromoDiscount } from '../../../hooks/usePromoDiscount';
import { dailyPriceQuote } from './dailyPrice';
import { getGlassColors } from '../../../utils/glassTheme';
import { ArrowDownIcon, DevicesIcon, RestartIcon } from '@/components/icons';
import type { Tariff, Subscription, PurchaseOptions } from '../../../types';
import {
  defaultTariffCategory,
  networkCategory,
  tariffCategory,
  type TariffCategoryTab,
} from '../networkCategory';
import {
  crossesArchiveBoundary,
  currentNetworkCategory,
  findCurrentTariff,
  livePaidSubscription,
  renewalLockUntil,
  renewalRequiresExpiry,
} from '../tariffSwitch';
import { uiLocale } from '../../../utils/uiLocale';
import { TariffNetworkDetails } from '../TariffNetworkDetails';

// ──────────────────────────────────────────────────────────────────
// TariffPickerGrid
//
// The tariff selection surface inside SubscriptionPurchase. Renders:
//   - an optional promo-group banner when any tariff carries a
//     promo_group_name
//   - the "all tariffs purchased" empty state (multi-tariff mode)
//   - the grid itself (1 col mobile, 2 cols sm+) with promo prices,
//     per-tariff CTAs differentiated by user state (extend / switch /
//     purchase / legacy renewal)
//
// Owns the category tab; calls back into the parent for selection
// (`onSelectTariff`) and switch (`onSwitchTariff`).
//
// Переход между сетевыми тарифами — обычная покупка (`onSelectTariff`),
// а не пропорциональный `onSwitchTariff`: клиент выбирает период и платит
// полную цену, остаток текущего тарифа бэкенд прибавит к новому сроку.
// Пропорциональный switch остался только у архивных тарифов.
// ──────────────────────────────────────────────────────────────────

export interface TariffPickerGridProps {
  tariffs: Tariff[];
  subscription: Subscription | null;
  purchaseOptions: PurchaseOptions | undefined;
  isTariffsMode: boolean;
  isMultiTariff: boolean;
  onSelectTariff: (tariff: Tariff) => void;
  onSwitchTariff: (tariffId: number) => void;
}

export function TariffPickerGrid({
  tariffs,
  subscription,
  purchaseOptions,
  isTariffsMode,
  isMultiTariff,
  onSelectTariff,
  onSwitchTariff,
}: TariffPickerGridProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const g = getGlassColors(isDark);
  const { formatAmount, currencySymbol } = useCurrency();
  const { applyPromoDiscount } = usePromoDiscount();
  const tabId = useId();
  const [selectedCategory, setSelectedCategory] = useState<TariffCategoryTab | null>(null);
  const eligibleTariffs = tariffs.filter((tariff) => {
    if (isMultiTariff && tariff.is_purchased) return false;
    return !(subscription?.is_trial && tariff.name.toLowerCase().includes('trial'));
  });
  const availableCategories = new Set(eligibleTariffs.map(tariffCategory));
  const hasCategories = availableCategories.has('wifi') || availableCategories.has('wifi_lte');
  const currentTariff = findCurrentTariff(tariffs, subscription);
  const currentCategory = currentNetworkCategory(subscription, currentTariff);
  // Живая платная подписка — единственное состояние, где есть переносимый
  // остаток дней и работают замки политики. Один источник правды и для
  // кнопок ниже, и для вкладки, на которой открывается каталог.
  const liveSubscription = livePaidSubscription(subscription, {
    isMultiTariff,
    expired: Boolean(
      purchaseOptions &&
        'subscription_is_expired' in purchaseOptions &&
        purchaseOptions.subscription_is_expired,
    ),
  });
  const hasActivePaidSubscription = liveSubscription !== null;
  // Индивидуальные условия: до конца оплаченного срока бэкенд не отдаст
  // клиенту другой тариф — это единственный замок поверх категорий.
  const renewalLocked = renewalRequiresExpiry(liveSubscription);
  const renewalUntil = renewalLockUntil(liveSubscription);
  const activeCategory =
    selectedCategory && availableCategories.has(selectedCategory)
      ? selectedCategory
      : defaultTariffCategory(eligibleTariffs, liveSubscription);
  const visibleTariffs = hasCategories
    ? eligibleTariffs.filter((tariff) => tariffCategory(tariff) === activeCategory)
    : eligibleTariffs;
  const categoryTabs: TariffCategoryTab[] = availableCategories.has('legacy')
    ? ['wifi_lte', 'wifi', 'legacy']
    : ['wifi_lte', 'wifi'];
  const isCurrent = (tariff: Tariff) => tariff.is_current || tariff.id === subscription?.tariff_id;
  // Архивные и сетевые тарифы бэкенд не смешивает, пока подписка жива.
  const isArchiveLocked = (tariff: Tariff) =>
    hasActivePaidSubscription &&
    !isCurrent(tariff) &&
    crossesArchiveBoundary(subscription, currentTariff, tariff);
  const archivePolicyVisible = !renewalLocked && visibleTariffs.some(isArchiveLocked);

  const formatPrice = (kopeks: number) =>
    kopeks === 0
      ? t('subscription.free', 'Бесплатно')
      : `${formatAmount(kopeks / 100)}\u00A0${currencySymbol}`;

  return (
    <Tabs.Root
      value={activeCategory}
      onValueChange={(value) => setSelectedCategory(value as TariffCategoryTab)}
    >
      {/* Promo group discount banner */}
      {tariffs.some((tariff) => tariff.promo_group_name) && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-success-500/30 bg-success-500/10 p-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success-500/20 text-success-400">
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"
              />
            </svg>
          </div>
          <div>
            <div className="text-sm font-medium text-success-400">
              {t('subscription.promoGroup.yourGroup', {
                name: tariffs.find((tariff) => tariff.promo_group_name)?.promo_group_name,
              })}
            </div>
            <div className="text-xs text-dark-400">
              {t('subscription.promoGroup.personalDiscountsApplied')}
            </div>
          </div>
        </div>
      )}

      {hasCategories && (
        <div className="mb-5 space-y-3">
          <Tabs.List
            aria-label={t('subscription.network.chooseCategory')}
            className="flex gap-1 rounded-xl border border-dark-700/50 bg-dark-800/50 p-1"
          >
            {categoryTabs.map((category) => (
              <Tabs.Trigger
                key={category}
                value={category}
                id={`${tabId}-${category}`}
                aria-controls={`${tabId}-tariffs`}
                disabled={!availableCategories.has(category)}
                className="flex-1 rounded-lg px-2 py-3 text-sm font-medium text-dark-400 transition-colors hover:text-dark-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-400 disabled:cursor-not-allowed disabled:opacity-40 data-[state=active]:bg-accent-500 data-[state=active]:text-on-accent"
              >
                {t(`subscription.network.${category}`)}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {activeCategory !== 'legacy' && (
            <p className="text-sm text-dark-300">
              {t(`subscription.network.${activeCategory}Description`)}
            </p>
          )}
          <p className="text-xs text-dark-400">{t('subscription.network.explanation')}</p>
        </div>
      )}

      {hasActivePaidSubscription && (hasCategories || currentCategory || renewalLocked) && (
        <p id={`${tabId}-switch-policy`} className="mb-4 text-sm text-dark-400">
          {renewalLocked
            ? renewalUntil
              ? t('subscription.network.legacyRenewalUntil', {
                  date: renewalUntil.toLocaleDateString(uiLocale()),
                })
              : t('subscription.network.legacyRenewalAfterExpiry')
            : t('subscription.network.switchPurchaseRule')}
        </p>
      )}
      {archivePolicyVisible && (
        <p id={`${tabId}-archive-policy`} className="mb-4 text-sm text-dark-400">
          {t('subscription.network.switchUnavailable')}
        </p>
      )}

      {/* Tariff Grid */}
      {isMultiTariff &&
        purchaseOptions &&
        'all_tariffs_purchased' in purchaseOptions &&
        purchaseOptions.all_tariffs_purchased && (
          <div
            className="rounded-2xl border p-6 text-center"
            style={{ background: g.cardBg, borderColor: g.cardBorder }}
          >
            <div className="mb-2 text-3xl">✅</div>
            <h3 className="mb-1 text-lg font-semibold" style={{ color: g.text }}>
              {t('subscription.allTariffsPurchased', 'Все тарифы подключены')}
            </h3>
            <p className="mb-4 text-sm" style={{ color: g.textSecondary }}>
              {t(
                'subscription.allTariffsPurchasedDesc',
                'Вы уже приобрели все доступные тарифы. Продлить подписку можно на странице тарифа.',
              )}
            </p>
            <button
              onClick={() => navigate('/subscriptions')}
              className="rounded-xl bg-accent-500 px-6 py-2.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-600"
            >
              {t('subscription.backToList', 'Мои подписки')}
            </button>
          </div>
        )}
      <div
        role={hasCategories ? 'tabpanel' : undefined}
        id={`${tabId}-tariffs`}
        aria-labelledby={hasCategories ? `${tabId}-${activeCategory}` : undefined}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        {[...visibleTariffs]
          .sort((a, b) => {
            const aIsCurrent = a.is_current || a.id === subscription?.tariff_id;
            const bIsCurrent = b.is_current || b.id === subscription?.tariff_id;
            if (aIsCurrent && !bIsCurrent) return -1;
            if (!aIsCurrent && bIsCurrent) return 1;
            return 0;
          })
          .map((tariff) => {
            const isCurrentTariff = isCurrent(tariff);
            const isSubscriptionExpired =
              isTariffsMode &&
              purchaseOptions &&
              'subscription_is_expired' in purchaseOptions &&
              purchaseOptions.subscription_is_expired === true;
            // Free (0₽) source tariff: the backend blocks the prorated switch
            // (free_tariff_cannot_switch) — offer the purchase flow instead.
            const isOnFreeTariff =
              isTariffsMode &&
              purchaseOptions &&
              'subscription_on_free_tariff' in purchaseOptions &&
              purchaseOptions.subscription_on_free_tariff === true;
            const canSwitch =
              !isMultiTariff &&
              subscription &&
              subscription.tariff_id &&
              !isCurrentTariff &&
              !subscription.is_trial &&
              !isSubscriptionExpired &&
              !isOnFreeTariff &&
              (subscription.is_active || subscription.is_limited);
            const isLegacySubscription =
              subscription && !subscription.is_trial && !subscription.tariff_id;
            // Замок остался только там, где откажет и бэкенд: архивный ↔
            // сетевой тариф и индивидуальные условия до конца срока.
            const isBlocked = !isCurrentTariff && (renewalLocked || isArchiveLocked(tariff));
            // Сетевой → сетевой: обычная покупка с выбором периода.
            const isNetworkPurchaseSwitch =
              hasActivePaidSubscription &&
              !isCurrentTariff &&
              !isBlocked &&
              Boolean(currentCategory) &&
              Boolean(networkCategory(tariff.network_category));

            return (
              <div
                key={tariff.id}
                className={`bento-card-hover p-5 text-left transition-all ${
                  isCurrentTariff
                    ? 'bento-card-glow border-accent-500'
                    : tariff.is_highlighted
                      ? // Текущий тариф важнее подсказки: две «активные» рамки
                        // сразу не дают понять, что именно сейчас куплено.
                        bestValueFrame(false)
                      : ''
                }`}
              >
                {tariff.is_highlighted && !isCurrentTariff && <BestValueBadge className="mb-2" />}
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <div className="text-lg font-semibold text-dark-100">{tariff.name}</div>
                    {tariff.description && (
                      <div className="mt-1 whitespace-pre-line text-sm text-dark-400">
                        {tariff.description}
                      </div>
                    )}
                  </div>
                  {isCurrentTariff && (
                    <span className="badge-success text-xs">{t('subscription.currentTariff')}</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <div className="flex items-center gap-1.5">
                    <ArrowDownIcon className="h-4 w-4 text-accent-400" />
                    <span className="font-medium text-dark-200">
                      <TariffNetworkDetails tariff={tariff} />
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <DevicesIcon className="h-4 w-4 text-dark-400" />
                    <span className="text-dark-300">
                      {tariff.device_limit === 0
                        ? '∞'
                        : t('subscription.devices', { count: tariff.device_limit })}
                    </span>
                  </div>
                  {!networkCategory(tariff.network_category) &&
                    tariff.traffic_reset_mode &&
                    tariff.traffic_reset_mode !== 'NO_RESET' && (
                      <div className="flex items-center gap-1.5">
                        <RestartIcon className="h-4 w-4 text-dark-400" />
                        <span className="text-dark-300">
                          {t(`subscription.trafficReset.${tariff.traffic_reset_mode}`)}
                        </span>
                      </div>
                    )}
                </div>
                {/* Price info */}
                <div className="mt-3 border-t border-dark-700/50 pt-3 text-sm text-dark-400">
                  {(() => {
                    const promoDaily = dailyPriceQuote(tariff, applyPromoDiscount);
                    if (promoDaily) {
                      return (
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-accent-400">
                            {formatPrice(promoDaily.price)}
                          </span>
                          {promoDaily.original && promoDaily.original > promoDaily.price && (
                            <span className="text-xs text-dark-500 line-through">
                              {formatPrice(promoDaily.original)}
                            </span>
                          )}
                          <span>{t('subscription.tariff.perDay')}</span>
                          {promoDaily.percent != null && promoDaily.percent > 0 && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-xs ${
                                promoDaily.isPromoGroup
                                  ? 'bg-success-500/20 text-success-400'
                                  : 'bg-warning-500/20 text-warning-400'
                              }`}
                            >
                              -{promoDaily.percent}%
                            </span>
                          )}
                        </span>
                      );
                    }
                    if (tariff.periods.length > 0) {
                      const firstPeriod = tariff.periods[0];
                      const promoPeriod = applyPromoDiscount(
                        firstPeriod?.price_kopeks || 0,
                        firstPeriod?.original_price_kopeks,
                      );
                      return (
                        <span className="flex flex-wrap items-center gap-2">
                          <span>{t('subscription.from')}</span>
                          <span className="font-medium text-accent-400">
                            {formatPrice(promoPeriod.price)}
                          </span>
                          {/* У сетевых тарифов цена периодная: без срока «от 299 ₽»
                              читается как цена за месяц любого периода. */}
                          {networkCategory(tariff.network_category) && firstPeriod && (
                            <span>
                              {t('subscription.network.perPeriod', { count: firstPeriod.days })}
                            </span>
                          )}
                          {promoPeriod.original && promoPeriod.original > promoPeriod.price && (
                            <span className="text-xs text-dark-500 line-through">
                              {formatPrice(promoPeriod.original)}
                            </span>
                          )}
                          {promoPeriod.percent != null && promoPeriod.percent > 0 && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-xs ${
                                promoPeriod.isPromoGroup
                                  ? 'bg-success-500/20 text-success-400'
                                  : 'bg-warning-500/20 text-warning-400'
                              }`}
                            >
                              -{promoPeriod.percent}%
                            </span>
                          )}
                        </span>
                      );
                    }
                    return (
                      <span className="font-medium text-accent-400">
                        {t('subscription.tariff.flexiblePayment')}
                      </span>
                    );
                  })()}
                </div>

                {/* Action Buttons */}
                <div className="mt-4 flex gap-2">
                  {isCurrentTariff ? (
                    subscription?.is_daily ? (
                      <div className="flex-1 py-2 text-center text-sm text-dark-500">
                        {t('subscription.currentTariff')}
                      </div>
                    ) : (
                      <button
                        onClick={() => onSelectTariff(tariff)}
                        className="btn-primary flex-1 py-2 text-sm"
                      >
                        {t('subscription.extend')}
                      </button>
                    )
                  ) : isBlocked ? (
                    <button
                      disabled
                      aria-describedby={
                        renewalLocked ? `${tabId}-switch-policy` : `${tabId}-archive-policy`
                      }
                      className="btn-secondary flex-1 py-2 text-sm disabled:opacity-50"
                    >
                      {t('subscription.network.afterExpiry')}
                    </button>
                  ) : isNetworkPurchaseSwitch ? (
                    <button
                      onClick={() => onSelectTariff(tariff)}
                      className="btn-primary flex-1 py-2 text-sm"
                    >
                      {t('subscription.switchTariff.switch')}
                    </button>
                  ) : isLegacySubscription ? (
                    <button
                      onClick={() => onSelectTariff(tariff)}
                      className="btn-primary flex-1 py-2 text-sm"
                    >
                      {t('subscription.tariff.selectForRenewal')}
                    </button>
                  ) : canSwitch ? (
                    <button
                      onClick={() => onSwitchTariff(tariff.id)}
                      className="btn-secondary flex-1 py-2 text-sm"
                    >
                      {t('subscription.switchTariff.switch')}
                    </button>
                  ) : (
                    <button
                      onClick={() => onSelectTariff(tariff)}
                      className="btn-primary flex-1 py-2 text-sm"
                    >
                      {t('subscription.purchase')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </Tabs.Root>
  );
}
