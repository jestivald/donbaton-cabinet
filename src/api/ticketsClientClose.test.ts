import { expect, it, vi } from 'vitest';
import apiClient from './client';
import { ticketsApi } from './tickets';

vi.mock('./client', () => ({ default: { post: vi.fn() } }));

it('posts close to the cabinet ticket route and returns ticket detail', async () => {
  const detail = { id: 42, status: 'closed', can_close: false, messages: [] };
  vi.mocked(apiClient.post).mockResolvedValue({ data: detail });
  expect(await ticketsApi.closeTicket(42)).toEqual(detail);
  expect(apiClient.post).toHaveBeenCalledExactlyOnceWith('/cabinet/tickets/42/close');
});
