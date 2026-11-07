import { skipToken, useQuery } from '@tanstack/react-query';
import { ticketsApi } from '../api/tickets';
import { getTicketRefetchInterval } from '../utils/ticketUpdates';

export function useSupportTicket(ticketId: number | undefined) {
  return useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: ticketId ? () => ticketsApi.getTicket(ticketId) : skipToken,
    enabled: !!ticketId,
    refetchInterval: (query) => getTicketRefetchInterval(query.state.data),
    // React Query приостанавливает фоновый поллинг через focusManager.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}
