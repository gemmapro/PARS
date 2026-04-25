import { useState, useRef, useEffect } from 'react';
import ExcelImport from '@/pages/ExcelImport';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { useSoundFeedback } from '@/hooks/useSoundFeedback';
import type { SoundSettings, SoundTheme, SoundType } from '@/hooks/useSoundFeedback';
import { exportToExcel } from '@/lib/excelExport';
import type { DB } from '@/types';
import { formatDate } from '@/lib/utils-tr';
import { hashPassword as hashPass } from '@/lib/userManager';
import { loadUsers, saveUsers, createUser, updateUserPassword, toggleUserActive, deleteUser, updateUserRole, getUserSession, type AppUser, type UserRole } from '@/lib/userManager';
import { loadUIPrefs, saveUIPrefs, applyUIPrefs, THEMES, DEFAULT_PREFS, type UIPrefs } from '@/hooks/useUIPrefs';
import { loadConnConfig, saveConnConfig, testFirebase, testSupabase, DEFAULT_CONN, type ConnConfig } from '@/lib/connConfig';
import { saveBackupToFirebase } from '@/hooks/useDB';
import { mergeRestoreDB, type RestoreReport } from '@/hooks/useDB';
import { SystemMap } from '@/components/SystemMap';
import { CHANGELOG, CHANGE_TYPE_CONFIG } from '@/lib/changelog';
import { loadAppConfig, saveAppConfig, validateVersion, APP_NAME, APP_SUBTITLE } from '@/lib/appConfig';

