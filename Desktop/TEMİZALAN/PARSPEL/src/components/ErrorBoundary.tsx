import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: string;
}

// ── Hata loglarını localStorage'a kaydet ──
function logError(error: Error, errorInfo: string) {
  try {
    const logs = JSON.parse(localStorage.getItem('sobaErrorLog') || '[]');
    logs.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      message: error.message,
      stack: error.stack?.slice(0, 500),
      component: errorInfo,
      time: new Date().toISOString(),
      url: window.location.href,
    });
    // Son 100 hata kaydı tut
    localStorage.setItem('sobaErrorLog', JSON.stringify(logs.slice(0, 100)));
  } catch { /* localStorage dolu olabilir */ }
}

export function getErrorLogs(): Array<{ id: string; message: string; stack?: string; component: string; time: string; url: string }> {
  try {
    return JSON.parse(localStorage.getItem('sobaErrorLog') || '[]');
  } catch { return []; }
}

export function clearErrorLogs() {
  localStorage.removeItem('sobaErrorLog');
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: '' };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const info = errorInfo.componentStack || '';
    this.setState({ errorInfo: info });
    logError(error, info);
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#f1f5f9', background: '#0f172a', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: '4rem', marginBottom: 16 }}>⚠️</div>
          <h2 style={{ color: '#ef4444', marginBottom: 12, fontWeight: 800 }}>Bir Hata Oluştu</h2>
          <p style={{ color: '#94a3b8', marginBottom: 20, maxWidth: 480, lineHeight: 1.6 }}>
            Beklenmeyen bir hata oluştu. Verileriniz güvende — localStorage'da kayıtlı.
          </p>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: '14px 20px', marginBottom: 20, maxWidth: 500, width: '100%', textAlign: 'left' }}>
            <p style={{ color: '#ef4444', fontSize: '0.85rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {this.state.error?.message}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={() => window.location.reload()} style={{ background: '#3b82f6', border: 'none', borderRadius: 10, color: '#fff', padding: '12px 28px', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' }}>
              Sayfayı Yenile
            </button>
            <button onClick={() => this.setState({ hasError: false, error: null, errorInfo: '' })} style={{ background: '#273548', border: '1px solid #334155', borderRadius: 10, color: '#94a3b8', padding: '12px 28px', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' }}>
              Devam Et
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
