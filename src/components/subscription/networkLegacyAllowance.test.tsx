// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../locales/en.json';
import ru from '../../locales/ru.json';
import type { Subscription } from '../../types';
import { uiLocale } from '../../utils/uiLocale';
import { NetworkTrafficSummary } from './NetworkTrafficSummary';

vi.mock('../../utils/formatTraffic', () => ({ formatTraffic: (gb: number) => `${gb} GiB` }));
vi.mock('../../utils/uiLocale', () => ({ uiLocale: vi.fn(() => 'ru-RU') }));

const gib = 1024 ** 3;
const carriedDeadline = '2026-10-20T12:00:00Z';
const originalPaidEnd = '2026-10-05T12:00:00Z';
const quota = {
  limit_bytes: 70 * gib,
  topup_bytes: 5 * gib,
  used_bytes: 15 * gib,
  remaining_bytes: 60 * gib,
  exhausted: false,
  accounting_state: 'ready' as const,
  period_mode: 'rolling_30_days_with_legacy_pool' as const,
  period_ends_at: '2026-11-04T12:00:00Z',
  legacy_compatibility_until: originalPaidEnd,
  legacy_pool_bytes: 10 * gib,
  legacy_pool_expires_at: carriedDeadline,
  has_carried_lte: true,
};

afterEach(cleanup);

async function mount(
  language: 'ru' | 'en',
  subscription: Pick<Subscription, 'network_category' | 'lte_quota'>,
) {
  const i18n = createInstance();
  await i18n.init({
    lng: language,
    resources: { ru: { translation: ru }, en: { translation: en } },
  });
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  vi.mocked(uiLocale).mockReturnValue(locale);
  render(
    <I18nextProvider i18n={i18n}>
      <NetworkTrafficSummary subscription={subscription} />
    </I18nextProvider>,
  );
  return {
    label: (key: string, options: Record<string, string> = {}) =>
      i18n.t(`subscription.network.${key}`, options),
    date: (value: string) => new Date(value).toLocaleDateString(locale),
  };
}

describe.each(['ru', 'en'] as const)('legacy LTE allowance display in %s', (language) => {
  it('separates new included traffic, carried capacity and new top-ups while retaining their total', async () => {
    const { label, date } = await mount(language, {
      network_category: 'wifi_lte',
      lte_quota: quota,
    });
    expect(screen.getByText(label('included', { traffic: '60 GiB' }))).toBeTruthy();
    expect(screen.queryByText(label('included', { traffic: '70 GiB' }))).toBeNull();
    expect(screen.getByText(label('carriedAllowance', { traffic: '10 GiB' }))).toBeTruthy();
    expect(
      screen.getByText(label('legacyPoolExpiry', { date: date(carriedDeadline) })),
    ).toBeTruthy();
    expect(screen.getByText(label('added', { traffic: '5 GiB' }))).toBeTruthy();
    expect(screen.getByText(label('remaining', { traffic: '60 GiB' }))).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('20');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe(
      label('used', { used: '15 GiB', total: '75 GiB' }),
    );
    expect(screen.queryByText(label('legacyUntil', { date: date(originalPaidEnd) }))).toBeNull();
  });

  it('shows paid LTE tails on Wi-Fi without promising zero included traffic or an allowance renewal', async () => {
    const { label, date } = await mount(language, {
      network_category: 'wifi',
      lte_quota: {
        ...quota,
        limit_bytes: 10 * gib,
        used_bytes: 5 * gib,
        remaining_bytes: 10 * gib,
        next_period_limit_bytes: 0,
      },
    });
    expect(screen.getByText('LTE')).toBeTruthy();
    expect(screen.getByText(label('remaining', { traffic: '10 GiB' }))).toBeTruthy();
    expect(screen.getByText(label('carriedAllowance', { traffic: '10 GiB' }))).toBeTruthy();
    expect(
      screen.getByText(label('legacyPoolExpiry', { date: date(carriedDeadline) })),
    ).toBeTruthy();
    expect(screen.queryByText(label('included', { traffic: '0 GiB' }))).toBeNull();
    expect(screen.queryByText(label('resetDate', { date: date(quota.period_ends_at) }))).toBeNull();
    expect(screen.queryByText(label('nextAllowance', { traffic: '0 GiB' }))).toBeNull();
    expect(screen.queryByText(label('legacyUntil', { date: date(originalPaidEnd) }))).toBeNull();
  });

  it('keeps the original paid-terms date only while the original calendar applies', async () => {
    const { label, date } = await mount(language, {
      network_category: 'wifi_lte',
      lte_quota: {
        ...quota,
        period_mode: 'legacy_calendar',
        legacy_pool_bytes: 0,
        legacy_pool_expires_at: null,
      },
    });
    expect(screen.getByText(label('legacyUntil', { date: date(originalPaidEnd) }))).toBeTruthy();
    expect(screen.getByText(label('carriedAllowance', { traffic: '70 GiB' }))).toBeTruthy();
    expect(screen.queryByText(label('included', { traffic: '70 GiB' }))).toBeNull();
    expect(
      screen.queryByText(label('legacyPoolExpiry', { date: date(carriedDeadline) })),
    ).toBeNull();
  });

  it('does not fabricate a carried deadline when only the remaining capacity is known', async () => {
    const { label } = await mount(language, {
      network_category: 'wifi',
      lte_quota: { ...quota, limit_bytes: 10 * gib, legacy_pool_expires_at: null },
    });
    expect(screen.getByText(label('carriedAllowance', { traffic: '10 GiB' }))).toBeTruthy();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
    const prefix = label('legacyPoolExpiry', { date: '' }).trim();
    expect(screen.queryByText((text) => text.startsWith(prefix))).toBeNull();
  });
});
