// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ru from '../locales/ru.json';
import AdminTariffCreate from './AdminTariffCreate';

const api = vi.hoisted(() => ({
  getTariff: vi.fn(),
  createTariff: vi.fn(),
  updateTariff: vi.fn(),
  getAvailableServers: vi.fn(),
  getAvailableExternalSquads: vi.fn(),
  getAvailablePromoGroups: vi.fn(),
}));
vi.mock('../api/tariffs', () => ({ tariffsApi: api }));
vi.mock('../components/admin', () => ({ AdminBackButton: () => null }));

const i18n = createInstance();
await i18n.init({ lng: 'ru', resources: { ru: { translation: ru } }, initAsync: false });

beforeEach(() => {
  api.createTariff.mockReset().mockResolvedValue({});
  api.updateTariff.mockReset().mockResolvedValue({});
  api.getTariff.mockReset();
  api.getAvailableServers.mockResolvedValue([]);
  api.getAvailableExternalSquads.mockResolvedValue([]);
  api.getAvailablePromoGroups.mockResolvedValue([]);
});
afterEach(cleanup);

function showForm(edit = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[edit ? '/admin/tariffs/8/edit' : '/admin/tariffs/create']}>
          <Routes>
            <Route path="/admin/tariffs/create" element={<AdminTariffCreate />} />
            <Route path="/admin/tariffs/:id/edit" element={<AdminTariffCreate />} />
            <Route path="/admin/tariffs" element={<p>Saved</p>} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

function choosePeriodTariff() {
  fireEvent.click(screen.getByText(ru.admin.tariffs.periodTariff));
  fireEvent.change(screen.getByLabelText(ru.admin.tariffs.nameLabel, { exact: false }), {
    target: { value: 'Тариф для проверки' },
  });
}

function addPeriod() {
  fireEvent.click(screen.getByRole('button', { name: ru.admin.tariffs.tabPeriods }));
  fireEvent.change(screen.getByPlaceholderText('300'), { target: { value: '417' } });
  fireEvent.click(screen.getByRole('button', { name: ru.admin.tariffs.addButton }));
}

describe('operator configures network tariffs', () => {
  it('requires an explicit LTE allowance and sends the separate quota with unlimited Wi-Fi', async () => {
    showForm();
    choosePeriodTariff();
    fireEvent.change(screen.getByLabelText(ru.admin.tariffs.networkCategory), {
      target: { value: 'wifi_lte' },
    });
    expect(
      (screen.getByLabelText(ru.admin.tariffs.trafficLimitLabel) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: ru.admin.tariffs.saveButton }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText(ru.admin.tariffs.lteIncludedGb), {
      target: { value: '17' },
    });
    addPeriod();
    fireEvent.click(screen.getByRole('button', { name: ru.admin.tariffs.saveButton }));
    await waitFor(() => expect(api.createTariff).toHaveBeenCalledTimes(1));
    expect(api.createTariff.mock.calls[0][0]).toMatchObject({
      network_category: 'wifi_lte',
      traffic_limit_gb: 0,
      lte_traffic_limit_gb: 17,
      lte_period_days: 30,
      period_prices: [{ days: 30, price_kopeks: 41700 }],
      is_daily: false,
      custom_days_enabled: false,
      custom_traffic_enabled: false,
      traffic_reset_mode: 'NO_RESET',
    });
  });

  it('does not offer traffic top-ups or global resets for Wi-Fi-only plans', async () => {
    showForm();
    choosePeriodTariff();
    fireEvent.change(screen.getByLabelText(ru.admin.tariffs.networkCategory), {
      target: { value: 'wifi' },
    });
    fireEvent.click(screen.getByRole('button', { name: ru.admin.tariffs.tabExtra }));
    expect(screen.queryByRole('switch', { name: ru.admin.tariffs.extraTrafficTitle })).toBeNull();
    expect(screen.queryByText(ru.admin.tariffs.trafficResetModeTitle)).toBeNull();
    addPeriod();
    fireEvent.click(screen.getByRole('button', { name: ru.admin.tariffs.saveButton }));
    await waitFor(() => expect(api.createTariff).toHaveBeenCalledTimes(1));
    expect(api.createTariff.mock.calls[0][0]).toMatchObject({
      network_category: 'wifi',
      traffic_limit_gb: 0,
      lte_traffic_limit_gb: null,
      lte_period_days: null,
      traffic_topup_enabled: false,
    });
  });

  it('keeps the category fixed for a tariff that has subscriptions and surfaces backend rejection', async () => {
    api.getTariff.mockResolvedValue({
      id: 8,
      name: 'Существующий',
      is_daily: false,
      network_category: 'wifi_lte',
      lte_traffic_limit_gb: 23,
      lte_period_days: 30,
      traffic_limit_gb: 0,
      subscriptions_count: 2,
      period_prices: [{ days: 30, price_kopeks: 50000 }],
    });
    api.updateTariff.mockRejectedValue(new Error('LTE configuration is unavailable'));
    showForm(true);
    const category = await screen.findByLabelText(ru.admin.tariffs.networkCategory);
    expect((category as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText(ru.admin.tariffs.lteIncludedGb) as HTMLInputElement).value).toBe(
      '23',
    );
    fireEvent.click(screen.getByRole('button', { name: ru.admin.tariffs.saveButton }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('LTE configuration is unavailable'),
    );
  });
});
