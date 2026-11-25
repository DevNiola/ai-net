import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { NotificationProvider } from '../context/NotificationContext';
import { useNotifications } from './useNotifications';
import type { AppNotification } from '../types/notification';

// Silence WebSocket noise in tests
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

describe('useNotifications', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('returns default values when no notifications exist', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.isConnected).toBe(false);
  });

  it('addNotification increases unreadCount', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.addNotification({
        id: 'n1',
        type: 'task_completed',
        title: 'Task done',
        message: 'Your task completed successfully.',
      });
    });

    expect(result.current.unreadCount).toBe(1);
    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].read).toBe(false);
  });

  it('markAsRead reduces unreadCount', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.addNotification({
        id: 'n2',
        type: 'payment_received',
        title: 'Payment received',
        message: '1.5 XLM received.',
      });
    });

    expect(result.current.unreadCount).toBe(1);

    act(() => {
      result.current.markAsRead('n2');
    });

    expect(result.current.unreadCount).toBe(0);
    expect(result.current.notifications.find((n) => n.id === 'n2')?.read).toBe(true);
  });

  it('markAllAsRead sets all notifications to read', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.addNotification({ id: 'a1', type: 'task_completed', title: 'T1', message: 'm1' });
      result.current.addNotification({ id: 'a2', type: 'agent_registered', title: 'T2', message: 'm2' });
      result.current.addNotification({ id: 'a3', type: 'system', title: 'T3', message: 'm3' });
    });

    expect(result.current.unreadCount).toBe(3);

    act(() => {
      result.current.markAllAsRead();
    });

    expect(result.current.unreadCount).toBe(0);
    result.current.notifications.forEach((n) => {
      expect(n.read).toBe(true);
    });
  });

  it('clearAll removes all notifications', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.addNotification({ id: 'c1', type: 'system', title: 'T', message: 'm' });
      result.current.addNotification({ id: 'c2', type: 'system', title: 'T2', message: 'm2' });
    });

    expect(result.current.notifications).toHaveLength(2);

    act(() => {
      result.current.clearAll();
    });

    expect(result.current.notifications).toHaveLength(0);
    expect(result.current.unreadCount).toBe(0);
  });

  it('removeNotification removes only the specified notification', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.addNotification({ id: 'r1', type: 'system', title: 'T1', message: 'm1' });
      result.current.addNotification({ id: 'r2', type: 'system', title: 'T2', message: 'm2' });
    });

    act(() => {
      result.current.removeNotification('r1');
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].id).toBe('r2');
  });

  it('deduplicates notifications with the same id', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.addNotification({ id: 'dup1', type: 'task_completed', title: 'First', message: 'm' });
      result.current.addNotification({ id: 'dup1', type: 'task_completed', title: 'Updated', message: 'm' });
    });

    // Should only keep one
    const matches = result.current.notifications.filter((n) => n.id === 'dup1');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('Updated');
  });

  it('returns fallback values when used outside NotificationProvider', () => {
    // No wrapper — context is null
    const { result } = renderHook(() => useNotifications());

    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.isConnected).toBe(false);
    // Calling methods should not throw
    expect(() => result.current.markAsRead('x')).not.toThrow();
    expect(() => result.current.markAllAsRead()).not.toThrow();
  });

  it('persists notifications to localStorage', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.addNotification({ id: 'p1', type: 'system', title: 'Persist me', message: 'stored' });
    });

    const stored = JSON.parse(localStorage.getItem('ai_net_notifications') || '[]') as AppNotification[];
    expect(stored.some((n) => n.id === 'p1')).toBe(true);
  });
});
