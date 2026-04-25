/**
 * Giriş Ekranı — Kullanıcı Adı + Şifre
 * Kullanıcılar Firebase config/users dökümanında saklanır
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { logger } from '@/lib/logger';
import {
  loginUser, getUserSession, setUserSession, clearUserSession,
  loadUsers, createUser, type AppUser, type UserRole,
} from '@/lib/userManager';

export { hashPassword as hashPass } from '@/lib/userManager';

// ── Oturum hook ────────────────────────────────────────────────────────────
export function useAuth() {
  const [authed, setAuthed] = useState(() => !!getUserSession());
  const [currentUser, setCurrentUser] = useState(() => getUserSession());

  const login = (user: AppUser, remember = false) => {
    setUserSession(user, remember);
    setCurrentUser({ userId: user.id, username: user.username, role: user.role });
    setAuthed(true);
    logger.info('auth', 'Giriş başarılı', { username: user.username, role: user.role });
  };

  const logout = () => {
    clearUserSession();
    setAuthed(false);
    setCurrentUser(null);
    logger.info('auth', 'Oturum kapatıldı');
  };

  return { authed, login, logout, currentUser };
}

// ── Parçacıklar ────────────────────────────────────────────────────────────
const PARTICLES = Array.from({ length: 55 }, (_, i) => ({
  size: 2 + ((i * 7) % 5),
  left: (i * 19.3) % 100,
  delay: (i * 1.37) % 22,
  duration: 14 + ((i * 3.1) % 24),
  color: i % 4 === 0 ? '#ff5722' : i % 4 === 1 ? '#ff9800' : i % 4 === 2 ? '#ffb74d' : 'rgba(255,255,255,0.6)',
  glow: i % 4 === 0,
}));

function Particle({ p }: { p: typeof PARTICLES[number] }) {
  return (
    <div style={{
      position: 'absolute', width: p.size, height: p.size, borderRadius: '50%',
      background: p.color, left: `${p.left}%`, bottom: '-5%', opacity: 0,
      animation: `floatUp ${p.duration}s ${p.delay}s infinite`, pointerEvents: 'none',
      boxShadow: p.glow ? `0 0 8px 2px rgba(255,87,34,0.5)` : 'none',
    }} />
  );
}

// ── Ana bileşen ────────────────────────────────────────────────────────────
export default function LoginScreen({ onLogin }: { onLogin: (user: AppUser, remember: boolean) => void }) {
  const [username, setUsername] = useState('');
  const [pass, setPass] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [success, setSuccess] = useState(false);
  const [fbStatus, setFbStatus] = useState<'connecting' | 'ready' | 'first-setup' | 'error'>('connecting');
  const [statusMsg, setStatusMsg] = useState('Bağlanılıyor…');
  const [time, setTime] = useState(new Date());
  const usernameRef = useRef<HTMLInputElement>(null);

  // İlk kurulum state
  const [setupMode, setSetupMode] = useState(false);
  const [setupPass2, setSetupPass2] = useState('');

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const checkUsers = useCallback(async () => {
    setFbStatus('connecting');
    setStatusMsg('Firebase\'e bağlanılıyor…');
    try {
      const users = await loadUsers();
      if (users.length === 0) {
        setFbStatus('first-setup');
        setStatusMsg('İlk kurulum — yönetici hesabı oluşturun');
        setSetupMode(true);
      } else {
        setFbStatus('ready');
        setStatusMsg(`${users.filter(u => u.active).length} kullanıcı hazır`);
        setSetupMode(false);
      }
    } catch {
      setFbStatus('error');
      setStatusMsg('Firebase bağlantısı kurulamadı');
    }
    setTimeout(() => usernameRef.current?.focus(), 300);
  }, []);

  useEffect(() => { checkUsers(); }, [checkUsers]);

  const doShake = () => { setShake(true); setTimeout(() => setShake(false), 600); };

  const handleLogin = async () => {
    if (!username.trim()) { setError('Kullanıcı adı gerekli'); doShake(); return; }
    if (!pass.trim()) { setError('Şifre gerekli'); doShake(); return; }
    setLoading(true); setError('');
    const user = await loginUser(username.trim(), pass);
    if (user) {
      setSuccess(true);
      setTimeout(() => onLogin(user, remember), 900);
    } else {
      setError('Kullanıcı adı veya şifre hatalı');
      doShake(); setPass('');
    }
    setLoading(false);
  };

  const handleFirstSetup = async () => {
    if (!username.trim()) { setError('Kullanıcı adı gerekli'); doShake(); return; }
    if (pass.length < 4) { setError('Şifre en az 4 karakter olmalı'); doShake(); return; }
    if (pass !== setupPass2) { setError('Şifreler eşleşmiyor'); doShake(); return; }
    setLoading(true); setError('');
    const result = await createUser(username.trim(), pass, 'admin');
    if (result.ok) {
      const user = await loginUser(username.trim(), pass);
      if (user) { setSuccess(true); setTimeout(() => onLogin(user, remember), 900); }
    } else {
      setError(result.msg);
    }
    setLoading(false);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') setupMode ? handleFirstSetup() : handleLogin();
  };

  const fbColors = { connecting: '#f59e0b', ready: '#10b981', 'first-setup': '#8b5cf6', error: '#ef4444' };
  const fbDots = { connecting: '◌', ready: '●', 'first-setup': '◆', error: '✕' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#040810', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`
        @keyframes floatUp { 0%{transform:translateY(0) scale(0);opacity:0} 10%{opacity:0.35;transform:translateY(-10vh) scale(1)} 85%{opacity:0.25} 100%{transform:translateY(-115vh) scale(0.4);opacity:0} }
        @keyframes gradientShift { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
        @keyframes loginSlideUp { from{opacity:0;transform:translateY(48px) scale(0.94);filter:blur(4px)} to{opacity:1;transform:translateY(0) scale(1);filter:blur(0)} }
        @keyframes loginShakeX { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-14px)} 40%{transform:translateX(14px)} 60%{transform:translateX(-8px)} 80%{transform:translateX(8px)} }
        @keyframes loginFadeOut { to{opacity:0;transform:scale(1.08);filter:blur(12px)} }
        @keyframes loginGlowPulse { 0%,100%{box-shadow:0 0 40px rgba(255,87,34,0.12),0 40px 120px rgba(0,0,0,0.6)} 50%{box-shadow:0 0 70px rgba(255,87,34,0.22),0 40px 120px rgba(0,0,0,0.6)} }
        @keyframes loginPulse { 0%,100%{transform:scale(1);opacity:0.8} 50%{transform:scale(1.07);opacity:1} }
        @keyframes loginFbDot { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes loginSuccessRing { 0%{transform:scale(0.8);opacity:0} 50%{transform:scale(1.15);opacity:0.8} 100%{transform:scale(1.5);opacity:0} }
        @keyframes spin { to{transform:rotate(360deg)} }
        .login-input:focus { border-color:rgba(255,87,34,0.5)!important; box-shadow:0 0 0 3px rgba(255,87,34,0.12)!important; }
        .login-btn:not(:disabled):hover { transform:translateY(-1px); box-shadow:0 12px 40px rgba(255,87,34,0.45)!important; }
      `}</style>

      {/* Arka plan */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(-45deg,#060c1a,#0d1829,#111826,#08122a,#0d081e,#060c1a)', backgroundSize: '400% 400%', animation: 'gradientShift 22s ease infinite' }} />
      <div style={{ position: 'absolute', top: '12%', left: '18%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle,rgba(255,87,34,0.07) 0%,transparent 65%)', animation: 'loginPulse 32s ease-in-out infinite', pointerEvents: 'none' }} />
      {PARTICLES.map((p, i) => <Particle key={i} p={p} />)}

      {/* Üst bilgi */}
      <div style={{ position: 'absolute', top: 28, left: 0, right: 0, textAlign: 'center', color: 'rgba(255,255,255,0.12)', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.35em', textTransform: 'uppercase' }}>
        Solhan Ticaret Yönetim Sistemi
      </div>
      <div style={{ position: 'absolute', top: 24, right: 36, color: 'rgba(255,255,255,0.18)', fontSize: '0.9rem', fontVariantNumeric: 'tabular-nums' }}>
        {time.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </div>
      <div style={{ position: 'absolute', top: 24, left: 36, display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ color: fbColors[fbStatus], fontSize: '0.75rem', animation: fbStatus === 'connecting' ? 'loginFbDot 1.2s ease-in-out infinite' : 'none' }}>{fbDots[fbStatus]}</span>
        <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.68rem', fontWeight: 500 }}>Firebase</span>
      </div>

      {/* Kart */}
      <div style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: 440, padding: '0 20px', animation: success ? 'loginFadeOut 0.9s ease forwards' : shake ? 'loginShakeX 0.5s ease' : 'loginSlideUp 0.7s cubic-bezier(0.22,1,0.36,1)' }}>
        {success && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 20 }}>
            <div style={{ width: 120, height: 120, borderRadius: '50%', border: '3px solid #10b981', animation: 'loginSuccessRing 0.8s ease forwards' }} />
          </div>
        )}

        <div style={{ background: 'rgba(255,255,255,0.028)', backdropFilter: 'blur(50px)', borderRadius: 28, border: '1px solid rgba(255,255,255,0.07)', padding: '48px 36px 40px', animation: 'loginGlowPulse 5s ease-in-out infinite' }}>
          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div style={{ width: 80, height: 80, margin: '0 auto 18px', borderRadius: '50%', background: 'linear-gradient(135deg,#ff5722 0%,#ff8c42 60%,#ff9800 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', boxShadow: '0 8px 40px rgba(255,87,34,0.45),0 0 0 8px rgba(255,87,34,0.06)', animation: 'loginPulse 3.5s ease-in-out infinite' }}>
              {success ? '✅' : setupMode ? '🔐' : '🔥'}
            </div>
            <h1 style={{ fontSize: '1.65rem', fontWeight: 900, background: 'linear-gradient(135deg,#ff5722 0%,#ff8c42 50%,#ffb74d 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 6, letterSpacing: '-0.02em' }}>
              {setupMode ? 'İlk Kurulum' : 'Solhan'}
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.82rem' }}>
              {fbStatus === 'connecting' ? 'Bağlanılıyor…' : fbStatus === 'error' ? statusMsg : setupMode ? 'Yönetici hesabı oluşturun' : 'Kullanıcı adı ve şifrenizle giriş yapın'}
            </p>
          </div>

          {/* Bağlanıyor animasyonu */}
          {fbStatus === 'connecting' && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
              {[0, 1, 2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', margin: '0 3px', animation: `loginFbDot 1.2s ease-in-out ${i * 0.2}s infinite` }} />)}
            </div>
          )}

          {/* Hata */}
          {fbStatus === 'error' && (
            <div style={{ marginBottom: 20, padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12 }}>
              <div style={{ color: '#f87171', fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>⚠️ Bağlantı Hatası</div>
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem' }}>Firebase'e erişilemiyor. İnternet bağlantınızı kontrol edin.</div>
            </div>
          )}

          {/* Form */}
          {(fbStatus === 'ready' || fbStatus === 'first-setup') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Kullanıcı adı */}
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 15, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.2)', fontSize: '1rem', pointerEvents: 'none' }}>👤</span>
                <input
                  ref={usernameRef}
                  className="login-input"
                  type="text"
                  value={username}
                  onChange={e => { setUsername(e.target.value); setError(''); }}
                  onKeyDown={handleKey}
                  placeholder="Kullanıcı adı"
                  autoComplete="username"
                  style={{ width: '100%', padding: '15px 16px 15px 46px', background: 'rgba(255,255,255,0.04)', border: `1.5px solid ${error ? 'rgba(239,68,68,0.45)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 14, color: '#f1f5f9', fontSize: '1rem', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>

              {/* Şifre */}
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 15, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.2)', fontSize: '1rem', pointerEvents: 'none' }}>🔒</span>
                <input
                  className="login-input"
                  type={showPass ? 'text' : 'password'}
                  value={pass}
                  onChange={e => { setPass(e.target.value); setError(''); }}
                  onKeyDown={handleKey}
                  placeholder={setupMode ? 'Şifre (min 4 karakter)' : 'Şifre'}
                  autoComplete={setupMode ? 'new-password' : 'current-password'}
                  style={{ width: '100%', padding: '15px 48px 15px 46px', background: 'rgba(255,255,255,0.04)', border: `1.5px solid ${error ? 'rgba(239,68,68,0.45)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 14, color: '#f1f5f9', fontSize: '1rem', boxSizing: 'border-box', outline: 'none' }}
                />
                <button onClick={() => setShowPass(v => !v)} style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: '1rem', padding: '4px' }}>
                  {showPass ? '🙈' : '👁️'}
                </button>
              </div>

              {/* Şifre tekrar (ilk kurulum) */}
              {setupMode && (
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 15, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.2)', fontSize: '1rem', pointerEvents: 'none' }}>🔐</span>
                  <input
                    className="login-input"
                    type={showPass ? 'text' : 'password'}
                    value={setupPass2}
                    onChange={e => { setSetupPass2(e.target.value); setError(''); }}
                    onKeyDown={handleKey}
                    placeholder="Şifreyi tekrar girin"
                    autoComplete="new-password"
                    style={{ width: '100%', padding: '15px 16px 15px 46px', background: 'rgba(255,255,255,0.04)', border: `1.5px solid ${error ? 'rgba(239,68,68,0.45)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 14, color: '#f1f5f9', fontSize: '1rem', boxSizing: 'border-box', outline: 'none' }}
                  />
                </div>
              )}

              {/* Hata mesajı */}
              {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f87171', fontSize: '0.82rem', fontWeight: 500, padding: '9px 13px', background: 'rgba(239,68,68,0.08)', borderRadius: 10, border: '1px solid rgba(239,68,68,0.15)' }}>
                  ⚠️ {error}
                </div>
              )}

              {/* Beni hatırla */}
              {!setupMode && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#ff5722', cursor: 'pointer' }} />
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.84rem' }}>Beni hatırla <span style={{ color: 'rgba(255,255,255,0.18)', fontSize: '0.74rem' }}>(30 gün)</span></span>
                </label>
              )}

              {/* Giriş butonu */}
              <button
                className="login-btn"
                onClick={setupMode ? handleFirstSetup : handleLogin}
                disabled={loading}
                style={{ width: '100%', padding: '16px 0', background: loading ? 'rgba(255,87,34,0.35)' : 'linear-gradient(135deg,#ff5722 0%,#ff6d3a 45%,#ff9800 100%)', border: 'none', borderRadius: 14, color: '#fff', fontSize: '1rem', fontWeight: 800, cursor: loading ? 'wait' : 'pointer', boxShadow: '0 6px 28px rgba(255,87,34,0.3)', transition: 'all 0.25s' }}
              >
                {loading
                  ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                      {setupMode ? 'Oluşturuluyor…' : 'Doğrulanıyor…'}
                    </span>
                  : setupMode ? '🚀 Yönetici Hesabı Oluştur' : '🚀 Giriş Yap'
                }
              </button>
            </div>
          )}

          {/* Yeniden bağlan */}
          {fbStatus === 'error' && (
            <button onClick={checkUsers} style={{ width: '100%', padding: '14px 0', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, color: '#94a3b8', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer', marginTop: 8 }}>
              🔄 Yeniden Bağlan
            </button>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 22, color: 'rgba(255,255,255,0.08)', fontSize: '0.7rem' }}>
          Solhan Ticaret &copy; {new Date().getFullYear()} · Veriler Firebase'de güvenle saklanır
        </div>
      </div>
    </div>
  );
}
