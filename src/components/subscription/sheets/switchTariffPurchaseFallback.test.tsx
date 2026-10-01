// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { AxiosError } from 'axios';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ru from '../../../locales/ru.json';
import type { Tariff } from '../../../types';
import { SwitchTariffSheet } from './SwitchTariffSheet';

/**
 * Страховка на предпросмотре смены тарифа. Сетевые тарифы покупаются
 * обычным флоу: бэкенд отвечает `network_purchase_only` + use_purchase_flow,
 * и панель обязана увести клиента в покупку, а не показать пустую карточку.
 * Отказ политики строкой (`detail: "текст"`) показывается текстом.
 */

const previewTariffSwitch = vi.fn();
vi.mock('../../../api/subscription', () => ({
  subscriptionApi: {
    previewTariffSwitch: (...args: unknown[]) => previewTariffSwitch(...args),
    switchTariff: vi.fn(),
  },
}));

const i18n = createInstance();
await i18n.init({ lng: 'ru', resources: { ru: { translation: ru } }, initAsync: false });

const target = { id: 10, name: 'Везде 120', network_category: 'wifi_lte' } as Tariff;

function refusal(detail: unknown) {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 400,
    data: { detail },
  } as never);
}

function sheet(onExpiredFallback = vi.fn(), onClose = vi.fn()) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <SwitchTariffSheet
            open
            tariffId={target.id}
            subscriptionId={undefined}
            tariffs={[target]}
            onClose={onClose}
            onExpiredFallback={onExpiredFallback}
          />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onExpiredFallback, onClose };
}

// jsdom не умеет scrollIntoView, а открытая панель зовёт его по таймеру через
// 100 мс: если тест живёт дольше (нагруженная машина), таймер падает
// необработанной ошибкой, и vitest завершается с кодом 1 при зелёных тестах.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

// Тело в скобках обязательно: mockReset() возвращает сам мок, а vitest
// принимает возвращённую из beforeEach функцию за teardown и вызывает её
// после теста — мок выстрелил бы ещё одним отказом уже вне теста.
beforeEach(() => {
  previewTariffSwitch.mockReset();
});
afterEach(cleanup);

describe('предпросмотр смены тарифа', () => {
  it('уводит в обычную покупку, когда бэкенд требует флоу покупки', async () => {
    previewTariffSwitch.mockRejectedValue(
      refusal({
        code: 'network_purchase_only',
        message: 'Это покупка нового тарифа на полный срок.',
        use_purchase_flow: true,
      }),
    );
    const { onExpiredFallback, onClose } = sheet();
    await waitFor(() => expect(onExpiredFallback).toHaveBeenCalledExactlyOnceWith(target));
    expect(onClose).toHaveBeenCalled();
  });

  it('показывает отказ политики текстом', async () => {
    previewTariffSwitch.mockRejectedValue(refusal('Прежние условия действуют до 07.10.2026.'));
    const { onExpiredFallback } = sheet();
    await waitFor(() =>
      expect(screen.getByText('Прежние условия действуют до 07.10.2026.')).toBeTruthy(),
    );
    expect(onExpiredFallback).not.toHaveBeenCalled();
  });
});
