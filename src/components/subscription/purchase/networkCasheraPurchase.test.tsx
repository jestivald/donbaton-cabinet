// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ru from '../../../locales/ru.json';
import type { Tariff, TariffPeriod } from '../../../types';
import { TariffPurchaseForm } from './TariffPurchaseForm';

/**
 * ДонБатон: оформить сетевой тариф (Wi-Fi / Wi-Fi + LTE) с внешней автооплатой
 * нельзя — бот форка такие привязки не ведёт. Кнопки «Оформить с автооплатой»
 * СБП и Lava форк прятал с самого начала; Cashera (апстрим 1.80.0) — третья
 * такая кнопка и прячется так же. Архивному тарифу всё остаётся как у апстрима.
 */

vi.mock('../../../hooks/useTheme', () => ({ useTheme: () => ({ isDark: true }) }));
vi.mock('../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: (n: number) => String(n), currencySymbol: '₽' }),
}));
vi.mock('../../../hooks/usePromoDiscount', () => ({
  usePromoDiscount: () => ({
    applyPromoDiscount: (price: number, original?: number) => ({ price, original }),
  }),
}));
vi.mock('../../../utils/formatTraffic', () => ({
  formatTraffic: (gb: number) => `${gb} ГБ`,
}));
vi.mock('../../../utils/uiLocale', () => ({ uiLocale: () => 'ru-RU' }));
vi.mock('../../../platform', () => ({
  usePlatform: () => ({ platform: 'web', openLink: () => {} }),
}));

const i18n = createInstance();
await i18n.init({ lng: 'ru', resources: { ru: { translation: ru } } });

afterEach(cleanup);

const period = (days: number, priceKopeks: number): TariffPeriod => ({
  days,
  months: Math.round(days / 30),
  label: `${days} дней`,
  price_kopeks: priceKopeks,
  price_label: `${priceKopeks / 100} ₽`,
  price_per_month_kopeks: Math.round((priceKopeks * 30) / days),
  price_per_month_label: '',
});

const tariff = (overrides: Partial<Tariff> & { id: number; name: string }): Tariff => ({
  description: null,
  tier_level: 1,
  traffic_limit_gb: 0,
  traffic_limit_label: 'Безлимит',
  is_unlimited_traffic: true,
  device_limit: 3,
  extra_devices_count: 0,
  servers_count: 0,
  servers: [],
  periods: [period(30, 29900)],
  is_current: false,
  is_available: true,
  ...overrides,
});

function purchaseForm(selected: Tariff) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <TariffPurchaseForm
            tariff={selected}
            subscriptionId={undefined}
            balanceKopeks={undefined}
            sbpPurchaseEnabled
            lavaPurchaseEnabled
            casheraPurchaseEnabled
            onBack={() => {}}
          />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

const recurringButtons = [
  ru.subscription.sbpRecurring.purchaseButton,
  ru.subscription.lavaRecurring.purchaseButton,
  ru.subscription.casheraRecurring.purchaseButton,
];

describe('оформление с внешней автооплатой', () => {
  it.each([
    ['wifi', tariff({ id: 1, name: 'Домашний', network_category: 'wifi' })],
    [
      'wifi_lte',
      tariff({
        id: 2,
        name: 'Везде',
        network_category: 'wifi_lte',
        lte_traffic_limit_gb: 60,
        lte_period_days: 30,
      }),
    ],
  ])('сетевому тарифу (%s) кнопок СБП, Lava и Cashera нет', (_category, selected) => {
    render(purchaseForm(selected));
    for (const name of recurringButtons) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('архивному тарифу все три кнопки остаются, как у апстрима', () => {
    render(purchaseForm(tariff({ id: 3, name: 'Архив' })));
    for (const name of recurringButtons) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });
});
