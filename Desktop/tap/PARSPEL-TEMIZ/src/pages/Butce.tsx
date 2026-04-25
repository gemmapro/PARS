import { useState, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { genId, formatMoney, parseBankDate } from '@/lib/utils-tr';
import type { DB, BudgetCategory } from '@/types';

interface Props { db: DB; save: (fn: (prev: DB) => DB) => void; }

const PRESET_CATEGORIES: Omit<BudgetCategory, 'id'>[] = [
  { name: 'Kira', icon: '🏠', monthlyLimit: 5000, color: '#3b82f6', kasaCategories: ['kira'] },
  { name: 'Elektrik/Su/Gaz', icon: '⚡', monthlyLimit: 1500, color: '#f59e0b', kasaCategories: ['elektrik', 'su', 'gaz', 'fatura'] },
  { name: 'Personel Maaş', icon: '👥', monthlyLimit: 20000, color: '#8b5cf6', kasaCategories: ['maas', 'personel', 'maaş'] },
  { name: 'Ham Madde/Stok', icon: '📦', monthlyLimit: 15000, color: '#10b981', kasaCategories: ['alis', 'stok', 'hammadde', 'alis_fatura'] },
  { name: 'Nakliye/Kargo', icon: '🚚', monthlyLimit: 3000, color: '#06b6d4', kasaCategories: ['nakliye', 'kargo', 'tasima'] },
  { name: 'Reklam/Pazarlama', icon: '📢', monthlyLimit: 2000, color: '#ec4899', kasaCategories: ['reklam', 'pazarlama', 'tanitim'] },
  { name: 'Diğer Giderler', icon: '📋', monthlyLimit: 5000, color: '#64748b', kasaCategories: ['diger', 'genel'] },
];

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

export default function Butce({ db, save }: Props) {
  const { showToast } = useToast();
  const { showConfirm } = useConfirm();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [bankModal, setBankModal] = useState(false);
  const [importResult, setImportResult] = useState<{ total: number; matched: number; entries: Array<{ date: string; desc: string; amount: number; type: 'gelir' | 'gider' }> } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Omit<BudgetCategory, 'id'>>({ name: '', icon: '📋', monthlyLimit: 0, color: '#64748b', kasaCategories: [] });

  const budgets: BudgetCategory[] = db.budgets || [];

  const yearlyData = useMemo(() => {
    return Array.from({ length: 12 }, (_, m) => {
      const start = new Date(year, m, 1).toISOString();
      const end = new Date(year, m + 1, 0, 23, 59, 59).toISOString();
      const monthKasa = db.kasa.filter(k => !k.deleted && k.createdAt >= start && k.createdAt <= end);
      const gelir = monthKasa.filter(k => k.type === 'gelir').reduce((s, k) => s + k.amount, 0);
      const gider = monthKasa.filter(k => k.type === 'gider').reduce((s, k) => s + k.amount, 0);
      return { name: MONTHS[m].slice(0, 3), gelir, gider, net: gelir - gider };
    });
  }, [db.kasa, year]);

  const startOfMonth = new Date(year, month, 1).toISOString();
  const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

  const monthKasa = useMemo(() => db.kasa.filter(k => !k.deleted && k.createdAt >= startOfMonth && k.createdAt <= endOfMonth), [db.kasa, startOfMonth, endOfMonth]);
  const monthExpenses = monthKasa.filter(k => k.type === 'gider');
  const monthIncome = monthKasa.filter(k => k.type === 'gelir');
  const totalExpense = monthExpenses.reduce((s, k) => s + k.amount, 0);
  const totalIncome = monthIncome.reduce((s, k) => s + k.amount, 0);
  const totalBudget = budgets.reduce((s, b) => s + b.monthlyLimit, 0);

  const categorySpend = useMemo(() => {
    const matchesKw = (kc: string, cat: string, desc: string) => {
      const kl = kc.toLowerCase();
      if (cat === kl || cat.startsWith(kl + '_') || cat.endsWith('_' + kl)) return true;
      const words = desc.split(/\s+/);
      return words.some(w => w === kl);
    };
    return budgets.map(b => {
      const spent = monthExpenses.filter(k => {
        const cat = (k.category || '').toLowerCase();
        const desc = (k.description || '').toLowerCase();
        return b.kasaCategories.some(kc => matchesKw(kc, cat, desc));
      }).reduce((s, k) => s + k.amount, 0);
      return { ...b, spent, remaining: b.monthlyLimit - spent, pct: b.monthlyLimit > 0 ? Math.min(100, (spent / b.monthlyLimit) * 100) : 0 };
    });
  }, [budgets, monthExpenses]);

  const uncategorized = useMemo(() => {
    const matchedIds = new Set<string>();
    const matchesKw = (kc: string, cat: string, desc: string) => {
      const kl = kc.toLowerCase();
      if (cat === kl || cat.startsWith(kl + '_') || cat.endsWith('_' + kl)) return true;
      const words = desc.split(/\s+/);
      return words.some(w => w === kl);
    };
    categorySpend.forEach(b => {
      monthExpenses.forEach(k => {
        const cat = (k.category || '').toLowerCase();
        const desc = (k.description || '').toLowerCase();
        if (b.kasaCategories.some(kc => matchesKw(kc, cat, desc))) matchedIds.add(k.id);
      });
    });
    return monthExpenses.filter(k => !matchedIds.has(k.id));
  }, [categorySpend, monthExpenses]);

  const initPresets = () => {
    showConfirm('Hazır Kategoriler', 'Standart gider kategorileri eklenecek. Mevcut kategoriler korunacak. Devam edilsin mi?', () => {
      save(prev => {
        const existing = prev.budgets || [];
        const toAdd = PRESET_CATEGORIES.filter(p => !existing.some(e => e.name === p.name));
        return { ...prev, budgets: [...existing, ...toAdd.map(p => ({ ...p, id: genId() }))] };
      });
      showToast(`${PRESET_CATEGORIES.length} kategori eklendi!`, 'success');
    });
  };

  const openAdd = () => { setForm({ name: '', icon: '📋', monthlyLimit: 0, color: '#64748b', kasaCategories: [] }); setEditId(null); setModal(true); };
  const openEdit = (b: BudgetCategory) => { setForm({ name: b.name, icon: b.icon, monthlyLimit: b.monthlyLimit, color: b.color, kasaCategories: [...b.kasaCategories] }); setEditId(b.id); setModal(true); };

  const handleSave = () => {
    if (!form.name) { showToast('Kategori adı gerekli!', 'error'); return; }
    save(prev => {
      const budgets = [...(prev.budgets || [])];
      if (editId) {
        const i = budgets.findIndex(b => b.id === editId);
        if (i >= 0) budgets[i] = { ...budgets[i], ...form };
      } else {
        budgets.push({ ...form, id: genId() });
      }
      return { ...prev, budgets };
    });
    showToast(editId ? 'Güncellendi!' : 'Kategori eklendi!', 'success');
    setModal(false);
  };

  const deleteCat = (id: string) => {
    showConfirm('Sil', 'Bu bütçe kategorisi silinecek!', () => {
      save(prev => ({ ...prev, budgets: (prev.budgets || []).filter(b => b.id !== id) }));
      showToast('Silindi!', 'success');
    });
  };

  const parseBankCSV = (text: string) => {
    const lines = text.split('\n').filter(l => l.trim());
    const entries: Array<{ date: string; desc: string; amount: number; type: 'gelir' | 'gider' }> = [];
    lines.forEach(line => {
      const cols = line.split(/[,;\t]/).map(c => c.replace(/["']/g, '').trim());
      if (cols.length < 3) return;
      const dateStr = cols.find(c => /\d{2}[./-]\d{2}[./-]\d{2,4}/.test(c)) || '';
      const amtStr = cols.find(c => /[\d.,]+/.test(c) && parseFloat(c.replace(/\./g, '').replace(',', '.')) > 0);
      const amount = amtStr ? Math.abs(parseFloat(amtStr.replace(/\./g, '').replace(',', '.'))) : 0;
      if (!amount || amount < 1) return;
      const desc = cols.filter(c => c !== dateStr && c !== amtStr && c.length > 2).join(' — ').slice(0, 120);
      const isGelir = cols.some(c => /alacak|gelen|tahsilat|gelir/i.test(c));
      if (dateStr && amount > 0) entries.push({ date: dateStr, desc, amount, type: isGelir ? 'gelir' : 'gider' });
    });
    return entries;
  };

  const parseXLSX = (buf: ArrayBuffer): string => {
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    return rows.map(row => (row as unknown[]).map(cell => String(cell ?? '')).join(';')).join('\n');
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    const isXLSX = ext === 'xlsx' || ext === 'xls';

    const processText = (text: string) => {
      const entries = parseBankCSV(text);
      if (entries.length === 0) { showToast('Uyumlu veri bulunamadı. Dosya formatını kontrol edin!', 'error'); return; }
      let matched = 0;
      entries.forEach(e => {
        const matchesKw = (kc: string) => { const kl = kc.toLowerCase(); return e.desc.toLowerCase().split(/\s+/).some((w: string) => w === kl); };
        const cat = budgets.find(b => b.kasaCategories.some(matchesKw));
        if (cat) matched++;
      });
      setImportResult({ total: entries.length, matched, entries });
    };

    if (isXLSX) {
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const text = parseXLSX(ev.target?.result as ArrayBuffer);
          processText(text);
        } catch {
          showToast('Excel dosyası okunamadı. Farklı bir format deneyin.', 'error');
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = ev => processText(ev.target?.result as string);
      reader.readAsText(file, 'utf-8');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const confirmImport = () => {
    if (!importResult) return;
    const nowIso = new Date().toISOString();
    let failedDateCount = 0;
    save(prev => {
      const newEntries = importResult.entries.map(e => {
        const cat = budgets.find(b => b.kasaCategories.some(kc => {
          const kl = kc.toLowerCase(); const dl = e.desc.toLowerCase();
          return dl.split(/\s+/).some((w: string) => w === kl);
        }));
        const parsedDate = e.date ? parseBankDate(e.date) : null;
        if (e.date && !parsedDate) failedDateCount++;
        return {
          id: genId(), type: e.type, category: cat?.kasaCategories[0] || 'banka_ekstere', amount: e.amount, kasa: 'banka' as const,
          description: `[Ekstre] ${e.desc}`.slice(0, 150),
          createdAt: parsedDate ? parsedDate.toISOString() : nowIso,
          updatedAt: nowIso,
        };
      });
      return { ...prev, kasa: [...prev.kasa, ...newEntries] };
    });
    if (failedDateCount > 0) {
      showToast(`✅ ${importResult.total} işlem aktarıldı. ⚠️ ${failedDateCount} kaydın tarihi okunamadı, bugünün tarihi kullanıldı.`, 'success');
    } else {
      showToast(`✅ ${importResult.total} işlem kasa'ya aktarıldı!`, 'success');
    }
    setImportResult(null);
    setBankModal(false);
  };

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      {/* Header Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
        {[
          { icon: '📤', label: 'Aylık Gelir', value: formatMoney(totalIncome), color: '#10b981' },
          { icon: '📥', label: 'Aylık Gider', value: formatMoney(totalExpense), color: '#ef4444' },
          { icon: '💡', label: 'Toplam Bütçe', value: formatMoney(totalBudget), color: '#3b82f6' },
          { icon: '⚖️', label: 'Bütçe Kalan', value: formatMoney(totalBudget - totalExpense), color: totalBudget - totalExpense >= 0 ? '#10b981' : '#ef4444' },
          { icon: '📋', label: 'Kategorisiz', value: String(uncategorized.length) + ' işlem', color: '#f59e0b' },
        ].map(s => (
          <div key={s.label} style={{ background: `linear-gradient(135deg, ${s.color}12, ${s.color}06)`, borderRadius: 14, padding: '14px 16px', border: `1px solid ${s.color}20` }}>
            <div style={{ fontSize: '0.9rem', marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 900, color: s.color }}>{s.value}</div>
            <div style={{ color: '#475569', fontSize: '0.7rem', marginTop: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Period + Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={month} onChange={e => setMonth(parseInt(e.target.value))} style={sel}>{MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}</select>
        <select value={year} onChange={e => setYear(parseInt(e.target.value))} style={sel}>
          {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {budgets.length === 0 && <button onClick={initPresets} style={btnSecondary}>✨ Hazır Kategoriler</button>}
          <button onClick={() => { setBankModal(true); setImportResult(null); }} style={btnSecondary}>🏦 Banka Ekstresi İçe Aktar</button>
          <button onClick={openAdd} style={btnPrimary}>+ Kategori Ekle</button>
        </div>
      </div>

      {/* Yıllık Grafik */}
      {yearlyData.some(d => d.gelir > 0 || d.gider > 0) && (
        <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)', padding: '16px 18px', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.9rem', marginBottom: 14 }}>📅 {year} Yıllık Gelir / Gider</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={yearlyData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: number) => [formatMoney(v), '']} contentStyle={{ background: '#0f1e35', border: '1px solid #334155', borderRadius: 8, fontSize: '0.82rem' }} />
              <Legend />
              <Bar dataKey="gelir" fill="#10b981" name="Gelir" radius={[3,3,0,0]} />
              <Bar dataKey="gider" fill="#ef4444" name="Gider" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {budgets.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, background: 'rgba(255,255,255,0.02)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: '3rem', marginBottom: 14 }}>📊</div>
          <h3 style={{ color: '#e2e8f0', marginBottom: 8 }}>Bütçe kategorisi yok</h3>
          <p style={{ color: '#475569', marginBottom: 20, fontSize: '0.9rem' }}>Gider kategorileri ekleyerek aylık bütçenizi takip edin</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={initPresets} style={btnPrimary}>✨ Hazır Kategoriler Yükle</button>
            <button onClick={openAdd} style={btnSecondary}>Manuel Ekle</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {categorySpend.map(b => (
            <div key={b.id} style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))', borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)', padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <div style={{ width: 40, height: 40, background: `${b.color}15`, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>{b.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.92rem' }}>{b.name}</span>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                      <span style={{ color: b.pct >= 90 ? '#ef4444' : b.pct >= 70 ? '#f59e0b' : '#10b981', fontWeight: 800, fontSize: '0.88rem' }}>{formatMoney(b.spent)}</span>
                      <span style={{ color: '#334155', fontSize: '0.78rem' }}>/ {formatMoney(b.monthlyLimit)}</span>
                      <button onClick={() => openEdit(b)} style={miniBtn}>✏️</button>
                      <button onClick={() => deleteCat(b.id)} style={{ ...miniBtn, color: '#ef4444' }}>🗑️</button>
                    </div>
                  </div>
                  <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 6, height: 7, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${b.pct}%`, background: b.pct >= 90 ? 'linear-gradient(90deg,#ef4444,#dc2626)' : b.pct >= 70 ? 'linear-gradient(90deg,#f59e0b,#d97706)' : `linear-gradient(90deg, ${b.color}, ${b.color}aa)`, borderRadius: 6, transition: 'width 0.5s ease' }} />
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: '3px 8px', fontSize: '0.72rem', color: '#475569' }}>Kalan: <strong style={{ color: b.remaining >= 0 ? '#10b981' : '#ef4444' }}>{formatMoney(Math.abs(b.remaining))}{b.remaining < 0 ? ' aşıldı!' : ''}</strong></span>
                <span style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: '3px 8px', fontSize: '0.72rem', color: '#475569' }}>%{b.pct.toFixed(0)} kullanıldı</span>
                {b.kasaCategories.map(kc => <span key={kc} style={{ background: `${b.color}10`, color: b.color, borderRadius: 5, padding: '2px 7px', fontSize: '0.68rem', fontWeight: 600 }}>{kc}</span>)}
              </div>
            </div>
          ))}

          {uncategorized.length > 0 && (
            <div style={{ background: 'rgba(245,158,11,0.06)', borderRadius: 14, border: '1px solid rgba(245,158,11,0.15)', padding: '14px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.88rem' }}>⚠️ Kategorisiz Giderler ({uncategorized.length} işlem)</div>
                <span style={{ color: '#ef4444', fontWeight: 800 }}>{formatMoney(uncategorized.reduce((s, k) => s + k.amount, 0))}</span>
              </div>
              {uncategorized.slice(0, 5).map(k => (
                <div key={k.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.82rem' }}>
                  <span style={{ color: '#64748b' }}>{k.description || k.category}</span>
                  <span style={{ color: '#ef4444', fontWeight: 600 }}>{formatMoney(k.amount)}</span>
                </div>
              ))}
              {uncategorized.length > 5 && <p style={{ color: '#475569', fontSize: '0.78rem', marginTop: 6 }}>...ve {uncategorized.length - 5} işlem daha</p>}
            </div>
          )}
        </div>
      )}

      {/* Category Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title={editId ? '✏️ Kategori Düzenle' : '+ Bütçe Kategorisi Ekle'} maxWidth={480}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 10 }}>
            <div><label style={lbl}>İkon</label><input value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} style={{ ...inp, textAlign: 'center', fontSize: '1.5rem' }} /></div>
            <div><label style={lbl}>Kategori Adı *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inp} placeholder="ör: Elektrik" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 10 }}>
            <div><label style={lbl}>Aylık Limit (₺)</label><input type="number" inputMode="decimal" value={form.monthlyLimit} onChange={e => setForm(f => ({ ...f, monthlyLimit: parseFloat(e.target.value) || 0 }))} style={inp} /></div>
            <div><label style={lbl}>Renk</label><input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} style={{ ...inp, padding: 6, cursor: 'pointer' }} /></div>
          </div>
          <div>
            <label style={lbl}>Eşleşme Anahtar Kelimeleri (virgülle ayırın)</label>
            <input value={form.kasaCategories.join(', ')} onChange={e => setForm(f => ({ ...f, kasaCategories: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} style={inp} placeholder="elektrik, enerji, fatura" />
            <p style={{ color: '#334155', fontSize: '0.73rem', marginTop: 5 }}>Kasa işlemlerinin açıklama/kategori alanında bu kelimeler aranacak</p>
          </div>
          <button onClick={handleSave} style={{ padding: '12px 0', background: 'linear-gradient(135deg,#ff5722,#ff7043)', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 800, cursor: 'pointer' }}>💾 {editId ? 'Güncelle' : 'Ekle'}</button>
        </div>
      </Modal>

      {/* Bank Statement Modal */}
      <Modal open={bankModal} onClose={() => { setBankModal(false); setImportResult(null); }} title="🏦 Banka Ekstresi İçe Aktar" maxWidth={560}>
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 10, padding: '12px 16px', color: '#93c5fd', fontSize: '0.82rem', lineHeight: 1.7 }}>
            <strong>Desteklenen Formatlar:</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '7px 0' }}>
              {[['📊', 'XLSX', '#10b981'], ['📗', 'XLS', '#10b981'], ['📄', 'CSV', '#3b82f6'], ['📝', 'TXT', '#64748b']].map(([icon, fmt, color]) => (
                <span key={fmt} style={{ background: `${color}15`, border: `1px solid ${color}30`, borderRadius: 6, padding: '2px 9px', fontSize: '0.78rem', fontWeight: 700, color }}>{icon} {fmt}</span>
              ))}
            </div>
            Her satırda: <strong>Tarih, Açıklama, Tutar</strong> (virgül / noktalı virgül / tab ayrımlı veya Excel sütunları)<br />
            <em style={{ color: '#64748b' }}>İpucu: Excel'den "Farklı Kaydet → CSV" veya doğrudan .xlsx yükleyebilirsiniz.</em>
          </div>
          {!importResult ? (
            <>
              <input ref={fileRef} type="file" accept=".csv,.txt,.xls,.xlsx" onChange={handleFileImport} style={{ display: 'none' }} />
              <button onClick={() => fileRef.current?.click()} style={{ padding: '40px 0', background: 'rgba(59,130,246,0.06)', border: '2px dashed rgba(59,130,246,0.3)', borderRadius: 12, color: '#60a5fa', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem', transition: 'all 0.2s' }}
                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(59,130,246,0.6)'}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(59,130,246,0.3)'}>
                📂 XLSX / CSV / TXT Dosyası Seç
              </button>
            </>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                {[{ label: 'Toplam İşlem', value: importResult.total, color: '#3b82f6' }, { label: 'Otomatik Eşleşen', value: importResult.matched, color: '#10b981' }, { label: 'Eşleşmeyen', value: importResult.total - importResult.matched, color: '#f59e0b' }].map(s => (
                  <div key={s.label} style={{ background: `${s.color}12`, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.4rem', fontWeight: 900, color: s.color }}>{s.value}</div>
                    <div style={{ color: '#475569', fontSize: '0.72rem', marginTop: 3 }}>{s.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 10 }}>
                {importResult.entries.slice(0, 15).map((e, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.78rem' }}>
                    <span style={{ color: '#64748b', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.desc}</span>
                    <span style={{ color: e.type === 'gelir' ? '#10b981' : '#ef4444', fontWeight: 700, marginLeft: 8 }}>{e.type === 'gelir' ? '+' : '-'}{formatMoney(e.amount)}</span>
                  </div>
                ))}
                {importResult.entries.length > 15 && <p style={{ color: '#334155', fontSize: '0.75rem', textAlign: 'center', padding: '6px 0' }}>...ve {importResult.entries.length - 15} işlem daha</p>}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={confirmImport} style={{ flex: 1, padding: '12px 0', background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 800, cursor: 'pointer' }}>✅ {importResult.total} İşlemi Kasa'ya Aktar</button>
                <button onClick={() => setImportResult(null)} style={{ padding: '12px 16px', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 10, color: '#64748b', cursor: 'pointer' }}>İptal</button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', marginBottom: 5, color: '#64748b', fontSize: '0.8rem', fontWeight: 600 };
const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#f1f5f9', fontSize: '0.88rem', boxSizing: 'border-box' };
const miniBtn: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: 'none', borderRadius: 6, color: '#64748b', padding: '4px 6px', cursor: 'pointer', fontSize: '0.82rem' };
const sel: React.CSSProperties = { padding: '8px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, color: '#94a3b8', fontSize: '0.85rem' };
const btnPrimary: React.CSSProperties = { background: 'linear-gradient(135deg,#ff5722,#ff7043)', border: 'none', borderRadius: 10, color: '#fff', padding: '9px 16px', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' };
const btnSecondary: React.CSSProperties = { background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 10, color: '#60a5fa', padding: '9px 14px', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem' };
