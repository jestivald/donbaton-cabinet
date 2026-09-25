// @vitest-environment jsdom
//
// ДонБатон поверх апстрима 1.78–1.79: «старая» подписка (платная, без тарифа —
// бот присылает requires_tariff_selection) и сетевые категории форка.
// Закрепляет решения слияния v1.79.0: замок политики форка важнее апстримного
// «Перейти на тариф», сетевой переход по-прежнему идёт обычной покупкой, а блок
// «Дополнительно» держит политику форка и апстримный отказ старой подписке.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import ru from '../../locales/ru.json';
import type { LteQuota, Subscription, Tariff } from '../../types';
import { TariffPickerGrid, type TariffPickerGridProps } from './purchase/TariffPickerGrid';
import { showsNetworkAddonOptions } from './networkCategory';

vi.mock('../../hooks/useTheme', () => ({ useTheme: () => ({ isDark: true }) }));
vi.mock('../../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: (n: number) => String(n), currencySymbol: '₽' }),
}));
vi.mock('../../hooks/usePromoDiscount', () => ({
  usePromoDiscount: () => ({
    applyPromoDiscount: (price: number, original?: number) => ({ price, original }),
  }),
}));
vi.mock('../../utils/uiLocale', () => ({ uiLocale: () => 'ru-RU' }));

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
const archived = tariff({ id: 3, name: 'Архив LTE' });

function catalog(props: Partial<TariffPickerGridProps> = {}) {
  return (
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <TariffPickerGrid
          tariffs={[wifi, lte, archived]}
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

describe('legacy subscription (requires_tariff_selection) in the network catalog', () => {
  it('keeps network plans locked for a live archived subscription instead of «move to tariff»', () => {
    const onSelectTariff = vi.fn();
    const onSwitchTariff = vi.fn();
    render(
      catalog({
        subscription: {
          is_active: true,
          is_trial: false,
          requires_tariff_selection: true,
        } as Subscription,
        onSelectTariff,
        onSwitchTariff,
      }),
    );

    // Сетевые тарифы: замок форка (архив ↔ сеть не смешиваются, пока подписка жива).
    const locked = screen.getByRole('button', { name: ru.subscription.network.afterExpiry });
    expect((locked as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: ru.subscription.cta.moveToTariff })).toBeNull();

    // Архивная группа: апстримный переход на тариф ведёт в обычный выбор тарифа.
    selectTab('Другие тарифы');
    fireEvent.click(screen.getByRole('button', { name: ru.subscription.cta.moveToTariff }));
    expect(onSelectTariff).toHaveBeenCalledExactlyOnceWith(archived);
    expect(onSwitchTariff).not.toHaveBeenCalled();
  });

  it('sells another network plan to a legacy network subscription as a regular purchase', () => {
    const onSelectTariff = vi.fn();
    const onSwitchTariff = vi.fn();
    render(
      catalog({
        subscription: {
          is_active: true,
          is_trial: false,
          network_category: 'wifi',
          requires_tariff_selection: true,
        } as Subscription,
        onSelectTariff,
        onSwitchTariff,
      }),
    );

    selectTab('Wi-Fi + LTE');
    fireEvent.click(screen.getByRole('button', { name: ru.subscription.switchTariff.switch }));
    expect(onSelectTariff).toHaveBeenCalledExactlyOnceWith(lte);
    expect(onSwitchTariff).not.toHaveBeenCalled();
  });
});

describe('showsNetworkAddonOptions', () => {
  const quota = (overrides: Partial<LteQuota> = {}) =>
    ({ is_unlimited: false, ...overrides }) as LteQuota;
  const sub = (overrides: Partial<Subscription>) =>
    ({
      is_active: true,
      is_limited: false,
      is_trial: false,
      device_limit: 3,
      traffic_limit_gb: 0,
      network_category: null,
      lte_quota: null,
      ...overrides,
    }) as Subscription;

  it('offers LTE packages but never devices to network subscriptions', () => {
    expect(showsNetworkAddonOptions(sub({ network_category: 'wifi' }))).toBe(false);
    expect(
      showsNetworkAddonOptions(sub({ network_category: 'wifi_lte', lte_quota: quota() })),
    ).toBe(true);
    expect(
      showsNetworkAddonOptions(
        sub({ network_category: 'wifi_lte', lte_quota: quota({ is_unlimited: true }) }),
      ),
    ).toBe(false);
  });

  it('keeps classic add-ons: devices, or traffic even with unlimited devices', () => {
    expect(showsNetworkAddonOptions(sub({}))).toBe(true);
    expect(showsNetworkAddonOptions(sub({ device_limit: 0 }))).toBe(false);
    expect(showsNetworkAddonOptions(sub({ device_limit: 0, traffic_limit_gb: 100 }))).toBe(true);
  });

  it('hides add-ons from legacy, trial and inactive subscriptions', () => {
    expect(
      showsNetworkAddonOptions(
        sub({ network_category: 'wifi_lte', lte_quota: quota(), requires_tariff_selection: true }),
      ),
    ).toBe(false);
    expect(showsNetworkAddonOptions(sub({ requires_tariff_selection: true }))).toBe(false);
    expect(showsNetworkAddonOptions(sub({ is_trial: true }))).toBe(false);
    expect(showsNetworkAddonOptions(sub({ is_active: false }))).toBe(false);
    expect(showsNetworkAddonOptions(sub({ is_active: false, is_limited: true }))).toBe(true);
  });
});
