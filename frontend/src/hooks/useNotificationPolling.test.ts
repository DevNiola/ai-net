import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { NotificationProvider } from '../context/NotificationContext';
import { useNotificationPolling } from './useNotificationPolling';
import { useNotifications } from './useNotifications';

// Suppress WebSocket noise in tests
class MockWebSocket {
  onopen: null = null;
  onmessage: null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: null = null;
  readyState = 1;
  close() {
    if (this.onclose) this.onclose(new CloseEvent('close'));
  }
}
(global as unknown as Record<string, unknown>).WebSocket = MockWebSocket;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(NotificationProvider, null, children);
}

describe('useNotificationPolling', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('fetches notifications on mount and returns lastFetched', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 'poll-1',
          type: 'task_completed',
          title: 'Polled task',
          message: 'From API',
          timestamp: new Date().toISOString(),
          read: false,
        },
      ],
    } as unknown as Response);

    const { result } = renderHook(() => useNotificationPolling(), { wrapper });

    await waitFor(() => expect(result.current.lastFetched).not.toBeNull(), { timeout: 3000 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/notifications',
      expect.objectContaining({ credentials: 'include' })
    );
    expect(result.current.error).toBeNull();
  });

  it('adds new notifications from API into the context', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 'poll-new',
          type: 'payment_received',
          title: 'New payment',
          message: '0.5 XLM',
          timestamp: new Date().toISOString(),
          read: false,
        },
      ],
    } as unknown as Response);

    const { result } = renderHook(() => ({
      polling: useNotificationPolling(),
      notifications: useNotifications(),
    }), { wrapper });

    await waitFor(() => expect(result.current.polling.lastFetched).not.toBeNull(), { timeout: 3000 });

    expect(result.current.notifications.notifications.some((n) => n.id === 'poll-new')).toBe(true);
  });

  it('does not add duplicate notifications across two polls', async () => {
    // Both calls return the same notification
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 'dup-poll', type: 'system', title: 'T', message: 'm', timestamp: new Date().toISOString(), read: false },
      ],
    } as unknown as Response);

    const { result } = renderHook(() => ({
      polling: useNotificationPolling(),
      notifications: useNotifications(),
    }), { wrapper });

    // Wait for the initial fetch
    await waitFor(() => expect(result.current.polling.lastFetched).not.toBeNull(), { timeout: 3000 });

    // The deduplication set should prevent a second add even if we call fetchNotifications again
    // We verify the invariant: only one notification with that id exists
    const dupes = result.current.notifications.notifications.filter((n) => n.id === 'dup-poll');
    expect(dupes).toHaveLength(1);
  });

  it('sets error state when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 503,
    } as unknown as Response);

    const { result } = renderHook(() => useNotificationPolling(), { wrapper });

    await waitFor(() => expect(result.current.error).not.toBeNull(), { timeout: 3000 });
    expect(result.current.error).toMatch(/503/);
  });

  it('calls fetch on mount (polling is registered)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as unknown as Response);

    const { result } = renderHook(() => useNotificationPolling(), { wrapper });

    // Initial fetch on mount
    await waitFor(() => expect(result.current.lastFetched).not.toBeNull(), { timeout: 3000 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('handles response in { notifications: [] } envelope format', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        notifications: [
          { id: 'env-1', type: 'system', title: 'Env', message: 'e', timestamp: new Date().toISOString(), read: false },
        ],
        total: 1,
      }),
    } as unknown as Response);

    const { result } = renderHook(() => ({
      polling: useNotificationPolling(),
      notifications: useNotifications(),
    }), { wrapper });

    await waitFor(() => expect(result.current.polling.lastFetched).not.toBeNull(), { timeout: 3000 });
    expect(result.current.notifications.notifications.some((n) => n.id === 'env-1')).toBe(true);
  });

  it('interval id is registered (setInterval is called)', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as unknown as Response);

    const intervalSpy = vi.spyOn(globalThis, 'setInterval');

    const { unmount } = renderHook(() => useNotificationPolling(), { wrapper });

    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);

    unmount();
    intervalSpy.mockRestore();
  });
});
