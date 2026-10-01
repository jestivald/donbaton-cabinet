// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformProvider } from '@/platform/PlatformProvider';
import { ToastProvider } from '@/components/Toast';
import ruLocale from '@/locales/ru.json';
import type { Subscription } from '@/types';
import { RecurringPanels } from './RecurringPanels';

/**
 * ДонБатон: внешней автооплаты у тарифов Wi-Fi / Wi-Fi + LTE нет (бот:
 * «Для тарифов Wi-Fi/LTE внешняя автооплата пока недоступна»). У сетевой
 * подписки кабинет не спрашивает состояние ни одного рекуррента — СБП, Lava
 * и пришедшего в 1.80.0 Cashera — и не рисует их блоки, даже если бот
 * включил фичу для остальных.
 */

function ru(key: string): string {
  const value = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], ruLocale);
  if (typeof value !== 'string') throw new Error(`нет строки ${key}`);
  return value;
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const opts = typeof fallback === 'object' && fallback !== null ? fallback : options;
      let template: string;
      try {
        template = ru(key);
      } catch {
        template = typeof fallback === 'string' ? fallback : key;
      }
      return template.replace(/{{(\w+)}}/g, (_m, name) => String((opts as never)?.[name] ?? ''));
    },
    i18n: { language: 'ru', changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: unknown }) => children ?? null,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const calls = { sbp: [] as number[], lava: [] as number[], cashera: [] as number[] };

vi.mock('@/api/subscription', () => ({
  subscriptionApi: {
    getPurchaseOptions: () =>
      Promise.resolve({
        sales_mode: 'tariffs',
        tariffs: [],
        balance_kopeks: 0,
        platega_recurrent_enabled: true,
        lava_recurrent_enabled: true,
        cashera_recurrent_enabled: true,
      }),
    getSbpRecurring: (id: number) => {
      calls.sbp.push(id);
      return Promise.resolve({ status: 'none' });
    },
    getLavaRecurring: (id: number) => {
      calls.lava.push(id);
      return Promise.resolve({ status: 'none' });
    },
    getCasheraRecurring: (id: number) => {
      calls.cashera.push(id);
      return Promise.resolve({ status: 'none' });
    },
  },
}));

vi.mock('@/api/currency', () => ({
  currencyApi: { getExchangeRates: () => Promise.resolve({ USD: 100, CNY: 14, IRR: 0.0024 }) },
}));

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  calls.sbp = [];
  calls.lava = [];
  calls.cashera = [];
});

afterEach(cleanup);

const subscription = (overrides: Partial<Subscription> = {}): Subscription =>
  ({
    id: 1,
    status: 'active',
    is_trial: false,
    is_active: true,
    is_expired: false,
    tariff_id: 9,
    tariff_name: 'Везде',
    end_date: '2026-11-01T00:00:00Z',
    days_left: 30,
    traffic_limit_gb: 0,
    traffic_used_gb: 0,
    device_limit: 3,
    servers: [],
    connected_squads: [],
    autopay_enabled: false,
    ...overrides,
  }) as Subscription;

function renderPanels(sub: Subscription) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PlatformProvider>
        <ToastProvider>
          <MemoryRouter>
            <RecurringPanels subscription={sub} subscriptionId={sub.id} />
          </MemoryRouter>
        </ToastProvider>
      </PlatformProvider>
    </QueryClientProvider>,
  );
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('рекурренты у сетевой подписки', () => {
  it.each(['wifi', 'wifi_lte'] as const)(
    '%s: ни запроса состояния, ни блока СБП, Lava и Cashera',
    async (category) => {
      renderPanels(subscription({ network_category: category }));
      await settle();

      expect(calls).toEqual({ sbp: [], lava: [], cashera: [] });
      expect(screen.queryByText(ru('subscription.casheraRecurring.title'))).toBeNull();
      expect(screen.queryByText(ru('subscription.casheraRecurring.autopayHint'))).toBeNull();
    },
  );

  it('у обычной подписки при включённой фиче — запрос и блок Cashera на месте', async () => {
    renderPanels(subscription({ network_category: null, tariff_name: 'Базовый' }));

    expect(await screen.findByText(ru('subscription.casheraRecurring.title'))).toBeTruthy();
    expect(calls).toEqual({ sbp: [1], lava: [1], cashera: [1] });
  });
});
