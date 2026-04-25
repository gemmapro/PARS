import { useEffect, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: number;
}

const isMobileDevice = () => window.innerWidth < 768;

export function Modal({ open, onClose, title, children, maxWidth = 560 }: ModalProps) {
  const mobile = isMobileDevice();

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  if (mobile) {
    // Mobilde bottom sheet
    return (
      <div
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          background: 'rgba(5,10,20,0.8)', backdropFilter: 'blur(8px)',
          animation: 'fadeIn 0.18s ease',
        }}
      >
        <div style={{
          background: 'linear-gradient(180deg, #0f1e35 0%, #0c1628 100%)',
          borderRadius: '20px 20px 0 0',
          width: '100%',
          border: '1px solid rgba(255,255,255,0.09)',
          borderBottom: 'none',
          boxShadow: '0 -20px 60px rgba(0,0,0,0.6)',
          maxHeight: '92vh', overflowY: 'auto',
          animation: 'slideUpSheet 0.28s cubic-bezier(0.22,1,0.36,1)',
        }}>
          {/* Handle */}
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12, paddingBottom: 4 }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)' }} />
          </div>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <h3 style={{ fontWeight: 800, fontSize: '1rem', color: '#f1f5f9', letterSpacing: '-0.01em', margin: 0 }}>{title}</h3>
            <button
              onClick={onClose}
              style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: '#64748b', cursor: 'pointer', width: 32, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', flexShrink: 0 }}
            >×</button>
          </div>
          <div style={{ padding: '16px 16px 32px' }}>{children}</div>
        </div>
        <style>{`
          @keyframes slideUpSheet { from { transform: translateY(100%); } to { transform: translateY(0); } }
        `}</style>
      </div>
    );
  }

  // Desktop — ortalanmış modal
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflowY: 'auto',
        background: 'rgba(5,10,20,0.75)', backdropFilter: 'blur(8px)',
        animation: 'fadeIn 0.18s ease',
      }}
    >
      <div style={{
        background: 'linear-gradient(160deg, #0f1e35 0%, #0c1628 100%)',
        borderRadius: 18, width: '100%', maxWidth,
        border: '1px solid rgba(255,255,255,0.09)',
        boxShadow: '0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
        maxHeight: '90vh', overflowY: 'auto',
        animation: 'slideUp 0.2s ease',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <h3 style={{ fontWeight: 800, fontSize: '1.05rem', color: '#f1f5f9', letterSpacing: '-0.01em' }}>{title}</h3>
          <button
            onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: '#64748b', cursor: 'pointer', width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', transition: 'all 0.15s' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.15)'; (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLButtonElement).style.color = '#64748b'; }}
          >×</button>
        </div>
        <div style={{ padding: '20px 24px' }}>{children}</div>
      </div>
      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(16px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      `}</style>
    </div>
  );
}
