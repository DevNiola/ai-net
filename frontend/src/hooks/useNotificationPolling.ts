import { useEffect, useRef, useState, useCallback } from 'react';
import { useNotifications } from './useNotifications';
import type { AppNotification } from '../types/notification';

const POLL_INTERVAL_MS = 30_000;

export interface UseNotificationPollingResult {
  isPolling: boolean;
  lastFetched: Date | null;
  error: string | null;
}

/**
 * Polls GET /api/notifications every 30 seconds and merges any new
 * notifications into the context via addNotification().
 */
export function useNotificationPolling(): UseNotificationPollingResult {
  const { notifications, addNotification } = useNotifications();
  const [isPolling, setIsPolling] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep a stable ref to current notification IDs to avoid deduplication issues
  const knownIdsRef = useRef<Set<string>>(new Set(notifications.map((n) => n.id)));

  // Keep ref in sync when context updates
  useEffect(() => {
    notifications.forEach((n) => knownIdsRef.current.add(n.id));
  }, [notifications]);

  const fetchNotifications = useCallback(async () => {
    setIsPolling(true);
    setError(null);
    try {
      const response = await fetch('/api/notifications', {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const items: AppNotification[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.notifications)
          ? data.notifications
          : [];

      // Add only genuinely new notifications
      for (const notification of items) {
        if (notification.id && !knownIdsRef.current.has(notification.id)) {
          knownIdsRef.current.add(notification.id);
          addNotification({
            id: notification.id,
            type: notification.type,
            title: notification.title,
            message: notification.message || notification.description || '',
            description: notification.description || notification.message || '',
            timestamp: notification.timestamp,
            read: notification.read ?? false,
            link: notification.link,
            metadata: notification.metadata,
          });
        }
      }

      setLastFetched(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setIsPolling(false);
    }
  }, [addNotification]);

  useEffect(() => {
    // Initial fetch on mount
    fetchNotifications();

    const intervalId = setInterval(fetchNotifications, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [fetchNotifications]);

  return { isPolling, lastFetched, error };
}

export default useNotificationPolling;
