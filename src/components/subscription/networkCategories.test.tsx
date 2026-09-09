// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ru from '../../locales/ru.json';
import type { Subscription, Tariff } from '../../types';
import { TariffPickerGrid, type TariffPickerGridProps } from './purchase/TariffPickerGrid';
import { NetworkTrafficSummary } from './NetworkTrafficSummary';
import { canBuyTraffic } from './networkCategory';
import { TariffPurchaseForm } from './purchase/TariffPurchaseForm';

vi.mock('../../hooks/useTheme', () => ({ useTheme: () => ({ isDark: true }) }));
vi.mock('../../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: (n: number) => String(n), currencySymbol: '₽' }),
}));
vi.mock('../../hooks/usePromoDiscount', () => ({
  usePromoDiscount: () => ({
    applyPromoDiscount: (price: number, original?: number) => ({ price, original }),
  }),
}));
vi.mock('../../utils/formatTraffic', () => ({
  formatTraffic: (gb: number) => `${gb} ГБ`,
}));
vi.mock('../../utils/uiLocale', () => ({ uiLocale: () => 'ru-RU' }));
vi.mock('../../platform', () => ({ usePlatform: () => ({ platform: 'web', openLink: () => {} }) }));

const i18n = createInstance();
await i18n.init({ lng: 'ru', resources: { ru: { translation: ru } }, initImmediate: false });

afterEach(cleanup);

const tariff = (overrides: Partial<Tariff> & { id: number; name: string }): Tariff => ({
  description: null,
  tier_level: 1,
  traffic_limit_gb: 0,
  traffic_limit_label: 'Старый лимит',
  is_unlimited_traffic: true,
  device_limit: 3,
  extra_devices_count: 0,
  servers_count: 0,
  servers: [],
  periods: [],
  is_current: false,
  is_available: true,
  ...overrides,
});

const wifi = tariff({ id: 1, name: 'Домашний', network_category: 'wifi' });
const lte = tariff({
  id: 2,
  name: 'Везде',
  network_category: 'wifi_lte',
  lte_traffic_limit_gb: 37,
  lte_period_days: 28,
});
const legacy = tariff({ id: 3, name: 'Архив LTE' });

function catalog(props: Partial<TariffPickerGridProps> = {}) {
  return (
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <TariffPickerGrid
          tariffs={[wifi, lte, legacy]}
          subscription={null}
          purchaseOptions={undefined}
          isTariffsMode
          isMultiTariff={false}
          onSelectTariff={() => {}}
          onSwitchTariff={() => {}}
          {...props}
        />
      </MemoryRouter>
    </I18nextProvider>
  );
}

function selectTab(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false });
}

