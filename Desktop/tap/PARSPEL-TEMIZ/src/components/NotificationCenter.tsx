import { useState, useEffect, useCallback, useRef } from 'react';
import type { DB } from '@/types';
import { generateNotifications, getUnreadCount, type AppNotification, type NotifSeverity, type NotifCategory } from '@/lib/notificationEngine';

const DISMISSED_KEY = 'sobaYonetim_dismissedNotifs';
const REFRESH_MS = 5 * 60 * 1000; // 5 dakika

const SEV_STYLE: Record<NotifSeverity, { border: string; bg: string; dot: string; label: string }> = {
  critical: { border: 'rgba(239,68,68,0.35)', bg: 'rgba(239,68,68,0.07)', dot: '#ef4444', label: 'Kritik' },
  warning:  { border: 'rgba(245,158,11,0.3)',  bg: 'rgba(245,158,11,0.06)', dot: '#f59e0b', label: 'Uyarı'  },
  info:     { border: 'rgba(96,165,250,0.25)',  bg: 'rgba(96,165,250,0.05)', dot: '#60a5fa', label: 'Bilgi'  },
};

const CAT_LABEL: Record<NotifCategory, string> = {
  stok: '📦 Stok', kasa: '💰 Kasa', cari: '👤 Cari',
  siparis: '🚚 Sipariş', fatura: '🧾 Fatura', sistem: '⚙️ Sistem',
};

interface Props {
  db: DB;
  onNavigate: (tab: string) => void;
}

function loadDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveDismissed(set: Set<string>) {
  try { sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...set])); } catch {}
}

