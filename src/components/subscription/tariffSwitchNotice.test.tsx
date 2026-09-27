// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ru from '../../locales/ru.json';
import type { Subscription, Tariff, TariffPeriod } from '../../types';
import { TariffPurchaseForm } from './purchase/TariffPurchaseForm';

/**
 * Смена сетевого тарифа продаётся как обычная покупка: цена — полная цена
 * периода, а всё, чего в ней не видно (остаток дней не сгорает, устройства
 * и категория меняются сразу, новый объём LTE ждёт конца прежних оплаченных
 * условий, разницу при удешевлении не возвращают), клиент обязан прочитать
 * до оплаты.
 */

vi.mock('../../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: (n: number) => String(n), currencySymbol: '₽' }),
}));
vi.mock('../../hooks/usePromoDiscount', () => ({
  usePromoDiscount: () => ({
    applyPromoDiscount: (price: number, original?: number) => ({ price, original }),
  }),
}));
vi.mock('../../utils/formatTraffic', () => ({ formatTraffic: (gb: number) => `${gb} ГБ` }));
vi.mock('../../utils/uiLocale', () => ({ uiLocale: () => 'ru-RU' }));
vi.mock('../../platform', () => ({ usePlatform: () => ({ platform: 'web', openLink: () => {} }) }));

const i18n = createInstance();
await i18n.init({ lng: 'ru', resources: { ru: { translation: ru } }, initImmediate: false });
const text = (key: string, options: Record<string, string | number> = {}) =>
  i18n.t(`subscription.switchTariff.${key}`, options) as string;

afterEach(cleanup);

const period = (days: number, priceKopeks: number, label: string): TariffPeriod =>
  ({
    days,
    months: Math.round(days / 30),
    label,
    price_kopeks: priceKopeks,
    price_label: `${priceKopeks / 100} ₽`,
    price_per_month_kopeks: Math.round((priceKopeks * 30) / days),
    price_per_month_label: '',
  }) as TariffPeriod;

const plan = (overrides: Partial<Tariff> & { id: number; name: string }): Tariff =>
  ({
    description: null,
    tier_level: 1,
    traffic_limit_gb: 0,
    traffic_limit_label: '',
    is_unlimited_traffic: true,
    network_category: 'wifi_lte',
    lte_period_days: 30,
    extra_devices_count: 0,
    servers_count: 0,
    servers: [],
    is_current: false,
    is_available: true,
    periods: [period(30, 29900, '1 месяц'), period(90, 79900, '3 месяца')],
    ...overrides,
  }) as Tariff;

const cheap = plan({ id: 9, name: 'Везде 60', device_limit: 3, lte_traffic_limit_gb: 60 });
const rich = plan({
  id: 10,
  name: 'Везде 120',
  device_limit: 5,
  lte_traffic_limit_gb: 120,
  periods: [period(30, 49900, '1 месяц'), period(90, 129900, '3 месяца')],
});
const wifiOnly = plan({
  id: 7,
  name: 'Дома',
  device_limit: 3,
  network_category: 'wifi',
  lte_traffic_limit_gb: null,
  lte_period_days: null,
});

const subscriptionOn = (tariff: Tariff, overrides: Partial<Subscription> = {}): Subscription =>
  ({
    tariff_id: tariff.id,
    tariff_name: tariff.name,
    network_category: tariff.network_category,
    device_limit: tariff.device_limit,
    days_left: 40,
    is_active: true,
    is_trial: false,
    is_expired: false,
    is_limited: false,
    lte_quota: { period_mode: 'rolling_30_days' },
    ...overrides,
  }) as Subscription;

