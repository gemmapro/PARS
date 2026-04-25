import { useState } from 'react';
import { hashPass } from './LoginScreen';
import { genId } from '@/lib/utils-tr';

const SETUP_DONE_KEY = 'sobaYonetim_setupDone';

// Firebase auth URL (setup sırasında parolayı Firebase'e yaz)
const FIREBASE_PROJECT = 'pars-001-bae2d';
const FIREBASE_API_KEY = 'AIzaSyDxr7PNnh_-kt04sX2VcwER8coM2UWPg5k';
const FIREBASE_AUTH_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/config/auth?key=${FIREBASE_API_KEY}`;

async function savePassToFirebase(hash: string): Promise<void> {
  try {
    await fetch(FIREBASE_AUTH_URL, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { hash: { stringValue: hash }, updatedAt: { stringValue: new Date().toISOString() } } }),
      signal: AbortSignal.timeout(8000),
    });
    // Oturum cache'ine de yaz
    try { sessionStorage.setItem('sobaYonetim_hc', hash); } catch { /* ignore */ }
  } catch { /* Firebase hata — giriş ekranı tekrar yükleyecek */ }
}

export function isSetupDone(): boolean {
  return !!localStorage.getItem(SETUP_DONE_KEY);
}

export function getSetupData(): SetupResult | null {
  try {
    const raw = localStorage.getItem('sobaYonetim_setupData');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

interface KasaDef { name: string; icon: string; enabled: boolean; }
interface UrunDef { name: string; category: string; cost: number; price: number; stock: number; minStock: number; }
interface OrtakDef { name: string; share: number | undefined; phone: string; }
interface KategoriDef { id: string; name: string; icon: string; enabled: boolean; }

interface SetupResult {
  companyName: string;
  city: string;
  kasalar: { id: string; name: string; icon: string }[];
  urunler: { id: string; name: string; category: string; cost: number; price: number; stock: number; minStock: number; createdAt: string; updatedAt: string }[];
  ortaklar: { id: string; name: string; share: number | undefined; phone: string; createdAt: string }[];
  cariOrtaklar: { id: string; name: string; type: 'musteri' | 'tedarikci'; balance: number; phone: string; createdAt: string; updatedAt: string }[];
  kategoriler: { id: string; name: string; icon: string; createdAt: string }[];
}

interface Props {
  onComplete: (data: SetupResult) => void;
}

const DEFAULT_KASALAR: KasaDef[] = [
  { name: 'Nakit', icon: '💵', enabled: true },
  { name: 'Banka', icon: '🏦', enabled: true },
  { name: 'Pos/Kart', icon: '💳', enabled: false },
];

const DEFAULT_KATEGORILER: KategoriDef[] = [
  { id: 'soba',     name: 'Soba',        icon: '🔥', enabled: true },
  { id: 'aksesuar', name: 'Aksesuar',     icon: '🔧', enabled: true },
  { id: 'yedek',    name: 'Yedek Parça',  icon: '⚙️', enabled: true },
  { id: 'boru',     name: 'Boru',         icon: '🔩', enabled: true },
  { id: 'pelet',    name: 'Pelet',        icon: '🪵', enabled: true },
];

const emptyUrun = (): UrunDef => ({ name: '', category: 'soba', cost: 0, price: 0, stock: 0, minStock: 5 });
const emptyOrtak = (): OrtakDef => ({ name: '', share: undefined, phone: '' });

export default function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form verileri
  const [companyName, setCompanyName] = useState('');
  const [city, setCity] = useState('');
  const [kategoriler, setKategoriler] = useState<KategoriDef[]>(DEFAULT_KATEGORILER);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [kasalar, setKasalar] = useState<KasaDef[]>(DEFAULT_KASALAR.map(k => ({ ...k })));
  const [urunler, setUrunler] = useState<UrunDef[]>([emptyUrun()]);
  const [ortaklar, setOrtaklar] = useState<OrtakDef[]>([]);
  const [ortakCariAc, setOrtakCariAc] = useState<boolean[]>([]);

  const STEPS = [
    { title: 'Hoş Geldiniz',      icon: '🔥', desc: 'Kurulum sihirbazı' },
    { title: 'İşletme Bilgileri', icon: '🏪', desc: 'Firma adı ve konum' },
    { title: 'Kasa Tanımları',    icon: '💰', desc: 'Kullanacağınız kasalar' },
    { title: 'Ürün Kategorileri', icon: '🏷️', desc: 'Ürünleri hangi kategorilere ayıracaksınız?' },
    { title: 'Ürün Ekle',         icon: '📦', desc: 'İsteğe bağlı — atlanabilir' },
    { title: 'Ortak Tanımla',     icon: '🤝', desc: 'İsteğe bağlı — atlanabilir' },
    { title: 'Güvenlik',          icon: '🔒', desc: 'Giriş parolası' },
  ];

  const setErr = (msg: string) => { setError(msg); setTimeout(() => setError(''), 3500); };

  const validate = (): boolean => {
    if (step === 1) {
      if (!companyName.trim()) { setErr('İşletme adı gerekli!'); return false; }
    }
    if (step === 2) {
      if (!kasalar.some(k => k.enabled)) { setErr('En az bir kasa seçin!'); return false; }
    }
    if (step === 3) {
      if (!kategoriler.some(k => k.enabled)) { setErr('En az bir kategori seçin!'); return false; }
    }
    if (step === 4) {
      // Ürünler isteğe bağlı ama eklendiyse zorunlu alan kontrolü
      for (const u of urunler) {
        if (u.name && (!u.price || !u.cost)) { setErr(`"${u.name}" için alış ve satış fiyatı girin!`); return false; }
      }
    }
    if (step === 5) {
      for (let i = 0; i < ortaklar.length; i++) {
        if (!ortaklar[i].name.trim()) { setErr(`${i + 1}. ortak için ad gerekli!`); return false; }
      }
    }
    if (step === 6) {
      // Parola girilmişse doğrula, girilmemişse atla
      if (pass.length > 0 && pass.length < 4) { setErr('Parola en az 4 karakter olmalı!'); return false; }
      if (pass.length > 0 && pass !== pass2) { setErr('Parolalar eşleşmiyor!'); return false; }
    }
    return true;
  };

  const next = () => { if (!validate()) return; setStep(s => s + 1); };
  const prev = () => { setError(''); setStep(s => s - 1); };

  const finish = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      // Parola girilmişse kaydet, girilmemişse atla
      if (pass.length >= 4) {
        const hashed = await hashPass(pass);
        await savePassToFirebase(hashed);
      }

      const now = new Date().toISOString();
      const kasaList = kasalar.filter(k => k.enabled).map(k => ({ id: genId(), name: k.name, icon: k.icon }));

      const kategoriList = kategoriler
        .filter(k => k.enabled)
        .map(k => ({ id: k.id, name: k.name, icon: k.icon, createdAt: now }));

      const urunList = urunler
        .filter(u => u.name.trim())
        .map(u => ({ id: genId(), name: u.name.trim(), category: u.category, cost: u.cost, price: u.price, stock: u.stock, minStock: u.minStock || 5, brand: '', barcode: '', description: '', createdAt: now, updatedAt: now }));

      const ortakList = ortaklar
        .filter(o => o.name.trim())
        .map(o => ({ id: genId(), name: o.name.trim(), share: o.share, phone: o.phone, createdAt: now }));

      // Ortak için otomatik cari aç
      const cariOrtakList = ortaklar
        .filter((o, i) => o.name.trim() && ortakCariAc[i] !== false)
        .map(o => ({
          id: genId(), name: o.name.trim(), type: 'musteri' as const,
          balance: 0, phone: o.phone, taxNo: '', email: '', address: '', note: 'Ortak cari hesabı',
          createdAt: now, updatedAt: now,
        }));

      const result: SetupResult = { companyName: companyName.trim(), city: city.trim(), kasalar: kasaList, kategoriler: kategoriList, urunler: urunList, ortaklar: ortakList, cariOrtaklar: cariOrtakList };
      localStorage.setItem('sobaYonetim_setupData', JSON.stringify(result));
      localStorage.setItem(SETUP_DONE_KEY, '1');
      onComplete(result);
    } catch { setErr('Bir hata oluştu, tekrar deneyin.'); }
    setLoading(false);
  };

  const progress = (step / (STEPS.length - 1)) * 100;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'linear-gradient(135deg, #040810 0%, #0a1628 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', -apple-system, sans-serif", padding: 16, overflowY: 'auto' }}>
      {/* Progress bar */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 3, background: '#1e293b', zIndex: 10 }}>
        <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg,#ff5722,#ff9800)', transition: 'width 0.4s ease' }} />
      </div>

      <div style={{ width: '100%', maxWidth: 480, background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(40px)', borderRadius: 24, border: '1px solid rgba(255,255,255,0.06)', padding: '40px 32px 36px', boxShadow: '0 30px 100px rgba(0,0,0,0.6)', marginTop: 20 }}>
        {/* Adım noktaları */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 28 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{ width: i === step ? 24 : 7, height: 7, borderRadius: 4, background: i < step ? '#ff5722' : i === step ? '#ff9800' : 'rgba(255,255,255,0.1)', transition: 'all 0.3s' }} />
          ))}
        </div>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ width: 60, height: 60, margin: '0 auto 14px', borderRadius: '50%', background: 'linear-gradient(135deg,#ff5722,#ff9800)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.7rem', boxShadow: '0 8px 24px rgba(255,87,34,0.35)' }}>
            {STEPS[step].icon}
          </div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 800, background: 'linear-gradient(135deg,#ff5722,#ff9800)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 2 }}>
            {STEPS[step].title}
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.8rem', margin: 0 }}>{STEPS[step].desc}</p>
        </div>

        {/* İçerik */}
        <div style={{ minHeight: 180 }}>
          {step === 0 && <StepWelcome steps={STEPS} />}
          {step === 1 && <StepCompany companyName={companyName} setCompanyName={setCompanyName} city={city} setCity={setCity} />}
          {step === 2 && <StepKasa kasalar={kasalar} setKasalar={setKasalar} />}
          {step === 3 && <StepKategoriler kategoriler={kategoriler} setKategoriler={setKategoriler} />}
          {step === 4 && <StepUrunler urunler={urunler} setUrunler={setUrunler} kategoriler={kategoriler.filter(k => k.enabled)} />}
          {step === 5 && <StepOrtaklar ortaklar={ortaklar} setOrtaklar={setOrtaklar} ortakCariAc={ortakCariAc} setOrtakCariAc={setOrtakCariAc} />}
          {step === 6 && <StepPassword pass={pass} setPass={setPass} pass2={pass2} setPass2={setPass2} />}
        </div>

        {/* Hata */}
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '10px 14px', marginTop: 12, color: '#ef4444', fontSize: '0.85rem', fontWeight: 600 }}>
            ⚠️ {error}
          </div>
        )}

        {/* Butonlar */}
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          {step > 0 && (
            <button onClick={prev} style={{ padding: '12px 18px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, background: 'transparent', color: '#64748b', cursor: 'pointer', fontWeight: 600 }}>
              ← Geri
            </button>
          )}
          {/* Atla butonu (ürün ve ortak adımları) */}
          {(step === 4 || step === 5) && (
            <button onClick={() => setStep(s => s + 1)} style={{ padding: '12px 18px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, background: 'transparent', color: '#475569', cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem' }}>
              Atla →
            </button>
          )}
          <button
            onClick={step === STEPS.length - 1 ? finish : next}
            disabled={loading}
            style={{ flex: 1, padding: '13px 0', background: loading ? '#334155' : 'linear-gradient(135deg,#ff5722,#ff9800)', border: 'none', borderRadius: 12, color: '#fff', fontWeight: 700, fontSize: '0.95rem', cursor: loading ? 'not-allowed' : 'pointer', boxShadow: loading ? 'none' : '0 4px 20px rgba(255,87,34,0.3)', transition: 'all 0.2s' }}
          >
            {loading ? 'Kaydediliyor...' : step === STEPS.length - 1 ? '✅ Kurulumu Tamamla' : 'Devam →'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Adım 0: Hoş Geldiniz ──
function StepWelcome({ steps }: { steps: { title: string; icon: string; desc: string }[] }) {
  return (
    <div>
      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem', lineHeight: 1.7, marginBottom: 20, textAlign: 'center' }}>
        <strong style={{ color: '#ff7043' }}>SOLHAN</strong> Yönetim Sistemine hoş geldiniz.<br />
        Bu sihirbaz sistemi işletmenize göre yapılandıracak.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.slice(1).map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '11px 14px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontSize: '1.2rem', width: 28, textAlign: 'center' }}>{s.icon}</span>
            <div>
              <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '0.88rem' }}>{s.title}</div>
              <div style={{ color: '#475569', fontSize: '0.75rem' }}>{s.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Adım 1: İşletme ──
function StepCompany({ companyName, setCompanyName, city, setCity }: { companyName: string; setCompanyName: (v: string) => void; city: string; setCity: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={lbl}>İşletme / Firma Adı *</label>
        <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="örn: Solhan Isıtma Sistemleri" style={inp} autoFocus />
      </div>
      <div>
        <label style={lbl}>Şehir / İlçe <span style={{ color: '#334155' }}>(isteğe bağlı)</span></label>
        <input value={city} onChange={e => setCity(e.target.value)} placeholder="örn: Şanlıurfa / Siverek" style={inp} />
      </div>
    </div>
  );
}

// ── Adım 2: Kasa ──
function StepKasa({ kasalar, setKasalar }: { kasalar: KasaDef[]; setKasalar: React.Dispatch<React.SetStateAction<KasaDef[]>> }) {
  const toggle = (i: number) => setKasalar(prev => prev.map((k, idx) => idx === i ? { ...k, enabled: !k.enabled } : k));
  return (
    <div>
      <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.82rem', marginBottom: 14 }}>Kullanacağınız kasa/hesap türlerini seçin. Sonradan değiştirilebilir.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {kasalar.map((k, i) => (
          <div key={k.name} onClick={() => toggle(i)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderRadius: 12, cursor: 'pointer', border: `1px solid ${k.enabled ? 'rgba(255,87,34,0.4)' : 'rgba(255,255,255,0.07)'}`, background: k.enabled ? 'rgba(255,87,34,0.08)' : 'rgba(255,255,255,0.02)', transition: 'all 0.2s' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.3rem' }}>{k.icon}</span>
              <span style={{ color: k.enabled ? '#f1f5f9' : '#64748b', fontWeight: 600 }}>{k.name}</span>
            </div>
            <div style={{ width: 20, height: 20, borderRadius: '50%', background: k.enabled ? '#ff5722' : 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: '#fff', transition: 'all 0.2s' }}>
              {k.enabled ? '✓' : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Adım 3: Kategoriler ──
function StepKategoriler({ kategoriler, setKategoriler }: { kategoriler: KategoriDef[]; setKategoriler: React.Dispatch<React.SetStateAction<KategoriDef[]>> }) {
  const toggle = (i: number) => setKategoriler(prev => prev.map((k, idx) => idx === i ? { ...k, enabled: !k.enabled } : k));
  const [yeniAd, setYeniAd] = useState('');
  const [yeniIcon, setYeniIcon] = useState('📦');
  const addKat = () => {
    const ad = yeniAd.trim();
    if (!ad) return;
    const id = ad.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    setKategoriler(prev => [...prev, { id, name: ad, icon: yeniIcon, enabled: true }]);
    setYeniAd(''); setYeniIcon('📦');
  };
  return (
    <div>
      <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.82rem', marginBottom: 14 }}>Hangi ürün kategorilerini kullanacaksınız? Sonradan değiştirilebilir.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {kategoriler.map((k, i) => (
          <div key={k.id} onClick={() => toggle(i)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 12, cursor: 'pointer', border: `1px solid ${k.enabled ? 'rgba(255,87,34,0.4)' : 'rgba(255,255,255,0.07)'}`, background: k.enabled ? 'rgba(255,87,34,0.08)' : 'rgba(255,255,255,0.02)', transition: 'all 0.2s' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.3rem' }}>{k.icon}</span>
              <span style={{ color: k.enabled ? '#f1f5f9' : '#64748b', fontWeight: 600 }}>{k.name}</span>
            </div>
            <div style={{ width: 20, height: 20, borderRadius: '50%', background: k.enabled ? '#ff5722' : 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: '#fff', transition: 'all 0.2s' }}>
              {k.enabled ? '✓' : ''}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={yeniIcon} onChange={e => setYeniIcon(e.target.value)} style={{ ...inp, width: 52, textAlign: 'center', fontSize: '1.2rem' }} placeholder="🏷️" maxLength={2} />
        <input value={yeniAd} onChange={e => setYeniAd(e.target.value)} onKeyDown={e => e.key === 'Enter' && addKat()} style={{ ...inp, flex: 1 }} placeholder="Yeni kategori adı..." />
        <button onClick={addKat} style={{ padding: '10px 16px', background: 'rgba(255,87,34,0.12)', border: '1px solid rgba(255,87,34,0.3)', borderRadius: 10, color: '#ff7043', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }}>+ Ekle</button>
      </div>
    </div>
  );
}

// ── Adım 4: Ürünler ──
function StepUrunler({ urunler, setUrunler, kategoriler }: { urunler: UrunDef[]; setUrunler: React.Dispatch<React.SetStateAction<UrunDef[]>>; kategoriler: KategoriDef[] }) {
  const update = (i: number, field: keyof UrunDef, value: string | number) =>
    setUrunler(prev => prev.map((u, idx) => idx === i ? { ...u, [field]: value } : u));
  const add = () => setUrunler(prev => [...prev, emptyUrun()]);
  const remove = (i: number) => setUrunler(prev => prev.filter((_, idx) => idx !== i));
  const cats = kategoriler.length > 0 ? kategoriler : DEFAULT_KATEGORILER;

  return (
    <div>
      <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.82rem', marginBottom: 14 }}>Başlangıç ürünlerinizi ekleyin. İsim boş bırakılan satırlar atlanır.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
        {urunler.map((u, i) => (
          <div key={i} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ color: '#64748b', fontSize: '0.8rem', fontWeight: 600 }}>ÜRÜN {i + 1}</span>
              {urunler.length > 1 && <button onClick={() => remove(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.85rem' }}>✕</button>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ gridColumn: '1/-1' }}>
                <input value={u.name} onChange={e => update(i, 'name', e.target.value)} placeholder="Ürün adı" style={inp} />
              </div>
              <div>
                <select value={u.category} onChange={e => update(i, 'category', e.target.value)} style={inp}>
                  {cats.map(k => <option key={k.id} value={k.id}>{k.icon} {k.name}</option>)}
                </select>
              </div>
              <div>
                <input type="number" value={u.stock || ''} onChange={e => update(i, 'stock', parseFloat(e.target.value) || 0)} placeholder="Stok adedi" style={inp} min={0} />
              </div>
              <div>
                <input type="number" value={u.cost || ''} onChange={e => update(i, 'cost', parseFloat(e.target.value) || 0)} placeholder="Alış fiyatı ₺" style={inp} min={0} />
              </div>
              <div>
                <input type="number" value={u.price || ''} onChange={e => update(i, 'price', parseFloat(e.target.value) || 0)} placeholder="Satış fiyatı ₺" style={inp} min={0} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <button onClick={add} style={{ width: '100%', marginTop: 10, padding: '10px 0', background: 'rgba(255,87,34,0.08)', border: '1px dashed rgba(255,87,34,0.3)', borderRadius: 10, color: '#ff7043', cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem' }}>
        + Ürün Ekle
      </button>
    </div>
  );
}

// ── Adım 5: Ortaklar ──
function StepOrtaklar({ ortaklar, setOrtaklar, ortakCariAc, setOrtakCariAc }: {
  ortaklar: OrtakDef[];
  setOrtaklar: React.Dispatch<React.SetStateAction<OrtakDef[]>>;
  ortakCariAc: boolean[];
  setOrtakCariAc: React.Dispatch<React.SetStateAction<boolean[]>>;
}) {
  const update = (i: number, field: keyof OrtakDef, value: string | number | undefined) =>
    setOrtaklar(prev => prev.map((o, idx) => idx === i ? { ...o, [field]: value } : o));
  const toggleCari = (i: number) =>
    setOrtakCariAc(prev => { const next = [...prev]; next[i] = !(next[i] ?? true); return next; });
  const add = () => { setOrtaklar(prev => [...prev, emptyOrtak()]); setOrtakCariAc(prev => [...prev, true]); };
  const remove = (i: number) => { setOrtaklar(prev => prev.filter((_, idx) => idx !== i)); setOrtakCariAc(prev => prev.filter((_, idx) => idx !== i)); };

  return (
    <div>
      <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.82rem', marginBottom: 14 }}>
        İşletme ortaklarını tanımlayın. Her ortak için otomatik <strong style={{ color: '#ff7043' }}>cari hesap</strong> açılır — tahsilat ve emanet takibi yapılabilir.
      </p>
      {ortaklar.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#334155' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🤝</div>
          <p style={{ fontSize: '0.85rem' }}>Ortak yok — isterseniz ekleyin</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 300, overflowY: 'auto', paddingRight: 4 }}>
          {ortaklar.map((o, i) => (
            <div key={i} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ color: '#64748b', fontSize: '0.8rem', fontWeight: 600 }}>ORTAK {i + 1}</span>
                <button onClick={() => remove(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.85rem' }}>✕</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ gridColumn: '1/-1' }}>
                  <input value={o.name} onChange={e => update(i, 'name', e.target.value)} placeholder="Ortak adı *" style={inp} />
                </div>
                <div>
                  <input type="number" value={o.share ?? ''} onChange={e => update(i, 'share', e.target.value === '' ? undefined : parseFloat(e.target.value))} placeholder="Hisse % (opsiyonel)" style={inp} min={0} max={100} />
                </div>
                <div>
                  <input value={o.phone} onChange={e => update(i, 'phone', e.target.value)} placeholder="Telefon (opsiyonel)" style={inp} />
                </div>
              </div>
              {/* Cari aç toggle */}
              <div onClick={() => toggleCari(i)} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer', userSelect: 'none' }}>
                <div style={{ width: 36, height: 20, borderRadius: 10, background: (ortakCariAc[i] ?? true) ? '#ff5722' : '#334155', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 3, left: (ortakCariAc[i] ?? true) ? 18 : 3, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                </div>
                <span style={{ fontSize: '0.82rem', color: (ortakCariAc[i] ?? true) ? '#ff7043' : '#475569', fontWeight: 600 }}>
                  {(ortakCariAc[i] ?? true) ? '✓ Otomatik cari hesap açılacak' : 'Cari hesap açılmayacak'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      <button onClick={add} style={{ width: '100%', marginTop: 10, padding: '10px 0', background: 'rgba(255,87,34,0.08)', border: '1px dashed rgba(255,87,34,0.3)', borderRadius: 10, color: '#ff7043', cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem' }}>
        + Ortak Ekle
      </button>
    </div>
  );
}

// ── Adım 5: Parola ──
function StepPassword({ pass, setPass, pass2, setPass2 }: { pass: string; setPass: (v: string) => void; pass2: string; setPass2: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.82rem', margin: 0 }}>Uygulamaya giriş için parola belirleyin. En az 4 karakter.</p>
      <div>
        <label style={lbl}>Parola *</label>
        <input type={show ? 'text' : 'password'} value={pass} onChange={e => setPass(e.target.value)} placeholder="Min. 4 karakter" style={inp} autoFocus />
      </div>
      <div>
        <label style={lbl}>Parola Tekrar *</label>
        <input type={show ? 'text' : 'password'} value={pass2} onChange={e => setPass2(e.target.value)} placeholder="Aynı parolayı tekrar girin" style={inp} />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#475569', fontSize: '0.82rem' }}>
        <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} />
        Parolayı göster
      </label>
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', marginBottom: 5, color: '#64748b', fontSize: '0.8rem', fontWeight: 600 };
const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#f1f5f9', fontSize: '0.88rem', boxSizing: 'border-box', outline: 'none' };
