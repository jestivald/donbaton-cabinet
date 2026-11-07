import type { QueryClient } from '@tanstack/react-query';
import type { WSMessage } from '../providers/WebSocketContext';
import type { TicketDetail } from '../types';

const POLL_INTERVAL_MS = 10_000;
const WAIT_WINDOW_MS = 3 * 60_000;

/** Единая инвалидация переписки для всех экранов, независимо от колокольчика. */
export function invalidateTicketQueries(queryClient: QueryClient, message: WSMessage) {
  if (!message.type.startsWith('ticket.')) return;

  const ticketId = message.ticket_id;
  const hasTicketId = typeof ticketId === 'number' && Number.isInteger(ticketId) && ticketId > 0;
  return queryClient.invalidateQueries({
    predicate: ({ queryKey: [key, id] }) => {
      switch (key) {
        case 'tickets':
        case 'admin-tickets':
        case 'admin-ticket-stats':
        case 'admin-user-tickets':
          return true;
        case 'ticket':
        case 'admin-ticket':
        case 'admin-ticket-detail':
          // Без корректного id обновляем все карточки, чтобы не потерять событие.
          return !hasTicketId || id === ticketId;
        default:
          return false;
      }
    },
  });
}

/** Поллинг нужен только в коротком окне ожидания ответа на сообщение клиента. */
export function getTicketRefetchInterval(
  ticket: TicketDetail | undefined,
  now = Date.now(),
): number | false {
  if (!ticket || ticket.status === 'closed' || ticket.closed_at) return false;
  const lastMessage = ticket.messages[ticket.messages.length - 1];
  if (!lastMessage || lastMessage.is_from_admin) return false;

  const elapsed = now - Date.parse(lastMessage.created_at);
  // Не планируем следующий запрос за пределами окна ожидания.
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed + POLL_INTERVAL_MS <= WAIT_WINDOW_MS
    ? POLL_INTERVAL_MS
    : false;
}