function form(tariff: Tariff, liveSubscription: Subscription | null, currentTariff: Tariff | null) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <TariffPurchaseForm
            tariff={tariff}
            subscriptionId={undefined}
            balanceKopeks={10_000_000}
            liveSubscription={liveSubscription}
            currentTariff={currentTariff}
            onBack={() => {}}
          />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('покупка другого сетевого тарифа = смена тарифа', () => {
  it('переносит остаток дней и включает новые условия сразу', () => {
    form(rich, subscriptionOn(cheap), cheap);
    expect(
      screen.getByText(text('carryOver', { remaining: 40, period: 30, total: 70 })),
    ).toBeTruthy();
    expect(screen.getByText(text('devicesNow', { from: '3', to: '5' }))).toBeTruthy();
    expect(screen.getByText(text('lteImmediate', { gb: 120 }))).toBeTruthy();
    expect(screen.queryByText(text('devicesReset'))).toBeNull();
    expect(screen.queryByText(text('noRefund'))).toBeNull();
    // Цена — обычная полная цена периода, без пропорций и доплат.
    // Неразрывный пробел перед «₽» — апстрим v1.76.0; textContent его не
    // нормализует, в отличие от getByText.
    expect(screen.getByText(ru.subscription.total).parentElement?.textContent).toContain(
      '499\u00A0₽',
    );

    fireEvent.click(screen.getByText('3 месяца'));
    expect(
      screen.getByText(text('carryOver', { remaining: 40, period: 90, total: 130 })),
    ).toBeTruthy();
    expect(screen.getByText(ru.subscription.total).parentElement?.textContent).toContain(
      '1299\u00A0₽',
    );
  });

  it('в фазе прежних оплаченных условий обещает новый LTE-пакет только после неё', () => {
    form(
      rich,
      subscriptionOn(cheap, {
        lte_quota: {
          period_mode: 'legacy_calendar',
          legacy_compatibility_until: '2099-03-05T12:00:00Z',
        },
      } as Partial<Subscription>),
      cheap,
    );
    expect(
      screen.getByText(text('lteAfterLegacy', { date: '05.03.2099', gb: 120, days: 30 })),
    ).toBeTruthy();
    expect(screen.queryByText(text('lteImmediate', { gb: 120 }))).toBeNull();
    // Устройства прежние условия не задерживают.
    expect(screen.getByText(text('devicesNow', { from: '3', to: '5' }))).toBeTruthy();
  });

  it('не тянет истёкшую фазу прежних условий в будущее', () => {
    form(
      rich,
      subscriptionOn(cheap, {
        lte_quota: {
          period_mode: 'legacy_calendar',
          legacy_compatibility_until: '2020-01-01T12:00:00Z',
        },
      } as Partial<Subscription>),
      cheap,
    );
    expect(screen.getByText(text('lteImmediate', { gb: 120 }))).toBeTruthy();
    expect(screen.queryByText(/2020/)).toBeNull();
  });

  it('на удешевлении честен про невозврат разницы и сброс устройств', () => {
    form(cheap, subscriptionOn(rich), rich);
    expect(screen.getByText(text('devicesNow', { from: '5', to: '3' }))).toBeTruthy();
    expect(screen.getByText(text('devicesReset'))).toBeTruthy();
    expect(screen.getByText(text('noRefund'))).toBeTruthy();
    expect(screen.getByText(text('lteImmediate', { gb: 60 }))).toBeTruthy();
  });

  it('в окне прежних условий не обещает сброс и уменьшает лимит только после даты', () => {
    // Перенесённые 8 устройств на техническом «Везде 120», покупка «Везде 60» (3).
    form(
      cheap,
      subscriptionOn(rich, {
        device_limit: 8,
        lte_quota: {
          period_mode: 'legacy_calendar',
          legacy_compatibility_until: '2099-03-05T12:00:00Z',
        },
      } as Partial<Subscription>),
      rich,
    );
    expect(
      screen.getByText(text('devicesAfterLegacy', { from: '8', to: '3', date: '05.03.2099' })),
    ).toBeTruthy();
    expect(screen.queryByText(text('devicesNow', { from: '8', to: '3' }))).toBeNull();
    expect(screen.queryByText(text('devicesReset'))).toBeNull();
  });

  it('окно прежних условий по дате, даже если LTE-период уже обычный', () => {
    form(
      cheap,
      subscriptionOn(rich, {
        lte_quota: {
          period_mode: 'rolling_30_days',
          legacy_compatibility_until: '2099-03-05T12:00:00Z',
        },
      } as Partial<Subscription>),
      rich,
    );
    expect(screen.queryByText(text('devicesReset'))).toBeNull();
    expect(
      screen.getByText(text('devicesAfterLegacy', { from: '5', to: '3', date: '05.03.2099' })),
    ).toBeTruthy();
  });

  it('после окна сброс — только когда лимит нового тарифа меньше лимита текущего тарифа', () => {
    // Лимит подписки 8 больше лимита обоих тарифов (5 → 5): бэкенд сравнивает тарифы, сброса нет.
    const same = plan({
      id: 11,
      name: 'Везде 120 Wi-Fi',
      device_limit: 5,
      network_category: 'wifi',
    });
    form(
      same,
      subscriptionOn(rich, {
        device_limit: 8,
        lte_quota: {
          period_mode: 'rolling_30_days',
          legacy_compatibility_until: '2020-01-01T12:00:00Z',
        },
      } as Partial<Subscription>),
      rich,
    );
    expect(screen.queryByText(text('devicesReset'))).toBeNull();
    cleanup();
    form(
      cheap,
      subscriptionOn(rich, {
        device_limit: 8,
        lte_quota: {
          period_mode: 'rolling_30_days',
          legacy_compatibility_until: '2020-01-01T12:00:00Z',
        },
      } as Partial<Subscription>),
      rich,
    );
    expect(screen.getByText(text('devicesReset'))).toBeTruthy();
    expect(screen.getByText(text('devicesNow', { from: '8', to: '3' }))).toBeTruthy();
  });

  it('у тарифа без LTE не обещает пакет', () => {
    form(wifiOnly, subscriptionOn(rich), rich);
    expect(screen.getByText(text('lteNone'))).toBeTruthy();
    expect(screen.getByText(text('devicesNow', { from: '5', to: '3' }))).toBeTruthy();
    expect(screen.getByText(text('devicesReset'))).toBeTruthy();
  });

  it('молчит на продлении того же тарифа и без живой подписки', () => {
    form(rich, subscriptionOn(rich), rich);
    expect(screen.queryByText(text('noticeTitle'))).toBeNull();
    cleanup();
    form(rich, null, cheap);
    expect(screen.queryByText(text('noticeTitle'))).toBeNull();
  });
});