export default function NotificationCenter({ db, onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<AppNotification[]>(() => generateNotifications(db));
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);
  const [lastRefresh, setLastRefresh] = useState(() => new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));
  const panelRef = useRef<HTMLDivElement>(null);

  // DB değişince veya periyodik olarak yenile
  const refresh = useCallback(() => {
    setNotifs(generateNotifications(db));
    setLastRefresh(new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));
  }, [db]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Panel dışı tıklamada kapat
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const t = setTimeout(() => document.addEventListener('mousedown', h), 50);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', h); };
  }, [open]);

  // ESC
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const dismiss = (id: string) => {
    setDismissed(prev => {
      const next = new Set(prev).add(id);
      saveDismissed(next);
      return next;
    });
  };

  const dismissAll = () => {
    setDismissed(prev => {
      const next = new Set(prev);
      notifs.forEach(n => next.add(n.id));
      saveDismissed(next);
      return next;
    });
  };

  const resetDismissed = () => {
    setDismissed(new Set());
    saveDismissed(new Set());
  };

  const visible = notifs.filter(n => !dismissed.has(n.id));
  const unread = getUnreadCount(notifs, dismissed);

  const criticalCount = visible.filter(n => n.severity === 'critical').length;
  const warningCount = visible.filter(n => n.severity === 'warning').length;

  // Kategoriye göre grupla
  const grouped = visible.reduce<Record<string, AppNotification[]>>((acc, n) => {
    (acc[n.category] = acc[n.category] || []).push(n);
    return acc;
  }, {});

  return (
    <>
      {/* Çan butonu */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button
          onClick={() => setOpen(o => !o)}
          title="Bildirimler"
          style={{
            position: 'relative',
            background: open
              ? 'rgba(245,158,11,0.15)'
              : unread > 0
                ? (criticalCount > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.08)')
                : 'rgba(255,255,255,0.04)',
            border: open
              ? '1px solid rgba(245,158,11,0.4)'
              : unread > 0
                ? (criticalCount > 0 ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(245,158,11,0.2)')
                : '1px solid rgba(255,255,255,0.06)',
            borderRadius: 9,
            color: open
              ? '#fbbf24'
              : unread > 0
                ? (criticalCount > 0 ? '#f87171' : '#fbbf24')
                : '#334155',
            width: 36,
            height: 36,
            cursor: 'pointer',
            fontSize: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.18s',
            animation: criticalCount > 0 && !open ? 'bellShake 3s ease-in-out infinite' : 'none',
          }}
          onMouseEnter={e => {
            if (!open) {
              (e.currentTarget as HTMLButtonElement).style.background = criticalCount > 0
                ? 'rgba(239,68,68,0.18)' : 'rgba(245,158,11,0.14)';
            }
          }}
          onMouseLeave={e => {
            if (!open) {
              (e.currentTarget as HTMLButtonElement).style.background = unread > 0
                ? (criticalCount > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.08)')
                : 'rgba(255,255,255,0.04)';
            }
          }}
        >
          🔔
        </button>
        {/* Badge */}
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            minWidth: 16, height: 16,
            background: criticalCount > 0 ? '#ef4444' : '#f59e0b',
            color: '#fff',
            fontSize: '0.6rem', fontWeight: 800,
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px',
            border: '2px solid #070e1c',
            pointerEvents: 'none',
            animation: criticalCount > 0 ? 'badgePulse 2s ease-in-out infinite' : 'none',
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </div>

      {/* Overlay */}
      {open && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 199, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }}
          onClick={() => setOpen(false)}
        />
      )}

      {/* Panel */}
      <div
        ref={panelRef}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(400px, 100vw)',
          zIndex: 200,
          background: 'linear-gradient(160deg, #0a1628 0%, #07101e 100%)',
          borderLeft: '1px solid rgba(255,255,255,0.07)',
          boxShadow: '-16px 0 50px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.28s cubic-bezier(0.22,1,0.36,1)',
          visibility: open ? 'visible' : 'hidden',
        }}
      >
        {/* Başlık */}
        <div style={{
          padding: '16px 18px 13px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
          background: 'rgba(0,0,0,0.2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{
              width: 36, height: 36, flexShrink: 0,
              background: criticalCount > 0
                ? 'linear-gradient(135deg,#ef4444,#dc2626)'
                : unread > 0
                  ? 'linear-gradient(135deg,#f59e0b,#d97706)'
                  : 'linear-gradient(135deg,#334155,#475569)',
              borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1rem',
              boxShadow: criticalCount > 0 ? '0 4px 16px rgba(239,68,68,0.4)' : '0 4px 16px rgba(0,0,0,0.3)',
            }}>🔔</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, color: '#f1f5f9', fontSize: '0.93rem' }}>Bildirimler</div>
              <div style={{ color: '#334155', fontSize: '0.67rem' }}>Son güncelleme: {lastRefresh}</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: '#475569', cursor: 'pointer', width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 }}
            >×</button>
          </div>

          {/* Özet sayaçlar */}
          <div style={{ display: 'flex', gap: 7 }}>
            {([
              { count: criticalCount, label: 'Kritik', color: '#ef4444', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)' },
              { count: warningCount, label: 'Uyarı', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.18)' },
              { count: visible.filter(n => n.severity === 'info').length, label: 'Bilgi', color: '#60a5fa', bg: 'rgba(96,165,250,0.07)', border: 'rgba(96,165,250,0.15)' },
            ]).map(({ count, label, color, bg, border }) => (
              <div key={label} style={{ flex: 1, background: bg, border: `1px solid ${border}`, borderRadius: 9, padding: '6px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 900, color, lineHeight: 1 }}>{count}</div>
                <div style={{ fontSize: '0.6rem', color: '#475569', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* İçerik */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
          {visible.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', gap: 12 }}>
              <div style={{ fontSize: '2.5rem' }}>✅</div>
              <div style={{ color: '#10b981', fontWeight: 700, fontSize: '0.9rem' }}>Her şey yolunda!</div>
              <div style={{ color: '#334155', fontSize: '0.75rem', textAlign: 'center' }}>Aktif uyarı yok. Tüm bildirimler okundu işaretlendi.</div>
              <button
                onClick={resetDismissed}
                style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.18)', borderRadius: 8, color: '#60a5fa', padding: '6px 14px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}
              >Bildirimleri Yenile</button>
            </div>
          ) : (
            Object.entries(grouped).map(([cat, items]) => (
              <div key={cat} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: '0.63rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, paddingLeft: 2 }}>
                  {CAT_LABEL[cat as NotifCategory] || cat}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {items.map(n => {
                    const s = SEV_STYLE[n.severity];
                    return (
                      <div
                        key={n.id}
                        style={{
                          background: s.bg,
                          border: `1px solid ${s.border}`,
                          borderRadius: 10,
                          padding: '10px 12px',
                          display: 'flex',
                          gap: 10,
                          alignItems: 'flex-start',
                          animation: 'notifSlideIn 0.22s ease both',
                        }}
                      >
                        {/* Sol dot */}
                        <div style={{ marginTop: 3, flexShrink: 0 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.dot, display: 'block', boxShadow: `0 0 6px ${s.dot}` }} />
                        </div>

                        {/* İçerik */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 2 }}>
                            <span style={{ fontSize: '0.88rem', lineHeight: 1, flexShrink: 0 }}>{n.icon}</span>
                            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#e2e8f0', lineHeight: 1.3 }}>{n.title}</span>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b', lineHeight: 1.4, marginBottom: n.targetTab ? 8 : 0 }}>{n.detail}</div>
                          {n.targetTab && (
                            <button
                              onClick={() => { onNavigate(n.targetTab!); setOpen(false); }}
                              style={{
                                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: 6, color: '#94a3b8', padding: '3px 9px', cursor: 'pointer',
                                fontSize: '0.7rem', fontWeight: 600, transition: 'all 0.15s',
                              }}
                              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)'; (e.currentTarget as HTMLButtonElement).style.color = '#f1f5f9'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLButtonElement).style.color = '#94a3b8'; }}
                            >
                              Git →
                            </button>
                          )}
                        </div>

                        {/* Kapat */}
                        <button
                          onClick={() => dismiss(n.id)}
                          title="Okundu işaretle"
                          style={{ background: 'none', border: 'none', color: '#1e3a5f', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: 2, flexShrink: 0, borderRadius: 4, transition: 'color 0.15s' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#64748b')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#1e3a5f')}
                        >×</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Alt butonlar */}
        {visible.length > 0 && (
          <div style={{ padding: '10px 14px 14px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              onClick={dismissAll}
              style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 9, color: '#475569', padding: '8px', cursor: 'pointer', fontSize: '0.77rem', fontWeight: 600, transition: 'all 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#94a3b8'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#475569'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
            >
              ✓ Tümünü Okundu İşaretle
            </button>
            <button
              onClick={refresh}
              title="Yenile"
              style={{ background: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.14)', borderRadius: 9, color: '#60a5fa', padding: '8px 14px', cursor: 'pointer', fontSize: '0.85rem', transition: 'all 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(96,165,250,0.14)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(96,165,250,0.07)')}
            >⟳</button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes bellShake {
          0%,100%  { transform: rotate(0); }
          8%        { transform: rotate(-12deg); }
          16%       { transform: rotate(12deg); }
          24%       { transform: rotate(-8deg); }
          32%       { transform: rotate(8deg); }
          40%       { transform: rotate(0); }
        }
        @keyframes notifSlideIn {
          from { opacity: 0; transform: translateX(12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
