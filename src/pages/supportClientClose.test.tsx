// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TicketDetail } from '../types';
import Support from './Support';

const api = vi.hoisted(() => ({ close: vi.fn(), get: vi.fn(), confirm: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../api/info', () => ({
  infoApi: { getSupportConfig: async () => ({ tickets_enabled: true }) },
}));
vi.mock('@/platform', () => ({
  usePlatform: () => ({
    haptic: { impact: vi.fn() },
    openLink: vi.fn(),
    openTelegramLink: vi.fn(),
    dialog: { confirm: api.confirm },
  }),
}));
vi.mock('../api/tickets', () => ({
  ticketsApi: {
    getTickets: async () => ({ items: [ticket] }),
    getTicket: api.get,
    closeTicket: api.close,
  },
}));

let ticket: TicketDetail;
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  ticket = {
    id: 1,
    title: 'Проверка закрытия',
    status: 'open',
    priority: 'normal',
    created_at: '2026-11-08T12:00:00Z',
    updated_at: '2026-11-08T12:00:00Z',
    closed_at: null,
    can_close: true,
    is_reply_blocked: false,
    messages: [],
  };
  api.get.mockImplementation(async () => ticket);
  api.confirm.mockResolvedValue(true);
  api.close.mockImplementation(async () => {
    ticket = { ...ticket, status: 'closed', can_close: false, closed_at: ticket.updated_at };
    return ticket;
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});

async function openTicket() {
  const view = render(
    <QueryClientProvider client={client}>
      <Support />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /Проверка закрытия/ }));
  await waitFor(() => expect(api.get).toHaveBeenCalledWith(1));
  await waitFor(() => expect(client.getQueryData(['ticket', 1])).toEqual(ticket));
  return view;
}

it.each(['open', 'answered'])(
  'confirms and closes an %s ticket, then hides replies',
  async (status) => {
    ticket.status = status;
    await openTicket();
    await screen.findByPlaceholderText('support.replyPlaceholder');
    fireEvent.click(await screen.findByRole('button', { name: 'support.closeTicket' }));
    await waitFor(() => expect(api.close).toHaveBeenCalledExactlyOnceWith(1));
    expect(api.confirm).toHaveBeenCalledExactlyOnceWith('support.closeConfirm');
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('support.replyPlaceholder')).toBeNull(),
    );
    expect(screen.queryByRole('button', { name: 'support.closeTicket' })).toBeNull();
    expect(client.getQueryData<TicketDetail>(['ticket', 1])?.status).toBe('closed');
    expect(await screen.findAllByText('support.status.closed')).toHaveLength(2);
  },
);

it.each([
  { status: 'open', can_close: false },
  { status: 'closed', can_close: true },
  { status: 'pending', can_close: true },
])('does not offer closing when unavailable: %j', async (values) => {
  Object.assign(ticket, values);
  await openTicket();
  expect(screen.queryByRole('button', { name: 'support.closeTicket' })).toBeNull();
  expect(api.close).not.toHaveBeenCalled();
});

it('cancels without sending a close request', async () => {
  api.confirm.mockResolvedValue(false);
  await openTicket();
  fireEvent.click(await screen.findByRole('button', { name: 'support.closeTicket' }));
  await waitFor(() => expect(api.confirm).toHaveBeenCalledOnce());
  expect(api.close).not.toHaveBeenCalled();
  expect(screen.getByPlaceholderText('support.replyPlaceholder')).toBeTruthy();
});

it('shows a close error even when replies are blocked, and allows retry', async () => {
  ticket.is_reply_blocked = true;
  api.close.mockRejectedValueOnce(new Error('offline'));
  await openTicket();
  fireEvent.click(await screen.findByRole('button', { name: 'support.closeTicket' }));
  expect((await screen.findByRole('alert')).textContent).toBe('support.errors.closeFailed');
  expect(client.getQueryData<TicketDetail>(['ticket', 1])?.status).toBe('open');
  fireEvent.click(screen.getByRole('button', { name: 'support.closeTicket' }));
  await waitFor(() =>
    expect(client.getQueryData<TicketDetail>(['ticket', 1])?.status).toBe('closed'),
  );
  expect(screen.queryByRole('alert')).toBeNull();
});

it('prevents duplicate clicks while confirmation and closing are pending', async () => {
  let confirm!: (value: boolean) => void;
  let finish!: (value: TicketDetail) => void;
  api.confirm.mockReturnValue(
    new Promise<boolean>((resolve) => {
      confirm = resolve;
    }),
  );
  api.close.mockReturnValue(
    new Promise<TicketDetail>((resolve) => {
      finish = resolve;
    }),
  );
  await openTicket();
  fireEvent.change(screen.getByPlaceholderText('support.replyPlaceholder'), {
    target: { value: 'Ответ' },
  });
  const button = await screen.findByRole('button', { name: 'support.closeTicket' });
  fireEvent.click(button);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  expect(api.confirm).toHaveBeenCalledOnce();
  await act(async () => confirm(true));
  await waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect((document.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish({ ...ticket, status: 'closed', can_close: false }));
  await waitFor(() => expect(screen.queryByPlaceholderText('support.replyPlaceholder')).toBeNull());
});

it('ignores a stale detail response arriving after a successful close', async () => {
  await openTicket();
  const oldTicket = { ...ticket };
  let stale!: (value: TicketDetail) => void;
  api.get.mockReturnValueOnce(
    new Promise<TicketDetail>((resolve) => {
      stale = resolve;
    }),
  );
  void client.refetchQueries({ queryKey: ['ticket', 1] });
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  fireEvent.click(await screen.findByRole('button', { name: 'support.closeTicket' }));
  await waitFor(() =>
    expect(client.getQueryData<TicketDetail>(['ticket', 1])?.status).toBe('closed'),
  );
  await act(async () => stale(oldTicket));
  expect(client.getQueryData<TicketDetail>(['ticket', 1])?.status).toBe('closed');
  expect(screen.queryByPlaceholderText('support.replyPlaceholder')).toBeNull();
});
