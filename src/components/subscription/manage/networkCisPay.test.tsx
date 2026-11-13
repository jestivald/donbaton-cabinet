// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkCategory, Subscription, Tariff } from '@/types';
import { TariffPurchaseForm } from '../purchase/TariffPurchaseForm';
import { RecurringPanels } from './RecurringPanels';

const api = vi.hoisted(() => ({
  getPurchaseOptions: vi.fn(),
  getSbpRecurring: vi.fn(),
  getLavaRecurring: vi.fn(),
  getCasheraRecurring: vi.fn(),
  getCisPayRecurring: vi.fn(),
  quoteCisPayRecurring: vi.fn(),
  purchaseCisPayRecurring: vi.fn(),
  previewTariffPurchase: vi.fn(),
  previewRecurrentPurchase: vi.fn(),
}));
vi.mock('@/api/subscription', () => ({ subscriptionApi: api }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ isDark: true }) }));
vi.mock('@/hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: String, currencySymbol: '₽' }),
}));
vi.mock('@/hooks/usePromoDiscount', () => ({
  usePromoDiscount: () => ({
    applyPromoDiscount: (price: number, original?: number) => ({ price, original }),
  }),
}));
vi.mock('@/platform', () => ({
  usePlatform: () => ({ platform: 'browser', openLink: vi.fn() }),
}));
vi.mock('@/platform/hooks/useNativeDialog', () => ({ useDestructiveConfirm: () => vi.fn() }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const tariff = (category: NetworkCategory | null): Tariff => ({
  id: 9,
  name: 'Тариф',
  description: null,
  tier_level: 1,
  network_category: category,
  is_available: true,
  is_current: false,
  device_limit: 3,
  extra_devices_count: 0,
  traffic_limit_gb: 100,
  traffic_limit_label: '100 ГБ',
  is_unlimited_traffic: false,
  servers: [],
  servers_count: 0,
  purchase_device_selection_supported: true,
  periods: [
    {
      days: 30,
      months: 1,
      label: '30 дней',
      price_kopeks: 30000,
      price_label: '300 ₽',
      price_per_month_kopeks: 30000,
      price_per_month_label: '300 ₽',
    },
  ],
});

function mount(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  api.getPurchaseOptions.mockResolvedValue({
    sales_mode: 'tariffs',
    tariffs: [tariff(null)],
    cispay_recurrent_enabled: true,
    platega_recurrent_enabled: true,
    lava_recurrent_enabled: true,
    cashera_recurrent_enabled: true,
  });
  for (const method of [
    api.getSbpRecurring,
    api.getLavaRecurring,
    api.getCasheraRecurring,
    api.getCisPayRecurring,
  ]) {
    method.mockResolvedValue({ status: 'none' });
  }
  api.previewTariffPurchase.mockResolvedValue({
    total_kopeks: 30000,
    expires_at: new Date(Date.now() + 300000).toISOString(),
    device_selection: {
      selectable: true,
      effective_limit: 3,
      included_limit: 1,
      min_limit: 1,
      max_limit: 5,
    },
  });
  api.previewRecurrentPurchase.mockResolvedValue({
    amount_kopeks: 30000,
    charge_days: 30,
    selected_device_limit: 3,
    quote_id: 'provider-quote',
    expires_at: new Date(Date.now() + 300000).toISOString(),
  });
  api.quoteCisPayRecurring.mockResolvedValue({
    quote_id: 'cispay-quote',
    amount_kopeks: 30000,
    period_days: 30,
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function panels(category: NetworkCategory | null) {
  const subscription = {
    id: 42,
    tariff_id: 9,
    status: 'active',
    is_trial: false,
    network_category: category,
  } as Subscription;
  return mount(<RecurringPanels subscription={subscription} subscriptionId={42} />);
}

function purchase(category: NetworkCategory | null) {
  return mount(
    <TariffPurchaseForm
      tariff={tariff(category)}
      subscriptionId={42}
      balanceKopeks={50000}
      onBack={() => {}}
      sbpPurchaseEnabled
      lavaPurchaseEnabled
      casheraPurchaseEnabled
      cispayPurchaseEnabled
    />,
  );
}

describe('CisPay follows the network tariff policy', () => {
  it.each(['wifi', 'wifi_lte'] as const)(
    '%s: does not mount or query the recurring panel even with setup enabled',
    async (category) => {
      const client = panels(category);
      await waitFor(() =>
        expect(client.getQueryState(['purchase-options', 42])?.status).toBe('success'),
      );
      expect(api.getCisPayRecurring).not.toHaveBeenCalled();
      expect(client.getQueryCache().findAll({ queryKey: ['cispay-recurring'] })).toHaveLength(0);
      expect(screen.queryByText('subscription.cispayRecurring.title')).toBeNull();
      expect(screen.queryByText('subscription.cispayRecurring.period')).toBeNull();
      expect(screen.queryByText('subscription.cispayRecurring.choose')).toBeNull();
      expect(api.getSbpRecurring).not.toHaveBeenCalled();
      expect(api.getLavaRecurring).not.toHaveBeenCalled();
      expect(api.getCasheraRecurring).not.toHaveBeenCalled();
    },
  );

  it('keeps status requests and setup available for an ordinary subscription', async () => {
    panels(null);
    // 1.82.1: подключение CisPay — прямо в панели (выбор периода + кнопка), без ссылки на покупку.
    expect(await screen.findByText('subscription.cispayRecurring.period')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'subscription.cispayRecurring.choose' }),
    ).toBeTruthy();
    expect(api.getCisPayRecurring).toHaveBeenCalledWith(42, undefined);
  });

  it.each(['wifi', 'wifi_lte'] as const)(
    '%s: purchase keeps the device quote but offers no external autopay or recurring quotes',
    async (category) => {
      const client = purchase(category);
      await screen.findByRole('combobox');
      await waitFor(() => expect(client.isFetching()).toBe(0));
      expect(api.previewTariffPurchase).toHaveBeenCalledWith(
        expect.objectContaining({ tariff_id: 9, subscription_id: 42 }),
      );
      expect(api.previewRecurrentPurchase).not.toHaveBeenCalled();
      expect(api.quoteCisPayRecurring).not.toHaveBeenCalled();
      expect(api.purchaseCisPayRecurring).not.toHaveBeenCalled();
      expect(screen.queryByText('subscription.cispayRecurring.choose')).toBeNull();
      for (const provider of ['sbp', 'lava', 'cashera']) {
        expect(screen.queryByText(`subscription.${provider}Recurring.purchaseButton`)).toBeNull();
      }
    },
  );

  it('keeps CisPay purchase and consent quotes available for an ordinary tariff', async () => {
    const client = purchase(null);
    await screen.findByRole('combobox');
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const button = screen.getByRole('button', { name: 'subscription.cispayRecurring.choose' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() =>
      expect(api.quoteCisPayRecurring).toHaveBeenCalledWith({
        tariff_id: 9,
        subscription_id: 42,
        period_days: 30,
        device_limit: 3,
      }),
    );
    expect(api.purchaseCisPayRecurring).not.toHaveBeenCalled();
    expect(api.previewRecurrentPurchase).toHaveBeenCalled();
  });
});
