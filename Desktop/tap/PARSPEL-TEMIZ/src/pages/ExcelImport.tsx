import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { genId, formatMoney } from '@/lib/utils-tr';
import type { DB } from '@/types';

interface Props { db: DB; save: (fn: (prev: DB) => DB) => void; }

interface ImportPreview {
  cari: Array<{ name: string; balance: number; toplamAlis: number; durum: string }>;
  sales: Array<{ date: string; customer: string; product: string; qty: number; total: number }>;
  giderler: Array<{ date: string; category: string; desc: string; amount: number }>;
}

/* Convert Excel serial date or "DD.MM.YYYY" string to ISO */
function toISO(val: unknown): string {
  if (typeof val === 'number' && val > 40000) {
    return new Date((val - 25569) * 86400 * 1000).toISOString();
  }
  if (typeof val === 'string') {
    const m = val.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (m) return new Date(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`).toISOString();
  }
  return new Date().toISOString();
}

function parseOzetTablo(rows: unknown[][]): ImportPreview['cari'] {
  const result: ImportPreview['cari'] = [];
  for (const r of rows) {
    if (typeof r[0] !== 'number' || !r[1]) continue;
    const name = String(r[1]).trim();
    const toplamAlis = typeof r[7] === 'number' ? r[7] : 0;
    const bakiye = typeof r[9] === 'number' ? r[9] : 0;
    const durum = String(r[10] || '');
    if (!name) continue;
    result.push({ name, balance: bakiye, toplamAlis, durum });
  }
  return result;
}

function parseSayfa1(rows: unknown[][]): ImportPreview['sales'] {
  const result: ImportPreview['sales'] = [];
  let headerFound = false;
  for (const r of rows) {
    if (!headerFound) {
      if (String(r[0]).toUpperCase().includes('TARİH') || String(r[0]).toUpperCase().includes('TARIH')) { headerFound = true; }
      continue;
    }
    const customer = String(r[1] || '').trim();
    if (!customer) continue;
    const total = typeof r[10] === 'number' ? r[10] : (typeof r[6] === 'number' ? r[6] : 0);
    if (total <= 0) continue;
    const sobaQty = typeof r[4] === 'number' ? r[4] : 0;
    const peletKg = typeof r[7] === 'number' ? r[7] : 0;
    const desc = String(r[2] || '').trim();
    const product = sobaQty > 0 && peletKg > 0 ? `Soba+Pelet` : sobaQty > 0 ? 'Soba' : peletKg > 0 ? 'Pelet' : desc || 'Soba';
    result.push({
      date: toISO(r[0]),
      customer,
      product,
      qty: sobaQty || peletKg || 1,
      total,
    });
  }
  return result;
}

function parseGiderler(rows: unknown[][]): ImportPreview['giderler'] {
  const result: ImportPreview['giderler'] = [];
  let currentCategory = '';
  for (const r of rows) {
    const col0 = String(r[0] || '');
    if (col0.startsWith('📌')) { currentCategory = col0.replace('📌', '').trim(); continue; }
    if (typeof r[0] !== 'number') continue;
    const dateVal = r[1];
    const desc = String(r[2] || r[3] || '').trim();
    const amount = typeof r[6] === 'number' ? r[6] : 0;
    if (!amount || amount <= 0) continue;
    result.push({ date: toISO(dateVal), category: currentCategory, desc, amount });
  }
  return result;
}

export default function ExcelImport({ db, save }: Props) {
  const { showToast } = useToast();
  const { showConfirm } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [opts, setOpts] = useState({ cari: true, sales: true, giderler: true });
  const [activeTab, setActiveTab] = useState<'cari' | 'satis' | 'gider'>('cari');

  const handleFile = (file: File) => {
    setLoading(true);
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = XLSX.read(ev.target?.result as ArrayBuffer, { type: 'array' });
        const ozetSheet = wb.Sheets['ÖZET TABLO'];
        const sayfa1Sheet = wb.Sheets['Sayfa1'];
        const giderSheet = wb.Sheets['GİDERLER'];
        if (!ozetSheet && !sayfa1Sheet && !giderSheet) {
          showToast('Bu dosya tanımlanamadı. Lütfen SOBA TAKİP dosyasını yükleyin!', 'error');
          setLoading(false);
          return;
        }
        const ozetRows: unknown[][] = ozetSheet ? XLSX.utils.sheet_to_json(ozetSheet, { header: 1, defval: '' }) : [];
        const s1Rows: unknown[][] = sayfa1Sheet ? XLSX.utils.sheet_to_json(sayfa1Sheet, { header: 1, defval: '' }) : [];
        const giderRows: unknown[][] = giderSheet ? XLSX.utils.sheet_to_json(giderSheet, { header: 1, defval: '' }) : [];
        setPreview({
          cari: parseOzetTablo(ozetRows),
          sales: parseSayfa1(s1Rows),
          giderler: parseGiderler(giderRows),
        });
      } catch (e) {
        showToast('Dosya okunamadı: ' + String(e), 'error');
      }
      setLoading(false);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const doImport = () => {
    if (!preview) return;
    const totalCount = (opts.cari ? preview.cari.length : 0) + (opts.sales ? preview.sales.length : 0) + (opts.giderler ? preview.giderler.length : 0);
    showConfirm('Excel\'den İçe Aktar', `Toplam ${totalCount} kayıt sisteme aktarılacak. Mevcut verilerle çakışma kontrolü yapılır ama bazı mükerrer kayıtlar oluşabilir. Devam edilsin mi?`, () => {
      const nowIso = new Date().toISOString();
      save(prev => {
        let newDB = { ...prev };

        /* --- CARİ --- */
        if (opts.cari && preview.cari.length > 0) {
          const existing = new Set(prev.cari.map(c => c.name.trim().toLowerCase()));
          const toAdd = preview.cari.filter(c => !existing.has(c.name.trim().toLowerCase()));
          const newCari = toAdd.map(c => ({
            id: genId(), name: c.name, type: 'musteri' as const,
            balance: c.balance, phone: '', email: '', taxNo: '', address: '',
            lastTransaction: nowIso, createdAt: nowIso, updatedAt: nowIso,
          }));
          newDB = { ...newDB, cari: [...prev.cari, ...newCari] };
        }

        /* --- SATIŞLAR --- */
        if (opts.sales && preview.sales.length > 0) {
          const newSales = preview.sales.map(s => {
            const cari = newDB.cari.find(c => c.name.trim().toLowerCase() === s.customer.trim().toLowerCase());
            const unitPrice = s.qty > 0 ? Math.round(s.total / s.qty) : s.total;
            return {
              id: genId(), productName: s.product, productId: '' as string,
              quantity: s.qty, unitPrice, cost: 0,
              discount: 0, discountAmount: 0, subtotal: s.total,
              total: s.total, profit: 0, payment: 'cari' as const,
              customerName: s.customer, cariId: cari?.id,
              items: [{ productId: '', productName: s.product, quantity: s.qty, unitPrice, cost: 0, total: s.total }],
              status: 'tamamlandi' as const,
              createdAt: s.date, updatedAt: s.date,
            };
          });
          newDB = { ...newDB, sales: [...prev.sales, ...newSales] };
        }

        /* --- GİDERLER → KASA --- */
        if (opts.giderler && preview.giderler.length > 0) {
          const kasaCatMap: Record<string, string> = {
            'NAKLİYE': 'nakliye', 'PERSONEL': 'personel', 'İŞLETME GİDERLERİ': 'isletme',
            'MARKET / ALIŞ VERİŞ': 'market', 'PELET YÜKLEME': 'pelet_yukleme',
            'PELET BOŞALTMA': 'pelet_bosaltma', 'KASA': 'kasa_gider',
          };
          const newKasa = preview.giderler.map(g => ({
            id: genId(), type: 'gider' as const,
            category: kasaCatMap[g.category] || 'diger',
            amount: g.amount, kasa: 'banka' as const,
            description: `[Excel] ${g.category}: ${g.desc}`.slice(0, 150),
            createdAt: g.date, updatedAt: g.date,
          }));
          newDB = { ...newDB, kasa: [...prev.kasa, ...newKasa] };
        }

        return newDB;
      });
      showToast(`✅ İçe aktarma tamamlandı! ${opts.cari ? preview.cari.length + ' cari' : ''} ${opts.sales ? preview.sales.length + ' satış' : ''} ${opts.giderler ? preview.giderler.length + ' gider' : ''} eklendi.`);
      setPreview(null);
    });
  };

  const durum2color = (d: string) => d.includes('Borç') ? '#ef4444' : d.includes('Fazla') ? '#10b981' : '#64748b';

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Drop Zone */}
      {!preview && (
        <Card title="📥 Excel Dosyası Seç — SOBA TAKİP (.xlsm / .xlsx)">
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            style={{ padding: '50px 20px', background: 'rgba(59,130,246,0.05)', border: '2px dashed rgba(59,130,246,0.25)', borderRadius: 14, textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(59,130,246,0.5)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(59,130,246,0.25)')}
          >
            <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>📊</div>
            {loading ? (
              <div style={{ color: '#60a5fa', fontWeight: 700 }}>Dosya okunuyor...</div>
            ) : (
              <>
                <div style={{ color: '#93c5fd', fontWeight: 700, fontSize: '1rem', marginBottom: 6 }}>Dosyayı buraya sürükleyin ya da tıklayın</div>
                <div style={{ color: '#475569', fontSize: '0.82rem' }}>SOBA_TAKIP_GIDERLI.xlsm · .xlsx · .xls formatları desteklenir</div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 10 }}>
                  {[['ÖZET TABLO', '→ Cariler', '#8b5cf6'], ['Sayfa1', '→ Satışlar', '#10b981'], ['GİDERLER', '→ Kasa', '#f59e0b']].map(([s, t, c]) => (
                    <span key={s} style={{ background: `${c}12`, border: `1px solid ${c}25`, borderRadius: 6, padding: '3px 10px', fontSize: '0.73rem', color: c }}><strong>{s}</strong> {t}</span>
                  ))}
                </div>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".xlsm,.xlsx,.xls" onChange={handleFileInput} style={{ display: 'none' }} />
        </Card>
      )}

      {/* Preview */}
      {preview && (
        <>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {[
              { key: 'cari' as const, icon: '👥', label: 'Cari Müşteri', count: preview.cari.length, color: '#8b5cf6' },
              { key: 'sales' as const, icon: '🛒', label: 'Satış Kaydı', count: preview.sales.length, color: '#10b981' },
              { key: 'giderler' as const, icon: '💸', label: 'Gider Kaydı', count: preview.giderler.length, color: '#f59e0b' },
            ].map(s => (
              <div key={s.key} onClick={() => setOpts(o => ({ ...o, [s.key]: !o[s.key] }))}
                style={{ background: opts[s.key] ? `${s.color}12` : 'rgba(0,0,0,0.2)', borderRadius: 12, padding: '14px', border: `2px solid ${opts[s.key] ? s.color + '40' : 'transparent'}`, cursor: 'pointer', transition: 'all 0.2s', textAlign: 'center' }}>
                <div style={{ fontSize: '1.3rem', marginBottom: 4 }}>{opts[s.key] ? '✅' : '⬜'} {s.icon}</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 900, color: opts[s.key] ? s.color : '#334155' }}>{s.count}</div>
                <div style={{ color: '#475569', fontSize: '0.73rem', marginTop: 2, fontWeight: 600 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Tab Preview */}
          <Card title="👁️ Önizleme — aktarmak istediklerinizi seçmek için yukarıya tıklayın">
            <div style={{ display: 'flex', gap: 4, marginBottom: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 4 }}>
              {[{ id: 'cari' as const, label: `👥 Cariler (${preview.cari.length})` }, { id: 'satis' as const, label: `🛒 Satışlar (${preview.sales.length})` }, { id: 'gider' as const, label: `💸 Giderler (${preview.giderler.length})` }].map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ flex: 1, padding: '7px 4px', border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem', background: activeTab === t.id ? 'linear-gradient(135deg,#ff5722,#ff7043)' : 'transparent', color: activeTab === t.id ? '#fff' : '#64748b' }}>{t.label}</button>
              ))}
            </div>

            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {activeTab === 'cari' && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead><tr>{['Müşteri', 'Toplam Alış', 'Bakiye', 'Durum'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {preview.cari.map((c, i) => {
                      const existingCari = db.cari.find(x => x.name.trim().toLowerCase() === c.name.trim().toLowerCase());
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: existingCari ? 0.5 : 1 }}>
                          <td style={tdStyle}>
                            {existingCari && <span style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', borderRadius: 4, padding: '1px 5px', fontSize: '0.68rem', marginRight: 5 }}>VAR</span>}
                            {c.name}
                          </td>
                          <td style={{ ...tdStyle, color: '#3b82f6' }}>{formatMoney(c.toplamAlis)}</td>
                          <td style={{ ...tdStyle, color: c.balance > 0 ? '#ef4444' : c.balance < 0 ? '#10b981' : '#64748b', fontWeight: 700 }}>{formatMoney(Math.abs(c.balance))}</td>
                          <td style={{ ...tdStyle }}><span style={{ color: durum2color(c.durum), fontSize: '0.78rem' }}>{c.durum}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {activeTab === 'satis' && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead><tr>{['Tarih', 'Müşteri', 'Ürün', 'Adet', 'Tutar'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {preview.sales.map((s, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ ...tdStyle, color: '#64748b' }}>{new Date(s.date).toLocaleDateString('tr-TR')}</td>
                        <td style={tdStyle}>{s.customer}</td>
                        <td style={{ ...tdStyle, color: '#94a3b8' }}>{s.product}</td>
                        <td style={{ ...tdStyle, color: '#64748b', textAlign: 'right' }}>{s.qty}</td>
                        <td style={{ ...tdStyle, color: '#10b981', fontWeight: 700, textAlign: 'right' }}>{formatMoney(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {activeTab === 'gider' && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead><tr>{['Tarih', 'Kategori', 'Açıklama', 'Tutar'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {preview.giderler.map((g, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ ...tdStyle, color: '#64748b' }}>{new Date(g.date).toLocaleDateString('tr-TR')}</td>
                        <td style={{ ...tdStyle, color: '#f59e0b', fontWeight: 600 }}>{g.category}</td>
                        <td style={{ ...tdStyle, color: '#94a3b8', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.desc}</td>
                        <td style={{ ...tdStyle, color: '#ef4444', fontWeight: 700, textAlign: 'right' }}>{formatMoney(g.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>

          {/* Warning about existing */}
          {(() => {
            const existing = preview.cari.filter(c => db.cari.some(x => x.name.trim().toLowerCase() === c.name.trim().toLowerCase()));
            return existing.length > 0 ? (
              <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, padding: '10px 14px', color: '#f59e0b', fontSize: '0.82rem' }}>
                ⚠️ <strong>{existing.length} müşteri</strong> zaten kayıtlı (tabloda "VAR" işaretli). Bunlar tekrar aktarılmayacak; sadece yeni {preview.cari.length - existing.length} müşteri eklenecek.
              </div>
            ) : null;
          })()}

          {/* Totals */}
          <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: '0.85rem' }}>
              <span style={{ color: '#64748b' }}>Toplam Satış Tutarı:</span>
              <span style={{ color: '#10b981', fontWeight: 800 }}>{formatMoney(preview.sales.reduce((s, x) => s + x.total, 0))}</span>
              <span style={{ color: '#64748b' }}>Toplam Gider:</span>
              <span style={{ color: '#ef4444', fontWeight: 800 }}>{formatMoney(preview.giderler.reduce((s, x) => s + x.amount, 0))}</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={doImport} disabled={!opts.cari && !opts.sales && !opts.giderler}
              style={{ flex: 1, padding: '14px 0', background: (!opts.cari && !opts.sales && !opts.giderler) ? 'rgba(0,0,0,0.2)' : 'linear-gradient(135deg,#ff5722,#ff7043)', border: 'none', borderRadius: 12, color: '#fff', fontWeight: 900, cursor: (!opts.cari && !opts.sales && !opts.giderler) ? 'not-allowed' : 'pointer', fontSize: '0.95rem' }}>
              ✅ {(opts.cari ? preview.cari.filter(c => !db.cari.some(x => x.name.toLowerCase() === c.name.toLowerCase())).length : 0) + (opts.sales ? preview.sales.length : 0) + (opts.giderler ? preview.giderler.length : 0)} Kaydı Sisteme Aktar
            </button>
            <button onClick={() => setPreview(null)} style={{ padding: '14px 20px', background: 'rgba(255,255,255,0.04)', border: 'none', borderRadius: 12, color: '#64748b', cursor: 'pointer', fontWeight: 700 }}>
              ✕ İptal
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: '18px 20px' }}>
      <h3 style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 700, marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</h3>
      {children}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: '6px 10px', textAlign: 'left', color: '#334155', fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' };
const tdStyle: React.CSSProperties = { padding: '7px 10px', color: '#e2e8f0' };
