import { render, screen } from '@testing-library/react';
import ruLocale from '@/locales/ru.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { PlatformProvider } from '@/platform/PlatformProvider';

/**
 * Обвязка для тестов экрана продления.
 *
 * Отдельным файлом, а не внутри теста: vi.mock поднимается выше импортов, и моки
 * i18n и API из теста обязаны примениться раньше, чем сюда подтянется страница.
 */

export async function renderRenew() {
  const Renew = (await import('@/pages/RenewSubscription')).default;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PlatformProvider>
        <MemoryRouter initialEntries={['/subscriptions/42/renew']}>
          <Routes>
            <Route path="/subscriptions/:subscriptionId/renew" element={<Renew />} />
          </Routes>
        </MemoryRouter>
      </PlatformProvider>
    </QueryClientProvider>,
  );
}

/**
 * Подпись срока так, как её рисует экран продления: готовая строка из
 * `landing.periodLabels.d<дни>`, иначе месяцы/дни — см. utils/periodLabel.
 */
export function periodLabel(days: number): string {
  const labels = (ruLocale as { landing: { periodLabels: Record<string, string> } }).landing
    .periodLabels;
  const exact = labels[`d${days}`];
  if (exact) return exact;
  const months = Math.floor(days / 30);
  const template = months > 0 && days % 30 === 0 ? labels.nMonths : labels.nDays;
  return template.replace('{{count}}', String(months > 0 && days % 30 === 0 ? months : days));
}

/** Карточка периода — кнопка вокруг подписи срока. */
export function cardFor(days: number): HTMLElement {
  const label = screen.getByText(periodLabel(days));
  const card = label.closest('button');
  if (!card) throw new Error(`не нашёл карточку периода ${days}`);
  return card;
}
