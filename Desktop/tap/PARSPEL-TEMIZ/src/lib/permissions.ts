/**
 * Capacitor İzin Yöneticisi
 * Bildirim, dosya sistemi ve diğer izinleri yönetir.
 * İzinler uygulama başlangıcında istenir.
 */

import { Capacitor } from '@capacitor/core';

// ── Bildirim İzni ─────────────────────────────────────────────────────────────
export async function requestNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    // Web: Notification API
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.requestPermissions();
    return perm.display === 'granted';
  } catch {
    return false;
  }
}

// ── Yerel Bildirim Gönder ─────────────────────────────────────────────────────
export async function sendLocalNotification(title: string, body: string, id = Date.now()) {
  if (!Capacitor.isNativePlatform()) {
    // Web fallback
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/pwa-192.png' });
    }
    return;
  }

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.schedule({
      notifications: [{
        id,
        title,
        body,
        schedule: { at: new Date(Date.now() + 100) },
        sound: undefined,
        attachments: undefined,
        actionTypeId: '',
        extra: null,
      }],
    });
  } catch (e) {
    console.warn('Bildirim gönderilemedi:', e);
  }
}

// ── Dosya Kaydetme (Filesystem) ───────────────────────────────────────────────
export async function saveFileToDevice(filename: string, data: string, mimeType = 'application/octet-stream'): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    // Web: blob download
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  }

  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    await Filesystem.writeFile({
      path: filename,
      data,
      directory: Directory.Documents,
      encoding: 'utf8' as never,
    });
    return true;
  } catch (e) {
    console.warn('Dosya kaydedilemedi:', e);
    return false;
  }
}

// ── Tüm İzinleri Başlangıçta İste ────────────────────────────────────────────
export async function requestAllPermissions(): Promise<void> {
  // Bildirim izni
  await requestNotificationPermission().catch(() => {});

  if (!Capacitor.isNativePlatform()) return;

  // Mikrofon izni (sesli AI asistan için)
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop()); // hemen kapat, sadece izin al
    console.info('[permissions] Mikrofon izni verildi');
  } catch {
    console.warn('[permissions] Mikrofon izni reddedildi');
  }

  // Depolama izni (Excel export için)
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    await Filesystem.requestPermissions();
    console.info('[permissions] Depolama izni verildi');
  } catch {
    console.warn('[permissions] Depolama izni reddedildi');
  }
}
