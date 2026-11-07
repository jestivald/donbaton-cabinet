// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TicketDetail, TicketMessage } from '../types';
import { ticketsApi } from '../api/tickets';
import { invalidateTicketQueries } from '../utils/ticketUpdates';
import { useSupportTicket } from './useSupportTicket';

vi.mock('../api/tickets', () => ({ ticketsApi: { getTicket: vi.fn() } }));

const now = Date.parse('2026-11-07T12:00:00Z');
const message: TicketMessage = {
  id: 1,
  message_text: 'Помогите',
  is_from_admin: false,
  has_media: false,
  media_type: null,
  media_file_id: null,
  media_caption: null,
  created_at: new Date(now).toISOString(),
};
const ticket: TicketDetail = {
  id: 42,
  title: 'Поддержка',
  status: 'open',
  priority: 'normal',
  created_at: message.created_at,
  updated_at: message.created_at,
  closed_at: null,
  is_reply_blocked: false,
  messages: [message],
};

let client: QueryClient;
let visibility: DocumentVisibilityState;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  focusManager.setFocused(undefined);
  vi.mocked(ticketsApi.getTicket).mockReset().mockResolvedValue(ticket);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

async function renderTicket(id: number | undefined = 42) {
  const initialProps: { ticketId: number | undefined } = { ticketId: id };
  const hook = renderHook(
    ({ ticketId }: { ticketId: number | undefined }) => useSupportTicket(ticketId),
    {
      initialProps,
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  await advance(1);
  return hook;
}

async function setVisibility(value: DocumentVisibilityState) {
  visibility = value;
  await act(async () => {
    window.dispatchEvent(new Event('visibilitychange'));
  });
  await advance(1);
}

describe('страховочное обновление открытого тикета', () => {
  it('запрашивает ответ каждые 10 с и заканчивает в пределах 3 минут', async () => {
    await renderTicket();
    expect(ticketsApi.getTicket).toHaveBeenCalledTimes(1);
    await advance(9_998);
    expect(ticketsApi.getTicket).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(ticketsApi.getTicket).toHaveBeenCalledTimes(2);
    await advance(170_000);
    const calls = vi.mocked(ticketsApi.getTicket).mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(18);
    expect(calls).toBeLessThanOrEqual(19);
    await advance(300_000);
    expect(ticketsApi.getTicket).toHaveBeenCalledTimes(calls);
  });

  it('не отправляет фоновые запросы и обновляется сразу при возвращении', async () => {
    await renderTicket();
    await setVisibility('hidden');
    await advance(60_000);
    expect(ticketsApi.getTicket).toHaveBeenCalledTimes(1);
    await setVisibility('visible');
    expect(ticketsApi.getTicket).toHaveBeenCalledTimes(2);
    await advance(10_000);
    expect(ticketsApi.getTicket).toHaveBeenCalledTimes(3);
  });

  it.each([
    { ...ticket, status: 'closed' },
    { ...ticket, messages: [message, { ...message, id: 2, is_from_admin: true }] },
  ])('останавливается при закрытии или ответе поддержки (%#)', async (updated) => {
    await renderTicket();
    vi.mocked(ticketsApi.getTicket).mockResolvedValue(updated);
    await advance(10_000);
    expect(ticketsApi.getTicket).toHaveBeenCalledTimes(2);
    await advance(60_000);
    expect(ticketsApi.getTicket).toHaveBeenCalledTimes(2);
  });

  it('возврат фокуса обновляет историю и после окончания окна ожидания', async () => {
    vi.mocked(ticketsApi.getTicket).mockResolvedValue({
      ...ticket,
      messages: [{ ...message, created_at: new Date(now - 300_000).toISOString() }],
    });
    await renderTicket();
    await advance(60_000);
    expect(ticketsApi.getTicket).toHaveBeenCalledTimes(1);
    await setVisibility('hidden');
    await setVisibility('visible');
    expect(ticketsApi.getTicket).toHaveBeenCalledTimes(2);
  });

  it('WS-ответ обновляет видимую переписку немедленно и останавливает поллинг', async () => {
    const { result } = await renderTicket();
    const updated = { ...ticket, messages: [{ ...message, is_from_admin: true }] };
    vi.mocked(ticketsApi.getTicket).mockResolvedValue(updated);
    await act(() => invalidateTicketQueries(client, { type: 'ticket.admin_reply', ticket_id: 42 }));
    await advance(1);
    expect(result.current.data).toEqual(updated);
    expect(ticketsApi.getTicket).toHaveBeenCalledTimes(2);
    await advance(60_000);
    expect(ticketsApi.getTicket).toHaveBeenCalledTimes(2);
  });

  it('новое сообщение клиента запускает новое окно ожидания', async () => {
    const { rerender } = await renderTicket();
    await advance(300_000);
    vi.mocked(ticketsApi.getTicket).mockClear();
    const updated = {
      ...ticket,
      messages: [...ticket.messages, { ...message, id: 2, created_at: new Date().toISOString() }],
    };
    vi.mocked(ticketsApi.getTicket).mockResolvedValue(updated);
    await act(() => client.invalidateQueries({ queryKey: ['ticket', 42] }));
    await advance(10_000);
    expect(ticketsApi.getTicket).toHaveBeenCalledTimes(2);
    rerender({ ticketId: undefined });
    await advance(60_000);
    expect(ticketsApi.getTicket).toHaveBeenCalledTimes(2);
  });

  it('после переключения опрашивает только новый выбранный тикет', async () => {
    const { rerender, unmount } = await renderTicket();
    vi.mocked(ticketsApi.getTicket).mockClear();
    rerender({ ticketId: 99 });
    await advance(10_001);
    expect(vi.mocked(ticketsApi.getTicket).mock.calls).toEqual([[99], [99]]);
    unmount();
    await advance(60_000);
    expect(ticketsApi.getTicket).toHaveBeenCalledTimes(2);
  });
});
