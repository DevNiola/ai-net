// Handles browser Push API permission and service worker registration
export const PUSH_PERMISSION_DISMISSED_KEY = 'ai_net_push_dismissed';

export async function requestPushPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  return await Notification.requestPermission();
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return reg;
  } catch (err) {
    console.error('SW registration failed:', err);
    return null;
  }
}

export function isPushDismissed(): boolean {
  try {
    return localStorage.getItem(PUSH_PERMISSION_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function dismissPushPrompt(): void {
  try {
    localStorage.setItem(PUSH_PERMISSION_DISMISSED_KEY, 'true');
  } catch (err) {
    console.error('Failed to persist push dismissal:', err);
  }
}

export async function initPushNotifications(): Promise<void> {
  if (isPushDismissed()) return;
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    await registerServiceWorker();
  }
}

export default {
  requestPushPermission,
  registerServiceWorker,
  isPushDismissed,
  dismissPushPrompt,
  initPushNotifications,
};
