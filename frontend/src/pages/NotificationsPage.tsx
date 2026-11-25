import React, { useState, useEffect } from 'react';
import { Bell, CheckCheck, Inbox } from 'lucide-react';
import { useNotifications } from '../hooks/useNotifications';
import NotificationItem from '../components/notifications/NotificationItem';
import { useNotificationPolling } from '../hooks/useNotificationPolling';
import {
  requestPushPermission,
  registerServiceWorker,
  isPushDismissed,
  dismissPushPrompt,
} from '../services/notificationService';
import './NotificationsPage.css';

export const NotificationsPage: React.FC = () => {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const { isPolling, lastFetched } = useNotificationPolling();
  const [showPushBanner, setShowPushBanner] = useState(false);

  useEffect(() => {
    // Show push banner if permission not yet granted and not dismissed
    if ('Notification' in window && Notification.permission === 'default' && !isPushDismissed()) {
      setShowPushBanner(true);
    }
  }, []);

  const handleEnablePush = async () => {
    const permission = await requestPushPermission();
    if (permission === 'granted') {
      await registerServiceWorker();
    }
    setShowPushBanner(false);
    dismissPushPrompt();
  };

  const handleDismissBanner = () => {
    setShowPushBanner(false);
    dismissPushPrompt();
  };

  const sorted = [...notifications].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return (
    <div className="notifications-page">
      {showPushBanner && (
        <div className="push-banner" role="banner" aria-label="Push notification permission prompt">
          <Bell size={16} aria-hidden="true" />
          <span className="push-banner-text">
            Enable push notifications to get alerted when tasks complete, payments arrive, or agents fail.
          </span>
          <button
            type="button"
            onClick={handleEnablePush}
            className="push-banner-enable-btn"
            aria-label="Enable push notifications"
          >
            Enable
          </button>
          <button
            type="button"
            onClick={handleDismissBanner}
            className="push-banner-dismiss-btn"
            aria-label="Dismiss push notification prompt"
          >
            ×
          </button>
        </div>
      )}

      <div className="notifications-page-header">
        <h1 className="notifications-page-title">
          Notifications{' '}
          {unreadCount > 0 && (
            <span className="notifications-unread-label">({unreadCount} unread)</span>
          )}
        </h1>
        <div className="notifications-page-header-actions">
          {isPolling && <span className="notifications-polling-indicator">Syncing…</span>}
          {lastFetched && (
            <span className="notifications-last-fetched">
              Updated {lastFetched.toLocaleTimeString()}
            </span>
          )}
          {notifications.length > 0 && (
            <button
              type="button"
              onClick={markAllAsRead}
              className="notifications-mark-all-btn"
              aria-label="Mark all notifications as read"
              data-testid="mark-all-read-btn"
            >
              <CheckCheck size={14} /> Mark all read
            </button>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="notifications-empty-state" data-testid="notification-empty-state">
          <Inbox size={40} className="notifications-empty-icon" aria-hidden="true" />
          <p>No notifications yet.</p>
        </div>
      ) : (
        <div className="notification-list" role="feed" aria-label="Notifications list">
          {sorted.map((n) => (
            <NotificationItem
              key={n.id}
              notification={n}
              onMarkAsRead={markAsRead}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default NotificationsPage;
