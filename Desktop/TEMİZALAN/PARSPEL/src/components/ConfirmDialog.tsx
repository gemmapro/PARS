import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  danger?: boolean;
}

interface ConfirmContextType {
  showConfirm: (title: string, message: string, onConfirm: () => void, danger?: boolean) => void;
}

const ConfirmContext = createContext<ConfirmContextType>({ showConfirm: () => {} });

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState>({ open: false, title: '', message: '', onConfirm: () => {}, danger: true });

  const showConfirm = useCallback((title: string, message: string, onConfirm: () => void, danger = true) => {
    setState({ open: true, title, message, onConfirm, danger });
  }, []);

  const handleConfirm = () => { state.onConfirm(); setState(s => ({ ...s, open: false })); };
  const handleCancel = () => setState(s => ({ ...s, open: false }));

  return (
    <ConfirmContext.Provider value={{ showConfirm }}>
      {children}
      {state.open && (
        <div
          onClick={handleCancel}
          style={{ position: 'fixed', inset: 0, background: 'rgba(5,10,20,0.8)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(8px)', animation: 'fadeIn 0.18s ease' }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'linear-gradient(160deg, #0f1e35 0%, #0c1628 100%)', borderRadius: 18, padding: '28px 28px 24px', maxWidth: 380, width: '100%', border: '1px solid rgba(255,255,255,0.09)', boxShadow: '0 30px 80px rgba(0,0,0,0.6)', animation: 'slideUp 0.2s ease' }}>
            <div style={{ width: 48, height: 48, background: state.danger ? 'rgba(239,68,68,0.12)' : 'rgba(59,130,246,0.12)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', marginBottom: 16 }}>
              {state.danger ? '🗑️' : '❓'}
            </div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f1f5f9', marginBottom: 8 }}>{state.title}</h3>
            <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: 24, lineHeight: 1.5 }}>{state.message}</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleCancel}
                style={{ flex: 1, padding: '10px 0', background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', transition: 'all 0.15s' }}
                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.09)'}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)'}>
                İptal
              </button>
              <button
                onClick={handleConfirm}
                style={{ flex: 1, padding: '10px 0', background: state.danger ? 'linear-gradient(135deg, #dc2626, #ef4444)' : 'linear-gradient(135deg, #2563eb, #3b82f6)', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem', boxShadow: state.danger ? '0 4px 16px rgba(239,68,68,0.3)' : '0 4px 16px rgba(59,130,246,0.3)', transition: 'all 0.15s' }}>
                {state.danger ? '🗑️ Evet, Sil' : '✓ Onayla'}
              </button>
            </div>
          </div>
          <style>{`
            @keyframes slideUp { from { opacity: 0; transform: translateY(16px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
          `}</style>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
