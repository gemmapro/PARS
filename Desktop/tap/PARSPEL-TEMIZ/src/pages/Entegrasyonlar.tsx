import { useState } from 'react';
import type { DB } from '@/types';

interface Props { db: DB; }

const integrations = [
  { id: 'efatura', name: 'e-Fatura', icon: '🧾', desc: 'GİB e-Fatura entegrasyonu ile otomatik fatura oluşturma ve gönderme', status: 'planned', color: '#ff5722', features: ['Otomatik fatura oluşturma', 'e-Arşiv desteği', 'GİB onay takibi', 'Toplu fatura gönderimi'] },
  { id: 'edefteri', name: 'e-Defter', icon: '📚', desc: 'e-Defter entegrasyonu ile yasal defter tutma ve GİB\'e beyanname', status: 'planned', color: '#3b82f6', features: ['Yevmiye defteri', 'Kebir defteri', 'Beyanname hazırlama', 'Aylık kapanış'] },
  { id: 'pos', name: 'Sanal POS', icon: '💳', desc: 'Kredi kartı ödemelerini doğrudan sistemden alın', status: 'planned', color: '#10b981', features: ['Çoklu banka desteği', 'Taksitli satış', 'Otomatik mutabakat', 'İade işlemleri'] },
  { id: 'cargo', name: 'Kargo', icon: '📦', desc: 'Aras, MNG, Yurtiçi kargo entegrasyonları', status: 'planned', color: '#f59e0b', features: ['Otomatik gönderi oluşturma', 'Takip numarası', 'Fiyat karşılaştırma', 'Teslimat bildirimi'] },
  { id: 'whatsapp', name: 'WhatsApp', icon: '📱', desc: 'Müşterilere otomatik fatura ve bildirim gönderme', status: 'planned', color: '#22c55e', features: ['Fatura gönderimi', 'Ödeme hatırlatma', 'Sipariş bildirimi', 'Toplu mesaj'] },
  { id: 'excel', name: 'Excel/CSV', icon: '📊', desc: 'Veri içe/dışa aktarma ile diğer sistemlerle uyum', status: 'active', color: '#8b5cf6', features: ['Ürün içe aktarma', 'Satış dışa aktarma', 'Cari liste aktarma', 'Rapor dışa aktarma'] },
  { id: 'sms', name: 'SMS Bildirim', icon: '💬', desc: 'Müşterilere SMS ile ödeme hatırlatma ve bildirim', status: 'planned', color: '#06b6d4', features: ['Ödeme hatırlatma', 'Vade bildirimi', 'Sipariş onayı', 'Toplu SMS'] },
  { id: 'muhasebe', name: 'Muhasebeci Portalı', icon: '👨‍💼', desc: 'Muhasebecinize salt okunur erişim verin', status: 'planned', color: '#ec4899', features: ['Salt okunur erişim', 'Aylık rapor paylaşımı', 'Vergi dönemi özeti', 'Belge arşivi'] },
];

export default function Entegrasyonlar({ db }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const sel = integrations.find(i => i.id === selected);

  const activeCount = integrations.filter(i => i.status === 'active').length;
  const plannedCount = integrations.filter(i => i.status === 'planned').length;

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { icon: '🔗', label: 'Toplam Entegrasyon', value: String(integrations.length), color: '#3b82f6' },
          { icon: '✅', label: 'Aktif', value: String(activeCount), color: '#10b981' },
          { icon: '🚀', label: 'Yakında', value: String(plannedCount), color: '#f59e0b' },
        ].map(s => (
          <div key={s.label} style={{ background: `linear-gradient(135deg, ${s.color}12, ${s.color}06)`, borderRadius: 14, padding: '16px 18px', border: `1px solid ${s.color}20` }}>
            <div style={{ fontSize: '1rem', marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 900, color: s.color }}>{s.value}</div>
            <div style={{ color: '#475569', fontSize: '0.72rem', marginTop: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {integrations.map(intg => (
          <div key={intg.id} onClick={() => setSelected(intg.id)} style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))', borderRadius: 16, border: selected === intg.id ? `1px solid ${intg.color}40` : '1px solid rgba(255,255,255,0.07)', padding: 20, cursor: 'pointer', transition: 'all 0.2s', position: 'relative', overflow: 'hidden' }}
            onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = `${intg.color}30`}
            onMouseLeave={e => { if (selected !== intg.id) (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.07)'; }}>
            <div style={{ position: 'absolute', top: 12, right: 12 }}>
              <span style={{ background: intg.status === 'active' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.12)', color: intg.status === 'active' ? '#10b981' : '#f59e0b', borderRadius: 6, padding: '3px 8px', fontSize: '0.72rem', fontWeight: 700 }}>{intg.status === 'active' ? '✅ Aktif' : '🚀 Yakında'}</span>
            </div>
            <div style={{ width: 48, height: 48, background: `${intg.color}15`, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', marginBottom: 14 }}>{intg.icon}</div>
            <h3 style={{ color: '#f1f5f9', fontWeight: 800, fontSize: '1rem', marginBottom: 6 }}>{intg.name}</h3>
            <p style={{ color: '#475569', fontSize: '0.82rem', lineHeight: 1.5, marginBottom: 14 }}>{intg.desc}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {intg.features.slice(0, 3).map(f => (
                <span key={f} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '2px 8px', fontSize: '0.72rem', color: '#64748b' }}>{f}</span>
              ))}
              {intg.features.length > 3 && <span style={{ color: '#334155', fontSize: '0.72rem', padding: '2px 4px' }}>+{intg.features.length - 3}</span>}
            </div>
          </div>
        ))}
      </div>

      {sel && (
        <div style={{ marginTop: 20, background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))', borderRadius: 16, border: `1px solid ${sel.color}25`, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <div style={{ width: 52, height: 52, background: `${sel.color}15`, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem' }}>{sel.icon}</div>
            <div>
              <h3 style={{ color: '#f1f5f9', fontWeight: 800, fontSize: '1.1rem' }}>{sel.name}</h3>
              <p style={{ color: '#475569', fontSize: '0.85rem' }}>{sel.desc}</p>
            </div>
          </div>
          <h4 style={{ color: '#94a3b8', fontSize: '0.82rem', fontWeight: 700, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tüm Özellikler</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginBottom: 18 }}>
            {sel.features.map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                <span style={{ color: sel.color, fontSize: '0.85rem' }}>✓</span>
                <span style={{ color: '#e2e8f0', fontSize: '0.85rem' }}>{f}</span>
              </div>
            ))}
          </div>
          {sel.status === 'active' ? (
            <div style={{ background: 'rgba(16,185,129,0.08)', borderRadius: 12, padding: '14px 18px', border: '1px solid rgba(16,185,129,0.2)' }}>
              <p style={{ color: '#10b981', fontWeight: 700, fontSize: '0.88rem' }}>✅ Bu entegrasyon aktif</p>
              <p style={{ color: '#475569', fontSize: '0.82rem', marginTop: 4 }}>Ayarlar sayfasından detaylı konfigürasyon yapabilirsiniz.</p>
            </div>
          ) : (
            <div style={{ background: 'rgba(245,158,11,0.08)', borderRadius: 12, padding: '14px 18px', border: '1px solid rgba(245,158,11,0.15)' }}>
              <p style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.88rem' }}>🚀 Yakında Geliyor</p>
              <p style={{ color: '#475569', fontSize: '0.82rem', marginTop: 4 }}>Bu entegrasyon geliştirme aşamasında. Güncellemeler için takipte kalın!</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
