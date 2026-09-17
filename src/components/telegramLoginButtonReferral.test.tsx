// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Инцидент 16.09.2026: гость приходит по ссылке кабинета `/login?ref=<code>`,
 * жмёт «Войти через Telegram», виджет Telegram в РФ не грузится, кабинет падает
 * в deep-link — и код приглашения остаётся в localStorage браузера. В боте
 * гость регистрируется заново, уже без реферера: реферер не получает ничего.
 *
 * Ожидание: `?ref=` уезжает вместе с запросом токена deep-link'а, чтобы бот мог
 * привязать приглашение при регистрации. `campaign_slug` так ездил и раньше.
 */

const { requestDeepLinkToken, loginWithDeepLink, navigate, translation } = vi.hoisted(() => ({
  requestDeepLinkToken: vi.fn(),
  loginWithDeepLink: vi.fn(),
  navigate: vi.fn(),
  translation: {
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'ru', changeLanguage: () => Promise.resolve() },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => translation,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigate,
}));

vi.mock('../store/auth', () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      loginWithTelegramOIDC: vi.fn(),
      loginWithTelegramWidget: vi.fn(),
      loginWithDeepLink,
    }),
}));

vi.mock('../api/branding', () => ({
  brandingApi: {
    // Виджет выключен ⇒ компонент сразу показывает deep-link-ветку.
    getTelegramWidgetConfig: () =>
      Promise.resolve({
        bot_username: 'donbatonvpn_bot',
        oidc_enabled: false,
        oidc_client_id: '',
        request_access: false,
        size: 'large',
        radius: 20,
        userpic: true,
      }),
  },
}));

vi.mock('../api/auth', () => ({ authApi: { requestDeepLinkToken } }));

async function renderButton(referralCode?: string) {
  const { default: TelegramLoginButton } = await import('./TelegramLoginButton');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TelegramLoginButton referralCode={referralCode} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // Пользователь выбирает вход через бота — это и есть deep-link-ветка,
  // в которую кабинет в РФ попадает всегда (виджет Telegram не грузится).
  const optIn = await screen.findByText('auth.loginWithBot');
  fireEvent.click(optIn);
  return view;
}

describe('TelegramLoginButton: реферальный код в deep-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try {
      localStorage.clear();
    } catch {}
    requestDeepLinkToken.mockResolvedValue({
      token: 'tok-1234567890123456',
      bot_username: 'donbatonvpn_bot',
      expires_in: 300,
    });
    // Пусть poll вечно «ждёт подтверждения» — нас интересует только запрос токена.
    loginWithDeepLink.mockImplementation(() => new Promise(() => {}));
  });

  afterEach(() => {
    cleanup();
  });

  it('передаёт код приглашения в запрос токена', async () => {
    await renderButton('ref_uI7GP6KNW8');

    await waitFor(() => expect(requestDeepLinkToken).toHaveBeenCalled());
    expect(requestDeepLinkToken).toHaveBeenCalledWith('ref_uI7GP6KNW8', null);
  });

  it('берёт код из localStorage, если проп не передали', async () => {
    try {
      localStorage.setItem('referral_code', 'refkwqSIlpZ');
      localStorage.setItem('referral_code_ttl', String(Date.now() + 60_000));
    } catch {}

    await renderButton();

    await waitFor(() => expect(requestDeepLinkToken).toHaveBeenCalled());
    expect(requestDeepLinkToken).toHaveBeenCalledWith('refkwqSIlpZ', null);
  });

  it('без кода ничего лишнего не шлёт', async () => {
    await renderButton();

    await waitFor(() => expect(requestDeepLinkToken).toHaveBeenCalled());
    expect(requestDeepLinkToken).toHaveBeenCalledWith(null, null);
  });
});