describe('network categories in the purchase and switch catalog', () => {
  it('defaults to Wi-Fi + LTE, isolates categories and keeps legacy plans reachable', () => {
    render(catalog());
    expect(screen.getByText('Везде')).toBeTruthy();
    expect(screen.getByText('LTE: 37 ГБ')).toBeTruthy();
    expect(screen.getByText('каждые 28 дн.')).toBeTruthy();
    expect(screen.queryByText('Домашний')).toBeNull();
    expect(screen.queryByText('Архив LTE')).toBeNull();

    selectTab('Только Wi-Fi');
    expect(screen.getByText('Домашний')).toBeTruthy();
    expect(screen.queryByText('Везде')).toBeNull();
    expect(screen.queryByText('LTE: 37 ГБ')).toBeNull();

    selectTab('Другие тарифы');
    expect(screen.getByText('Архив LTE')).toBeTruthy();
    expect(screen.getByText('Старый лимит')).toBeTruthy();
    expect(screen.queryByText('Домашний')).toBeNull();
  });

  it('selects the current category and prevents a paid managed switch before expiry', () => {
    const onSwitchTariff = vi.fn();
    render(
      catalog({
        subscription: { tariff_id: 1, network_category: 'wifi', is_active: true } as Subscription,
        onSwitchTariff,
      }),
    );
    expect(screen.getByRole('tab', { name: 'Только Wi-Fi' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    selectTab('Wi-Fi + LTE');
    const blocked = screen.getByRole('button', { name: ru.subscription.network.afterExpiry });
    expect((blocked as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(blocked);
    expect(onSwitchTariff).not.toHaveBeenCalled();
    expect(screen.getByText(ru.subscription.network.switchUnavailable)).toBeTruthy();
  });

  it('allows the expired managed subscription to purchase another category', () => {
    const onSelectTariff = vi.fn();
    render(
      catalog({
        subscription: {
          tariff_id: 1,
          network_category: 'wifi',
          is_active: false,
          is_expired: true,
        } as Subscription,
        onSelectTariff,
      }),
    );
    selectTab('Wi-Fi + LTE');
    fireEvent.click(screen.getByRole('button', { name: ru.subscription.purchase }));
    expect(onSelectTariff).toHaveBeenCalledExactlyOnceWith(lte);
  });

  it('preserves active switches between legacy tariffs', () => {
    const onSwitchTariff = vi.fn();
    render(
      catalog({
        tariffs: [legacy, tariff({ id: 4, name: 'Другой архивный' })],
        subscription: { tariff_id: 3, is_active: true } as Subscription,
        onSwitchTariff,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: ru.subscription.switchTariff.switch }));
    expect(onSwitchTariff).toHaveBeenCalledExactlyOnceWith(4);
  });

  it('does not infer categories from tariff names and preserves the old catalog', () => {
    render(catalog({ tariffs: [legacy, tariff({ id: 4, name: 'Wi-Fi LTE VPN' })] }));
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('Архив LTE')).toBeTruthy();
    expect(screen.getByText('Wi-Fi LTE VPN')).toBeTruthy();
  });

  it('opens the legacy current tariff and tolerates unknown API category values', () => {
    render(
      catalog({
        tariffs: [wifi, lte, { ...legacy, network_category: 'future_category' as never }],
        subscription: { tariff_id: 3 } as Subscription,
      }),
    );
    expect(screen.getByRole('tab', { name: 'Другие тарифы' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByText('Архив LTE')).toBeTruthy();
  });

  it('falls back when a category disappears after reloading the available tariffs', () => {
    const { rerender } = render(catalog());
    selectTab('Только Wi-Fi');
    rerender(catalog({ tariffs: [lte] }));
    expect(screen.getByText('Везде')).toBeTruthy();
    expect((screen.getByRole('tab', { name: 'Только Wi-Fi' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('excludes purchased tariffs before choosing an available category in multi-tariff mode', () => {
    render(catalog({ tariffs: [wifi, { ...lte, is_purchased: true }], isMultiTariff: true }));
    expect(screen.getByText('Домашний')).toBeTruthy();
    expect(screen.queryByText('Везде')).toBeNull();
    expect((screen.getByRole('tab', { name: 'Wi-Fi + LTE' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('supports keyboard category navigation', async () => {
    render(catalog({ tariffs: [wifi, lte] }));
    const current = screen.getByRole('tab', { name: 'Wi-Fi + LTE' });
    current.focus();
    fireEvent.keyDown(current, { key: 'ArrowLeft' });
    await waitFor(() => expect(screen.getByText('Домашний')).toBeTruthy());
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(
      screen.getByRole('tab', { name: 'Только Wi-Fi' }).id,
    );
  });
});

function traffic(subscription: Pick<Subscription, 'network_category' | 'lte_quota'>) {
  return (
    <I18nextProvider i18n={i18n}>
      <NetworkTrafficSummary subscription={subscription} />
    </I18nextProvider>
  );
}

describe('separate LTE allowance', () => {
  it('shows the actual base, top-up, remainder and reset date without double-counting', () => {
    const gb = 1024 ** 3;
    render(
      traffic({
        network_category: 'wifi_lte',
        lte_quota: {
          limit_bytes: 10 * gb,
          topup_bytes: 5 * gb,
          used_bytes: 12 * gb,
          remaining_bytes: 3 * gb,
          period_ends_at: '2026-10-07T12:00:00Z',
          exhausted: false,
        },
      }),
    );
    expect(screen.getByText('Безлимит')).toBeTruthy();
    expect(screen.getByText('Осталось 3 ГБ')).toBeTruthy();
    expect(screen.getByText('Включено: 10 ГБ')).toBeTruthy();
    expect(screen.getByText('Доп. пакеты: 5 ГБ')).toBeTruthy();
    expect(screen.getByText('Пакет LTE обновится 07.10.2026')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('80');
  });

  it('does not fabricate a zero allowance or reset date when quota data is absent', () => {
    render(traffic({ network_category: 'wifi_lte', lte_quota: null }));
    expect(screen.getByText(ru.subscription.network.lteUnavailable)).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/Осталось|обновится/)).toBeNull();
  });

  it('marks a pending or stale counter and shows scheduled quota and top-up expiry from the API', () => {
    const gb = 1024 ** 3;
    const subscription = {
      network_category: 'wifi_lte' as const,
      lte_quota: {
        limit_bytes: 10 * gb,
        topup_bytes: 5 * gb,
        used_bytes: 0,
        remaining_bytes: 15 * gb,
        period_ends_at: null,
        exhausted: false,
        accounting_state: 'pending' as const,
        next_period_limit_bytes: 20 * gb,
        topups: [{ remaining_bytes: 5 * gb, expires_at: '2026-10-11T12:00:00Z' }],
      },
    };
    const { rerender } = render(traffic(subscription));
    expect(screen.getByRole('status').textContent).toBe(ru.subscription.network.accountingPending);
    expect(screen.getByText('Со следующего обновления: 20 ГБ LTE')).toBeTruthy();
    expect(screen.getByText('Ближайший дополнительный пакет истечёт 11.10.2026')).toBeTruthy();
    rerender(
      traffic({
        ...subscription,
        lte_quota: { ...subscription.lte_quota, accounting_state: 'stale' },
      }),
    );
    expect(screen.getByRole('status').textContent).toBe(ru.subscription.network.accountingStale);
    rerender(
      traffic({
        ...subscription,
        lte_quota: { ...subscription.lte_quota, accounting_state: 'ready' },
      }),
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not leak LTE quota into a Wi-Fi-only plan', () => {
    render(traffic({ network_category: 'wifi', lte_quota: null }));
    expect(screen.getByText('Безлимит')).toBeTruthy();
    expect(screen.queryByText('LTE')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('offers LTE top-ups independently of global traffic limits and keeps legacy rules', () => {
    const quota = {
      limit_bytes: 10,
      used_bytes: 10,
      remaining_bytes: 0,
      topup_bytes: 0,
      period_ends_at: null,
      exhausted: true,
    };
    expect(
      canBuyTraffic({ network_category: 'wifi_lte', lte_quota: quota, traffic_limit_gb: 0 }),
    ).toBe(true);
    expect(
      canBuyTraffic({ network_category: 'wifi_lte', lte_quota: null, traffic_limit_gb: 100 }),
    ).toBe(false);
    expect(canBuyTraffic({ network_category: 'wifi', traffic_limit_gb: 100 })).toBe(false);
    expect(canBuyTraffic({ traffic_limit_gb: 100 })).toBe(true);
    expect(canBuyTraffic({ traffic_limit_gb: 0 })).toBe(false);
  });
});

it('does not offer recurring or custom traffic/day purchase flows for managed plans', () => {
  const client = new QueryClient();
  const selected = tariff({
    ...lte,
    custom_days_enabled: true,
    price_per_day_kopeks: 100,
    custom_traffic_enabled: true,
    traffic_price_per_gb_kopeks: 100,
    periods: [
      {
        days: 30,
        months: 1,
        label: '30 дней',
        price_kopeks: 12300,
        price_label: '123 ₽',
        price_per_month_kopeks: 12300,
        price_per_month_label: '123 ₽',
      },
    ],
  });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <TariffPurchaseForm
            tariff={selected}
            subscriptionId={undefined}
            balanceKopeks={undefined}
            sbpPurchaseEnabled
            lavaPurchaseEnabled
            onBack={() => {}}
          />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
  expect(
    screen.queryByRole('button', { name: ru.subscription.sbpRecurring.purchaseButton }),
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: ru.subscription.lavaRecurring.purchaseButton }),
  ).toBeNull();
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.getByText('LTE: 37 ГБ')).toBeTruthy();
});
