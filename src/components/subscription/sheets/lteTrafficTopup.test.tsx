// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PurchaseOptions, Subscription } from '../../../types';
import { MemoryRouter } from 'react-router';
import { resetSafeStorage } from '../../../utils/safeStorage';
import { restoreLteTopupPackage } from '../lteTopupIntent';
import ru from '../../../locales/ru.json';
import { TrafficTopupSheet } from './TrafficTopupSheet';

const api = vi.hoisted(() => ({
  purchaseTraffic: vi.fn(),
  getTrafficPackages: vi.fn(),
  saveTrafficCart: vi.fn(),
}));
vi.mock('../../../api/subscription', () => ({ subscriptionApi: api }));
vi.mock('../../../store/auth', () => ({
  useAuthStore: (selector: (state: { user: { id: number } }) => unknown) =>
    selector({ user: { id: 41 } }),
}));
vi.mock('../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: String, currencySymbol: '₽' }),
}));

const i18n = createInstance();
await i18n.init({ lng: 'ru', resources: { ru: { translation: ru } }, initAsync: false });

function Topup({
  category = 'wifi_lte',
  balance,
}: {
  category?: Subscription['network_category'];
  balance?: number;
}) {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <TrafficTopupSheet
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      subscription={
        {
          id: 99,
          network_category: category,
          traffic_limit_gb: 10,
          traffic_used_gb: 5,
        } as Subscription
      }
      subscriptionId={99}
      selectedTrafficPackage={selected}
      onSelectedTrafficPackageChange={setSelected}
      purchaseOptions={
        balance == null ? undefined : ({ balance_kopeks: balance } as PurchaseOptions)
      }
      isDark
    />
  );
}

function showTopup(category?: Subscription['network_category'], balance?: number) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <Topup category={category} balance={balance} />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.purchaseTraffic.mockReset();
  api.saveTrafficCart.mockReset();
  sessionStorage.clear();
  resetSafeStorage();
  api.getTrafficPackages.mockResolvedValue([
    { gb: 7, price_kopeks: 12300, is_unlimited: false },
    { gb: 13, price_kopeks: 19800, is_unlimited: false },
  ]);
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('LTE top-up confirmation', () => {
  it('reuses the UUID after a failed request, then creates a new one for another purchase', async () => {
    api.purchaseTraffic.mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue({});
    showTopup();
    fireEvent.click(await screen.findByText('7 ГБ LTE'));
    fireEvent.click(screen.getByRole('button', { name: 'Купить 7 ГБ LTE' }));
    await waitFor(() => expect(api.purchaseTraffic).toHaveBeenCalledTimes(1));
    const firstId = api.purchaseTraffic.mock.calls[0][2];
    expect(firstId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Купить 7 ГБ LTE' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Купить 7 ГБ LTE' }));
    await waitFor(() => expect(api.purchaseTraffic).toHaveBeenCalledTimes(2));
    expect(api.purchaseTraffic.mock.calls[1]).toEqual([7, 99, firstId, 12300]);

    fireEvent.click(await screen.findByRole('button', { name: /Докупить LTE-трафик/ }));
    fireEvent.click(await screen.findByText('7 ГБ LTE'));
    fireEvent.click(screen.getByRole('button', { name: 'Купить 7 ГБ LTE' }));
    await waitFor(() => expect(api.purchaseTraffic).toHaveBeenCalledTimes(3));
    expect(api.purchaseTraffic.mock.calls[2][2]).not.toBe(firstId);
  });

  it('gives a different package its own request ID after a failed purchase', async () => {
    api.purchaseTraffic.mockRejectedValue(new Error('Connection lost'));
    showTopup();
    fireEvent.click(await screen.findByText('7 ГБ LTE'));
    fireEvent.click(screen.getByRole('button', { name: 'Купить 7 ГБ LTE' }));
    await waitFor(() => expect(api.purchaseTraffic).toHaveBeenCalledTimes(1));
    await screen.findByText('Connection lost');
    fireEvent.click(screen.getByText('13 ГБ LTE'));
    fireEvent.click(screen.getByRole('button', { name: 'Купить 13 ГБ LTE' }));
    await waitFor(() => expect(api.purchaseTraffic).toHaveBeenCalledTimes(2));
    expect(api.purchaseTraffic.mock.calls[1][0]).toBe(13);
    expect(api.purchaseTraffic.mock.calls[1][2]).not.toBe(api.purchaseTraffic.mock.calls[0][2]);
  });

  it('retains an unresolved request after closing and remounting, restoring the selected package', async () => {
    api.purchaseTraffic.mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue({});
    const first = showTopup();
    fireEvent.click(await screen.findByText('7 ГБ LTE'));
    fireEvent.click(screen.getByRole('button', { name: 'Купить 7 ГБ LTE' }));
    await screen.findByText('Connection lost');
    const requestId = api.purchaseTraffic.mock.calls[0][2];
    fireEvent.click(screen.getByRole('button', { name: ru.common.close }));
    first.unmount();
    resetSafeStorage();
    showTopup();
    fireEvent.click(await screen.findByRole('button', { name: 'Купить 7 ГБ LTE' }));
    await waitFor(() => expect(api.purchaseTraffic).toHaveBeenCalledTimes(2));
    expect(api.purchaseTraffic.mock.calls[1]).toEqual([7, 99, requestId, 12300]);
  });

  it('keeps LTE intent for a balance top-up and never creates a generic traffic cart', async () => {
    showTopup('wifi_lte', 0);
    fireEvent.click(await screen.findByText('7 ГБ LTE'));
    const stored = JSON.parse(sessionStorage.getItem('donbaton:lte-topup:41:99:7') || '{}');
    expect(stored.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(restoreLteTopupPackage(42, 99)).toBeNull();
    expect(restoreLteTopupPackage(41, 100)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: ru.balance.topUp }));
    await waitFor(() => expect(api.saveTrafficCart).not.toHaveBeenCalled());
    expect(api.purchaseTraffic).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('donbaton:lte-topup:41:99:7')).toContain(stored.requestId);
  });

  it('does not charge if the request ID cannot survive a page reload', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    showTopup();
    fireEvent.click(await screen.findByText('7 ГБ LTE'));
    expect(screen.getByRole('alert').textContent).toBe(
      ru.subscription.network.intentStorageUnavailable,
    );
    expect(
      (screen.getByRole('button', { name: 'Купить 7 ГБ LTE' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(api.purchaseTraffic).not.toHaveBeenCalled();
  });

  it('preserves legacy traffic wording and purchase semantics', async () => {
    api.purchaseTraffic.mockResolvedValue({});
    showTopup(null);
    expect(screen.queryByText('Докупить LTE-трафик')).toBeNull();
    fireEvent.click(await screen.findByText('7 ГБ'));
    fireEvent.click(
      screen.getByRole('button', {
        name: ru.subscription.additionalOptions.buyTrafficGb.replace('{{gb}}', '7'),
      }),
    );
    await waitFor(() =>
      expect(api.purchaseTraffic).toHaveBeenCalledExactlyOnceWith(7, 99, undefined, undefined),
    );
  });
});
