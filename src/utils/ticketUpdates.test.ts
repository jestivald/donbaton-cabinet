import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { TicketDetail, TicketMessage } from '../types';
import { getTicketRefetchInterval, invalidateTicketQueries } from './ticketUpdates';

const now = Date.parse('2026-11-07T12:00:00Z');
const userMessage: TicketMessage = {
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
  created_at: userMessage.created_at,
  updated_at: userMessage.created_at,
  closed_at: null,
  is_reply_blocked: false,
  can_close: true,
  messages: [userMessage],
};

describe('окно ожидания ответа поддержки', () => {
  it.each([0, 10_000, 60_000, 170_000])('поллинг раз в 10 с при возрасте %i мс', (age) => {
    expect(getTicketRefetchInterval(ticket, now + age)).toBe(10_000);
  });

  it.each([170_001, 180_000, 300_000])(
    'не планирует запрос за пределами 3 минут (%i мс)',
    (age) => {
      expect(getTicketRefetchInterval(ticket, now + age)).toBe(false);
    },
  );

  it('не отсчитывает окно от updated_at или предыдущих сообщений', () => {
    const messages = [{ ...userMessage, created_at: new Date(now - 300_000).toISOString() }];
    expect(getTicketRefetchInterval({ ...ticket, messages }, now)).toBe(false);
    messages.push({ ...userMessage, id: 2 });
    expect(getTicketRefetchInterval({ ...ticket, messages }, now)).toBe(10_000);
  });

  it('останавливается после ответа поддержки, включая ответ ИИ с is_from_admin', () => {
    const messages = [userMessage, { ...userMessage, id: 2, is_from_admin: true }];
    expect(getTicketRefetchInterval({ ...ticket, messages }, now)).toBe(false);
  });

  it.each([
    undefined,
    { ...ticket, messages: [] },
    { ...ticket, status: 'closed' },
    { ...ticket, closed_at: userMessage.created_at },
    { ...ticket, messages: [{ ...userMessage, created_at: 'invalid' }] },
    { ...ticket, messages: [{ ...userMessage, created_at: new Date(now + 1).toISOString() }] },
  ])('не опрашивает отсутствующий, закрытый тикет или некорректную дату (%#)', (value) => {
    expect(getTicketRefetchInterval(value, now)).toBe(false);
  });
});

describe('инвалидация по WS-событиям', () => {
  const listKeys = [
    ['tickets'],
    ['tickets', 2, 'open'],
    ['admin-tickets', 1, 'open'],
    ['admin-tickets', 2, 'closed'],
    ['admin-ticket-stats'],
    ['admin-user-tickets', 7],
  ];
  const detailKeys = [
    ['ticket', 42],
    ['admin-ticket', 42],
    ['admin-ticket-detail', 42],
  ];
  const otherDetails = [
    ['ticket', 99],
    ['admin-ticket', 99],
    ['admin-ticket-detail', 99],
  ];
  const unrelatedKeys = [
    ['balance'],
    ['ticket-notifications'],
    ['admin-ticket-notifications-count'],
  ];

  function createClient() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    for (const key of [...listKeys, ...detailKeys, ...otherDetails, ...unrelatedKeys]) {
      client.setQueryData(key, {});
    }
    return client;
  }

  it.each(['ticket.admin_reply', 'ticket.user_reply', 'ticket.new', 'ticket.status_changed'])(
    '%s обновляет все списки, статистику и только нужную переписку',
    async (type) => {
      const client = createClient();
      await invalidateTicketQueries(client, { type, ticket_id: 42 });
      for (const key of [...listKeys, ...detailKeys]) {
        expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
      }
      for (const key of [...otherDetails, ...unrelatedKeys]) {
        expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(false);
      }
      client.clear();
    },
  );

  it.each([undefined, 0, -1, 1.5, Number.NaN])(
    'обновляет все карточки, если нет корректного id (%s)',
    async (ticket_id) => {
      const client = createClient();
      await invalidateTicketQueries(client, { type: 'ticket.new', ticket_id });
      for (const key of [...detailKeys, ...otherDetails]) {
        expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      }
      client.clear();
    },
  );

  it('не затрагивает тикеты при других событиях', async () => {
    const client = createClient();
    await invalidateTicketQueries(client, { type: 'balance.topup', ticket_id: 42 });
    expect(
      client
        .getQueryCache()
        .getAll()
        .some((query) => query.state.isInvalidated),
    ).toBe(false);
    client.clear();
  });

  it('сразу запрашивает активную переписку ровно один раз', async () => {
    const client = createClient();
    const queryFn = vi.fn().mockResolvedValue(ticket);
    const observer = new QueryObserver(client, {
      queryKey: ['admin-ticket-detail', 42],
      queryFn,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    await invalidateTicketQueries(client, { type: 'ticket.user_reply', ticket_id: 42 });
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(['admin-ticket-detail', 42])).toEqual(ticket);
    unsubscribe();
    client.clear();
  });
});
