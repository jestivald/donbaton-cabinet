// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ru from '../../locales/ru.json';
import type { Subscription, Tariff, TariffPeriod } from '../../types';
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
await i18n.init({ lng: 'ru', resources: { ru: { translation: ru } }, initAsync: false });

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

const period = (
  days: number,
  priceKopeks: number,
  overrides: Partial<TariffPeriod> = {},
): TariffPeriod => ({
  days,
  months: Math.round(days / 30),
  label: `${days} дней`,
  price_kopeks: priceKopeks,
  price_label: `${priceKopeks / 100} ₽`,
  price_per_month_kopeks: Math.round((priceKopeks * 30) / days),
  price_per_month_label: '',
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
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Wi-Fi + LTE',
      'Только Wi-Fi',
      'Другие тарифы',
    ]);
    expect(screen.getByRole('tab', { name: 'Wi-Fi + LTE' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByText('Везде')).toBeTruthy();
    expect(screen.getByText('LTE: 37 ГиБ')).toBeTruthy();
    expect(screen.getByText('каждые 28 дн.')).toBeTruthy();
    expect(screen.queryByText('Домашний')).toBeNull();
    expect(screen.queryByText('Архив LTE')).toBeNull();

    selectTab('Только Wi-Fi');
    expect(screen.getByText('Домашний')).toBeTruthy();
    expect(screen.queryByText('Везде')).toBeNull();
    expect(screen.queryByText('LTE: 37 ГиБ')).toBeNull();

    selectTab('Другие тарифы');
    expect(screen.getByText('Архив LTE')).toBeTruthy();
    expect(screen.getByText('Старый лимит')).toBeTruthy();
    expect(screen.queryByText('Домашний')).toBeNull();
  });

  /**
   * Смена сетевого тарифа = покупка другого тарифа на полный срок: остаток
   * дней бэкенд перенесёт сам. Поэтому «Перейти» ведёт в обычный флоу
   * покупки с выбором периода, а не в пропорциональный switch.
   */
  it('opens the current category and sells another network plan as a regular purchase', () => {
    const onSelectTariff = vi.fn();
    const onSwitchTariff = vi.fn();
    render(
      catalog({
        subscription: { tariff_id: 1, network_category: 'wifi', is_active: true } as Subscription,
        onSelectTariff,
        onSwitchTariff,
      }),
    );
    expect(screen.getByRole('tab', { name: 'Только Wi-Fi' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByText(ru.subscription.network.switchPurchaseRule)).toBeTruthy();
    expect(screen.queryByText(ru.subscription.network.switchUnavailable)).toBeNull();

    selectTab('Wi-Fi + LTE');
    fireEvent.click(screen.getByRole('button', { name: ru.subscription.switchTariff.switch }));
    expect(onSelectTariff).toHaveBeenCalledExactlyOnceWith(lte);
    expect(onSwitchTariff).not.toHaveBeenCalled();
  });

  it('keeps archived and network plans apart while the paid subscription runs', () => {
    const onSelectTariff = vi.fn();
    const onSwitchTariff = vi.fn();
    const { unmount } = render(
      catalog({
        subscription: { tariff_id: 1, network_category: 'wifi', is_active: true } as Subscription,
        onSelectTariff,
        onSwitchTariff,
      }),
    );
    selectTab('Другие тарифы');
    const blocked = screen.getByRole('button', { name: ru.subscription.network.afterExpiry });
    expect((blocked as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(blocked);
    expect(screen.getByText(ru.subscription.network.switchUnavailable)).toBeTruthy();

    // И в обратную сторону: архивная подписка не уходит на сетевой тариф.
    unmount();
    render(
      catalog({
        subscription: { tariff_id: 3, is_active: true } as Subscription,
        onSelectTariff,
        onSwitchTariff,
      }),
    );
    selectTab('Wi-Fi + LTE');
    expect(
      (
        screen.getByRole('button', {
          name: ru.subscription.network.afterExpiry,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(onSelectTariff).not.toHaveBeenCalled();
    expect(onSwitchTariff).not.toHaveBeenCalled();
  });

  it('holds individual terms until the paid period ends and names the date', () => {
    const onSelectTariff = vi.fn();
    render(
      catalog({
        subscription: {
          tariff_id: 2,
          network_category: 'wifi_lte',
          is_active: true,
          lte_quota: {
            renewal_requires_expiry: true,
            legacy_compatibility_until: '2026-10-07T12:00:00Z',
          },
        } as Subscription,
        onSelectTariff,
      }),
    );
    expect(
      screen.getByText(
        i18n.t('subscription.network.legacyRenewalUntil', { date: '07.10.2026' }) as string,
      ),
    ).toBeTruthy();

    selectTab('Только Wi-Fi');
    const blocked = screen.getByRole('button', { name: ru.subscription.network.afterExpiry });
    expect((blocked as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(blocked);
    expect(onSelectTariff).not.toHaveBeenCalled();
  });

  it('opens Wi-Fi + LTE for the expired managed subscription and lets it purchase there', () => {
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
    expect(screen.getByRole('tab', { name: 'Wi-Fi + LTE' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.queryByText('Домашний')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: ru.subscription.purchase }));
    expect(onSelectTariff).toHaveBeenCalledExactlyOnceWith(lte);
    selectTab('Только Wi-Fi');
    expect(screen.getByText('Домашний')).toBeTruthy();
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
        subscription: { tariff_id: 3, is_active: true } as Subscription,
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
    fireEvent.keyDown(current, { key: 'ArrowRight' });
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
  it('preserves the paid compatibility end without promising a refill for NO_RESET or unlimited', () => {
    const subscription = {
      network_category: 'wifi_lte' as const,
      lte_quota: {
        limit_bytes: 10 * 1024 ** 3,
        topup_bytes: 0,
        used_bytes: 8 * 1024 ** 3,
        remaining_bytes: 2 * 1024 ** 3,
        period_ends_at: '2026-10-07T12:00:00Z',
        legacy_compatibility_until: '2026-10-07T12:00:00Z',
        period_mode: 'legacy_no_reset' as const,
        exhausted: false,
      },
    };
    const { rerender } = render(traffic(subscription));
    expect(screen.getByText('Осталось 2 ГБ')).toBeTruthy();
    expect(screen.getByText('Перенесённый пакет: 10 ГБ')).toBeTruthy();
    expect(screen.getByText('Прежние оплаченные условия действуют до 07.10.2026')).toBeTruthy();
    expect(screen.queryByText(/обновится/)).toBeNull();
    rerender(
      traffic({
        ...subscription,
        lte_quota: { ...subscription.lte_quota, is_unlimited: true, remaining_bytes: 0 },
      }),
    );
    expect(screen.getAllByText('Безлимит')).toHaveLength(2);
    expect(screen.queryByText(/Осталось/)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/обновится/)).toBeNull();
  });

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
            onBack={() => {}}
          />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

it('does not offer recurring or custom traffic/day purchase flows for managed plans', () => {
  render(
    purchaseForm(
      tariff({
        ...lte,
        custom_days_enabled: true,
        price_per_day_kopeks: 100,
        custom_traffic_enabled: true,
        traffic_price_per_gb_kopeks: 100,
        periods: [period(30, 12300)],
      }),
    ),
  );
  expect(
    screen.queryByRole('button', { name: ru.subscription.sbpRecurring.purchaseButton }),
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: ru.subscription.lavaRecurring.purchaseButton }),
  ).toBeNull();
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.getByText('LTE: 37 ГиБ')).toBeTruthy();
});

/**
 * Длинные периоды сетевых тарифов. Пакет LTE выдаётся раз в 30 дней, а не на
 * весь оплаченный срок: без пояснения «60 ГиБ» на годовой карточке читается
 * как «60 ГиБ на год» — ровно то обещание, которого продукт не даёт.
 */
const lteYear = tariff({
  ...lte,
  lte_traffic_limit_gb: 60,
  lte_period_days: 30,
  periods: [
    period(30, 29900, { label: '1 месяц' }),
    period(90, 79900, { label: '3 месяца' }),
    period(180, 129900, { label: '6 месяцев', is_highlighted: true }),
    period(360, 179900, { label: '12 месяцев' }),
  ],
});

describe('LTE-пакет на периодах длиннее его цикла', () => {
  it('пересчитывает обновления пакета под выбранный срок', () => {
    render(purchaseForm(lteYear));
    for (const label of ['1 месяц', '3 месяца', '6 месяцев', '12 месяцев']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // Шапка тарифа по-прежнему называет сам пакет и его цикл.
    expect(screen.getByText('LTE: 60 ГиБ')).toBeTruthy();
    expect(screen.getByText('каждые 30 дн.')).toBeTruthy();
    // Отмеченный оператором период (180) выбран сразу — форма открывается на нём.
    expect(
      screen.getByText(
        'LTE-пакет 60 ГиБ обновляется каждые 30 дней — 6 обновлений за срок подписки',
      ),
    ).toBeTruthy();

    // На месяце срок равен циклу — пояснять нечего.
    fireEvent.click(screen.getByText('1 месяц'));
    expect(screen.queryByText(/обновляется каждые/)).toBeNull();

    fireEvent.click(screen.getByText('12 месяцев'));
    expect(
      screen.getByText(
        'LTE-пакет 60 ГиБ обновляется каждые 30 дней — 12 обновлений за срок подписки',
      ),
    ).toBeTruthy();
    // Цена склеена неразрывным пробелом (апстрим v1.76.0: «₽» не отрывается
    // от числа), а textContent, в отличие от getByText, пробелы не нормализует.
    expect(screen.getByText(ru.subscription.total).parentElement?.textContent).toContain(
      '1799\u00A0₽',
    );

    fireEvent.click(screen.getByText('3 месяца'));
    expect(screen.getByText(/— 3 обновления за срок подписки/)).toBeTruthy();

    fireEvent.click(screen.getByText('1 месяц'));
    expect(screen.queryByText(/обновляется каждые/)).toBeNull();
    expect(screen.getByText(ru.subscription.total).parentElement?.textContent).toContain(
      '299\u00A0₽',
    );
  });

  it('не обещает обновление пакета тарифу без LTE', () => {
    render(
      purchaseForm(tariff({ ...wifi, periods: [period(360, 179900, { label: '12 месяцев' })] })),
    );
    expect(screen.getByText('12 месяцев')).toBeTruthy();
    expect(screen.queryByText(/обновляется каждые/)).toBeNull();
  });
});

it('называет срок рядом с ценой сетевого тарифа, не трогая старые карточки', () => {
  render(
    catalog({
      tariffs: [
        { ...lteYear, id: 5 },
        { ...legacy, periods: [period(30, 29900)] },
      ],
    }),
  );
  expect(screen.getByText(ru.subscription.from)).toBeTruthy();
  expect(screen.getByText('299 ₽')).toBeTruthy();
  expect(screen.getByText('/ 30 дней')).toBeTruthy();

  selectTab('Другие тарифы');
  expect(screen.getByText('299 ₽')).toBeTruthy();
  expect(screen.queryByText('/ 30 дней')).toBeNull();
});
