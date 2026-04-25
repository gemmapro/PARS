import { useState, useMemo } from 'react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { genId, formatDate, formatMoney } from '@/lib/utils-tr';
import { runIntegrityCheck, getIntegritySummary, getHealthScore, type IntegrityIssue, type IssueSeverity } from '@/lib/dataIntegrityChecker';
import { getErrorLogs, clearErrorLogs } from '@/components/ErrorBoundary';
import type { DB, MonitorRule, AuditEntry } from '@/types';

interface Props { db: DB; save: (fn: (prev: DB) => DB) => void; }

const ruleTypes = ['stok_min', 'stok_sifir', 'kasa_min', 'alacak_vadeli', 'borc_vadeli', 'satis_hedef'] as const;
const ruleLabels: Record<string, string> = { stok_min: '📦 Düşük Stok', stok_sifir: '🔴 Biten Stok', kasa_min: '💰 Düşük Kasa', alacak_vadeli: '📥 Vadeli Alacak', borc_vadeli: '📤 Vadeli Borç', satis_hedef: '🎯 Satış Hedefi' };
const levelColors: Record<string, string> = { critical: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
const severityLabels: Record<IssueSeverity, string> = { critical: '🔴 Kritik', warning: '🟡 Uyarı', info: '🔵 Bilgi' };
const categoryLabels: Record<string, string> = { stok: '📦 Stok', kasa: '💰 Kasa', cari: '👤 Cari', satis: '🛒 Satış', siparis: '📋 Sipariş', fatura: '🧾 Fatura', veri: '🗄️ Veri', referans: '🔗 Referans', anomali: '🔍 Anomali' };

export default function Monitor({ db, save }: Props) {
  const { showToast } = useToast();
  const { showConfirm } = useConfirm();
  const [tab, setTab] = useState<'health' | 'alerts' | 'rules' | 'errors' | 'activity' | 'audit'>('health');
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<MonitorRule>>({ name: '', type: 'stok_min', level: 'warning', interval: 60, popup: true, active: true, threshold: 0 });
  const [severityFilter, setSeverityFilter] = useState<IssueSeverity | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [auditStatusFilter, setAuditStatusFilter] = useState<'all' | 'applied' | 'blocked' | 'warned'>('all');
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);

  const openAdd = () => { setForm({ name: '', type: 'stok_min', level: 'warning', interval: 60, popup: true, active: true, threshold: 0 }); setEditId(null); setModalOpen(true); };
  const openEdit = (r: MonitorRule) => { setForm({ ...r }); setEditId(r.id); setModalOpen(true); };

  const handleSave = () => {
    if (!form.name) { showToast('Kural adı gerekli!', 'error'); return; }
    const nowIso = new Date().toISOString();
    save(prev => {
      const rules = [...prev.monitorRules];
      if (editId) {
        const i = rules.findIndex(r => r.id === editId);
        if (i >= 0) rules[i] = { ...rules[i], ...form, updatedAt: nowIso } as MonitorRule;
        showToast('Kural güncellendi!', 'success');
      } else {
        rules.push({ id: genId(), createdAt: nowIso, updatedAt: nowIso, name: '', type: 'stok_min', level: 'warning', interval: 60, popup: true, active: true, ...form } as MonitorRule);
        showToast('Kural eklendi!', 'success');
      }
      return { ...prev, monitorRules: rules };
    });
    setModalOpen(false);
  };

  const deleteRule = (id: string) => {
    showConfirm('Kural Sil', 'Bu kuralı silmek istediğinizden emin misiniz?', () => {
      save(prev => ({ ...prev, monitorRules: prev.monitorRules.filter(r => r.id !== id) }));
      showToast('Kural silindi!', 'success');
    });
  };

  const toggleActive = (id: string) => {
    save(prev => ({ ...prev, monitorRules: prev.monitorRules.map(r => r.id === id ? { ...r, active: !r.active } : r) }));
  };

  // ── Veri Bütünlüğü Denetimi ──
  const integrityIssues = useMemo(() => runIntegrityCheck(db), [db]);
  const summary = useMemo(() => getIntegritySummary(integrityIssues), [integrityIssues]);
  const healthScore = useMemo(() => getHealthScore(db), [db]);

  const filteredIssues = integrityIssues
    .filter(i => severityFilter === 'all' || i.severity === severityFilter)
    .filter(i => categoryFilter === 'all' || i.category === categoryFilter);

  // ── Aktif Uyarılar (Monitor Rules) ──
  const alerts = db.monitorRules.filter(r => r.active).flatMap(r => {
    const msgs: { level: string; msg: string }[] = [];
    if (r.type === 'stok_sifir') {
      const count = db.products.filter(p => !p.deleted && p.stock === 0).length;
      if (count > 0) msgs.push({ level: r.level, msg: `${count} ürün stoğu bitti!` });
    } else if (r.type === 'stok_min') {
      const count = db.products.filter(p => !p.deleted && p.stock > 0 && p.stock <= p.minStock).length;
      if (count > 0) msgs.push({ level: r.level, msg: `${count} üründe düşük stok uyarısı!` });
    } else if (r.type === 'kasa_min' && r.threshold !== undefined) {
      const kasaId = r.kasa || 'nakit';
      const bal = db.kasa.filter(k => !k.deleted && k.kasa === kasaId).reduce((s, k) => s + (k.type === 'gelir' ? k.amount : -k.amount), 0);
      if (bal < r.threshold) msgs.push({ level: r.level, msg: `${kasaId} kasası düşük: ${formatMoney(bal)}` });
    } else if (r.type === 'alacak_vadeli') {
      const alacak = db.cari.filter(c => c.type === 'musteri' && c.balance > 0);
      if (alacak.length > 0) {
        const toplam = alacak.reduce((s, c) => s + c.balance, 0);
        msgs.push({ level: r.level, msg: `${alacak.length} müşteride toplam ${formatMoney(toplam)} alacak var` });
      }
    } else if (r.type === 'borc_vadeli') {
      const borc = db.cari.filter(c => c.type === 'tedarikci' && c.balance > 0);
      if (borc.length > 0) {
        const toplam = borc.reduce((s, c) => s + c.balance, 0);
        msgs.push({ level: r.level, msg: `${borc.length} tedarikçiye toplam ${formatMoney(toplam)} borç var` });
      }
    } else if (r.type === 'satis_hedef' && r.threshold !== undefined) {
      const todayStr = new Date().toLocaleDateString('sv-SE');
      const bugunCiro = db.sales.filter(s => !s.deleted && s.status === 'tamamlandi' && s.createdAt.slice(0, 10) === todayStr).reduce((s, x) => s + x.total, 0);
      if (bugunCiro < r.threshold) msgs.push({ level: r.level, msg: `Günlük hedef: ${formatMoney(bugunCiro)} / ${formatMoney(r.threshold)} (%${((bugunCiro / r.threshold) * 100).toFixed(0)})` });
    }
    return msgs.map(m => ({ ...m, ruleName: r.name }));
  });

  // ── Hata Logları ──
  const errorLogs = getErrorLogs();

  // ── Aktivite Logları ──
  const activityLog = db._activityLog || [];

  // ── Denetim Logları ──
  const auditLog: AuditEntry[] = db._auditLog || [];
  const filteredAuditLog = auditLog.filter(e =>
    auditStatusFilter === 'all' || e.status === auditStatusFilter
  );

  // ── Sağlık skoru rengi ──
  const scoreColor = healthScore >= 80 ? '#10b981' : healthScore >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div>
      {/* Sağlık Skoru Özet */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div style={{ background: `linear-gradient(135deg, ${scoreColor}18, ${scoreColor}08)`, border: `1px solid ${scoreColor}33`, borderRadius: 14, padding: '16px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 900, color: scoreColor }}>{healthScore}</div>
          <div style={{ color: '#94a3b8', fontSize: '0.78rem', fontWeight: 600 }}>Sağlık Skoru</div>
        </div>
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 14, padding: '16px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 900, color: '#ef4444' }}>{summary.critical}</div>
          <div style={{ color: '#94a3b8', fontSize: '0.78rem', fontWeight: 600 }}>Kritik</div>
        </div>
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 14, padding: '16px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 900, color: '#f59e0b' }}>{summary.warning}</div>
          <div style={{ color: '#94a3b8', fontSize: '0.78rem', fontWeight: 600 }}>Uyarı</div>
        </div>
        <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 14, padding: '16px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 900, color: '#3b82f6' }}>{summary.info}</div>
          <div style={{ color: '#94a3b8', fontSize: '0.78rem', fontWeight: 600 }}>Bilgi</div>
        </div>
        <div style={{ background: 'rgba(255,87,34,0.08)', border: '1px solid rgba(255,87,34,0.2)', borderRadius: 14, padding: '16px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 900, color: '#ff5722' }}>{alerts.length}</div>
          <div style={{ color: '#94a3b8', fontSize: '0.78rem', fontWeight: 600 }}>Aktif Alarm</div>
        </div>
      </div>

      {/* Sekme Navigasyonu */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {([
          ['health', `🩺 Veri Sağlığı (${summary.total})`],
          ['alerts', `🔔 Alarmlar (${alerts.length})`],
          ['rules', `⚙️ Kurallar (${db.monitorRules.length})`],
          ['errors', `🐛 Hata Logları (${errorLogs.length})`],
          ['activity', `📋 Aktivite (${activityLog.length})`],
          ['audit', `🔒 Denetim Logu (${auditLog.length})`],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id as typeof tab)}
            style={{ padding: '8px 16px', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: '0.83rem', background: tab === id ? '#ff5722' : '#273548', color: tab === id ? '#fff' : '#94a3b8' }}>
            {label}
          </button>
        ))}
      </div>

      {/* ═══ TAB: Veri Sağlığı ═══ */}
      {tab === 'health' && (
        <>
          {/* Filtreler */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value as typeof severityFilter)} style={inp}>
              <option value="all">Tüm Seviyeler</option>
              <option value="critical">🔴 Kritik</option>
              <option value="warning">🟡 Uyarı</option>
              <option value="info">🔵 Bilgi</option>
            </select>
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={inp}>
              <option value="all">Tüm Kategoriler</option>
              {Object.entries(categoryLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          {filteredIssues.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#10b981' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>✅</div>
              <p style={{ fontWeight: 700, fontSize: '1.1rem' }}>Tüm veriler tutarlı!</p>
              <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: 8 }}>Hiçbir veri bütünlüğü sorunu bulunamadı.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredIssues.map(issue => (
                <div key={issue.id} style={{ background: `${levelColors[issue.severity]}0a`, border: `1px solid ${levelColors[issue.severity]}25`, borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ background: `${levelColors[issue.severity]}22`, color: levelColors[issue.severity], borderRadius: 6, padding: '2px 8px', fontSize: '0.72rem', fontWeight: 700 }}>
                      {severityLabels[issue.severity]}
                    </span>
                    <span style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 6, padding: '2px 8px', fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>
                      {categoryLabels[issue.category] || issue.category}
                    </span>
                    <span style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.9rem' }}>{issue.title}</span>
                  </div>
                  <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: issue.suggestion ? 6 : 0 }}>{issue.detail}</p>
                  {issue.suggestion && (
                    <p style={{ color: '#60a5fa', fontSize: '0.82rem', fontStyle: 'italic' }}>💡 {issue.suggestion}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ═══ TAB: Alarmlar ═══ */}
      {tab === 'alerts' && (
        <>
          {alerts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#10b981' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>🔕</div>
              <p style={{ fontWeight: 700 }}>Aktif alarm yok</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {alerts.map((a, i) => (
                <div key={i} style={{ background: `${levelColors[a.level] || '#94a3b8'}15`, border: `1px solid ${levelColors[a.level] || '#94a3b8'}40`, borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: levelColors[a.level] || '#94a3b8', flexShrink: 0 }} />
                  <span style={{ color: '#f1f5f9', fontSize: '0.9rem', flex: 1 }}>{a.msg}</span>
                  <span style={{ color: '#64748b', fontSize: '0.8rem' }}>{a.ruleName}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ═══ TAB: Kurallar ═══ */}
      {tab === 'rules' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <button onClick={openAdd} style={{ background: '#ff5722', border: 'none', borderRadius: 10, color: '#fff', padding: '10px 20px', fontWeight: 700, cursor: 'pointer' }}>+ Yeni Kural</button>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            {db.monitorRules.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 48, color: '#64748b' }}>Kural bulunamadı</div>
            ) : db.monitorRules.map(r => (
              <div key={r.id} style={{ background: '#1e293b', borderRadius: 12, border: `1px solid ${r.active ? levelColors[r.level] + '33' : '#33415555'}`, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, opacity: r.active ? 1 : 0.6 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, color: '#f1f5f9' }}>{r.name}</span>
                    <span style={{ background: `${levelColors[r.level]}22`, color: levelColors[r.level], borderRadius: 6, padding: '1px 8px', fontSize: '0.75rem', fontWeight: 700 }}>{r.level}</span>
                  </div>
                  <p style={{ color: '#64748b', fontSize: '0.82rem' }}>{ruleLabels[r.type] || r.type} · Her {r.interval}dk</p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button onClick={() => toggleActive(r.id)} style={{ background: r.active ? 'rgba(16,185,129,0.15)' : '#273548', border: 'none', borderRadius: 8, color: r.active ? '#10b981' : '#64748b', padding: '7px 12px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
                    {r.active ? '✓ Aktif' : '○ Pasif'}
                  </button>
                  {!r.isDefault && <button onClick={() => openEdit(r)} style={{ background: 'rgba(59,130,246,0.1)', border: 'none', borderRadius: 8, color: '#60a5fa', padding: '7px 10px', cursor: 'pointer' }}>✏️</button>}
                  {!r.isDefault && <button onClick={() => deleteRule(r.id)} style={{ background: 'rgba(239,68,68,0.1)', border: 'none', borderRadius: 8, color: '#ef4444', padding: '7px 10px', cursor: 'pointer' }}>🗑️</button>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ═══ TAB: Hata Logları ═══ */}
      {tab === 'errors' && (
        <>
          {errorLogs.length > 0 && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <button onClick={() => { clearErrorLogs(); showToast('Hata logları temizlendi!', 'success'); }} style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, color: '#ef4444', padding: '8px 16px', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}>🗑️ Logları Temizle</button>
            </div>
          )}
          {errorLogs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#10b981' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>🐛</div>
              <p style={{ fontWeight: 700 }}>Hata kaydı yok!</p>
              <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: 8 }}>Uygulama hatasız çalışıyor.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {errorLogs.map(log => (
                <div key={log.id} style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.9rem' }}>{log.message}</span>
                    <span style={{ color: '#64748b', fontSize: '0.78rem' }}>{formatDate(log.time)}</span>
                  </div>
                  {log.stack && (
                    <pre style={{ color: '#94a3b8', fontSize: '0.75rem', fontFamily: 'monospace', background: '#0f172a', borderRadius: 8, padding: '8px 12px', overflow: 'auto', maxHeight: 120, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{log.stack}</pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ═══ TAB: Denetim Logu ═══ */}
      {tab === 'audit' && (
        <>
          {/* Filtre */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <select value={auditStatusFilter} onChange={e => setAuditStatusFilter(e.target.value as typeof auditStatusFilter)} style={inp}>
              <option value="all">Tüm Durumlar</option>
              <option value="applied">✅ Uygulandı</option>
              <option value="warned">⚠️ Uyarıyla Uygulandı</option>
              <option value="blocked">🚫 Engellendi</option>
            </select>
          </div>

          {filteredAuditLog.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#64748b' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>🔒</div>
              <p style={{ fontWeight: 700 }}>Denetim kaydı yok</p>
              <p style={{ color: '#475569', fontSize: '0.85rem', marginTop: 8 }}>İşlemler otomatik olarak denetim loguna kaydedilecek.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredAuditLog.slice(0, 200).map(entry => {
                const statusColor = entry.status === 'blocked' ? '#ef4444' : entry.status === 'warned' ? '#f59e0b' : '#10b981';
                const statusLabel = entry.status === 'blocked' ? '🚫 Engellendi' : entry.status === 'warned' ? '⚠️ Uyarı' : '✅ Uygulandı';
                const isExpanded = expandedAuditId === entry.id;

                // Diff özeti
                const prevKeys = entry.prevValue && typeof entry.prevValue === 'object' ? Object.keys(entry.prevValue as object) : [];
                const nextKeys = entry.nextValue && typeof entry.nextValue === 'object' ? Object.keys(entry.nextValue as object) : [];
                const changedFields = [...new Set([...prevKeys, ...nextKeys])].filter(k => !k.startsWith('_'));

                return (
                  <div key={entry.id} style={{ background: `${statusColor}08`, border: `1px solid ${statusColor}25`, borderRadius: 12, padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      {/* Durum badge */}
                      <span style={{ background: `${statusColor}22`, color: statusColor, borderRadius: 6, padding: '2px 8px', fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {statusLabel}
                      </span>
                      {/* İşlem tipi */}
                      <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.88rem' }}>{entry.action}</span>
                      {/* Entity */}
                      <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>{entry.entity}{entry.entityId ? ` #${entry.entityId.slice(0, 8)}` : ''}</span>
                      {/* Değişen alanlar */}
                      {changedFields.length > 0 && (
                        <span style={{ color: '#60a5fa', fontSize: '0.78rem', background: 'rgba(96,165,250,0.1)', borderRadius: 5, padding: '1px 6px' }}>
                          {changedFields.slice(0, 3).join(', ')}{changedFields.length > 3 ? ` +${changedFields.length - 3}` : ''}
                        </span>
                      )}
                      <span style={{ marginLeft: 'auto', color: '#475569', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{formatDate(entry.time)}</span>
                      {/* Expand butonu (blocked kayıtlar için) */}
                      {entry.status === 'blocked' && entry.violations && entry.violations.length > 0 && (
                        <button
                          onClick={() => setExpandedAuditId(isExpanded ? null : entry.id)}
                          style={{ background: 'rgba(239,68,68,0.1)', border: 'none', borderRadius: 6, color: '#ef4444', padding: '3px 8px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                        >
                          {isExpanded ? '▲ Gizle' : '▼ İhlaller'}
                        </button>
                      )}
                    </div>

                    {/* İhlal detayları (expandable) */}
                    {isExpanded && entry.violations && (
                      <div style={{ marginTop: 10, borderTop: '1px solid rgba(239,68,68,0.2)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {entry.violations.map((v, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                            <span style={{ color: v.severity === 'block' ? '#ef4444' : '#f59e0b', fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                              {v.severity === 'block' ? '🚫' : '⚠️'} {v.ruleName}
                            </span>
                            <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>{v.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ═══ TAB: Aktivite ═══ */}
      {tab === 'activity' && (
        <>
          {activityLog.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#64748b' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>📋</div>
              <p style={{ fontWeight: 700 }}>Aktivite kaydı yok</p>
              <p style={{ color: '#475569', fontSize: '0.85rem', marginTop: 8 }}>İşlemler otomatik olarak kaydedilecek.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {activityLog.slice(0, 100).map(log => (
                <div key={log.id} style={{ background: '#1e293b', borderRadius: 10, border: '1px solid #334155', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: '1.1rem' }}>{getActionIcon(log.action)}</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ color: '#f1f5f9', fontSize: '0.88rem', fontWeight: 600 }}>{log.action}</span>
                    {log.detail && <span style={{ color: '#64748b', fontSize: '0.82rem', marginLeft: 8 }}>— {log.detail}</span>}
                  </div>
                  <span style={{ color: '#475569', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{formatDate(log.time)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal (Kural Ekle/Düzenle) */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? '✏️ Kural Düzenle' : '➕ Yeni Kural'}>
        <div style={{ display: 'grid', gap: 14 }}>
          <div><label style={lbl}>Kural Adı *</label><input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inp} /></div>
          <div>
            <label style={lbl}>Kural Tipi</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as MonitorRule['type'] }))} style={inp}>
              {ruleTypes.map(t => <option key={t} value={t}>{ruleLabels[t]}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Seviye</label>
            <select value={form.level} onChange={e => setForm(f => ({ ...f, level: e.target.value as MonitorRule['level'] }))} style={inp}>
              <option value="critical">🔴 Kritik</option>
              <option value="warning">🟡 Uyarı</option>
              <option value="info">🔵 Bilgi</option>
            </select>
          </div>
          {(form.type === 'kasa_min' || form.type === 'satis_hedef') && (
            <div><label style={lbl}>Eşik Değeri (₺)</label><input type="number" inputMode="decimal" value={form.threshold || 0} onChange={e => setForm(f => ({ ...f, threshold: parseFloat(e.target.value) || 0 }))} style={inp} /></div>
          )}
          <div><label style={lbl}>Kontrol Aralığı (dakika)</label><input type="number" inputMode="decimal" value={form.interval || 60} onChange={e => setForm(f => ({ ...f, interval: parseInt(e.target.value) || 60 }))} style={inp} min={1} /></div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={handleSave} style={{ flex: 1, background: '#10b981', border: 'none', borderRadius: 10, color: '#fff', padding: '11px 0', fontWeight: 700, cursor: 'pointer' }}>💾 Kaydet</button>
          <button onClick={() => setModalOpen(false)} style={{ background: '#273548', border: '1px solid #334155', borderRadius: 10, color: '#94a3b8', padding: '11px 20px', cursor: 'pointer' }}>İptal</button>
        </div>
      </Modal>
    </div>
  );
}

function getActionIcon(action: string): string {
  const a = action.toLowerCase();
  if (a.includes('satış') || a.includes('satis')) return '🛒';
  if (a.includes('ürün') || a.includes('urun') || a.includes('stok')) return '📦';
  if (a.includes('kasa') || a.includes('gelir') || a.includes('gider')) return '💰';
  if (a.includes('cari') || a.includes('müşteri')) return '👤';
  if (a.includes('fatura')) return '🧾';
  if (a.includes('sipariş')) return '📋';
  if (a.includes('sil') || a.includes('iptal')) return '🗑️';
  return '📝';
}

const lbl: React.CSSProperties = { display: 'block', marginBottom: 6, color: '#94a3b8', fontSize: '0.85rem', fontWeight: 500 };
const inp: React.CSSProperties = { width: '100%', padding: '10px 14px', background: 'rgba(15,23,42,0.6)', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9', fontSize: '0.9rem', boxSizing: 'border-box' };