// Firebase auth config (parola Settings'ten de değiştirilebilir)
const FIREBASE_PROJECT = 'pars-001-bae2d';
const FIREBASE_API_KEY = 'AIzaSyDxr7PNnh_-kt04sX2VcwER8coM2UWPg5k';
const FIREBASE_AUTH_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/config/auth?key=${FIREBASE_API_KEY}`;

async function fetchCurrentHash(): Promise<string | null> {
  try {
    const res = await fetch(FIREBASE_AUTH_URL, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.fields?.hash?.stringValue ?? null;
  } catch { return null; }
}

async function updateHashInFirebase(hash: string): Promise<boolean> {
  try {
    const res = await fetch(FIREBASE_AUTH_URL, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { hash: { stringValue: hash }, updatedAt: { stringValue: new Date().toISOString() } } }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch { return false; }
}

interface Props { db: DB; save: (fn: (prev: DB) => DB) => void; exportJSON: () => void; importJSON: (f: File) => Promise<boolean>; }

const TABS_LIST = [
  { id: 'arayuz', icon: '🎨', label: 'Arayüz' },
  { id: 'baglantilar', icon: '🔌', label: 'Bağlantılar' },
  { id: 'company', icon: '🏢', label: 'Şirket' },
  { id: 'categories', icon: '🏷️', label: 'Kategoriler' },
  { id: 'pellet', icon: '🪵', label: 'Pelet' },
  { id: 'sound', icon: '🔊', label: 'Ses' },
  { id: 'backup', icon: '💾', label: 'Yedek & Geri Yükleme' },
  { id: 'excel_export', icon: '📊', label: 'Excel Çıktı' },
  { id: 'activity', icon: '📋', label: 'Aktivite' },
  { id: 'shortcuts', icon: '⌨️', label: 'Kısayollar' },
  { id: 'repair', icon: '🔧', label: 'Veri Onarım' },
  { id: 'excel', icon: '📥', label: 'Excel İçe Aktar' },
  { id: 'data', icon: '🗄️', label: 'Veri Yönetimi' },
  { id: 'security', icon: '🔐', label: 'Güvenlik' },
  { id: 'sysmap', icon: '🗺️', label: 'Sistem Haritası' },
  { id: 'about', icon: 'ℹ️', label: 'Hakkında' },
] as const;

function loadSoundSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem('sobaYonetim');
    if (!raw) return { enabled: true, volume: 0.5, theme: 'standart' };
    const parsed = JSON.parse(raw);
    return { enabled: true, volume: 0.5, theme: 'standart', ...(parsed.soundSettings || {}) };
  } catch {
    return { enabled: true, volume: 0.5, theme: 'standart' };
  }
}

function saveSoundSettingsToStorage(settings: SoundSettings) {
  try {
    const raw = localStorage.getItem('sobaYonetim');
    const parsed = raw ? JSON.parse(raw) : {};
    parsed.soundSettings = settings;
    localStorage.setItem('sobaYonetim', JSON.stringify(parsed));
  } catch {}
}

export default function Settings({ db, save, exportJSON, importJSON }: Props) {
  const { showToast: _showToast } = useToast();
  const showToast = _showToast as (m: string, t?: string) => void;
  const { showConfirm } = useConfirm();
  const { playSound } = useSoundFeedback();
  const [company, setCompany] = useState(() => {
    // db.company boşsa db.settings'den doldur (setup wizard buraya yazar)
    const s = db.settings as Record<string, string> | undefined;
    return {
      ...db.company,
      name: db.company.name || s?.companyName || '',
      city: (db.company as any).city || s?.city || '',
    };
  });
  const [pellet, setPellet] = useState({ ...db.pelletSettings });
  const [tab, setTab] = useState<Tab>('arayuz');
  const [uiPrefs, setUiPrefs] = useState<UIPrefs>(loadUIPrefs);
  const [connCfg, setConnCfg] = useState<ConnConfig>(loadConnConfig);

  const saveCompany = () => {
    save(prev => ({
      ...prev,
      company: { ...company, id: prev.company.id, createdAt: prev.company.createdAt },
      settings: { ...prev.settings, companyName: company.name, city: (company as any).city || '' },
    }));
    showToast('Şirket bilgileri kaydedildi!', 'success');
  };

  const savePellet = () => {
    save(prev => ({ ...prev, pelletSettings: { ...pellet } }));
    showToast('Pelet ayarları kaydedildi!', 'success');
  };

  const clearData = () => {
    showConfirm('Tüm Verileri Sil', 'TÜM verileriniz kalıcı olarak silinecek! Bu işlem geri alınamaz. Emin misiniz?', () => {
      localStorage.removeItem('sobaYonetim');
      window.location.reload();
    }, true);
  };

  const dataStats = [
    { label: 'Ürünler', count: db.products.length, icon: '📦' },
    { label: 'Satışlar', count: db.sales.length, icon: '🛒' },
    { label: 'Tedarikçiler', count: db.suppliers.length, icon: '🏭' },
    { label: 'Cari Hesaplar', count: db.cari.length, icon: '👤' },
    { label: 'Kasa İşlemleri', count: db.kasa.length, icon: '💰' },
    { label: 'Banka İşlemleri', count: db.bankTransactions.length, icon: '🏦' },
    { label: 'Pelet Tedarikçi', count: db.peletSuppliers.length, icon: '🪵' },
    { label: 'Boru Tedarikçi', count: db.boruSuppliers.length, icon: '🔩' },
  ];

  const totalRecords = dataStats.reduce((s, d) => s + d.count, 0);

  const shortcuts = [
    { key: 'Ctrl + 1', desc: 'Özet (Dashboard)' },
    { key: 'Ctrl + 2', desc: 'Ürünler' },
    { key: 'Ctrl + 3', desc: 'Satış' },
    { key: 'Ctrl + 4', desc: 'Kasa' },
    { key: 'Ctrl + 5', desc: 'Raporlar' },
    { key: '+ Butonu', desc: 'Hızlı Eylem Menüsü (sağ alt)' },
    { key: 'Ctrl + Z', desc: 'Geri Al (tarayıcı düzeyi)' },
  ];

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 24, flexWrap: 'wrap', background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 6, width: 'fit-content' }}>
        {TABS_LIST.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '8px 16px', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem', background: tab === t.id ? 'linear-gradient(135deg, #ff5722, #ff7043)' : 'transparent', color: tab === t.id ? '#fff' : '#64748b', boxShadow: tab === t.id ? '0 4px 12px rgba(255,87,34,0.3)' : 'none', transition: 'all 0.15s' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'arayuz' && (
        <ArayuzAyarlari prefs={uiPrefs} onChange={p => { setUiPrefs(p); saveUIPrefs(p); applyUIPrefs(p); }} showToast={showToast} />
      )}

      {tab === 'baglantilar' && (
        <BaglantiAyarlari
          cfg={connCfg}
          onChange={c => { setConnCfg(c); saveConnConfig(c); }}
          showToast={showToast}
        />
      )}

      {tab === 'company' && (
        <Card title="🏢 Şirket Bilgileri">
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FV label="Şirket Adı" value={company.name || ''} onChange={v => setCompany(c => ({ ...c, name: v }))} />
              <FV label="Şehir" value={(company as any).city || ''} onChange={v => setCompany(c => ({ ...c, city: v } as any))} />
              <FV label="Vergi No" value={company.taxNo || ''} onChange={v => setCompany(c => ({ ...c, taxNo: v }))} />
              <FV label="Telefon" value={company.phone || ''} onChange={v => setCompany(c => ({ ...c, phone: v }))} />
              <FV label="E-posta" type="email" value={company.email || ''} onChange={v => setCompany(c => ({ ...c, email: v }))} />
            </div>
            <div><label style={lbl}>Adres</label><textarea value={company.address || ''} onChange={e => setCompany(c => ({ ...c, address: e.target.value }))} style={{ ...inp, minHeight: 70 }} /></div>
            <button onClick={saveCompany} style={btnPrimary}>💾 Şirket Bilgilerini Kaydet</button>
          </div>
        </Card>
      )}

      {tab === 'pellet' && (
        <Card title="🪵 Pelet Ayarları">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <FV label="Gramaj (gr/torba)" type="number" inputMode="decimal" value={String(pellet.gramaj)} onChange={v => setPellet(p => ({ ...p, gramaj: parseFloat(v) || 0 }))} />
            <FV label="Kg Fiyatı (₺)" type="number" inputMode="decimal" value={String(pellet.kgFiyat)} onChange={v => setPellet(p => ({ ...p, kgFiyat: parseFloat(v) || 0 }))} />
            <FV label="Çuval Kg" type="number" inputMode="decimal" value={String(pellet.cuvalKg)} onChange={v => setPellet(p => ({ ...p, cuvalKg: parseFloat(v) || 0 }))} />
            <FV label="Kritik Gün Sayısı" type="number" inputMode="decimal" value={String(pellet.critDays)} onChange={v => setPellet(p => ({ ...p, critDays: parseInt(v) || 0 }))} />
          </div>
          <div style={{ marginTop: 14, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 10, padding: '12px 16px', color: '#94a3b8', fontSize: '0.85rem' }}>
            💡 Mevcut değerler: {pellet.cuvalKg}kg çuval · ₺{pellet.kgFiyat}/kg · {pellet.gramaj}gr/torba
          </div>
          <button onClick={savePellet} style={{ ...btnPrimary, marginTop: 16 }}>💾 Pelet Ayarlarını Kaydet</button>
        </Card>
      )}

      {tab === 'sound' && (
        <SoundSettings playSound={playSound} />
      )}

      {tab === 'backup' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <Card title="📤 Yedek Al">
            <p style={{ color: '#64748b', fontSize: '0.88rem', marginBottom: 16, lineHeight: 1.6 }}>Tüm verilerinizi <strong style={{ color: '#f59e0b' }}>JSON formatında</strong> dışa aktarın.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
              {dataStats.slice(0, 4).map(d => (
                <div key={d.label} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.2rem', marginBottom: 4 }}>{d.icon}</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f1f5f9' }}>{d.count}</div>
                  <div style={{ color: '#334155', fontSize: '0.72rem' }}>{d.label}</div>
                </div>
              ))}
            </div>
            <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 10, padding: '10px 16px', marginBottom: 16, color: '#10b981', fontSize: '0.85rem', fontWeight: 600 }}>
              Toplam {totalRecords} kayıt yedeklenecek
            </div>
            <button onClick={exportJSON} style={{ ...btnPrimary, background: 'linear-gradient(135deg, #059669, #10b981)' }}>
              Yedeği İndir (.json)
            </button>
          </Card>

          <FullRestorePanel showToast={showToast} showConfirm={showConfirm as (t: string, m: string, ok: () => void, d?: boolean) => void} save={save} db={db} />

          <SelectiveRestore showToast={showToast} showConfirm={showConfirm as (t: string, m: string, ok: () => void, d?: boolean) => void} save={save} db={db} />

          <SmartImportManager db={db} save={save} showToast={showToast} showConfirm={showConfirm as (t: string, m: string, ok: () => void, d?: boolean) => void} />
        </div>
      )}

      {tab === 'excel_export' && (
        <ExcelExportPanel db={db} />
      )}

      {tab === 'activity' && (
        <ActivityPanel db={db} save={save} showToast={showToast} showConfirm={showConfirm as (t: string, m: string, ok: () => void, d?: boolean) => void} />
      )}

      {tab === 'shortcuts' && (
        <Card title="⌨️ Klavye Kısayolları">
          <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: 16 }}>Uygulamayı daha hızlı kullanmak için aşağıdaki kısayolları kullanabilirsiniz.</p>
          <div style={{ display: 'grid', gap: 8 }}>
            {shortcuts.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 16px', background: 'rgba(0,0,0,0.2)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.04)' }}>
                <kbd style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '4px 10px', fontSize: '0.82rem', fontFamily: 'monospace', color: '#f59e0b', fontWeight: 700, whiteSpace: 'nowrap', boxShadow: '0 2px 0 rgba(0,0,0,0.4)' }}>{s.key}</kbd>
                <span style={{ color: '#94a3b8', fontSize: '0.88rem' }}>{s.desc}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'repair' && (
        <VeriOnarim db={db} save={save} showToast={showToast} showConfirm={showConfirm as (title: string, msg: string, onOk: () => void, danger?: boolean) => void} />
      )}

      {tab === 'excel' && (
        <ExcelImport db={db} save={save} />
      )}

      {tab === 'categories' && (
        <KategoriYonetim db={db} save={save} />
      )}

      {tab === 'data' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <Card title="🗄️ Veri İstatistikleri">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
              {dataStats.map(d => (
                <div key={d.label} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.4rem', marginBottom: 4 }}>{d.icon}</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 900, color: d.count > 0 ? '#f1f5f9' : '#334155' }}>{d.count}</div>
                  <div style={{ color: '#334155', fontSize: '0.72rem', marginTop: 2 }}>{d.label}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, textAlign: 'center', color: '#475569', fontSize: '0.85rem' }}>
              Toplam <strong style={{ color: '#f1f5f9' }}>{totalRecords}</strong> kayıt · localStorage'da saklanıyor
            </div>
          </Card>

          <Card title="🗑️ Tehlikeli Alan">
            <p style={{ color: '#64748b', fontSize: '0.88rem', marginBottom: 16, lineHeight: 1.6 }}>Aşağıdaki işlemler <strong style={{ color: '#ef4444' }}>geri alınamaz</strong>. Önce yedek almanızı şiddetle tavsiye ederiz.</p>
            <div style={{ display: 'grid', gap: 10 }}>
              <DangerAction label="Satış Geçmişini Temizle" desc={`${db.sales.length} satış kaydı silinecek`} onConfirm={() => { save(prev => ({ ...prev, sales: [] })); showToast('Satış geçmişi temizlendi!'); }} />
              <DangerAction label="Kasa İşlemlerini Temizle" desc={`${db.kasa.length} kasa kaydı silinecek`} onConfirm={() => { save(prev => ({ ...prev, kasa: [] })); showToast('Kasa temizlendi!'); }} />
              <DangerAction label="Aktivite Günlüğünü Temizle" desc={`${db._activityLog.length} kayıt silinecek`} onConfirm={() => { save(prev => ({ ...prev, _activityLog: [] })); showToast('Aktivite günlüğü temizlendi!'); }} />
              <button onClick={clearData} style={{ width: '100%', padding: '14px 0', background: 'linear-gradient(135deg, rgba(220,38,38,0.15), rgba(239,68,68,0.08))', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, color: '#ef4444', fontWeight: 800, cursor: 'pointer', fontSize: '0.95rem' }}>
                ☠️ TÜM VERİLERİ SİL ve Sıfırla
              </button>
            </div>
          </Card>
        </div>
      )}

      {tab === 'security' && (
        <SecurityPanel showToast={showToast} />
      )}

      {tab === 'sysmap' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <Card title="🗺️ Sistem Haritası — Modüller Arası İlişkiler">
            <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: 14, lineHeight: 1.6 }}>
              Her modülün diğer modülleri nasıl etkilediğini gösteren akış diyagramı.
              Düz çizgi = doğrudan veri etkisi, kesik çizgi = veri sağlar.
            </p>
            <SystemMap />
          </Card>
        </div>
      )}

      {tab === 'about' && (
        <AboutPanel db={db} />
      )}
    </div>
  );
}

function SecurityPanel({ showToast }: { showToast: (msg: string, type?: 'success' | 'error' | 'info') => void }) {
  const [oldPass, setOldPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newPass2, setNewPass2] = useState('');
  const [loading, setLoading] = useState(false);
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const session = getUserSession();

  const handleChange = async () => {
    if (!oldPass) { showToast('Mevcut parolayı girin!', 'error'); return; }
    if (newPass.length < 4) { showToast('Yeni parola en az 4 karakter olmalı!', 'error'); return; }
    if (newPass !== newPass2) { showToast('Yeni parolalar eşleşmiyor!', 'error'); return; }
    if (!session) { showToast('Oturum bulunamadı!', 'error'); return; }
    setLoading(true);
    const users = await loadUsers();
    const me = users.find(u => u.id === session.userId);
    if (!me) { showToast('Kullanıcı bulunamadı!', 'error'); setLoading(false); return; }
    const oldHash = await hashPass(oldPass);
    if (oldHash !== me.passwordHash) {
      showToast('Mevcut parola yanlış!', 'error');
      setOldPass(''); setLoading(false); return;
    }
    const ok = await updateUserPassword(session.userId, newPass);
    if (ok) {
      setOldPass(''); setNewPass(''); setNewPass2('');
      showToast('Parola başarıyla güncellendi!', 'success');
    } else {
      showToast('Firebase kayıt hatası!', 'error');
    }
    setLoading(false);
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Card title="🔐 Şifremi Değiştir">
        <div style={{ display: 'grid', gap: 14, maxWidth: 380 }}>
          {session && <div style={{ padding: '8px 12px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, fontSize: '0.82rem', color: '#a5b4fc' }}>
            👤 Giriş yapan: <strong>{session.username}</strong> ({session.role === 'admin' ? 'Yönetici' : 'Kullanıcı'})
          </div>}
          <div>
            <label style={lbl}>Mevcut Parola</label>
            <div style={{ position: 'relative' }}>
              <input type={showOld ? 'text' : 'password'} value={oldPass} onChange={e => setOldPass(e.target.value)} placeholder="Mevcut parolanız" style={{ ...inp, paddingRight: 44 }} />
              <button onClick={() => setShowOld(p => !p)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '0.9rem' }}>{showOld ? '🙈' : '👁️'}</button>
            </div>
          </div>
          <div>
            <label style={lbl}>Yeni Parola</label>
            <div style={{ position: 'relative' }}>
              <input type={showNew ? 'text' : 'password'} value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="En az 4 karakter" style={{ ...inp, paddingRight: 44 }} />
              <button onClick={() => setShowNew(p => !p)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '0.9rem' }}>{showNew ? '🙈' : '👁️'}</button>
            </div>
          </div>
          <div>
            <label style={lbl}>Yeni Parola (Tekrar)</label>
            <input type={showNew ? 'text' : 'password'} value={newPass2} onChange={e => setNewPass2(e.target.value)} placeholder="Yeni parolayı tekrar girin" style={inp} onKeyDown={e => e.key === 'Enter' && handleChange()} />
          </div>
          <button onClick={handleChange} disabled={loading} style={btnPrimary}>
            {loading ? '⏳ Değiştiriliyor...' : '🔐 Parolayı Değiştir'}
          </button>
        </div>
      </Card>

      {/* Yönetici Paneli — sadece admin görür */}
      {session?.role === 'admin' && <AdminPanel showToast={showToast} />}
    </div>
  );
}

// ── Yönetici Paneli ────────────────────────────────────────────────────────
function AdminPanel({ showToast }: { showToast: (msg: string, type?: 'success' | 'error' | 'info') => void }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUsername, setNewUsername] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('user');
  const [resetPassId, setResetPassId] = useState<string | null>(null);
  const [resetPassVal, setResetPassVal] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setUsers(await loadUsers());
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const handleCreate = async () => {
    if (!newUsername.trim()) { showToast('Kullanıcı adı gerekli!', 'error'); return; }
    if (newPass.length < 4) { showToast('Şifre en az 4 karakter!', 'error'); return; }
    setSaving(true);
    const result = await createUser(newUsername.trim(), newPass, newRole);
    if (result.ok) {
      showToast(`✅ ${newUsername} oluşturuldu`, 'success');
      setNewUsername(''); setNewPass('');
      await refresh();
    } else {
      showToast(result.msg, 'error');
    }
    setSaving(false);
  };

  const handleToggle = async (userId: string, username: string, active: boolean) => {
    await toggleUserActive(userId);
    showToast(`${username} ${active ? 'devre dışı bırakıldı' : 'aktif edildi'}`, 'info');
    await refresh();
  };

  const handleDelete = async (userId: string, username: string) => {
    if (!confirm(`"${username}" kullanıcısını silmek istediğinizden emin misiniz?`)) return;
    await deleteUser(userId);
    showToast(`${username} silindi`, 'info');
    await refresh();
  };

  const handleRoleChange = async (userId: string, role: UserRole) => {
    await updateUserRole(userId, role);
    showToast('Rol güncellendi', 'success');
    await refresh();
  };

  const handleResetPass = async (userId: string) => {
    if (resetPassVal.length < 4) { showToast('Şifre en az 4 karakter!', 'error'); return; }
    await updateUserPassword(userId, resetPassVal);
    showToast('Şifre sıfırlandı', 'success');
    setResetPassId(null); setResetPassVal('');
    await refresh();
  };

  const roleColors: Record<UserRole, string> = { admin: '#f59e0b', user: '#60a5fa' };

  return (
    <Card title="👥 Kullanıcı Yönetimi">
      {/* Yeni kullanıcı ekle */}
      <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: '16px', marginBottom: 18 }}>
        <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.88rem', marginBottom: 12 }}>➕ Yeni Kullanıcı Ekle</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <label style={lbl}>Kullanıcı Adı *</label>
            <input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="kullanici_adi" style={inp} />
          </div>
          <div>
            <label style={lbl}>Şifre *</label>
            <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="Min. 4 karakter" style={inp} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Rol</label>
            <select value={newRole} onChange={e => setNewRole(e.target.value as UserRole)} style={inp}>
              <option value="user">👤 Kullanıcı</option>
              <option value="admin">⭐ Yönetici</option>
            </select>
          </div>
          <button onClick={handleCreate} disabled={saving} style={{ ...btnPrimary, flex: 1 }}>
            {saving ? '...' : '➕ Ekle'}
          </button>
        </div>
      </div>

      {/* Kullanıcı listesi */}
      {loading ? (
        <div style={{ color: '#475569', fontSize: '0.85rem', textAlign: 'center', padding: '20px 0' }}>Yükleniyor...</div>
      ) : users.length === 0 ? (
        <div style={{ color: '#475569', fontSize: '0.85rem', textAlign: 'center', padding: '20px 0' }}>Kullanıcı bulunamadı</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {users.map(u => (
            <div key={u.id} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: '12px 14px', border: `1px solid ${u.active ? 'rgba(255,255,255,0.06)' : 'rgba(239,68,68,0.15)'}`, opacity: u.active ? 1 : 0.6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: resetPassId === u.id ? 10 : 0 }}>
                {/* Avatar */}
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: `${roleColors[u.role]}20`, border: `2px solid ${roleColors[u.role]}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 }}>
                  {u.role === 'admin' ? '⭐' : '👤'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.88rem' }}>{u.username}</div>
                  <div style={{ fontSize: '0.72rem', color: '#475569' }}>
                    {u.lastLogin ? `Son giriş: ${new Date(u.lastLogin).toLocaleString('tr-TR')}` : 'Hiç giriş yapılmadı'}
                  </div>
                </div>
                {/* Rol seçici */}
                <select
                  value={u.role}
                  onChange={e => handleRoleChange(u.id, e.target.value as UserRole)}
                  style={{ padding: '4px 8px', background: `${roleColors[u.role]}15`, border: `1px solid ${roleColors[u.role]}30`, borderRadius: 7, color: roleColors[u.role], fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  <option value="user">Kullanıcı</option>
                  <option value="admin">Yönetici</option>
                </select>
                {/* Şifre sıfırla */}
                <button
                  onClick={() => { setResetPassId(resetPassId === u.id ? null : u.id); setResetPassVal(''); }}
                  title="Şifre Sıfırla"
                  style={{ padding: '5px 9px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, color: '#f59e0b', cursor: 'pointer', fontSize: '0.8rem' }}
                >🔑</button>
                {/* Aktif/Pasif */}
                <button
                  onClick={() => handleToggle(u.id, u.username, u.active)}
                  title={u.active ? 'Devre Dışı Bırak' : 'Aktif Et'}
                  style={{ padding: '5px 9px', background: u.active ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${u.active ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`, borderRadius: 8, color: u.active ? '#10b981' : '#ef4444', cursor: 'pointer', fontSize: '0.8rem' }}
                >{u.active ? '✓' : '✕'}</button>
                {/* Sil */}
                <button
                  onClick={() => handleDelete(u.id, u.username)}
                  title="Kullanıcıyı Sil"
                  style={{ padding: '5px 9px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, color: '#ef4444', cursor: 'pointer', fontSize: '0.8rem' }}
                >🗑️</button>
              </div>
              {/* Şifre sıfırlama alanı */}
              {resetPassId === u.id && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input
                    type="password"
                    value={resetPassVal}
                    onChange={e => setResetPassVal(e.target.value)}
                    placeholder="Yeni şifre (min 4 karakter)"
                    style={{ ...inp, flex: 1 }}
                    autoFocus
                  />
                  <button onClick={() => handleResetPass(u.id)} style={{ padding: '8px 14px', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, color: '#f59e0b', fontWeight: 700, cursor: 'pointer', fontSize: '0.82rem' }}>
                    Kaydet
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SoundSettings({ playSound }: { playSound: (type: SoundType) => void }) {
  const [settings, setSettings] = useState<SoundSettings>(loadSoundSettings);
  const [speechEnabled, setSpeechEnabled] = useState<boolean>(() => {
    try {
      const d = JSON.parse(localStorage.getItem('sobaYonetim') || '{}');
      return d.soundSettings?.speechEnabled !== false;
    } catch { return true; }
  });

  const updateSettings = (patch: Partial<SoundSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSoundSettingsToStorage(next);
  };

  const toggleSpeech = () => {
    const next = !speechEnabled;
    setSpeechEnabled(next);
    const key = 'sobaYonetim';
    const raw = localStorage.getItem(key);
    const data = raw ? JSON.parse(raw) : {};
    data.soundSettings = { ...(data.soundSettings || {}), speechEnabled: next };
    localStorage.setItem(key, JSON.stringify(data));
    if (next && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance('Sesli bildirim aktif edildi');
      u.lang = 'tr-TR';
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    }
  };

  const themes: { id: SoundTheme; label: string; desc: string }[] = [
    { id: 'standart', label: '🎵 Standart', desc: 'Dengeli ve sade sesler' },
    { id: 'minimal', label: '🔇 Minimal', desc: 'Kısa ve hafif sesler' },
    { id: 'yogun', label: '🔊 Yoğun', desc: 'Belirgin ve güçlü sesler' },
  ];

  const soundTypes: { type: SoundType; label: string }[] = [
    { type: 'success', label: '✅ Başarı' },
    { type: 'error', label: '❌ Hata' },
    { type: 'warning', label: '⚠️ Uyarı' },
    { type: 'sale', label: '🛒 Satış' },
    { type: 'notification', label: '🔔 Bildirim' },
  ];

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Card title="🔊 Ses Ayarları">
        <div style={{ display: 'grid', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.95rem' }}>Sesli Geri Bildirim</div>
              <div style={{ color: '#64748b', fontSize: '0.82rem', marginTop: 2 }}>İşlem seslerini açın veya kapatın</div>
            </div>
            <button
              onClick={() => updateSettings({ enabled: !settings.enabled })}
              style={{ width: 52, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer', position: 'relative', background: settings.enabled ? '#10b981' : '#334155', transition: 'background 0.2s' }}
            >
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', position: 'absolute', top: 4, left: settings.enabled ? 28 : 4, transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
            </button>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <label style={lbl}>Ses Seviyesi</label>
              <span style={{ color: '#ff7043', fontWeight: 700, fontSize: '0.85rem' }}>{Math.round(settings.volume * 100)}%</span>
            </div>
            <input
              type="range" min={0} max={1} step={0.05}
              value={settings.volume}
              onChange={e => updateSettings({ volume: parseFloat(e.target.value) })}
              style={{ width: '100%', accentColor: '#ff5722' }}
              disabled={!settings.enabled}
            />
          </div>

          <div>
            <label style={lbl}>Ses Teması</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              {themes.map(t => (
                <button
                  key={t.id}
                  onClick={() => updateSettings({ theme: t.id })}
                  disabled={!settings.enabled}
                  style={{ padding: '12px 10px', border: `2px solid ${settings.theme === t.id ? '#ff5722' : 'rgba(255,255,255,0.08)'}`, borderRadius: 10, cursor: 'pointer', background: settings.theme === t.id ? 'rgba(255,87,34,0.1)' : 'rgba(0,0,0,0.2)', color: settings.theme === t.id ? '#ff7043' : '#64748b', textAlign: 'center', transition: 'all 0.15s', opacity: settings.enabled ? 1 : 0.5 }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{t.label}</div>
                  <div style={{ fontSize: '0.72rem', marginTop: 4, color: settings.theme === t.id ? '#ff7043' : '#475569' }}>{t.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card title="🗣️ Sesli Konuşma (TTS)">
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.95rem' }}>Sesli Bildirim</div>
              <div style={{ color: '#64748b', fontSize: '0.82rem', marginTop: 2 }}>Hata ve uyarılarda sesli konuşma</div>
            </div>
            <button
              onClick={toggleSpeech}
              style={{ width: 52, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer', position: 'relative', background: speechEnabled ? '#10b981' : '#334155', transition: 'background 0.2s' }}
            >
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', position: 'absolute', top: 4, left: speechEnabled ? 28 : 4, transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
            </button>
          </div>
          <button
            onClick={() => {
              if ('speechSynthesis' in window) {
                const u = new SpeechSynthesisUtterance('Merhaba! Bu bir test konuşmasıdır. Önemli bildirimlerde sesli uyarı alacaksınız.');
                u.lang = 'tr-TR';
                u.rate = 1.05;
                window.speechSynthesis.speak(u);
              }
            }}
            style={{ padding: '10px 14px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, cursor: 'pointer', background: 'rgba(0,0,0,0.3)', color: '#94a3b8', fontWeight: 600, fontSize: '0.85rem' }}
          >
            🗣️ Test Konuşma
          </button>
        </div>
      </Card>

      <Card title="🎧 Sesleri Dinle">
        <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: 14 }}>Her ses tipini aşağıdan test edebilirsiniz.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          {soundTypes.map(s => (
            <button
              key={s.type}
              onClick={() => playSound(s.type)}
              disabled={!settings.enabled}
              style={{ padding: '10px 14px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, cursor: 'pointer', background: 'rgba(0,0,0,0.3)', color: '#94a3b8', fontWeight: 600, fontSize: '0.85rem', transition: 'all 0.15s', opacity: settings.enabled ? 1 : 0.5 }}
              onMouseEnter={e => { if (settings.enabled) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,87,34,0.1)'; }}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.3)'}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function ExcelExportPanel({ db }: { db: DB }) {
  const { showToast } = useToast();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sheets, setSheets] = useState({ stok: true, satislar: true, cari: true, kasa: true });

  type SheetKey = keyof typeof sheets;

  const toggleSheet = (key: SheetKey) => setSheets(s => ({ ...s, [key]: !s[key] }));

  const handleExport = () => {
    const selectedSheets = (Object.keys(sheets) as SheetKey[]).filter(k => sheets[k]) as ('stok' | 'satislar' | 'cari' | 'kasa')[];
    if (selectedSheets.length === 0) { showToast('En az bir sekme seçin!', 'warning'); return; }
    try {
      exportToExcel(db, { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, sheets: selectedSheets });
      showToast(`Excel dosyası oluşturuldu! (${selectedSheets.length} sekme)`, 'success');
    } catch (e) {
      showToast('Excel oluşturulamadı!', 'error');
    }
  };

  const sheetDefs: { key: SheetKey; label: string; icon: string; count: number }[] = [
    { key: 'stok', label: 'Stok / Ürünler', icon: '📦', count: db.products.length },
    { key: 'satislar', label: 'Satışlar', icon: '🛒', count: db.sales.length },
    { key: 'cari', label: 'Cari Hesaplar', icon: '👤', count: db.cari.length },
    { key: 'kasa', label: 'Kasa İşlemleri', icon: '💰', count: db.kasa.length },
  ];

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Card title="📊 Excel Dışa Aktarma">
        <p style={{ color: '#64748b', fontSize: '0.88rem', marginBottom: 16, lineHeight: 1.6 }}>
          Seçtiğiniz veri gruplarını Türkçe başlıklı, tarih ve para birimi formatlarıyla <strong style={{ color: '#10b981' }}>.xlsx</strong> dosyasına aktarın.
        </p>

        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>Tarih Aralığı (Satış ve Kasa için)</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ ...lbl, fontSize: '0.78rem' }}>Başlangıç</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inp} />
            </div>
            <div>
              <label style={{ ...lbl, fontSize: '0.78rem' }}>Bitiş</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inp} />
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>Dahil Edilecek Sayfalar</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
            {sheetDefs.map(s => (
              <div
                key={s.key}
                onClick={() => toggleSheet(s.key)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: sheets[s.key] ? 'rgba(16,185,129,0.08)' : 'rgba(0,0,0,0.2)', border: `2px solid ${sheets[s.key] ? '#10b981' : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s' }}
              >
                <span style={{ fontSize: '1.2rem' }}>{s.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: sheets[s.key] ? '#f1f5f9' : '#64748b', fontSize: '0.88rem' }}>{s.label}</div>
                  <div style={{ color: '#475569', fontSize: '0.75rem' }}>{s.count} kayıt</div>
                </div>
                <div style={{ width: 20, height: 20, borderRadius: 5, background: sheets[s.key] ? '#10b981' : 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.75rem', fontWeight: 800 }}>
                  {sheets[s.key] ? '✓' : ''}
                </div>
              </div>
            ))}
          </div>
        </div>

        <button onClick={handleExport} style={{ ...btnPrimary, background: 'linear-gradient(135deg, #059669, #10b981)' }}>
          📊 Excel Dosyasını İndir (.xlsx)
        </button>
      </Card>
    </div>
  );
}

function ActivityPanel({ db, save, showToast, showConfirm }: {
  db: DB;
  save: (fn: (prev: DB) => DB) => void;
  showToast: (m: string, t?: string) => void;
  showConfirm: (t: string, m: string, ok: () => void, d?: boolean) => void;
}) {
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');

  const activityLog = [...(db._activityLog || [])].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  const actionTypes = Array.from(new Set(activityLog.map(a => {
    const parts = a.action.split(':');
    return parts[0].trim();
  }))).slice(0, 15);

  let filtered = activityLog;
  if (typeFilter !== 'all') filtered = filtered.filter(a => a.action.startsWith(typeFilter));
  if (dateFilter) filtered = filtered.filter(a => a.time.startsWith(dateFilter));

  const getIcon = (action: string) => {
    const a = action.toLowerCase();
    if (a.includes('satış') || a.includes('satis')) return '🛒';
    if (a.includes('ürün') || a.includes('urun') || a.includes('stok')) return '📦';
    if (a.includes('kasa') || a.includes('gelir') || a.includes('gider')) return '💰';
    if (a.includes('cari') || a.includes('müşteri')) return '👤';
    if (a.includes('fatura')) return '🧾';
    if (a.includes('sipariş')) return '📋';
    if (a.includes('sil') || a.includes('iptal')) return '🗑️';
    return '📝';
  };

  const clearLog = () => {
    showConfirm('Aktivite Günlüğünü Temizle', `${db._activityLog.length} kayıt silinecek. Devam edilsin mi?`, () => {
      save(prev => ({ ...prev, _activityLog: [] }));
      showToast('Aktivite günlüğü temizlendi!');
    }, true);
  };

  return (
    <Card title="📋 Aktivite Günlüğü">
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} style={{ ...inp, width: 160 }} placeholder="Tarih filtrele" />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ ...inp, flex: 1 }}>
          <option value="all">Tüm İşlemler</option>
          {actionTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {dateFilter && <button onClick={() => setDateFilter('')} style={{ padding: '9px 12px', background: '#334155', border: 'none', borderRadius: 8, color: '#94a3b8', cursor: 'pointer', fontSize: '0.82rem' }}>✕ Tarih</button>}
        <button onClick={clearLog} style={{ padding: '9px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, color: '#f87171', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>🗑️ Temizle</button>
      </div>

      <div style={{ color: '#475569', fontSize: '0.8rem', marginBottom: 10 }}>{filtered.length} kayıt (toplam {activityLog.length})</div>

      <div style={{ display: 'grid', gap: 6, maxHeight: 500, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#334155' }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>📋</div>
            <p>Aktivite bulunamadı</p>
          </div>
        ) : filtered.map(a => (
          <div key={a.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 14px', background: 'rgba(0,0,0,0.2)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,87,34,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '0.9rem' }}>
              {getIcon(a.action)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '0.85rem' }}>{a.action}</div>
              {a.detail && <div style={{ color: '#64748b', fontSize: '0.78rem', marginTop: 2 }}>{a.detail}</div>}
            </div>
            <div style={{ color: '#334155', fontSize: '0.75rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {formatDate(a.time)}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

const RESTORE_SECTIONS = [
  { key: 'products', label: 'Ürünler', icon: '📦' },
  { key: 'sales', label: 'Satışlar', icon: '🛒' },
  { key: 'suppliers', label: 'Tedarikçiler', icon: '🏭' },
  { key: 'cari', label: 'Cari Hesaplar', icon: '👤' },
  { key: 'kasa', label: 'Kasa İşlemleri', icon: '💰' },
  { key: 'bankTransactions', label: 'Banka İşlemleri', icon: '🏦' },
  { key: 'invoices', label: 'Faturalar', icon: '🧾' },
  { key: 'orders', label: 'Siparişler', icon: '📋' },
  { key: 'stockMovements', label: 'Stok Hareketleri', icon: '📊' },
  { key: 'peletSuppliers', label: 'Pelet Tedarikçi', icon: '🪵' },
  { key: 'peletOrders', label: 'Pelet Sipariş', icon: '🪵' },
  { key: 'boruSuppliers', label: 'Boru Tedarikçi', icon: '🔩' },
  { key: 'boruOrders', label: 'Boru Sipariş', icon: '🔩' },
  { key: 'budgets', label: 'Bütçe', icon: '📊' },
  { key: 'returns', label: 'İadeler', icon: '↩️' },
  { key: 'company', label: 'Şirket Bilgileri', icon: '🏢', isObject: true },
  { key: 'pelletSettings', label: 'Pelet Ayarları', icon: '⚙️', isObject: true },
] as const;

// ── Tam Geri Yükleme Paneli ────────────────────────────────────────────────
function FullRestorePanel({ showToast, showConfirm, save, db }: {
  showToast: (m: string, t?: string) => void;
  showConfirm: (t: string, m: string, ok: () => void, d?: boolean) => void;
  save: (fn: (prev: DB) => DB) => void;
  db: DB;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [lastReport, setLastReport] = useState<RestoreReport | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileRef.current) fileRef.current.value = '';

    showConfirm(
      '⚠️ Tam Geri Yükleme',
      `"${file.name}" dosyasındaki veriler yükleniyor. Mevcut tüm veriler bu yedekle değiştirilecek. Önceki veri otomatik yedeklenir. Devam edilsin mi?`,
      () => {
        // Önce mevcut veriyi yedekle
        saveBackupToFirebase(db, `onceki_${new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')}`).catch(() => {});

        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const raw = JSON.parse(ev.target?.result as string) as DB;
            // fullRestoreDB'yi doğrudan import etmek yerine save içinde çağırıyoruz
            save(prev => {
              // makeDefaultDB'ye erişim yok burada — prev'i default olarak kullan
              const def = { ...prev };
              // Temel yapıyı koru, yedekteki veriyi üzerine yaz
              const merged: DB = { ...def, ...raw };
              // Zorunlu array alanları
              const arrayKeys = ['products','sales','suppliers','orders','cari','kasa','bankTransactions',
                'matchRules','monitorRules','monitorLog','stockMovements','peletSuppliers','peletOrders',
                'boruSuppliers','boruOrders','invoices','budgets','returns','_activityLog',
                'ortakEmanetler','installments','partners','notes'] as const;
              for (const key of arrayKeys) {
                if (!Array.isArray(merged[key])) (merged as Record<string, unknown>)[key] = [];
              }
              if (!merged.kasalar || merged.kasalar.length === 0) merged.kasalar = def.kasalar;
              if (!merged.company || typeof merged.company !== 'object') merged.company = def.company;
              if (!merged.pelletSettings) merged.pelletSettings = def.pelletSettings;
              if (!Array.isArray(merged.productCategories) || merged.productCategories.length === 0) merged.productCategories = def.productCategories;
              return merged;
            });

            const report: RestoreReport = { added: 0, skippedDuplicate: 0, skippedInvalidName: 0, skippedMissingField: 0, warnings: [] };
            // Ad kalite kontrolü raporu
            (raw.cari || []).forEach((c: { name?: unknown }) => {
              if (typeof c.name !== 'string' || c.name.trim().length < 2 || /^\d+$/.test(c.name.trim())) {
                report.skippedInvalidName++;
                report.warnings.push(`Cari gizlendi: "${c.name}" — geçersiz ad`);
              }
            });
            (raw.products || []).forEach((p: { name?: unknown }) => {
              if (typeof p.name !== 'string' || p.name.trim().length < 2 || /^\d+$/.test(p.name.trim())) {
                report.skippedInvalidName++;
                report.warnings.push(`Ürün gizlendi: "${p.name}" — geçersiz ad`);
              }
            });
            setLastReport(report);

            const msg = report.skippedInvalidName > 0
              ? `✅ Geri yükleme tamamlandı. ${report.skippedInvalidName} geçersiz kayıt gizlendi.`
              : '✅ Tam geri yükleme başarılı! Önceki veri yedeklendi.';
            showToast(msg, 'success');
            setTimeout(() => window.location.reload(), 1800);
          } catch {
            showToast('Dosya okunamadı veya geçersiz format!', 'error');
          }
        };
        reader.readAsText(file);
      },
      true
    );
  };

  return (
    <Card title="🔄 Tam Geri Yükleme">
      <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 10, padding: '10px 16px', marginBottom: 14, color: '#fca5a5', fontSize: '0.83rem', lineHeight: 1.6 }}>
        <strong>Dikkat:</strong> Mevcut tüm veriler yedekteki verilerle değiştirilir. İşlem öncesi otomatik yedek alınır.
        Yedekten gelen geçersiz adlı kayıtlar (boş, tek haneli, sadece sayı) gizlenir.
      </div>
      <input ref={fileRef} type="file" accept=".json" onChange={handleFile} style={{ display: 'none' }} />
      <button
        onClick={() => fileRef.current?.click()}
        style={{ width: '100%', padding: '14px 0', background: 'rgba(239,68,68,0.08)', border: '2px dashed rgba(239,68,68,0.3)', borderRadius: 12, color: '#f87171', cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem', transition: 'all 0.2s' }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.15)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.08)'; }}
      >
        📂 JSON Yedek Dosyası Seç — Tam Geri Yükle
      </button>

      {lastReport && lastReport.warnings.length > 0 && (
        <div style={{ marginTop: 12, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, padding: '10px 14px' }}>
          <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: '0.82rem', marginBottom: 6 }}>⚠️ Gizlenen Kayıtlar</div>
          {lastReport.warnings.map((w, i) => (
            <div key={i} style={{ color: '#94a3b8', fontSize: '0.75rem', padding: '2px 0' }}>• {w}</div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SelectiveRestore({ showToast, showConfirm, save, db }: {
  showToast: (m: string, t?: string) => void;
  showConfirm: (t: string, m: string, ok: () => void, d?: boolean) => void;
  save: (fn: (prev: DB) => DB) => void;
  db: DB;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileData, setFileData] = useState<Record<string, unknown> | null>(null);
  const [fileName, setFileName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [available, setAvailable] = useState<{ key: string; label: string; icon: string; count: number; isObject?: boolean }[]>([]);
  const [lastReport, setLastReport] = useState<RestoreReport | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (typeof data !== 'object' || Array.isArray(data)) {
          showToast('Geçersiz JSON formatı!', 'error');
          return;
        }
        setFileData(data);
        const avail: typeof available = [];
        RESTORE_SECTIONS.forEach(s => {
          const val = data[s.key];
          if (s.key === 'company' || s.key === 'pelletSettings') {
            if (val && typeof val === 'object' && !Array.isArray(val)) {
              avail.push({ key: s.key, label: s.label, icon: s.icon, count: 1, isObject: true });
            }
          } else if (Array.isArray(val) && val.length > 0) {
            avail.push({ key: s.key, label: s.label, icon: s.icon, count: val.length });
          }
        });
        setAvailable(avail);
        setSelected(new Set(avail.map(a => a.key)));
      } catch {
        showToast('JSON ayrıştırılamadı!', 'error');
      }
    };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  const toggleSection = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(available.map(a => a.key)));
  const selectNone = () => setSelected(new Set());

  const doRestore = () => {
    if (!fileData || selected.size === 0) return;
    const selCount = available.filter(a => selected.has(a.key)).reduce((s, a) => s + a.count, 0);
    showConfirm(
      'Seçimli Geri Yükleme',
      `${selected.size} bölüm (${selCount} kayıt) işlenecek. Mevcut ID'ler korunur, geçersiz adlar atlanır. Devam edilsin mi?`,
      () => {
        try {
          // Geri yükleme öncesi mevcut veriyi otomatik yedekle
          const preLabel = `onceki_${new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')}`;
          saveBackupToFirebase(db, preLabel).catch(() => {});

          // Akıllı birleştirme — ID kontrolü + ad kalite kontrolü
          const { db: mergedDb, report } = mergeRestoreDB(db, fileData as Partial<DB>, selected);
          setLastReport(report);

          save(() => mergedDb);

          const msg = [
            `✅ ${report.added} kayıt eklendi.`,
            report.skippedDuplicate > 0 ? `${report.skippedDuplicate} tekrar (ID çakışması) atlandı.` : '',
            report.skippedInvalidName > 0 ? `${report.skippedInvalidName} geçersiz adlı kayıt atlandı.` : '',
            report.skippedMissingField > 0 ? `${report.skippedMissingField} eksik alanlı kayıt atlandı.` : '',
          ].filter(Boolean).join(' ');

          showToast(msg, report.skippedInvalidName > 0 || report.skippedMissingField > 0 ? 'info' : 'success');
          setTimeout(() => window.location.reload(), 2000);
        } catch {
          showToast('Geri yükleme sırasında hata oluştu!', 'error');
        }
      },
      true
    );
  };

  const reset = () => { setFileData(null); setFileName(''); setSelected(new Set()); setAvailable([]); setLastReport(null); };

  return (
    <Card title="📂 Seçimli Geri Yükleme">
      <p style={{ color: '#64748b', fontSize: '0.88rem', marginBottom: 14, lineHeight: 1.6 }}>
        Yedek dosyanızdan <strong style={{ color: '#f59e0b' }}>istediğiniz bölümleri seçerek</strong> geri yükleyin. Tüm veriyi değiştirmek zorunda değilsiniz.
      </p>

      {!fileData ? (
        <>
          <input ref={fileRef} type="file" accept=".json" onChange={handleFile} style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()} style={{ width: '100%', padding: '16px 0', background: 'rgba(59,130,246,0.08)', border: '2px dashed rgba(59,130,246,0.3)', borderRadius: 12, color: '#60a5fa', cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem', transition: 'all 0.2s' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(59,130,246,0.15)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(59,130,246,0.08)'; }}>
            JSON Yedek Dosyası Seç
          </button>
        </>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 10 }}>
            <span style={{ color: '#10b981', fontSize: '1.1rem' }}>📄</span>
            <span style={{ color: '#10b981', fontWeight: 700, fontSize: '0.88rem', flex: 1 }}>{fileName}</span>
            <span style={{ color: '#64748b', fontSize: '0.78rem' }}>{available.length} bölüm bulundu</span>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.9rem' }}>Geri Yüklenecek Bölümler:</span>
            <button onClick={selectAll} style={{ padding: '4px 10px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 6, color: '#10b981', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem' }}>Tümünü Seç</button>
            <button onClick={selectNone} style={{ padding: '4px 10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, color: '#ef4444', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem' }}>Hiçbirini Seçme</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {available.map(section => {
              const isSelected = selected.has(section.key);
              return (
                <div key={section.key} onClick={() => toggleSection(section.key)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                  background: isSelected ? 'rgba(59,130,246,0.08)' : 'rgba(0,0,0,0.2)',
                  border: `1px solid ${isSelected ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.04)'}`,
                  borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
                }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isSelected ? '#3b82f6' : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${isSelected ? '#3b82f6' : 'rgba(255,255,255,0.12)'}`,
                    color: '#fff', fontSize: '0.7rem', fontWeight: 700, flexShrink: 0,
                  }}>
                    {isSelected ? '✓' : ''}
                  </div>
                  <span style={{ fontSize: '0.95rem' }}>{section.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: isSelected ? '#f1f5f9' : '#64748b', fontWeight: 600, fontSize: '0.82rem' }}>{section.label}</div>
                    <div style={{ color: '#334155', fontSize: '0.72rem' }}>
                      {section.isObject ? 'Ayarlar' : `${section.count} kayıt`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {selected.size > 0 && (
            <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 10, padding: '10px 16px', color: '#fde68a', fontSize: '0.83rem' }}>
              Mevcut ID'ler korunur. Geçersiz adlar (boş, tek haneli, sadece sayı) ve zorunlu alanı eksik kayıtlar atlanır.
            </div>
          )}

          {lastReport && lastReport.warnings.length > 0 && (
            <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ color: '#f87171', fontWeight: 700, fontSize: '0.83rem', marginBottom: 8 }}>
                ⚠️ Atlanan Kayıtlar ({lastReport.skippedDuplicate + lastReport.skippedInvalidName + lastReport.skippedMissingField})
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                {lastReport.skippedDuplicate > 0 && <span style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', borderRadius: 6, padding: '2px 8px', fontSize: '0.75rem', fontWeight: 600 }}>🔁 {lastReport.skippedDuplicate} tekrar ID</span>}
                {lastReport.skippedInvalidName > 0 && <span style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', borderRadius: 6, padding: '2px 8px', fontSize: '0.75rem', fontWeight: 600 }}>✗ {lastReport.skippedInvalidName} geçersiz ad</span>}
                {lastReport.skippedMissingField > 0 && <span style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24', borderRadius: 6, padding: '2px 8px', fontSize: '0.75rem', fontWeight: 600 }}>⚠ {lastReport.skippedMissingField} eksik alan</span>}
              </div>
              <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                {lastReport.warnings.map((w, i) => (
                  <div key={i} style={{ color: '#94a3b8', fontSize: '0.75rem', padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>• {w}</div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            {selected.size > 0 && (
              <button onClick={doRestore} style={{ flex: 1, padding: '12px 0', background: 'linear-gradient(135deg, #2563eb, #3b82f6)', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' }}>
                {selected.size} Bölümü Geri Yükle
              </button>
            )}
            <button onClick={reset} style={{ padding: '12px 18px', background: '#273548', border: '1px solid #334155', borderRadius: 10, color: '#94a3b8', cursor: 'pointer', fontWeight: 600 }}>Sıfırla</button>
          </div>
        </div>
      )}
    </Card>
  );
}

const KNOWN_ARRAYS: Record<string, string> = {
  products: 'Ürünler', sales: 'Satışlar', suppliers: 'Tedarikçiler', cari: 'Cari Müşteriler',
  kasa: 'Kasa Hareketleri', bankTransactions: 'Banka İşlemleri', orders: 'Siparişler',
  invoices: 'Faturalar', stockMovements: 'Stok Hareketleri', peletSuppliers: 'Pelet Tedarikçi',
  peletOrders: 'Pelet Sipariş', boruSuppliers: 'Boru Tedarikçi', boruOrders: 'Boru Sipariş',
  budgets: 'Bütçe', returns: 'İadeler', ortakEmanetler: 'Ortak Emanet', installments: 'Taksitler',
};

const LEGACY_FIELD_MAP: Record<string, string> = {
  urunler: 'products', satislar: 'sales', tedarikci: 'suppliers', musteriler: 'cari',
  kasaHareketleri: 'kasa', bankHareketleri: 'bankTransactions', siparisler: 'orders',
  faturalar: 'invoices', stokHareketleri: 'stockMovements', stoklar: 'products',
  musteri: 'cari', tedarikcilar: 'suppliers', kasaIslemleri: 'kasa',
};

type ConflictResolution = 'overwrite' | 'skip' | 'merge';

interface ConflictInfo {
  entity: string;
  label: string;
  byId: number;
  byName: number;
  total: number;
}

const CSV_COLUMN_MAP: Record<string, { target: string; field: string }> = {
  'müşteri': { target: 'cari', field: 'name' },
  'musteri': { target: 'cari', field: 'name' },
  'müşteri adı': { target: 'cari', field: 'name' },
  'ad': { target: 'cari', field: 'name' },
  'isim': { target: 'cari', field: 'name' },
  'ad soyad': { target: 'cari', field: 'name' },
  'telefon': { target: 'cari', field: 'phone' },
  'tel': { target: 'cari', field: 'phone' },
  'adres': { target: 'cari', field: 'address' },
  'bakiye': { target: 'cari', field: 'balance' },
  'borç': { target: 'cari', field: 'balance' },
  'borc': { target: 'cari', field: 'balance' },
  'tarih': { target: '_date', field: 'createdAt' },
  'date': { target: '_date', field: 'createdAt' },
  'tutar': { target: '_amount', field: 'amount' },
  'toplam': { target: '_amount', field: 'total' },
  'fiyat': { target: '_amount', field: 'price' },
  'ürün': { target: 'products', field: 'name' },
  'urun': { target: 'products', field: 'name' },
  'ürün adı': { target: 'products', field: 'name' },
  'stok': { target: 'products', field: 'stock' },
  'maliyet': { target: 'products', field: 'cost' },
  'satış fiyatı': { target: 'products', field: 'price' },
  'kategori': { target: '_category', field: 'category' },
  'açıklama': { target: '_desc', field: 'description' },
  'aciklama': { target: '_desc', field: 'description' },
  'not': { target: '_desc', field: 'note' },
  'e-posta': { target: 'cari', field: 'email' },
  'email': { target: 'cari', field: 'email' },
};

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(/[,;\t]/).map(h => h.trim().replace(/^["']|["']$/g, ''));
  return lines.slice(1).map(line => {
    const values = line.split(/[,;\t]/).map(v => v.trim().replace(/^["']|["']$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] || ''; });
    return row;
  }).filter(row => Object.values(row).some(v => v !== ''));
}

interface CsvColumnMapping {
  csvColumn: string;
  targetEntity: string;
  targetField: string;
  autoDetected: boolean;
}

function detectCsvColumns(headers: string[]): CsvColumnMapping[] {
  return headers.map(h => {
    const lower = h.toLowerCase().trim();
    const match = CSV_COLUMN_MAP[lower];
    if (match) {
      return { csvColumn: h, targetEntity: match.target, targetField: match.field, autoDetected: true };
    }
    for (const [key, val] of Object.entries(CSV_COLUMN_MAP)) {
      if (lower.includes(key)) {
        return { csvColumn: h, targetEntity: val.target, targetField: val.field, autoDetected: true };
      }
    }
    return { csvColumn: h, targetEntity: '', targetField: '', autoDetected: false };
  });
}

function SmartImportManager({ db, save: _save, showToast, showConfirm }: {
  db: DB;
  save: (fn: (prev: DB) => DB) => void;
  showToast: (m: string, t?: string) => void;
  showConfirm: (t: string, m: string, ok: () => void, d?: boolean) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<'idle' | 'mapping' | 'csvMapping' | 'preview' | 'done'>('idle');
  const [rawData, setRawData] = useState<Record<string, unknown> | null>(null);
  const [mapped, setMapped] = useState<Record<string, unknown> | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, ConflictResolution>>({});
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>({});
  const [unknownFields, setUnknownFields] = useState<string[]>([]);
  const [legacyMapped, setLegacyMapped] = useState<Record<string, string>>({});
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvMappings, setCsvMappings] = useState<CsvColumnMapping[]>([]);
  const [csvTarget, setCsvTarget] = useState<string>('cari');

  const detectFieldMappings = (data: Record<string, unknown>) => {
    const unknown: string[] = [];
    const autoMapped: Record<string, string> = {};
    const knownAll = new Set([...Object.keys(KNOWN_ARRAYS), '_version', 'company', 'settings', 'pelletSettings', 'kasalar', 'matchRules', 'monitorRules', 'monitorLog', '_activityLog', 'soundSettings']);

    Object.keys(data).forEach(key => {
      if (!knownAll.has(key)) {
        if (LEGACY_FIELD_MAP[key]) {
          autoMapped[key] = LEGACY_FIELD_MAP[key];
        } else {
          unknown.push(key);
        }
      }
    });
    return { unknown, autoMapped };
  };

  const applyMappings = (data: Record<string, unknown>, mappings: Record<string, string>): Record<string, unknown> => {
    const result: Record<string, unknown> = { ...data };
    Object.entries(mappings).forEach(([src, dst]) => {
      if (dst && dst !== '' && result[src] !== undefined) {
        if (!result[dst] || !Array.isArray(result[dst])) {
          result[dst] = result[src];
        } else if (Array.isArray(result[dst]) && Array.isArray(result[src])) {
          result[dst] = [...(result[dst] as unknown[]), ...(result[src] as unknown[])];
        }
        delete result[src];
      }
    });
    return result;
  };

  const detectConflicts = (data: Record<string, unknown>): ConflictInfo[] => {
    const checks: Array<{ entity: string; label: string; dbItems: { id?: string; name?: string; code?: string }[]; importKey: string }> = [
      { entity: 'products', label: 'Ürün', dbItems: db.products, importKey: 'products' },
      { entity: 'sales', label: 'Satış', dbItems: db.sales, importKey: 'sales' },
      { entity: 'cari', label: 'Cari Müşteri', dbItems: db.cari, importKey: 'cari' },
      { entity: 'suppliers', label: 'Tedarikçi', dbItems: db.suppliers || [], importKey: 'suppliers' },
    ];

    return checks.map(({ entity, label, dbItems, importKey }) => {
      const incoming = (data[importKey] as { id?: string; name?: string; code?: string }[]) || [];
      const existingIds = new Set(dbItems.map(d => d.id).filter(Boolean));
      const existingNames = new Set(dbItems.map(d => (d.name || '').toLowerCase().trim()).filter(Boolean));
      const byId = incoming.filter(item => item.id && existingIds.has(item.id)).length;
      const byName = incoming.filter(item => !item.id && item.name && existingNames.has(item.name.toLowerCase().trim())).length;
      return { entity, label, byId, byName, total: byId + byName };
    }).filter(c => c.total > 0);
  };

  const analyzeData = (data: Record<string, unknown>) => {
    const errs: string[] = [];
    const warns: string[] = [];
    const st: Record<string, number> = {};

    Object.entries(KNOWN_ARRAYS).forEach(([key]) => {
      const val = data[key];
      if (Array.isArray(val)) {
        if (val.length > 0) st[key] = val.length;
        if (val.length === 0) warns.push(`"${KNOWN_ARRAYS[key]}" alanı boş`);
      } else if (val !== undefined) {
        errs.push(`"${key}" alanı geçersiz format — dizi bekleniyor`);
      }
    });

    if (!data.company || typeof data.company !== 'object') warns.push('Şirket bilgisi bulunamadı — varsayılan oluşturulacak');
    if (!data.pelletSettings) warns.push('Pelet ayarları bulunamadı — varsayılan kullanılacak');
    if (!data._version) warns.push('Versiyon bilgisi yok — eski format olabilir, lütfen kontrol edin');
    else if ((data._version as number) < 1) warns.push(`Eski versiyon (${data._version}) — bazı alanlar eksik olabilir`);

    return { errs, warns, st };
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;

      if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
        const rows = parseCSV(text);
        if (rows.length === 0) {
          setErrors(['CSV dosyası boş veya geçersiz format']);
          setStage('preview');
          return;
        }
        setCsvRows(rows);
        const headers = Object.keys(rows[0]);
        const mappings = detectCsvColumns(headers);
        setCsvMappings(mappings);
        const hasCariCols = mappings.some(m => m.targetEntity === 'cari');
        const hasProductCols = mappings.some(m => m.targetEntity === 'products');
        setCsvTarget(hasCariCols ? 'cari' : hasProductCols ? 'products' : 'cari');
        setStage('csvMapping');
        return;
      }

      try {
        const data = JSON.parse(text);
        if (typeof data !== 'object' || Array.isArray(data)) {
          setErrors(['Geçersiz JSON formatı — nesne bekleniyor']);
          setStage('preview');
          setRawData(null);
          return;
        }
        setRawData(data);
        const { unknown, autoMapped } = detectFieldMappings(data);
        setLegacyMapped(autoMapped);
        setUnknownFields(unknown);
        const initMappings: Record<string, string> = {};
        unknown.forEach(f => { initMappings[f] = ''; });
        setFieldMappings(initMappings);

        if (unknown.length > 0 || Object.keys(autoMapped).length > 0) {
          setStage('mapping');
        } else {
          proceedToPreview(data, {});
        }
      } catch {
        setErrors(['Dosya ayrıştırılamadı — JSON veya CSV formatını kontrol edin']);
        setStage('preview');
        setRawData(null);
      }
    };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  const applyCsvImport = () => {
    if (csvRows.length === 0) return;
    const items: Record<string, unknown>[] = csvRows.map(row => {
      const item: Record<string, unknown> = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      csvMappings.forEach(m => {
        if (!m.targetField || m.targetField === '') return;
        const val = row[m.csvColumn];
        if (!val) return;
        const numFields = ['balance', 'amount', 'total', 'price', 'stock', 'cost', 'quantity'];
        if (numFields.includes(m.targetField)) {
          item[m.targetField] = parseFloat(val.replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;
        } else if (m.targetField === 'createdAt') {
          try { item.createdAt = new Date(val).toISOString(); } catch { /* keep default */ }
        } else {
          item[m.targetField] = val;
        }
      });
      if (csvTarget === 'cari') {
        if (!item.type) item.type = 'musteri';
        if (!item.balance) item.balance = 0;
        if (!item.totalPurchases) item.totalPurchases = 0;
      }
      if (csvTarget === 'products') {
        if (!item.stock) item.stock = 0;
        if (!item.cost) item.cost = 0;
        if (!item.price) item.price = 0;
        if (!item.minStock) item.minStock = 5;
        if (!item.category) item.category = '';
      }
      if (csvTarget === 'kasa') {
        if (!item.type) item.type = 'gider';
        if (!item.kasa) item.kasa = 'nakit';
        if (!item.amount) item.amount = 0;
        if (!item.description) item.description = (item.name as string) || 'CSV İçe Aktarma';
        if (!item.category) item.category = 'diger';
      }
      return item;
    });

    const data: Record<string, unknown> = {};
    data[csvTarget] = items;
    setRawData(data);
    proceedToPreview(data, {});
  };

  const proceedToPreview = (data: Record<string, unknown>, userMappings: Record<string, string>) => {
    const allMappings = { ...legacyMapped, ...userMappings };
    const resolved = applyMappings(data, allMappings);
    const { errs, warns, st } = analyzeData(resolved);
    const detectedConflicts = detectConflicts(resolved);
    const initRes: Record<string, ConflictResolution> = {};
    detectedConflicts.forEach(c => { initRes[c.entity] = 'overwrite'; });
    setMapped(resolved);
    setErrors(errs);
    setWarnings(warns);
    setStats(st);
    setConflicts(detectedConflicts);
    setResolutions(initRes);
    setStage('preview');
  };

  const doImport = () => {
    if (!mapped) return;
    showConfirm('Veri Aktarımını Onayla', 'Seçilen çakışma çözümleri uygulanacak ve veriler içe aktarılacak. Mevcut veriler etkilenebilir. Onaylıyor musunuz?', () => {
      try {
        const raw = localStorage.getItem('sobaYonetim');
        const current = raw ? JSON.parse(raw) : {};
        const def = {
          _version: 1, products: [], sales: [], suppliers: [], orders: [], cari: [], kasa: [],
          kasalar: [{ id: 'nakit', name: 'Nakit', icon: '💵' }, { id: 'banka', name: 'Banka', icon: '🏦' }],
          bankTransactions: [], matchRules: [], monitorRules: [], monitorLog: [], stockMovements: [],
          peletSuppliers: [], peletOrders: [], boruSuppliers: [], boruOrders: [],
          invoices: [], budgets: [], returns: [], _activityLog: [],
          company: current.company || {}, settings: {}, pelletSettings: { gramaj: 14, kgFiyat: 6.5, cuvalKg: 15, critDays: 3 },
          ortakEmanetler: [], installments: [],
        };
        let finalData: Record<string, unknown> = { ...def, ...mapped };

        const conflictEntities = ['products', 'cari', 'suppliers', 'sales'] as const;
        conflictEntities.forEach(entity => {
          const resolution = resolutions[entity] || 'overwrite';
          const incoming = (mapped[entity] as { id?: string; name?: string }[]) || [];
          const existing = (current[entity] as { id?: string; name?: string }[]) || [];

          if (resolution === 'skip') {
            const existingIds = new Set(existing.map((x: { id?: string }) => x.id).filter(Boolean));
            const existingNames = new Set(existing.map((x: { name?: string }) => (x.name || '').toLowerCase()).filter(Boolean));
            finalData[entity] = [
              ...existing,
              ...incoming.filter(item =>
                item.name && // name boş/undefined olanları filtrele
                !existingIds.has(item.id) &&
                !existingNames.has((item.name || '').toLowerCase())
              ),
            ];
          } else if (resolution === 'merge') {
            const existingMap = new Map(existing.map((x: { id?: string }) => [x.id, x]));
            incoming.forEach(item => {
              if (item.id && existingMap.has(item.id)) {
                existingMap.set(item.id, { ...existingMap.get(item.id)!, ...item });
              } else {
                existingMap.set(item.id || Math.random().toString(), item);
              }
            });
            finalData[entity] = Array.from(existingMap.values());
          }
        });

        if (!finalData.kasalar || (finalData.kasalar as unknown[]).length === 0) finalData.kasalar = def.kasalar;
        if (!finalData.pelletSettings) finalData.pelletSettings = def.pelletSettings;
        if (!finalData.company || typeof finalData.company !== 'object') finalData.company = def.company;

        localStorage.setItem('sobaYonetim', JSON.stringify(finalData));
        setStage('done');
        showToast('Veriler başarıyla aktarıldı! Sayfa yenilenecek...', 'success');
        setTimeout(() => window.location.reload(), 1200);
      } catch {
        showToast('İçe aktarma sırasında hata oluştu!', 'error');
      }
    }, true);
  };

  const reset = () => {
    setStage('idle'); setRawData(null); setMapped(null); setErrors([]); setWarnings([]);
    setStats({}); setConflicts([]); setResolutions({}); setFieldMappings({}); setUnknownFields([]); setLegacyMapped({});
    setCsvRows([]); setCsvMappings([]); setCsvTarget('cari');
  };

  const btnStyle = (active: boolean, color: string) => ({
    padding: '6px 14px', border: `1px solid ${active ? color : '#334155'}`, borderRadius: 8,
    background: active ? `${color}20` : 'transparent', color: active ? color : '#64748b',
    cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem',
  });

  return (
    <Card title="🧠 Akıllı Veri İçe Aktarma">
      <p style={{ color: '#64748b', fontSize: '0.88rem', marginBottom: 14, lineHeight: 1.6 }}>
        JSON, CSV veya TXT dosyanızı analiz eder; kolonları otomatik eşler (müşteri, tarih, tutar vb.), manuel düzeltme imkanı sunar ve çakışmaları çözerek güvenli aktarım yapar.
      </p>

      {stage === 'idle' && (
        <>
          <input ref={fileRef} type="file" accept=".json,.csv,.tsv,.txt" onChange={handleFile} style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()} style={{ width: '100%', padding: '16px 0', background: 'rgba(139,92,246,0.08)', border: '2px dashed rgba(139,92,246,0.3)', borderRadius: 12, color: '#a78bfa', cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem' }}>
            Dosya Seç & Akıllı Analiz Başlat
          </button>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'center' }}>
            {['JSON', 'CSV', 'TSV', 'TXT'].map(f => (
              <span key={f} style={{ padding: '3px 10px', background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)', borderRadius: 6, color: '#a78bfa', fontSize: '0.72rem', fontWeight: 600 }}>.{f.toLowerCase()}</span>
            ))}
          </div>
        </>
      )}

      {stage === 'csvMapping' && csvRows.length > 0 && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ color: '#10b981', fontWeight: 700, marginBottom: 4 }}>{csvRows.length} satır okundu</div>
            <div style={{ color: '#64748b', fontSize: '0.82rem' }}>Kolon eşleşmelerini kontrol edin ve gerekirse düzeltin</div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.9rem' }}>Hedef Veri Türü:</span>
              {[
                { id: 'cari', label: 'Cari Müşteri', icon: '👤' },
                { id: 'products', label: 'Ürün', icon: '📦' },
                { id: 'kasa', label: 'Kasa', icon: '💰' },
              ].map(t => (
                <button key={t.id} onClick={() => setCsvTarget(t.id)} style={{
                  padding: '6px 14px', border: `1px solid ${csvTarget === t.id ? '#ff5722' : '#334155'}`,
                  borderRadius: 8, background: csvTarget === t.id ? 'rgba(255,87,34,0.15)' : 'transparent',
                  color: csvTarget === t.id ? '#ff7043' : '#64748b', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem',
                }}>{t.icon} {t.label}</button>
              ))}
            </div>
          </div>

          <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.9rem' }}>Kolon Eşleşmeleri</div>
          {csvMappings.map((m, i) => (
            <div key={m.csvColumn} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ minWidth: 140, padding: '6px 10px', background: 'rgba(0,0,0,0.3)', borderRadius: 6, color: m.autoDetected ? '#10b981' : '#f59e0b', fontFamily: 'monospace', fontSize: '0.82rem', fontWeight: 600 }}>
                {m.csvColumn}
                {m.autoDetected && <span style={{ fontSize: '0.65rem', marginLeft: 4, color: '#10b981' }}>otomatik</span>}
              </div>
              <span style={{ color: '#475569' }}>→</span>
              <select
                value={m.targetField}
                onChange={e => {
                  const next = [...csvMappings];
                  next[i] = { ...next[i], targetField: e.target.value, autoDetected: false };
                  setCsvMappings(next);
                }}
                style={{ flex: 1, padding: '7px 10px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: '0.82rem' }}
              >
                <option value="">— Yoksay —</option>
                <option value="name">Ad / İsim</option>
                <option value="phone">Telefon</option>
                <option value="email">E-posta</option>
                <option value="address">Adres</option>
                <option value="balance">Bakiye / Borç</option>
                <option value="amount">Tutar</option>
                <option value="total">Toplam</option>
                <option value="price">Fiyat</option>
                <option value="cost">Maliyet</option>
                <option value="stock">Stok</option>
                <option value="category">Kategori</option>
                <option value="description">Açıklama</option>
                <option value="note">Not</option>
                <option value="createdAt">Tarih</option>
              </select>
            </div>
          ))}

          {csvRows.length > 0 && (
            <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 10, padding: '12px 16px', overflowX: 'auto' }}>
              <div style={{ color: '#64748b', fontWeight: 700, fontSize: '0.78rem', marginBottom: 8 }}>Önizleme (ilk 3 satır):</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr>
                    {Object.keys(csvRows[0]).map(h => (
                      <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {csvRows.slice(0, 3).map((row, ri) => (
                    <tr key={ri}>
                      {Object.values(row).map((v, ci) => (
                        <td key={ci} style={{ padding: '4px 8px', color: '#e2e8f0', borderBottom: '1px solid rgba(255,255,255,0.03)', whiteSpace: 'nowrap', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={applyCsvImport} style={{ flex: 1, padding: '11px 0', background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
              Devam → Önizleme & Çakışma Çözümü
            </button>
            <button onClick={reset} style={{ padding: '11px 18px', background: '#273548', border: '1px solid #334155', borderRadius: 10, color: '#94a3b8', cursor: 'pointer' }}>Sıfırla</button>
          </div>
        </div>
      )}

      {stage === 'mapping' && rawData && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.95rem' }}>🗺️ Alan Eşleme (Field Mapping)</div>
          {Object.keys(legacyMapped).length > 0 && (
            <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ color: '#10b981', fontWeight: 700, marginBottom: 8 }}>✅ Otomatik Algılanan Eski Alanlar</div>
              {Object.entries(legacyMapped).map(([src, dst]) => (
                <div key={src} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: '0.85rem' }}>
                  <span style={{ color: '#f59e0b', fontFamily: 'monospace', background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: 4 }}>{src}</span>
                  <span style={{ color: '#475569' }}>→</span>
                  <span style={{ color: '#10b981', fontFamily: 'monospace', background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: 4 }}>{dst}</span>
                  <span style={{ color: '#64748b', fontSize: '0.75rem' }}>({KNOWN_ARRAYS[dst] || dst})</span>
                </div>
              ))}
            </div>
          )}
          {unknownFields.length > 0 && (
            <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ color: '#fbbf24', fontWeight: 700, marginBottom: 10 }}>⚠️ Tanınmayan Alanlar — Eşleme Seçin</div>
              {unknownFields.map(field => (
                <div key={field} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ color: '#f59e0b', fontFamily: 'monospace', background: 'rgba(0,0,0,0.3)', padding: '3px 10px', borderRadius: 6, minWidth: 120, textAlign: 'center' }}>{field}</span>
                  <span style={{ color: '#475569', fontSize: '0.9rem' }}>→</span>
                  <select
                    value={fieldMappings[field] || ''}
                    onChange={e => setFieldMappings(prev => ({ ...prev, [field]: e.target.value }))}
                    style={{ flex: 1, padding: '7px 10px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: '0.85rem' }}
                  >
                    <option value="">— Yoksay (aktarma)</option>
                    {Object.entries(KNOWN_ARRAYS).map(([k, label]) => (
                      <option key={k} value={k}>{label} ({k})</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => proceedToPreview(rawData, fieldMappings)} style={{ flex: 1, padding: '11px 0', background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
              Devam → Önizleme & Çakışma Çözümü
            </button>
            <button onClick={reset} style={{ padding: '11px 18px', background: '#273548', border: '1px solid #334155', borderRadius: 10, color: '#94a3b8', cursor: 'pointer' }}>Sıfırla</button>
          </div>
        </div>
      )}

      {stage === 'preview' && (
        <div style={{ display: 'grid', gap: 12 }}>
          {errors.length > 0 && (
            <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ color: '#f87171', fontWeight: 700, marginBottom: 8 }}>❌ Hatalar</div>
              {errors.map((e, i) => <div key={i} style={{ color: '#fca5a5', fontSize: '0.85rem', marginBottom: 4 }}>• {e}</div>)}
            </div>
          )}
          {warnings.length > 0 && (
            <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ color: '#fbbf24', fontWeight: 700, marginBottom: 8 }}>⚠️ Uyarılar</div>
              {warnings.map((w, i) => <div key={i} style={{ color: '#fde68a', fontSize: '0.85rem', marginBottom: 4 }}>• {w}</div>)}
            </div>
          )}
          {Object.keys(stats).length > 0 && (
            <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ color: '#60a5fa', fontWeight: 700, marginBottom: 8 }}>📊 İçe Aktarılacak Kayıtlar</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                {Object.entries(stats).map(([k, v]) => (
                  <div key={k} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ color: '#f1f5f9', fontWeight: 700 }}>{v}</div>
                    <div style={{ color: '#475569', fontSize: '0.72rem' }}>{KNOWN_ARRAYS[k] || k}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {conflicts.length > 0 && (
            <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ color: '#f87171', fontWeight: 700, marginBottom: 12 }}>⚡ Çakışma Çözümü</div>
              {conflicts.map(c => (
                <div key={c.entity} style={{ marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ color: '#fca5a5', fontSize: '0.85rem', marginBottom: 8 }}>
                    <strong>{c.label}</strong>: {c.byId > 0 && `${c.byId} aynı ID`}{c.byId > 0 && c.byName > 0 && ', '}{c.byName > 0 && `${c.byName} aynı isim`} çakışması
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setResolutions(r => ({ ...r, [c.entity]: 'overwrite' }))} style={btnStyle(resolutions[c.entity] === 'overwrite', '#ef4444')}>
                      🔄 Üzerine Yaz
                    </button>
                    <button onClick={() => setResolutions(r => ({ ...r, [c.entity]: 'skip' }))} style={btnStyle(resolutions[c.entity] === 'skip', '#f59e0b')}>
                      ⏭️ Çakışanları Atla
                    </button>
                    <button onClick={() => setResolutions(r => ({ ...r, [c.entity]: 'merge' }))} style={btnStyle(resolutions[c.entity] === 'merge', '#10b981')}>
                      🔀 Birleştir
                    </button>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: 6 }}>
                    {resolutions[c.entity] === 'overwrite' && 'Mevcut kayıtlar yeni verilerle tamamen değiştirilir.'}
                    {resolutions[c.entity] === 'skip' && 'Çakışan kayıtlar atlanır; mevcut veriler korunur, yeni olanlar eklenir.'}
                    {resolutions[c.entity] === 'merge' && 'Mevcut kayıtlar yeni alanlarla güncellenir; hiç kayıp olmaz.'}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            {mapped && errors.length === 0 && (
              <button onClick={doImport} style={{ flex: 1, padding: '11px 0', background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                ✅ Aktarımı Onayla & Başlat
              </button>
            )}
            <button onClick={reset} style={{ padding: '11px 18px', background: '#273548', border: '1px solid #334155', borderRadius: 10, color: '#94a3b8', cursor: 'pointer' }}>Sıfırla</button>
          </div>
        </div>
      )}

      {stage === 'done' && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div style={{ fontSize: '3rem', marginBottom: 12 }}>✅</div>
          <div style={{ color: '#10b981', fontWeight: 700, fontSize: '1.1rem' }}>Veriler başarıyla aktarıldı!</div>
          <div style={{ color: '#64748b', fontSize: '0.85rem', marginTop: 6 }}>Sayfa yenileniyor...</div>
        </div>
      )}
    </Card>
  );
}

function VeriOnarim({ db, save, showToast, showConfirm }: { db: DB; save: (fn: (prev: DB) => DB) => void; showToast: (m: string, t?: string) => void; showConfirm: (title: string, msg: string, onOk: () => void, danger?: boolean) => void }) {
  const [results, setResults] = useState<string[]>([]);

  const diagnose = () => {
    const issues: string[] = [];
    const saleIds = db.sales.map(s => s.id);
    const dupSales = saleIds.length - new Set(saleIds).size;
    if (dupSales > 0) issues.push(`⚠️ ${dupSales} tekrarlanan satış kaydı`);
    const negStock = db.products.filter(p => p.stock < 0).length;
    if (negStock > 0) issues.push(`⚠️ ${negStock} ürünün stok değeri negatif`);
    const cariIds = new Set(db.cari.map(c => c.id));
    const orphanKasa = db.kasa.filter(k => k.cariId && !cariIds.has(k.cariId)).length;
    if (orphanKasa > 0) issues.push(`⚠️ ${orphanKasa} kasa kaydı silinmiş cariye bağlı`);
    const soldProductIds = new Set(db.sales.flatMap(s => s.items?.map((i: { productId: string }) => i.productId) || [s.productId]).filter(Boolean));
    const stocklessProducts = db.products.filter(p => soldProductIds.has(p.id) && p.stock === 0).length;
    if (stocklessProducts > 0) issues.push(`ℹ️ ${stocklessProducts} ürün satıldı ama stok sıfır`);
    if (!db.company.name) issues.push('ℹ️ Şirket adı girilmemiş');
    const lsSize = new Blob([localStorage.getItem('sobaYonetim') || '']).size;
    const lsKB = Math.round(lsSize / 1024);
    issues.push(`📊 localStorage boyutu: ${lsKB} KB (limit ~5MB)`);
    const orphanInvoices = (db.invoices || []).filter(inv => inv.cariId && !cariIds.has(inv.cariId)).length;
    if (orphanInvoices > 0) issues.push(`⚠️ ${orphanInvoices} fatura silinmiş cariye bağlı`);
    setResults(issues.length === 0 ? ['✅ Veri tutarlılık kontrolü tamam. Sorun bulunamadı!'] : issues);
  };

  const fixNegativeStock = () => {
    showConfirm('Stok Düzelt', 'Negatif stoklar sıfıra çekilecek. Devam edilsin mi?', () => {
      save(prev => ({ ...prev, products: prev.products.map(p => p.stock < 0 ? { ...p, stock: 0 } : p) }));
      showToast('Negatif stoklar düzeltildi!');
      diagnose();
    });
  };

  const fixOrphanKasa = () => {
    showConfirm('Orphan Temizle', 'Silinmiş cariye ait kasa kayıtlarındaki cari bağlantısı kaldırılacak. Devam?', () => {
      const cariIds = new Set(db.cari.map(c => c.id));
      save(prev => ({ ...prev, kasa: prev.kasa.map(k => k.cariId && !cariIds.has(k.cariId) ? { ...k, cariId: undefined } : k) }));
      showToast('Orphan kasa kayıtları düzeltildi!');
      diagnose();
    });
  };

  const recalcCariBalance = () => {
    showConfirm('Bakiye Yeniden Hesapla', 'Tüm cari bakiyeleri kasa işlemlerine göre sıfırdan hesaplanacak. Mevcut bakiyeler SIFIRLANACAK!', () => {
      save(prev => {
        const cari = prev.cari.map(c => {
          const kasaEntries = prev.kasa.filter(k => k.cariId === c.id);
          const newBalance = kasaEntries.reduce((s, k) => s + (k.type === 'gelir' ? k.amount : -k.amount), 0);
          return { ...c, balance: newBalance };
        });
        return { ...prev, cari };
      });
      showToast('Cari bakiyeler yeniden hesaplandı!');
      diagnose();
    }, true);
  };

  const removeDupSales = () => {
    showConfirm('Tekrarları Temizle', 'Aynı ID\'li tekrarlanan satış kayıtları silinecek. Devam edilsin mi?', () => {
      save(prev => {
        const seen = new Set<string>();
        return { ...prev, sales: prev.sales.filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true; }) };
      });
      showToast('Tekrarlanan satışlar temizlendi!');
      diagnose();
    });
  };

  const mergeduplicateCari = () => {
    const nameCounts: Record<string, string[]> = {};
    db.cari.forEach(c => { const n = c.name.trim().toLowerCase(); if (!nameCounts[n]) nameCounts[n] = []; nameCounts[n].push(c.id); });
    const dups = Object.entries(nameCounts).filter(([, ids]) => ids.length > 1);
    if (dups.length === 0) { showToast('Tekrarlanan cari bulunamadı!'); return; }
    showConfirm('Cari Birleştir', `${dups.length} isimde tekrar var. İlk kayıt korunacak. Devam?`, () => {
      save(prev => {
        const toRemove = new Set<string>();
        dups.forEach(([, ids]) => ids.slice(1).forEach(id => toRemove.add(id)));
        return { ...prev, cari: prev.cari.filter(c => !toRemove.has(c.id)) };
      });
      showToast(`${dups.length} grup birleştirildi!`);
      diagnose();
    }, true);
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Card title="🔧 Veri Tutarlılık Kontrolü">
        <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: 16, lineHeight: 1.6 }}>Veritabanınızı analiz ederek tutarsız, eksik veya hatalı kayıtları tespit edin.</p>
        <button onClick={diagnose} style={{ width: '100%', padding: '13px 0', background: 'linear-gradient(135deg,#3b82f6,#2563eb)', border: 'none', borderRadius: 12, color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: '0.95rem', marginBottom: 14 }}>
          🔍 Veriyi Analiz Et
        </button>
        {results.length > 0 && (
          <div style={{ display: 'grid', gap: 6 }}>
            {results.map((r, i) => (
              <div key={i} style={{ padding: '10px 14px', background: r.startsWith('✅') ? 'rgba(16,185,129,0.08)' : r.startsWith('📊') ? 'rgba(59,130,246,0.08)' : 'rgba(245,158,11,0.08)', border: `1px solid ${r.startsWith('✅') ? 'rgba(16,185,129,0.2)' : r.startsWith('📊') ? 'rgba(59,130,246,0.2)' : 'rgba(245,158,11,0.2)'}`, borderRadius: 9, color: '#e2e8f0', fontSize: '0.85rem' }}>
                {r}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="🛠️ Onarım Araçları">
        <div style={{ display: 'grid', gap: 10 }}>
          {[
            { label: '📦 Negatif Stokları Sıfırla', desc: 'Stok değeri 0\'ın altına düşmüş ürünleri sıfıra çeker', action: fixNegativeStock, color: '#f59e0b' },
            { label: '🔗 Orphan Kasa Bağlantılarını Temizle', desc: 'Silinmiş cariye bağlı kasa kayıtlarındaki bağlantıyı kaldırır', action: fixOrphanKasa, color: '#3b82f6' },
            { label: '⚖️ Cari Bakiyeleri Yeniden Hesapla', desc: 'Tüm bakiyeleri kasa işlemlerine göre baştan hesaplar', action: recalcCariBalance, color: '#8b5cf6' },
            { label: '🗑️ Tekrarlayan Satış Kayıtlarını Temizle', desc: 'Aynı ID ile çift kaydedilmiş satışları siler', action: removeDupSales, color: '#10b981' },
            { label: '🤝 Aynı İsimli Cari Hesapları Birleştir', desc: 'Aynı isimde birden fazla cari varsa tek kayıt bırakır', action: mergeduplicateCari, color: '#ef4444' },
          ].map(t => (
            <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'rgba(0,0,0,0.2)', borderRadius: 10, border: `1px solid ${t.color}15` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.88rem' }}>{t.label}</div>
                <div style={{ color: '#475569', fontSize: '0.78rem', marginTop: 2 }}>{t.desc}</div>
              </div>
              <button onClick={t.action} style={{ background: `${t.color}15`, border: `1px solid ${t.color}30`, borderRadius: 8, color: t.color, padding: '7px 14px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                Uygula
              </button>
            </div>
          ))}
        </div>
      </Card>

      <Card title="📋 Sistem Bilgileri">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { label: 'Toplam Kayıt', value: `${[db.products, db.sales, db.cari, db.kasa, db.invoices || [], db.budgets || []].reduce((s, a) => s + a.length, 0)} kayıt` },
            { label: 'localStorage Boyutu', value: `${Math.round(new Blob([localStorage.getItem('sobaYonetim') || '']).size / 1024)} KB` },
            { label: 'Uygulama Versiyonu', value: `v${db._version || 1}` },
            { label: 'Son Veri Güncellemesi', value: db.kasa.length > 0 ? new Date(Math.max(...db.kasa.map(k => new Date(k.updatedAt || k.createdAt).getTime()))).toLocaleDateString('tr-TR') : '-' },
          ].map(s => (
            <div key={s.label} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ color: '#475569', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{s.label}</div>
              <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.9rem' }}>{s.value}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function DangerAction({ label, desc, onConfirm }: { label: string; desc: string; onConfirm: () => void }) {
  const { showConfirm } = useConfirm();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'rgba(0,0,0,0.3)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.04)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, color: '#f1f5f9', fontSize: '0.88rem' }}>{label}</div>
        <div style={{ color: '#475569', fontSize: '0.78rem', marginTop: 2 }}>{desc}</div>
      </div>
      <button onClick={() => showConfirm(label, `${desc}. Bu işlem geri alınamaz!`, onConfirm, true)} style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, color: '#f87171', padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
        Temizle
      </button>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))', borderRadius: 16, border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden' }}>
      <div style={{ padding: '16px 22px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <h3 style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.95rem' }}>{title}</h3>
      </div>
      <div style={{ padding: '20px 22px' }}>{children}</div>
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', marginBottom: 6, color: '#64748b', fontSize: '0.82rem', fontWeight: 600 };
const inp: React.CSSProperties = { width: '100%', padding: '10px 14px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#f1f5f9', fontSize: '0.9rem', boxSizing: 'border-box' };
const btnPrimary: React.CSSProperties = { width: '100%', padding: '13px 0', background: 'linear-gradient(135deg, #ff5722, #ff7043)', border: 'none', borderRadius: 12, color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: '0.95rem' };

// ── Bağlantı Ayarları ─────────────────────────────────────────────────────────
function BaglantiAyarlari({ cfg, onChange, showToast }: {
  cfg: ConnConfig;
  onChange: (c: ConnConfig) => void;
  showToast: (m: string, t?: string) => void;
}) {
  const [fbTest, setFbTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [fbTesting, setFbTesting] = useState(false);
  const [sbTest, setSbTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sbTesting, setSbTesting] = useState(false);

  const setFb = (patch: Partial<typeof cfg.firebase>) =>
    onChange({ ...cfg, firebase: { ...cfg.firebase, ...patch } });
  const setSb = (patch: Partial<typeof cfg.supabase>) =>
    onChange({ ...cfg, supabase: { ...cfg.supabase, ...patch } });

  const handleFbTest = async () => {
    setFbTesting(true); setFbTest(null);
    const r = await testFirebase(cfg.firebase);
    setFbTest(r);
    setFbTesting(false);
    showToast(r.ok ? 'Firebase bağlantısı başarılı!' : 'Firebase bağlantısı başarısız!', r.ok ? 'success' : 'error');
  };

  const handleSbTest = async () => {
    setSbTesting(true); setSbTest(null);
    const r = await testSupabase(cfg.supabase);
    setSbTest(r);
    setSbTesting(false);
    showToast(r.ok ? 'Supabase bağlantısı başarılı!' : 'Supabase bağlantısı başarısız!', r.ok ? 'success' : 'error');
  };

  const handleSave = () => {
    saveConnConfig(cfg);
    showToast('Bağlantı ayarları kaydedildi! Sayfa yenilendiğinde aktif olur.', 'success');
  };

  const handleReset = () => {
    onChange(DEFAULT_CONN);
    saveConnConfig(DEFAULT_CONN);
    showToast('Varsayılan bağlantı ayarları geri yüklendi!', 'success');
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>

      {/* Aktif Sağlayıcı */}
      <Card title="🔌 Aktif Senkronizasyon Sağlayıcısı">
        <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: 14, lineHeight: 1.6 }}>
          Verileriniz hangi bulut servisiyle senkronize edilsin? Sadece bir sağlayıcı aktif olabilir.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          {([
            { id: 'firebase', label: '🔥 Firebase', desc: 'Google Firestore' },
            { id: 'supabase', label: '⚡ Supabase', desc: 'PostgreSQL tabanlı' },
            { id: 'none',     label: '🚫 Yok',      desc: 'Sadece yerel' },
          ] as const).map(p => (
            <button
              key={p.id}
              onClick={() => onChange({ ...cfg, activeProvider: p.id })}
              style={{
                flex: 1, padding: '14px 10px', borderRadius: 12, cursor: 'pointer', textAlign: 'center',
                background: cfg.activeProvider === p.id ? 'rgba(255,87,34,0.12)' : 'rgba(0,0,0,0.25)',
                border: `2px solid ${cfg.activeProvider === p.id ? 'rgba(255,87,34,0.5)' : 'rgba(255,255,255,0.07)'}`,
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontWeight: 700, color: cfg.activeProvider === p.id ? '#ff7043' : '#f1f5f9', fontSize: '0.9rem' }}>{p.label}</div>
              <div style={{ color: '#475569', fontSize: '0.72rem', marginTop: 4 }}>{p.desc}</div>
              {cfg.activeProvider === p.id && (
                <div style={{ marginTop: 6, fontSize: '0.68rem', color: '#10b981', fontWeight: 700 }}>✓ Aktif</div>
              )}
            </button>
          ))}
        </div>
      </Card>

      {/* Firebase */}
      <Card title="🔥 Firebase Firestore">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, color: '#94a3b8', fontSize: '0.82rem' }}>
            Firebase Firestore REST API ile senkronizasyon
          </div>
          <button
            onClick={() => setFb({ enabled: !cfg.firebase.enabled })}
            style={{ width: 48, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer', position: 'relative', background: cfg.firebase.enabled ? '#10b981' : '#334155', transition: 'background 0.2s', flexShrink: 0 }}
          >
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 4, left: cfg.firebase.enabled ? 26 : 4, transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
          </button>
        </div>

        {/* JSON Dosyası Yükleme */}
        <div style={{ marginBottom: 16, padding: '12px 14px', background: 'rgba(255,87,34,0.06)', border: '1px dashed rgba(255,87,34,0.3)', borderRadius: 10 }}>
          <div style={{ color: '#ff7043', fontWeight: 700, fontSize: '0.82rem', marginBottom: 6 }}>📁 Firebase Config Dosyası Yükle</div>
          <div style={{ color: '#64748b', fontSize: '0.75rem', marginBottom: 10 }}>
            Firebase Console'dan indirilen <code style={{ color: '#ff7043' }}>google-services.json</code> veya web config JSON dosyasını yükleyin — alanlar otomatik dolar.
          </div>
          <label style={{ display: 'block', cursor: 'pointer' }}>
            <div style={{ padding: '10px 14px', background: 'rgba(255,87,34,0.1)', border: '1px solid rgba(255,87,34,0.25)', borderRadius: 8, color: '#ff7043', fontWeight: 700, fontSize: '0.82rem', textAlign: 'center', cursor: 'pointer' }}>
              📂 JSON Dosyası Seç
            </div>
            <input
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => {
                  try {
                    const json = JSON.parse(ev.target?.result as string);
                    // google-services.json formatı
                    if (json.project_info && json.client) {
                      const projectId = json.project_info.project_id;
                      const apiKey = json.client?.[0]?.api_key?.[0]?.current_key || '';
                      if (projectId) { setFb({ projectId, apiKey }); showToast('✅ google-services.json okundu!', 'success'); return; }
                    }
                    // Firebase web config formatı: { apiKey, projectId, ... }
                    if (json.apiKey && json.projectId) {
                      setFb({ projectId: json.projectId, apiKey: json.apiKey });
                      showToast('✅ Firebase config okundu!', 'success');
                      return;
                    }
                    // firebaseConfig objesi içinde
                    if (json.firebaseConfig) {
                      setFb({ projectId: json.firebaseConfig.projectId || '', apiKey: json.firebaseConfig.apiKey || '' });
                      showToast('✅ Firebase config okundu!', 'success');
                      return;
                    }
                    showToast('⚠️ Tanınan bir Firebase JSON formatı değil. Manuel girin.', 'warning');
                  } catch {
                    showToast('❌ JSON dosyası okunamadı!', 'error');
                  }
                };
                reader.readAsText(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, opacity: cfg.firebase.enabled ? 1 : 0.5, pointerEvents: cfg.firebase.enabled ? 'auto' : 'none' }}>
          <div>
            <label style={lbl}>Project ID</label>
            <input value={cfg.firebase.projectId} onChange={e => setFb({ projectId: e.target.value })} style={inp} placeholder="örn: my-project-12345" />
          </div>
          <div>
            <label style={lbl}>API Key</label>
            <input type="password" value={cfg.firebase.apiKey} onChange={e => setFb({ apiKey: e.target.value })} style={inp} placeholder="AIza..." />
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={lbl}>Doküman Yolu</label>
            <input value={cfg.firebase.docPath} onChange={e => setFb({ docPath: e.target.value })} style={inp} placeholder="sync/main" />
            <div style={{ color: '#334155', fontSize: '0.72rem', marginTop: 4 }}>
              Firestore'daki koleksiyon/doküman yolu. Örn: <code style={{ color: '#ff7043' }}>sync/main</code>
            </div>
          </div>
        </div>

        {/* Oluşturulan URL önizleme */}
        {cfg.firebase.projectId && cfg.firebase.apiKey && (
          <div style={{ marginTop: 12, background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: '8px 12px', fontSize: '0.7rem', color: '#334155', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {`https://firestore.googleapis.com/v1/projects/${cfg.firebase.projectId}/databases/(default)/documents/${cfg.firebase.docPath}?key=${cfg.firebase.apiKey.slice(0, 8)}...`}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
          <button
            onClick={handleFbTest}
            disabled={fbTesting || !cfg.firebase.projectId || !cfg.firebase.apiKey}
            style={{ padding: '9px 18px', background: 'rgba(255,87,34,0.12)', border: '1px solid rgba(255,87,34,0.25)', borderRadius: 9, color: '#ff7043', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem', opacity: (!cfg.firebase.projectId || !cfg.firebase.apiKey) ? 0.4 : 1 }}
          >
            {fbTesting ? '⟳ Test ediliyor...' : '🔍 Bağlantıyı Test Et'}
          </button>
          {fbTest && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: fbTest.ok ? '#10b981' : '#ef4444', fontWeight: 600 }}>
              {fbTest.ok ? '✅' : '❌'} {fbTest.msg}
            </div>
          )}
        </div>

        {/* Nasıl alınır? */}
        <details style={{ marginTop: 14 }}>
          <summary style={{ color: '#475569', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600 }}>📖 Firebase bilgilerini nereden alırım?</summary>
          <div style={{ marginTop: 10, background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '12px 14px', fontSize: '0.8rem', color: '#64748b', lineHeight: 1.8 }}>
            <div>1. <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer" style={{ color: '#ff7043' }}>console.firebase.google.com</a> → Projenizi seçin</div>
            <div>2. Proje Ayarları (⚙️) → Genel → Proje kimliği = <strong style={{ color: '#f1f5f9' }}>Project ID</strong></div>
            <div>3. Proje Ayarları → Web API anahtarı = <strong style={{ color: '#f1f5f9' }}>API Key</strong></div>
            <div>4. Firestore Database → Koleksiyon ve doküman adı = <strong style={{ color: '#f1f5f9' }}>Doküman Yolu</strong></div>
            <div style={{ marginTop: 8, color: '#f59e0b' }}>⚠️ Firestore güvenlik kurallarını ayarlamayı unutmayın!</div>
          </div>
        </details>
      </Card>

      {/* Supabase */}
      <Card title="⚡ Supabase">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, color: '#94a3b8', fontSize: '0.82rem' }}>
            Supabase PostgreSQL ile senkronizasyon (REST API)
          </div>
          <button
            onClick={() => setSb({ enabled: !cfg.supabase.enabled })}
            style={{ width: 48, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer', position: 'relative', background: cfg.supabase.enabled ? '#10b981' : '#334155', transition: 'background 0.2s', flexShrink: 0 }}
          >
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 4, left: cfg.supabase.enabled ? 26 : 4, transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, opacity: cfg.supabase.enabled ? 1 : 0.5, pointerEvents: cfg.supabase.enabled ? 'auto' : 'none' }}>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={lbl}>Supabase URL</label>
            <input value={cfg.supabase.url} onChange={e => setSb({ url: e.target.value })} style={inp} placeholder="https://xxxxxxxxxxxx.supabase.co" />
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={lbl}>Anon Key (public)</label>
            <input type="password" value={cfg.supabase.anonKey} onChange={e => setSb({ anonKey: e.target.value })} style={inp} placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." />
          </div>
          <div>
            <label style={lbl}>Tablo Adı</label>
            <input value={cfg.supabase.tableName} onChange={e => setSb({ tableName: e.target.value })} style={inp} placeholder="soba_sync" />
          </div>
        </div>

        {/* SQL şeması */}
        <details style={{ marginTop: 12 }}>
          <summary style={{ color: '#475569', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600 }}>📋 Gerekli SQL şeması</summary>
          <pre style={{ marginTop: 10, background: 'rgba(0,0,0,0.4)', borderRadius: 10, padding: '12px 14px', fontSize: '0.75rem', color: '#10b981', overflowX: 'auto', lineHeight: 1.6 }}>{`CREATE TABLE soba_sync (
  id TEXT PRIMARY KEY DEFAULT 'main',
  data JSONB NOT NULL,
  version INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS politikası (opsiyonel)
ALTER TABLE soba_sync ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON soba_sync FOR ALL USING (true);`}</pre>
        </details>

        <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
          <button
            onClick={handleSbTest}
            disabled={sbTesting || !cfg.supabase.url || !cfg.supabase.anonKey}
            style={{ padding: '9px 18px', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 9, color: '#10b981', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem', opacity: (!cfg.supabase.url || !cfg.supabase.anonKey) ? 0.4 : 1 }}
          >
            {sbTesting ? '⟳ Test ediliyor...' : '🔍 Bağlantıyı Test Et'}
          </button>
          {sbTest && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: sbTest.ok ? '#10b981' : '#ef4444', fontWeight: 600 }}>
              {sbTest.ok ? '✅' : '❌'} {sbTest.msg}
            </div>
          )}
        </div>

        <details style={{ marginTop: 14 }}>
          <summary style={{ color: '#475569', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600 }}>📖 Supabase bilgilerini nereden alırım?</summary>
          <div style={{ marginTop: 10, background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '12px 14px', fontSize: '0.8rem', color: '#64748b', lineHeight: 1.8 }}>
            <div>1. <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" style={{ color: '#10b981' }}>supabase.com/dashboard</a> → Projenizi seçin</div>
            <div>2. Settings → API → Project URL = <strong style={{ color: '#f1f5f9' }}>Supabase URL</strong></div>
            <div>3. Settings → API → anon public = <strong style={{ color: '#f1f5f9' }}>Anon Key</strong></div>
            <div>4. SQL Editor'da yukarıdaki şemayı çalıştırın</div>
          </div>
        </details>
      </Card>

      {/* Kaydet / Sıfırla */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={handleReset} style={{ padding: '11px 18px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#64748b', fontWeight: 700, cursor: 'pointer', fontSize: '0.88rem' }}>
          ↺ Varsayılana Sıfırla
        </button>
        <button onClick={handleSave} style={{ flex: 1, padding: '11px 0', background: 'linear-gradient(135deg, #ff5722, #ff7043)', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: '0.88rem' }}>
          💾 Bağlantı Ayarlarını Kaydet
        </button>
      </div>

      <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 10, padding: '12px 16px', fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.7 }}>
        ⚠️ Bağlantı ayarları değiştirildikten sonra <strong style={{ color: '#f1f5f9' }}>sayfayı yenileyin</strong> — yeni ayarlar aktif olur.<br />
        🔒 Bağlantı ayarları Firebase'e kaydedilir — tüm cihazlarda geçerlidir.
      </div>
    </div>
  );
}

// ── Arayüz Ayarları ───────────────────────────────────────────────────────────
function ArayuzAyarlari({ prefs, onChange, showToast }: {
  prefs: UIPrefs;
  onChange: (p: UIPrefs) => void;
  showToast: (m: string, t?: string) => void;
}) {
  const set = (patch: Partial<UIPrefs>) => onChange({ ...prefs, ...patch });

  const fontLabels: Record<number, string> = { 0.85: 'Küçük', 1: 'Normal', 1.1: 'Büyük', 1.2: 'Çok Büyük' };
  const animLabels: Record<string, string> = { hizli: '⚡ Hızlı', normal: '✨ Normal', yavas: '🐢 Yavaş', yok: '🚫 Yok' };
  const radiusLabels: Record<number, string> = { 6: 'Keskin', 10: 'Az', 14: 'Normal', 20: 'Yuvarlak' };

  return (
    <div style={{ display: 'grid', gap: 16 }}>

      {/* Hazır Temalar */}
      <Card title="🎨 Hazır Temalar">
        {/* Açık/Koyu mod toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)' }}>
          <span style={{ fontSize: '1.1rem' }}>{prefs.lightMode ? '☀️' : '🌙'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{prefs.lightMode ? 'Açık Tema' : 'Koyu Tema'}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{prefs.lightMode ? 'Ferah ve aydınlık görünüm' : 'Göz yormayan karanlık görünüm'}</div>
          </div>
          <div
            onClick={() => set({ lightMode: !prefs.lightMode })}
            style={{ width: 48, height: 26, borderRadius: 13, background: prefs.lightMode ? 'var(--accent)' : 'rgba(255,255,255,0.1)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}
          >
            <div style={{ position: 'absolute', top: 3, left: prefs.lightMode ? 25 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
          </div>
        </div>

        {/* Koyu temalar */}
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>🌙 Koyu Temalar</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginBottom: 16 }}>
          {THEMES.filter(t => !t.light).map(t => {
            const isActive = prefs.accent === t.accent && prefs.bgBase === t.bg && !prefs.lightMode;
            return (
              <button
                key={t.id}
                onClick={() => { set({ accent: t.accent, bgBase: t.bg, lightMode: false }); showToast(`${t.label} teması uygulandı!`, 'success'); }}
                style={{ padding: '12px 10px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', background: isActive ? `${t.accent}18` : 'rgba(0,0,0,0.3)', border: `2px solid ${isActive ? t.accent : 'rgba(255,255,255,0.07)'}`, transition: 'all 0.15s', position: 'relative', overflow: 'hidden' }}
              >
                <div style={{ display: 'flex', gap: 5, marginBottom: 7 }}>
                  <div style={{ width: 18, height: 18, borderRadius: 5, background: t.accent, boxShadow: `0 0 8px ${t.accent}60` }} />
                  <div style={{ width: 18, height: 18, borderRadius: 5, background: t.bg, border: '1px solid rgba(255,255,255,0.1)' }} />
                </div>
                <div style={{ fontWeight: 700, color: isActive ? t.accent : '#f1f5f9', fontSize: '0.82rem' }}>{t.label}</div>
                <div style={{ color: '#475569', fontSize: '0.7rem', marginTop: 2 }}>{t.desc}</div>
                {isActive && <div style={{ position: 'absolute', top: 7, right: 7, width: 16, height: 16, borderRadius: '50%', background: t.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', color: '#fff', fontWeight: 900 }}>✓</div>}
              </button>
            );
          })}
        </div>

        {/* Açık temalar */}
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>☀️ Açık Temalar — Güneş Altında Okunabilir</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
          {THEMES.filter(t => t.light).map(t => {
            const isActive = prefs.accent === t.accent && prefs.bgBase === t.bg && prefs.lightMode;
            return (
              <button
                key={t.id}
                onClick={() => { set({ accent: t.accent, bgBase: t.bg, lightMode: true }); showToast(`${t.label} teması uygulandı!`, 'success'); }}
                style={{ padding: '12px 10px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', background: isActive ? `${t.accent}18` : t.bg, border: `2px solid ${isActive ? t.accent : 'rgba(0,0,0,0.12)'}`, transition: 'all 0.15s', position: 'relative', overflow: 'hidden' }}
              >
                <div style={{ display: 'flex', gap: 5, marginBottom: 7 }}>
                  <div style={{ width: 18, height: 18, borderRadius: 5, background: t.accent, boxShadow: `0 0 6px ${t.accent}40` }} />
                  <div style={{ width: 18, height: 18, borderRadius: 5, background: t.bg, border: '1px solid rgba(0,0,0,0.15)' }} />
                </div>
                <div style={{ fontWeight: 700, color: isActive ? t.accent : '#0f172a', fontSize: '0.82rem' }}>{t.label}</div>
                <div style={{ color: '#475569', fontSize: '0.7rem', marginTop: 2 }}>{t.desc}</div>
                {isActive && <div style={{ position: 'absolute', top: 7, right: 7, width: 16, height: 16, borderRadius: '50%', background: t.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', color: '#fff', fontWeight: 900 }}>✓</div>}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Özel Renk */}
      <Card title="🖌️ Özel Renk Seçimi">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={lbl}>Ana Renk (Accent)</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                type="color" value={prefs.accent}
                onChange={e => set({ accent: e.target.value })}
                style={{ width: 48, height: 40, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'none', padding: 2 }}
              />
              <input
                type="text" value={prefs.accent}
                onChange={e => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) set({ accent: e.target.value }); }}
                style={{ ...inp, flex: 1, fontFamily: 'monospace', fontSize: '0.88rem' }}
                placeholder="#ff5722"
              />
            </div>
            {/* Hızlı renk paleti */}
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              {['#ff5722','#ef4444','#f59e0b','#10b981','#0ea5e9','#6366f1','#8b5cf6','#ec4899','#14b8a6','#84cc16'].map(c => (
                <button key={c} onClick={() => set({ accent: c })}
                  style={{ width: 26, height: 26, borderRadius: 7, background: c, border: prefs.accent === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer', boxShadow: prefs.accent === c ? `0 0 8px ${c}` : 'none', transition: 'all 0.15s' }} />
              ))}
            </div>
          </div>
          <div>
            <label style={lbl}>Arka Plan Rengi</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                type="color" value={prefs.bgBase}
                onChange={e => set({ bgBase: e.target.value })}
                style={{ width: 48, height: 40, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'none', padding: 2 }}
              />
              <input
                type="text" value={prefs.bgBase}
                onChange={e => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) set({ bgBase: e.target.value }); }}
                style={{ ...inp, flex: 1, fontFamily: 'monospace', fontSize: '0.88rem' }}
                placeholder="#070e1c"
              />
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              {['#070e1c','#050f1a','#0a0714','#061410','#0f0c04','#0a0f18','#0f0505','#111827'].map(c => (
                <button key={c} onClick={() => set({ bgBase: c })}
                  style={{ width: 26, height: 26, borderRadius: 7, background: c, border: prefs.bgBase === c ? '2px solid #fff' : '2px solid rgba(255,255,255,0.2)', cursor: 'pointer', transition: 'all 0.15s' }} />
              ))}
            </div>
          </div>
        </div>
        {/* Canlı önizleme */}
        <div style={{ marginTop: 14, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ background: prefs.bgBase, padding: '14px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: `linear-gradient(135deg, ${prefs.accent}, ${prefs.accent}cc)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem' }}>🔥</div>
            <div>
              <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.88rem' }}>Önizleme</div>
              <div style={{ color: '#475569', fontSize: '0.72rem' }}>Seçilen tema görünümü</div>
            </div>
            <button style={{ marginLeft: 'auto', background: `linear-gradient(135deg, ${prefs.accent}, ${prefs.accent}cc)`, border: 'none', borderRadius: 8, color: '#fff', padding: '6px 14px', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
              Buton
            </button>
          </div>
        </div>
      </Card>

      {/* Yazı & Boyut */}
      <Card title="🔤 Yazı & Boyut">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={lbl}>Yazı Boyutu</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {([0.85, 1, 1.1, 1.2] as const).map(s => (
                <button key={s} onClick={() => set({ fontScale: s })}
                  style={{ flex: 1, padding: '9px 4px', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', background: prefs.fontScale === s ? prefs.accent : 'rgba(255,255,255,0.05)', color: prefs.fontScale === s ? '#fff' : '#64748b', transition: 'all 0.15s' }}>
                  {fontLabels[s]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={lbl}>Köşe Yuvarlama</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {([6, 10, 14, 20] as const).map(r => (
                <button key={r} onClick={() => set({ cardRadius: r })}
                  style={{ flex: 1, padding: '9px 4px', border: 'none', borderRadius: r, cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem', background: prefs.cardRadius === r ? prefs.accent : 'rgba(255,255,255,0.05)', color: prefs.cardRadius === r ? '#fff' : '#64748b', transition: 'all 0.15s' }}>
                  {radiusLabels[r]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Animasyon & Mod */}
      <Card title="⚡ Animasyon & Görünüm">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={lbl}>Animasyon Hızı</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['hizli', 'normal', 'yavas', 'yok'] as const).map(s => (
                <button key={s} onClick={() => set({ animSpeed: s })}
                  style={{ flex: 1, padding: '9px 6px', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.78rem', background: prefs.animSpeed === s ? prefs.accent : 'rgba(255,255,255,0.05)', color: prefs.animSpeed === s ? '#fff' : '#64748b', transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
                  {animLabels[s]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={lbl}>Kompakt Mod</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'rgba(0,0,0,0.2)', borderRadius: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#f1f5f9', fontSize: '0.85rem', fontWeight: 600 }}>Sıkışık Görünüm</div>
                <div style={{ color: '#475569', fontSize: '0.72rem', marginTop: 2 }}>Tablo ve padding'leri küçültür</div>
              </div>
              <button
                onClick={() => set({ compactMode: !prefs.compactMode })}
                style={{ width: 48, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer', position: 'relative', background: prefs.compactMode ? prefs.accent : '#334155', transition: 'background 0.2s', flexShrink: 0 }}
              >
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 4, left: prefs.compactMode ? 26 : 4, transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
              </button>
            </div>
          </div>
        </div>
      </Card>

      {/* Sıfırla */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={() => { onChange(DEFAULT_PREFS); showToast('Varsayılan tema geri yüklendi!', 'success'); }}
          style={{ flex: 1, padding: '11px 0', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#64748b', fontWeight: 700, cursor: 'pointer', fontSize: '0.88rem' }}>
          ↺ Varsayılana Sıfırla
        </button>
        <button
          onClick={() => showToast('Tema kaydedildi!', 'success')}
          style={{ flex: 2, padding: '11px 0', background: `linear-gradient(135deg, ${prefs.accent}, ${prefs.accent}cc)`, border: 'none', borderRadius: 10, color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: '0.88rem' }}>
          💾 Temayı Kaydet
        </button>
      </div>

      {/* Floating Buton Ayarları */}
      <Card title="🔘 Kayan Buton Ayarları">
        <p style={{ color: '#64748b', fontSize: '0.82rem', marginBottom: 14 }}>Ekrandaki kayan butonları göster/gizle. Butonları istediğiniz yere sürükleyebilirsiniz.</p>
        <div style={{ display: 'grid', gap: 10 }}>
          {[
            { key: 'showAIButton' as const, icon: '🤖', label: 'AI Asistan Butonu', desc: 'Sol alttaki yapay zeka butonu' },
            { key: 'showFABButton' as const, icon: '➕', label: 'Hızlı İşlem Butonu', desc: 'Sağ alttaki hızlı satış/gelir/gider butonu' },
            { key: 'showReportButton' as const, icon: '🐛', label: 'Hata Bildirme Butonu', desc: 'Hata bildirme, not alma ve takip butonu' },
          ].map(item => (
            <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'rgba(0,0,0,0.2)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ fontSize: '1.3rem' }}>{item.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.85rem' }}>{item.label}</div>
                <div style={{ color: '#475569', fontSize: '0.75rem', marginTop: 2 }}>{item.desc}</div>
              </div>
              <div
                onClick={() => onChange({ ...prefs, [item.key]: !prefs[item.key] })}
                style={{ width: 48, height: 26, borderRadius: 13, background: prefs[item.key] ? prefs.accent : '#334155', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}
              >
                <div style={{ position: 'absolute', top: 3, left: prefs[item.key] ? 25 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
              </div>
            </div>
          ))}
          <button
            onClick={() => {
              localStorage.removeItem('aiBtnPos');
              localStorage.removeItem('fabBtnPos');
              localStorage.removeItem('reportBtnPos');
              showToast('Buton konumları sıfırlandı!', 'success');
            }}
            style={{ padding: '9px 0', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#64748b', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
            📍 Buton Konumlarını Sıfırla
          </button>
        </div>
      </Card>
    </div>
  );
}

function FV({ label, value, onChange, type = 'text', inputMode }: { label: string; value: string; onChange: (v: string) => void; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'] }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input type={type} inputMode={inputMode} value={value} onChange={e => onChange(e.target.value)} style={inp} />
    </div>
  );
}

// ── Kategori Yönetim Component ────────────────────────────────────────────────
function KategoriYonetim({ db, save }: { db: DB; save: (fn: (prev: DB) => DB) => void }) {
  const { showToast } = useToast();
  const { showConfirm } = useConfirm();
  const cats = db.productCategories || [];
  const [yeniAd, setYeniAd] = useState('');
  const [yeniIcon, setYeniIcon] = useState('📦');
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', icon: '' });

  const addKat = () => {
    const ad = yeniAd.trim();
    if (!ad) { showToast('Kategori adı gerekli!', 'error'); return; }
    const id = ad.toLowerCase()
      .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
      .replace(/ı/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
      .replace(/[^a-z0-9]/g,'_').replace(/_+/g,'_');
    if (cats.find(c => c.id === id)) { showToast('Bu ID zaten var!', 'error'); return; }
    const nowIso = new Date().toISOString();
    save(prev => ({
      ...prev,
      productCategories: [...(prev.productCategories || []), { id, name: ad, icon: yeniIcon, createdAt: nowIso }],
    }));
    setYeniAd(''); setYeniIcon('📦');
    showToast('Kategori eklendi!', 'success');
  };

  const saveEdit = (id: string) => {
    if (!editForm.name.trim()) { showToast('Ad gerekli!', 'error'); return; }
    save(prev => ({
      ...prev,
      productCategories: (prev.productCategories || []).map(c =>
        c.id === id ? { ...c, name: editForm.name.trim(), icon: editForm.icon || c.icon } : c
      ),
    }));
    setEditId(null);
    showToast('Güncellendi!', 'success');
  };

  const deleteKat = (id: string) => {
    const used = db.products.filter(p => !p.deleted && p.category === id).length;
    if (used > 0) { showToast(`${used} ürün bu kategoriyi kullanıyor, silemezsiniz!`, 'error'); return; }
    showConfirm('Kategori Sil', 'Bu kategoriyi silmek istiyor musunuz?', () => {
      save(prev => ({ ...prev, productCategories: (prev.productCategories || []).filter(c => c.id !== id) }));
      showToast('Kategori silindi!', 'success');
    });
  };

  return (
    <Card title="🏷️ Ürün Kategorileri">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {cats.length === 0 && (
          <div style={{ color: '#475569', textAlign: 'center', padding: 24, fontSize: '0.88rem' }}>Henüz kategori yok</div>
        )}
        {cats.map(c => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.3)', borderRadius: 10, padding: '10px 14px', border: '1px solid rgba(255,255,255,0.06)' }}>
            {editId === c.id ? (
              <>
                <input value={editForm.icon} onChange={e => setEditForm(f => ({ ...f, icon: e.target.value }))} style={{ ...inp, width: 48, textAlign: 'center', fontSize: '1.1rem', padding: '6px' }} maxLength={2} />
                <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} style={{ ...inp, flex: 1, padding: '7px 10px' }} autoFocus />
                <button onClick={() => saveEdit(c.id)} style={{ background: '#10b981', border: 'none', borderRadius: 8, color: '#fff', padding: '6px 12px', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem' }}>✓</button>
                <button onClick={() => setEditId(null)} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 8, color: '#94a3b8', padding: '6px 10px', cursor: 'pointer' }}>✕</button>
              </>
            ) : (
              <>
                <span style={{ fontSize: '1.4rem', minWidth: 28, textAlign: 'center' }}>{c.icon}</span>
                <span style={{ flex: 1, color: '#f1f5f9', fontWeight: 600 }}>{c.name}</span>
                <span style={{ color: '#334155', fontSize: '0.75rem', fontFamily: 'monospace' }}>{c.id}</span>
                <span style={{ color: '#475569', fontSize: '0.78rem' }}>{db.products.filter(p => !p.deleted && p.category === c.id).length} ürün</span>
                <button onClick={() => { setEditId(c.id); setEditForm({ name: c.name, icon: c.icon }); }} style={{ background: 'rgba(59,130,246,0.12)', border: 'none', borderRadius: 8, color: '#60a5fa', padding: '5px 10px', cursor: 'pointer', fontSize: '0.8rem' }}>✏️</button>
                <button onClick={() => deleteKat(c.id)} style={{ background: 'rgba(239,68,68,0.1)', border: 'none', borderRadius: 8, color: '#ef4444', padding: '5px 10px', cursor: 'pointer', fontSize: '0.8rem' }}>🗑️</button>
              </>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={yeniIcon} onChange={e => setYeniIcon(e.target.value)} style={{ ...inp, width: 52, textAlign: 'center', fontSize: '1.2rem' }} placeholder="📦" maxLength={2} />
        <input value={yeniAd} onChange={e => setYeniAd(e.target.value)} onKeyDown={e => e.key === 'Enter' && addKat()} style={{ ...inp, flex: 1 }} placeholder="Yeni kategori adı..." />
        <button onClick={addKat} style={{ padding: '10px 18px', background: 'linear-gradient(135deg, #ff5722, #ff7043)', border: 'none', borderRadius: 10, color: '#fff', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }}>+ Ekle</button>
      </div>
      <p style={{ color: '#334155', fontSize: '0.75rem', marginTop: 10 }}>Ürünleri kullanan kategoriler silinemez.</p>
    </Card>
  );
}

// ── Hakkında Paneli ───────────────────────────────────────────────────────────
function AboutPanel({ db }: { db: DB }) {
  const totalRecords = [db.products, db.sales, db.cari, db.kasa, db.invoices || [], db.orders, db.suppliers].reduce((s, a) => s + a.length, 0);
  const lsKB = Math.round(new Blob([localStorage.getItem('sobaYonetim') || '']).size / 1024);

  const [appCfg, setAppCfg] = useState(loadAppConfig);
  const [editVersion, setEditVersion] = useState(false);
  const [versionInput, setVersionInput] = useState(appCfg.version);
  const [versionErr, setVersionErr] = useState('');
  const [expandedVersion, setExpandedVersion] = useState<string | null>(CHANGELOG[0]?.version || null);

  const saveVersion = () => {
    if (!validateVersion(versionInput)) {
      setVersionErr('Format: 2.1.0 veya 2.1.0-beta');
      return;
    }
    const next = { ...appCfg, version: versionInput.trim() };
    setAppCfg(next);
    saveAppConfig(next);
    setEditVersion(false);
    setVersionErr('');
  };

  const techStack = [
    { name: 'React 19', color: '#61dafb' },
    { name: 'TypeScript 6', color: '#3178c6' },
    { name: 'Vite 7', color: '#646cff' },
    { name: 'Tailwind CSS v4', color: '#38bdf8' },
    { name: 'Firebase Firestore', color: '#ffa000' },
    { name: 'Capacitor 8', color: '#119eff' },
    { name: 'Recharts', color: '#8884d8' },
    { name: 'Radix UI', color: '#7c3aed' },
  ];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Logo & Başlık */}
      <div style={{ background: 'linear-gradient(135deg, rgba(255,87,34,0.12), rgba(255,87,34,0.04))', borderRadius: 20, border: '1px solid rgba(255,87,34,0.2)', padding: '32px 28px', textAlign: 'center' }}>
        <div style={{ fontSize: '4rem', marginBottom: 12 }}>{appCfg.appIcon}</div>
        <h2 style={{ color: '#f1f5f9', fontWeight: 900, fontSize: '1.8rem', letterSpacing: '-0.03em', margin: 0 }}>{appCfg.appName}</h2>
        <p style={{ color: '#ff7043', fontWeight: 700, fontSize: '0.9rem', marginTop: 4 }}>{APP_SUBTITLE}</p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Versiyon — tıklanabilir */}
          {editVersion ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                value={versionInput}
                onChange={e => { setVersionInput(e.target.value); setVersionErr(''); }}
                style={{ padding: '4px 10px', background: 'rgba(0,0,0,0.4)', border: `1px solid ${versionErr ? '#ef4444' : '#334155'}`, borderRadius: 8, color: '#f1f5f9', fontSize: '0.85rem', width: 120 }}
                placeholder="2.1.0-beta"
                onKeyDown={e => { if (e.key === 'Enter') saveVersion(); if (e.key === 'Escape') { setEditVersion(false); setVersionErr(''); } }}
                autoFocus
              />
              <button onClick={saveVersion} style={{ padding: '4px 10px', background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 7, color: '#10b981', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>✓</button>
              <button onClick={() => { setEditVersion(false); setVersionErr(''); }} style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 7, color: '#64748b', cursor: 'pointer', fontSize: '0.8rem' }}>✕</button>
              {versionErr && <span style={{ color: '#ef4444', fontSize: '0.75rem' }}>{versionErr}</span>}
            </div>
          ) : (
            <button onClick={() => { setEditVersion(true); setVersionInput(appCfg.version); }} title="Versiyonu düzenle" style={{ background: 'rgba(255,87,34,0.15)', border: '1px solid rgba(255,87,34,0.3)', borderRadius: 8, padding: '4px 12px', color: '#ff7043', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace' }}>
              v{appCfg.version} ✏️
            </button>
          )}
          <span style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '4px 12px', color: '#94a3b8', fontSize: '0.8rem', fontWeight: 600 }}>
            DB v{db._version || 1}
          </span>
          <span style={{ background: 'rgba(16,185,129,0.12)', borderRadius: 8, padding: '4px 12px', color: '#10b981', fontSize: '0.8rem', fontWeight: 600 }}>
            {totalRecords} kayıt · {lsKB} KB
          </span>
        </div>
      </div>

      {/* Teknoloji Stack */}
      <Card title="⚙️ Teknoloji">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {techStack.map(t => (
            <span key={t.name} style={{ background: `${t.color}15`, border: `1px solid ${t.color}30`, borderRadius: 8, padding: '5px 12px', color: t.color, fontSize: '0.82rem', fontWeight: 700 }}>
              {t.name}
            </span>
          ))}
        </div>
      </Card>

      {/* Veritabanı Özeti */}
      <Card title="🗄️ Veritabanı Özeti">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
          {[
            { icon: '📦', label: 'Ürünler', count: db.products.filter(p => !p.deleted).length },
            { icon: '🛒', label: 'Satışlar', count: db.sales.filter(s => !s.deleted).length },
            { icon: '👤', label: 'Cari', count: db.cari.filter(c => !c.deleted).length },
            { icon: '💰', label: 'Kasa Kayıtları', count: db.kasa.filter(k => !k.deleted).length },
            { icon: '🧾', label: 'Faturalar', count: (db.invoices || []).filter(i => !i.deleted).length },
            { icon: '🏭', label: 'Tedarikçiler', count: db.suppliers.length },
            { icon: '📋', label: 'Siparişler', count: db.orders.length },
            { icon: '📈', label: 'Stok Hareketleri', count: db.stockMovements.length },
          ].map(s => (
            <div key={s.label} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.3rem', marginBottom: 4 }}>{s.icon}</div>
              <div style={{ color: '#f1f5f9', fontWeight: 800, fontSize: '1.1rem' }}>{s.count}</div>
              <div style={{ color: '#475569', fontSize: '0.72rem', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Sürüm Kitapçığı — Changelog */}
      <Card title="📖 Sürüm Geçmişi">
        <div style={{ display: 'grid', gap: 8 }}>
          {CHANGELOG.map(entry => {
            const isExpanded = expandedVersion === entry.version;
            const isLatest = entry.version === CHANGELOG[0]?.version;
            return (
              <div key={entry.version} style={{ background: isExpanded ? 'rgba(255,87,34,0.05)' : 'rgba(0,0,0,0.2)', borderRadius: 12, border: `1px solid ${isExpanded ? 'rgba(255,87,34,0.2)' : 'rgba(255,255,255,0.05)'}`, overflow: 'hidden', transition: 'all 0.2s' }}>
                {/* Başlık satırı */}
                <button
                  onClick={() => setExpandedVersion(isExpanded ? null : entry.version)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                >
                  <span style={{ fontFamily: 'monospace', fontWeight: 800, color: isLatest ? '#ff7043' : '#94a3b8', fontSize: '0.88rem', minWidth: 60 }}>v{entry.version}</span>
                  {isLatest && <span style={{ background: 'rgba(255,87,34,0.2)', color: '#ff7043', borderRadius: 5, padding: '1px 7px', fontSize: '0.68rem', fontWeight: 700 }}>SON</span>}
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.88rem' }}>{entry.title}</div>
                    <div style={{ color: '#475569', fontSize: '0.75rem', marginTop: 1 }}>{entry.date}</div>
                  </div>
                  <span style={{ color: '#334155', fontSize: '0.85rem', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'none' }}>▼</span>
                </button>

                {/* Detay */}
                {isExpanded && (
                  <div style={{ padding: '0 16px 14px' }}>
                    <p style={{ color: '#64748b', fontSize: '0.82rem', marginBottom: 12, lineHeight: 1.6 }}>{entry.summary}</p>
                    <div style={{ display: 'grid', gap: 5 }}>
                      {entry.changes.map((change, i) => {
                        const cfg = CHANGE_TYPE_CONFIG[change.type];
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                            <span style={{ background: cfg.bg, color: cfg.color, borderRadius: 5, padding: '1px 7px', fontSize: '0.68rem', fontWeight: 700, whiteSpace: 'nowrap', marginTop: 1 }}>{cfg.label}</span>
                            <span style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.5 }}>{change.text}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Lisans */}
      <Card title="📄 Lisans & Geliştirici">
        <div style={{ display: 'grid', gap: 10 }}>
          {[
            { label: 'Uygulama', value: `${appCfg.appName} — ${APP_SUBTITLE}` },
            { label: 'Geliştirici', value: 'Pars Pelet' },
            { label: 'Lisans', value: 'Özel Kullanım — Tüm hakları saklıdır' },
            { label: 'Platform', value: 'Web (PWA) + Android (Capacitor)' },
          ].map(row => (
            <div key={row.label} style={{ padding: '10px 14px', background: 'rgba(0,0,0,0.2)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 12 }}>
              <span style={{ color: '#475569', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', minWidth: 80 }}>{row.label}</span>
              <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.85rem' }}>{row.value}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}


