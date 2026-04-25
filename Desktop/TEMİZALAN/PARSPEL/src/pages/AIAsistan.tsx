import { useState, useRef, useEffect, useCallback } from 'react';
import { formatMoney } from '@/lib/utils-tr';
import type { DB } from '@/types';
import { loadConnConfig } from '@/lib/connConfig';
import { useSpeechRecognition, useSpeechSynthesis } from '@/hooks/useSpeech';

interface Props { db: DB; embedded?: boolean; }
interface Message { role: 'user' | 'assistant'; content: string; source?: 'claude' | 'gemini' | 'offline'; }

// ── Firebase AI Key Yönetimi ──────────────────────────────────────────────
function getAiKeysUrl(): string {
  const cfg = loadConnConfig();
  const apiKey = cfg.firebase.apiKey || import.meta.env.VITE_FIREBASE_API_KEY || '';
  const projectId = cfg.firebase.projectId || import.meta.env.VITE_FIREBASE_PROJECT_ID || '';
  if (!projectId || !apiKey) return '';
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/config/aikeys?key=${apiKey}`;
}

async function loadKeysFromFirebase(): Promise<{ claude: string; gemini: string }> {
  const url = getAiKeysUrl();
  if (!url) return { claude: '', gemini: '' };
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { claude: '', gemini: '' };
    const json = await res.json();
    return {
      claude: json?.fields?.claude?.stringValue || '',
      gemini: json?.fields?.gemini?.stringValue || '',
    };
  } catch { return { claude: '', gemini: '' }; }
}

async function saveKeysToFirebase(claude: string, gemini: string): Promise<boolean> {
  const url = getAiKeysUrl();
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          claude: { stringValue: claude },
          gemini: { stringValue: gemini },
          updatedAt: { stringValue: new Date().toISOString() },
        }
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch { return false; }
}

// Oturum cache — sekme kapanınca silinir, localStorage'a yazılmaz
const _keyCache: { claude: string; gemini: string; loaded: boolean } = { claude: '', gemini: '', loaded: false };

async function getKeys(): Promise<{ claude: string; gemini: string }> {
  // Stale-empty cache: yüklü ama her iki anahtar da boşsa yeniden dene
  if (_keyCache.loaded && !_keyCache.claude && !_keyCache.gemini) {
    _keyCache.loaded = false;
  }
  if (_keyCache.loaded) return { claude: _keyCache.claude, gemini: _keyCache.gemini };
  const keys = await loadKeysFromFirebase();
  _keyCache.claude = keys.claude;
  _keyCache.gemini = keys.gemini;
  _keyCache.loaded = true;
  return keys;
}

function invalidateKeyCache() {
  _keyCache.loaded = false;
  _keyCache.claude = '';
  _keyCache.gemini = '';
}

// ── Offline kural tabanlı sistem ──
function offlineReply(db: DB, query: string): string {
  const q = query.toLowerCase();
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthSales = db.sales.filter(s => !s.deleted && s.status === 'tamamlandi' && new Date(s.createdAt) >= monthStart);
  const ciro = monthSales.reduce((s, x) => s + x.total, 0);
  const kar = monthSales.reduce((s, x) => s + x.profit, 0);
  const activeKasa = db.kasa.filter(k => !k.deleted);
  const kasaToplam = activeKasa.reduce((s, k) => s + (k.type === 'gelir' ? k.amount : -k.amount), 0);
  const nakit = activeKasa.filter(k=>k.kasa==='nakit').reduce((s,k)=>s+(k.type==='gelir'?k.amount:-k.amount),0);
  const banka = activeKasa.filter(k=>k.kasa==='banka').reduce((s,k)=>s+(k.type==='gelir'?k.amount:-k.amount),0);

  if (q.includes('stok') || q.includes('ürün') || q.includes('sipariş')) {
    const activeProducts = db.products.filter(p => !p.deleted);
    const out = activeProducts.filter(p => p.stock === 0);
    const low = activeProducts.filter(p => p.stock > 0 && p.stock <= p.minStock);
    const stokDeger = activeProducts.reduce((s,p)=>s+p.cost*p.stock,0);
    return `📦 **Stok Özeti**\n- Toplam ürün: ${activeProducts.length} | Stok değeri: ${formatMoney(stokDeger)}\n- Stok biten: ${out.length}${out.length?'\n  ' + out.slice(0,5).map(p=>`• ${p.name}`).join('\n  '):''}\n- Az stoklu: ${low.length}${low.length?'\n  ' + low.slice(0,5).map(p=>`• ${p.name} (${p.stock}/${p.minStock})`).join('\n  '):''}\n\n⚠️ *Çevrimdışı mod — derin analiz için internet gerekli*`;
  }
  if (q.includes('kasa') || q.includes('nakit') || q.includes('para') || q.includes('sermaye')) {
    const alacak = db.cari.filter(c=>!c.deleted&&c.type==='musteri'&&c.balance>0).reduce((s,c)=>s+c.balance,0);
    const borc = db.cari.filter(c=>!c.deleted&&c.type==='tedarikci'&&c.balance>0).reduce((s,c)=>s+c.balance,0);
    const netSermaye = kasaToplam + alacak - borc;
    return `💰 **Kasa & Sermaye**\n- Nakit: ${formatMoney(nakit)}\n- Banka: ${formatMoney(banka)}\n- Toplam Kasa: ${formatMoney(kasaToplam)}\n- Müşteri Alacağı: ${formatMoney(alacak)}\n- Tedarikçi Borcu: ${formatMoney(borc)}\n- **Net Sermaye: ${formatMoney(netSermaye)}**\n\n⚠️ *Çevrimdışı mod*`;
  }
  if (q.includes('alacak') || q.includes('borç') || q.includes('cari') || q.includes('müşteri') || q.includes('tahsilat')) {
    const activeCari = db.cari.filter(c => !c.deleted);
    const alacak = activeCari.filter(c=>c.type==='musteri'&&c.balance>0).reduce((s,c)=>s+c.balance,0);
    const topBorclu = [...activeCari].filter(c=>c.type==='musteri'&&c.balance>0).sort((a,b)=>b.balance-a.balance).slice(0,5);
    // Gecikmiş alacaklar
    const overdue = activeCari.filter(c=>c.type==='musteri'&&c.balance>0).map(c=>{
      const lastPay = db.kasa.filter(k=>!k.deleted&&k.cariId===c.id&&k.type==='gelir').sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime())[0];
      const refDate = lastPay ? new Date(lastPay.createdAt) : c.lastTransaction ? new Date(c.lastTransaction) : null;
      const days = refDate ? Math.floor((Date.now()-refDate.getTime())/86400000) : null;
      return { ...c, days };
    }).filter(c=>c.days!==null&&c.days>=30).sort((a,b)=>(b.days??0)-(a.days??0));
    return `👤 **Cari & Alacak Özeti**\n- Toplam alacak: ${formatMoney(alacak)}\n- Alacaklı müşteri: ${topBorclu.length}\n\n**En Yüksek 5 Alacak:**\n${topBorclu.map(c=>`• ${c.name}: ${formatMoney(c.balance)}`).join('\n')||'Yok'}${overdue.length>0?`\n\n⚠️ **Gecikmiş Alacaklar (30+ gün):**\n${overdue.slice(0,5).map(c=>`• ${c.name}: ${formatMoney(c.balance)} — ${c.days} gün`).join('\n')}`:''}`;
  }
  if (q.includes('satış') || q.includes('analiz') || q.includes('performans') || q.includes('bu ay') || q.includes('kâr')) {
    const marj = ciro > 0 ? ((kar/ciro)*100).toFixed(1) : '0';
    const topProducts = Object.entries(
      db.sales.filter(s=>!s.deleted&&s.status==='tamamlandi'&&new Date(s.createdAt)>=monthStart)
        .reduce((acc,s)=>{ acc[s.productName]=(acc[s.productName]||0)+s.total; return acc; }, {} as Record<string,number>)
    ).sort((a,b)=>b[1]-a[1]).slice(0,3);
    return `📊 **Bu Ay Satış Özeti**\n- ${monthSales.length} satış\n- Ciro: ${formatMoney(ciro)}\n- Kâr: ${formatMoney(kar)} (%${marj} marj)\n\n**Bu Ay Top 3 Ürün:**\n${topProducts.map(([n,v],i)=>`${i+1}. ${n}: ${formatMoney(v)}`).join('\n')||'Veri yok'}\n\n⚠️ *Çevrimdışı mod — karşılaştırmalı analiz için internet gerekli*`;
  }
  if (q.includes('risk') || q.includes('kritik') || q.includes('öneri') || q.includes('ipucu')) {
    const out = db.products.filter(p=>!p.deleted&&p.stock===0).length;
    const low = db.products.filter(p=>!p.deleted&&p.stock>0&&p.stock<=p.minStock).length;
    const alacak = db.cari.filter(c=>!c.deleted&&c.type==='musteri'&&c.balance>0).reduce((s,c)=>s+c.balance,0);
    const riskler: string[] = [];
    if (kasaToplam < 5000) riskler.push(`💸 Kasa düşük: ${formatMoney(kasaToplam)}`);
    if (out > 0) riskler.push(`📦 ${out} ürün stok bitti`);
    if (low > 0) riskler.push(`⚠️ ${low} üründe az stok`);
    if (alacak > 50000) riskler.push(`💳 Yüksek alacak: ${formatMoney(alacak)}`);
    if (db.orders.filter(o=>o.status==='bekliyor').length > 3) riskler.push(`🚚 ${db.orders.filter(o=>o.status==='bekliyor').length} bekleyen sipariş`);
    return `🔴 **Kritik Durumlar**\n${riskler.length>0?riskler.map((r,i)=>`${i+1}. ${r}`).join('\n'):'✅ Kritik durum tespit edilmedi'}\n\n⚠️ *Çevrimdışı mod — detaylı analiz için internet gerekli*`;
  }
  return `🔌 **Çevrimdışı Mod**\n\nİnternet bağlantısı olmadığından AI analizi yapılamıyor.\n\nSorabileceğiniz konular:\n- Stok durumu\n- Kasa & sermaye özeti\n- Müşteri alacakları\n- Bu ay satışlar\n- Kritik riskler`;
}

// ── Claude API (Anthropic direkt) ──
async function askClaude(messages: Message[], context: string, key: string, onChunk: (t: string) => void): Promise<void> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-3-5',
      max_tokens: 1024,
      system: `Sen Soba işletmesi için AI analistsin. Kısa, net, Türkçe yanıt ver.\n\n${context}`,
      messages: messages.filter(m=>m.content).map(m => ({ role: m.role, content: m.content })),
      stream: true,
    }),
  });
  if (res.status === 429) throw new Error('429 Too many requests');
  if (!res.ok) throw new Error(`Claude API: ${res.status}`);
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const d = JSON.parse(line.slice(6));
        if (d.type === 'content_block_delta') onChunk(d.delta?.text || '');
      } catch { /* ignore */ }
    }
  }
}

// ── Gemini API (yedek) ──
async function askGemini(messages: Message[], context: string, key: string, onChunk: (t: string) => void): Promise<void> {
  const contents = [
    { role: 'user', parts: [{ text: `İşletme verilerim:\n${context}` }] },
    { role: 'model', parts: [{ text: 'Anladım, verilerinizi inceledim. Nasıl yardımcı olabilirim?' }] },
    ...messages.filter(m=>m.content).map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
  ];
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: 'Türkçe, kısa ve net yanıt ver. Soba işletmesi analistisin.' }] } }),
  });
  if (res.status === 429) throw new Error('429 Too many requests');
  if (!res.ok) throw new Error(`Gemini API: ${res.status}`);
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const d = JSON.parse(line.slice(6));
        const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) onChunk(text);
      } catch { /* ignore */ }
    }
  }
}

function buildContext(db: DB): string {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const monthSales = db.sales.filter(s => !s.deleted && s.status === 'tamamlandi' && new Date(s.createdAt) >= monthStart);
  const lastMonthSales = db.sales.filter(s => !s.deleted && s.status === 'tamamlandi' && new Date(s.createdAt) >= lastMonthStart && new Date(s.createdAt) <= lastMonthEnd);
  const totalKasa = db.kasa.filter(k => !k.deleted).reduce((s, k) => s + (k.type === 'gelir' ? k.amount : -k.amount), 0);
  const nakit = db.kasa.filter(k=>!k.deleted&&k.kasa==='nakit').reduce((s,k)=>s+(k.type==='gelir'?k.amount:-k.amount),0);
  const banka = db.kasa.filter(k=>!k.deleted&&k.kasa==='banka').reduce((s,k)=>s+(k.type==='gelir'?k.amount:-k.amount),0);
  const outStock = db.products.filter(p=>!p.deleted&&p.stock===0);
  const lowStock = db.products.filter(p=>!p.deleted&&p.stock>0&&p.stock<=p.minStock);
  const stokDeger = db.products.filter(p=>!p.deleted).reduce((s,p)=>s+p.cost*p.stock,0);

  // Top ürünler — satış adedi ve ciro bazlı
  const productSales: Record<string, { ciro: number; adet: number; kar: number }> = {};
  db.sales.filter(s=>!s.deleted&&s.status==='tamamlandi').forEach(s => {
    const id = s.productId || s.productName;
    if (!productSales[id]) productSales[id] = { ciro: 0, adet: 0, kar: 0 };
    productSales[id].ciro += s.total;
    productSales[id].adet += s.quantity;
    productSales[id].kar += s.profit;
  });
  const topProducts = db.products.filter(p=>!p.deleted)
    .map(p => ({ ...p, ...( productSales[p.id] || { ciro: 0, adet: 0, kar: 0 }) }))
    .sort((a,b) => b.ciro - a.ciro).slice(0, 5);

  // Gecikmiş alacaklar
  const overdueMusteri = db.cari.filter(c=>!c.deleted&&c.type==='musteri'&&c.balance>0).map(c => {
    const lastPay = db.kasa.filter(k=>!k.deleted&&k.cariId===c.id&&k.type==='gelir').sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime())[0];
    const lastPayDate = lastPay ? new Date(lastPay.createdAt) : null;
    const unpaidSale = db.sales.filter(s=>!s.deleted&&s.status==='tamamlandi'&&(s.cariId===c.id||s.customerId===c.id)).filter(s=>!lastPayDate||new Date(s.createdAt)>lastPayDate).sort((a,b)=>new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime())[0];
    const refDate = unpaidSale ? new Date(unpaidSale.createdAt) : c.lastTransaction ? new Date(c.lastTransaction) : null;
    const days = refDate ? Math.floor((Date.now()-refDate.getTime())/86400000) : null;
    return { name: c.name, balance: c.balance, days, phone: c.phone };
  }).filter(c=>c.days!==null&&c.days>=30).sort((a,b)=>(b.days??0)-(a.days??0));

  const alacak = db.cari.filter(c=>!c.deleted&&c.type==='musteri'&&c.balance>0).reduce((s,c)=>s+c.balance,0);
  const borc = db.cari.filter(c=>!c.deleted&&c.type==='tedarikci'&&c.balance>0).reduce((s,c)=>s+c.balance,0);
  const topBorclu = [...db.cari].filter(c=>!c.deleted&&c.type==='musteri'&&c.balance>0).sort((a,b)=>b.balance-a.balance).slice(0,5);

  const catSales: Record<string,{ ciro: number; kar: number }> = {};
  db.sales.filter(s=>!s.deleted&&s.status==='tamamlandi').forEach(s=>{
    const c=s.productCategory||'Diğer';
    if(!catSales[c]) catSales[c]={ciro:0,kar:0};
    catSales[c].ciro+=s.total; catSales[c].kar+=s.profit;
  });

  // Aylık trend (son 6 ay)
  const monthlyTrend: Record<string,number> = {};
  for(let i=5;i>=0;i--){
    const d=new Date(today.getFullYear(),today.getMonth()-i,1);
    const key=d.toLocaleDateString('tr-TR',{month:'short',year:'2-digit'});
    monthlyTrend[key]=0;
  }
  db.sales.filter(s=>!s.deleted&&s.status==='tamamlandi').forEach(s=>{
    const d=new Date(s.createdAt);
    const key=d.toLocaleDateString('tr-TR',{month:'short',year:'2-digit'});
    if(monthlyTrend[key]!==undefined) monthlyTrend[key]+=s.total;
  });

  const monthCiro = monthSales.reduce((s,x)=>s+x.total,0);
  const monthKar = monthSales.reduce((s,x)=>s+x.profit,0);
  const lastMonthCiro = lastMonthSales.reduce((s,x)=>s+x.total,0);
  const buyumePct = lastMonthCiro > 0 ? ((monthCiro-lastMonthCiro)/lastMonthCiro*100).toFixed(1) : 'N/A';

  return `## İşletme Özeti — ${today.toLocaleDateString('tr-TR')}

### 📊 Satış Performansı
- Bu ay: ${monthSales.length} satış | Ciro: ${formatMoney(monthCiro)} | Kâr: ${formatMoney(monthKar)} | Marj: %${monthCiro>0?((monthKar/monthCiro)*100).toFixed(1):0}
- Geçen ay: ${lastMonthSales.length} satış | Ciro: ${formatMoney(lastMonthCiro)}
- Büyüme: ${buyumePct}%
- Tüm zamanlar: ${db.sales.filter(s=>!s.deleted&&s.status==='tamamlandi').length} satış

### 💰 Kasa Durumu
- Toplam: ${formatMoney(totalKasa)} | Nakit: ${formatMoney(nakit)} | Banka: ${formatMoney(banka)}
- Diğer kasalar: ${formatMoney(totalKasa-nakit-banka)}

### 📦 Stok
- Toplam: ${db.products.filter(p=>!p.deleted).length} ürün | Stok değeri: ${formatMoney(stokDeger)}
- Biten: ${outStock.length}${outStock.length?` (${outStock.slice(0,3).map(p=>p.name).join(', ')})`:''} | Az stoklu: ${lowStock.length}

### 🏆 Top 5 Ürün (Ciro)
${topProducts.map((p,i)=>`${i+1}. ${p.name}: ${formatMoney(p.ciro)} ciro, ${p.adet} adet, ${formatMoney(p.kar)} kâr`).join('\n')}

### 👤 Cari & Alacak
- Toplam alacak: ${formatMoney(alacak)} | Toplam borç: ${formatMoney(borc)}
- En yüksek 5 alacak: ${topBorclu.map(c=>`${c.name}(${formatMoney(c.balance)})`).join(', ')||'Yok'}
${overdueMusteri.length>0?`- ⚠️ GECİKMİŞ ALACAKLAR (30+ gün): ${overdueMusteri.slice(0,5).map(c=>`${c.name} ${c.days}gün ${formatMoney(c.balance)}`).join(', ')}`:'- ✅ Gecikmiş alacak yok'}

### 🏭 Tedarik
- Tedarikçi: ${db.suppliers.length} | Bekleyen sipariş: ${db.orders.filter(o=>o.status==='bekliyor').length} | Yolda: ${db.orders.filter(o=>o.status==='yolda').length}

### 🏷️ Kategori Performansı
${Object.entries(catSales).sort((a,b)=>b[1].ciro-a[1].ciro).map(([c,v])=>`${c}: ${formatMoney(v.ciro)} ciro, %${v.ciro>0?((v.kar/v.ciro)*100).toFixed(1):0} marj`).join('\n')||'Veri yok'}

### 📅 Aylık Trend (Son 6 Ay)
${Object.entries(monthlyTrend).map(([m,v])=>`${m}: ${formatMoney(v)}`).join(' | ')}`;
}

const QUICK_PROMPTS = [
  { label: '📊 Bu Ay Analiz', prompt: 'Bu ayın satış performansını detaylı analiz et. Geçen aya göre büyüme/düşüş var mı? Kâr marjı nasıl?' },
  { label: '📦 Stok Durumu', prompt: 'Stoklarımın durumunu değerlendir. Hangi ürünleri acil sipariş etmeliyim? Stok değerim ne kadar?' },
  { label: '💰 Kâr Analizi', prompt: 'En kârlı ürünlerim hangileri? Hangi kategoride kâr marjı düşük? İyileştirme önerileri ver.' },
  { label: '🔮 Satış Tahmini', prompt: 'Aylık trend verilerime göre önümüzdeki ay için satış tahmini yap. Hangi ürünlere odaklanmalıyım?' },
  { label: '👤 Alacak Takibi', prompt: 'Gecikmiş alacaklarım var mı? Hangi müşterilerden tahsilat yapmalıyım? Öncelik sırası ver.' },
  { label: '🏭 Tedarik Analizi', prompt: 'Tedarikçilerimle ilgili durum nedir? Bekleyen siparişler var mı? Maliyet optimizasyonu için ne yapabilirim?' },
  { label: '💡 Kritik Öneriler', prompt: 'İşletmem için şu an en kritik 5 aksiyon nedir? Öncelik sırasıyla listele.' },
  { label: '📈 Büyüme Stratejisi', prompt: 'Verilerime göre satışları artırmak için hangi stratejileri izlemeliyim? Hangi ürün/kategori potansiyeli var?' },
  { label: '⚖️ Net Sermaye', prompt: 'Net sermayem ne durumda? Kasa, alacak ve borçlarımı değerlendirerek finansal sağlığımı analiz et.' },
  { label: '🔴 Risk Analizi', prompt: 'İşletmemde şu an en büyük finansal riskler neler? Stok, alacak ve kasa açısından değerlendir.' },
];

function MarkdownText({ text }: { text: string }) {
  const html = text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^### (.+)$/gm, '<h4 style="color:#ff7043;font-size:0.9rem;margin:10px 0 4px;font-weight:700">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="color:#f1f5f9;font-size:1rem;margin:12px 0 6px;font-weight:800">$1</h3>')
    .replace(/^- (.+)$/gm, '<li style="margin:3px 0;padding-left:4px">$1</li>')
    .replace(/(<li[^>]*>.*<\/li>\n?)+/gs, '<ul style="list-style:none;padding:0;margin:6px 0">$&</ul>')
    .replace(/\n\n/g, '<br/>').replace(/\n/g, '<br/>');
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

// ── API Ayarları Paneli ──
function ApiSettings({ onClose }: { onClose: () => void }) {
  const [ck, setCk] = useState('');
  const [gk, setGk] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    loadKeysFromFirebase().then(keys => {
      setCk(keys.claude);
      setGk(keys.gemini);
      setLoading(false);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    const ok = await saveKeysToFirebase(ck.trim(), gk.trim());
    if (ok) {
      invalidateKeyCache();
      setMsg('✅ Firebase\'e kaydedildi');
      setTimeout(() => { setMsg(''); onClose(); }, 1200);
    } else {
      setMsg('❌ Kayıt başarısız — Firebase bağlantısını kontrol edin');
    }
    setSaving(false);
  };

  const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: '0.85rem', boxSizing: 'border-box', fontFamily: 'monospace' };
  return (
    <div style={{ padding: '16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '8px 12px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8 }}>
        <span>☁️</span>
        <p style={{ color: '#10b981', fontSize: '0.82rem', margin: 0 }}>API anahtarları Firebase'de şifreli saklanır — tüm cihazlarda geçerlidir.</p>
      </div>
      {loading ? (
        <div style={{ color: '#64748b', fontSize: '0.85rem', textAlign: 'center', padding: '20px 0' }}>Firebase'den yükleniyor...</div>
      ) : (
        <>
          <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.82rem', marginBottom: 4 }}>🤖 Claude API Key (Anthropic — birincil)</label>
          <input value={ck} onChange={e => setCk(e.target.value)} placeholder="sk-ant-..." style={{ ...inp, marginBottom: 14 }} type="password" />
          <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.82rem', marginBottom: 4 }}>✨ Gemini API Key (Google — yedek)</label>
          <input value={gk} onChange={e => setGk(e.target.value)} placeholder="AIza..." style={{ ...inp, marginBottom: 18 }} type="password" />
          {msg && <div style={{ marginBottom: 12, fontSize: '0.82rem', color: msg.startsWith('✅') ? '#10b981' : '#ef4444', fontWeight: 600 }}>{msg}</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={save} disabled={saving} style={{ flex: 1, background: '#10b981', border: 'none', borderRadius: 8, color: '#fff', padding: '10px 0', fontWeight: 700, cursor: 'pointer' }}>
              {saving ? 'Kaydediliyor...' : '☁️ Firebase\'e Kaydet'}
            </button>
            <button onClick={onClose} style={{ background: '#273548', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', padding: '10px 16px', cursor: 'pointer' }}>İptal</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function AIAsistan({ db, embedded = false }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState<'idle' | 'claude' | 'gemini' | 'offline'>('idle');
  const [showSettings, setShowSettings] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const context = buildContext(db);
  const chatRef = useRef<HTMLDivElement>(null);

  // Sesli özellikler
  const { speaking, speak, stop: stopSpeak } = useSpeechSynthesis();
  const { listening, supported: micSupported, error: micError, start: startListen, stop: stopListen } = useSpeechRecognition((text) => {
    setInput(text);
    // Sesli girişten gelen metni otomatik gönder
    setTimeout(() => sendText(text), 100);
  });

  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [messages, loading]);

  const [keysLoaded, setKeysLoaded] = useState(false);
  const [hasKeys, setHasKeys] = useState(false);
  const [keyLoadError, setKeyLoadError] = useState(false);
  const keysRef = useRef({ claude: '', gemini: '' });

  useEffect(() => {
    getKeys().then(keys => {
      keysRef.current = keys;
      const loaded = !!(keys.claude || keys.gemini);
      setHasKeys(loaded);
      setKeyLoadError(!loaded); // anahtarlar yüklenemedi ise true
      setKeysLoaded(true);
    }).catch(() => {
      setKeyLoadError(true);
      setKeysLoaded(true);
    });
  }, []);

  const [isOnline, setIsOnline] = useState(true); // başlangıçta online kabul et

  useEffect(() => {
    // Capacitor Network plugin (Android WebView'da navigator.onLine güvenilmez)
    const initNetwork = async () => {
      try {
        const { Network } = await import('@capacitor/network');
        const status = await Network.getStatus();
        setIsOnline(status.connected);
        Network.addListener('networkStatusChange', s => setIsOnline(s.connected));
      } catch {
        // Web fallback
        setIsOnline(navigator.onLine);
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
      }
    };
    initNetwork();
  }, []);

  const copyMsg = (text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    });
  };

  const send = useCallback(async (text?: string) => {
    const userMsg = (text || input).trim();
    if (!userMsg || loading) return;

    // Rate limit koruması: son istekten en az 3 saniye geçmeli
    const now = Date.now();
    const lastReq = parseInt(sessionStorage.getItem('ai_last_req') || '0');
    const elapsed = now - lastReq;
    if (elapsed < 3000 && lastReq > 0) {
      const wait = Math.ceil((3000 - elapsed) / 1000);
      setMessages(prev => [...prev,
        { role: 'user', content: userMsg },
        { role: 'assistant', content: `⏳ Çok hızlı istek gönderiyorsunuz. Lütfen ${wait} saniye bekleyin.`, source: 'offline' }
      ]);
      return;
    }
    sessionStorage.setItem('ai_last_req', String(now));

    setInput('');
    setLoading(true);
    const newMessages: Message[] = [...messages, { role: 'user', content: userMsg }];
    setMessages(newMessages);
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    if (!isOnline) {
      const reply = offlineReply(db, userMsg);
      setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: reply, source: 'offline' }; return u; });
      if (autoSpeak) speak(reply);
      setApiStatus('offline'); setLoading(false); return;
    }

    // Key'leri her seferinde cache'den al (kaydet sonrası invalidate edilir)
    const keys = await getKeys();
    keysRef.current = keys;
    const claudeKey = keys.claude;
    const geminiKey = keys.gemini;

    const appendChunk = (chunk: string) => {
      setMessages(prev => { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], content: u[u.length - 1].content + chunk }; return u; });
    };

    // Rate limit hata mesajı oluştur
    const rateLimitMsg = (api: string) =>
      `⚠️ **${api} rate limit aşıldı** — çok fazla istek gönderildi.\n\nBirkaç dakika bekleyip tekrar deneyin. Bu sürede çevrimdışı mod aktif.`;

    if (claudeKey) {
      try {
        setApiStatus('claude');
        setMessages(prev => { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], source: 'claude' }; return u; });
        await askClaude(newMessages, context, claudeKey, appendChunk);
        if (autoSpeak) {
          setMessages(prev => { if (prev[prev.length-1]?.content) speak(prev[prev.length-1].content); return prev; });
        }
        setLoading(false); return;
      } catch (e: any) {
        const msg = String(e?.message || e || '');
        if (msg.includes('429') || msg.toLowerCase().includes('too many') || msg.toLowerCase().includes('rate')) {
          setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: rateLimitMsg('Claude'), source: 'offline' }; return u; });
          setLoading(false); return;
        }
        console.warn('Claude başarısız, Gemini deneniyor:', e);
        setMessages(prev => { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], content: '' }; return u; });
      }
    }

    if (geminiKey) {
      try {
        setApiStatus('gemini');
        setMessages(prev => { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], source: 'gemini' }; return u; });
        await askGemini(newMessages, context, geminiKey, appendChunk);
        if (autoSpeak) {
          setMessages(prev => { if (prev[prev.length-1]?.content) speak(prev[prev.length-1].content); return prev; });
        }
        setLoading(false); return;
      } catch (e: any) {
        const msg = String(e?.message || e || '');
        if (msg.includes('429') || msg.toLowerCase().includes('too many') || msg.toLowerCase().includes('rate')) {
          setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: rateLimitMsg('Gemini'), source: 'offline' }; return u; });
          setLoading(false); return;
        }
        console.warn('Gemini de başarısız:', e);
      }
    }

    const reply = !(claudeKey || geminiKey)
      ? '🔑 API anahtarı girilmemiş. Sağ üstteki ⚙️ ikonuna tıklayarak Claude veya Gemini anahtarınızı ekleyin.'
      : offlineReply(db, userMsg);
    setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: reply, source: 'offline' }; return u; });
    if (autoSpeak) speak(reply);
    setApiStatus('offline');
    setLoading(false);
  }, [input, loading, messages, context, db, autoSpeak, speak, isOnline]);

  // Sesli girişten çağrılabilmesi için ayrı ref
  const sendText = useCallback((text: string) => {
    if (!text.trim() || loading) return;
    setInput('');
    // send fonksiyonunu text parametresiyle çağır
    send(text);
  }, [send, loading]);

  const handleKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  const sourceLabel: Record<string, { label: string; color: string; bg: string }> = {
    claude: { label: '🤖 Claude', color: '#818cf8', bg: 'rgba(99,102,241,0.12)' },
    gemini: { label: '✨ Gemini', color: '#a78bfa', bg: 'rgba(139,92,246,0.12)' },
    offline: { label: '🔌 Çevrimdışı', color: '#64748b', bg: 'rgba(100,116,139,0.1)' },
  };

  // Anlık işletme özeti
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  const monthSales = db.sales.filter(s=>!s.deleted&&s.status==='tamamlandi'&&new Date(s.createdAt)>=monthStart);
  const kasaToplam = db.kasa.filter(k=>!k.deleted).reduce((s,k)=>s+(k.type==='gelir'?k.amount:-k.amount),0);
  const alacakToplam = db.cari.filter(c=>!c.deleted&&c.type==='musteri'&&c.balance>0).reduce((s,c)=>s+c.balance,0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: embedded ? '100%' : 'calc(100vh - 140px)' }}>
      {/* Header — sadece standalone modda */}
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, padding: '16px 20px', background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.06))', borderRadius: 16, border: '1px solid rgba(99,102,241,0.2)' }}>
          <div style={{ width: 48, height: 48, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', flexShrink: 0, boxShadow: '0 4px 20px rgba(99,102,241,0.4)' }}>🤖</div>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontWeight: 800, color: '#f1f5f9', fontSize: '1.1rem', margin: 0 }}>Soba AI Asistan</h2>
            <p style={{ color: '#475569', fontSize: '0.78rem', margin: '3px 0 0' }}>
              {!isOnline
                ? '🔌 Çevrimdışı — temel sorulara yanıt verir'
                : hasKeys
                  ? `✅ ${keysRef.current.claude ? 'Claude' : ''}${keysRef.current.claude && keysRef.current.gemini ? ' + ' : ''}${keysRef.current.gemini ? 'Gemini' : ''} hazır`
                  : keyLoadError
                    ? '⚠️ Anahtarlar yüklenemedi — ⚙️ ayarlara girin'
                    : '⚠️ API anahtarı girilmemiş — ⚙️ ayarlara girin'}
            </p>
          </div>
          {/* Anlık özet */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {[
              { label: 'Bu Ay', value: formatMoney(monthSales.reduce((s,x)=>s+x.total,0)), color: '#10b981' },
              { label: 'Kasa', value: formatMoney(kasaToplam), color: '#06b6d4' },
              { label: 'Alacak', value: formatMoney(alacakToplam), color: '#f59e0b' },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center', display: 'none' }} className="ai-stat">
                <div style={{ color: s.color, fontWeight: 700, fontSize: '0.85rem' }}>{s.value}</div>
                <div style={{ color: '#475569', fontSize: '0.65rem' }}>{s.label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {messages.length > 0 && (
              <button onClick={() => setMessages([])} title="Sohbeti Temizle" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, color: '#475569', padding: '7px 12px', cursor: 'pointer', fontSize: '0.82rem' }}>🗑️</button>
            )}
            <button onClick={() => setShowSettings(s => !s)} title="API Ayarları" style={{ background: showSettings ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 8, color: '#818cf8', padding: '7px 12px', cursor: 'pointer', fontSize: '0.9rem' }}>⚙️</button>
          </div>
        </div>
      )}

      {/* Embedded header */}
      {embedded && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <div style={{ flex: 1, display: 'flex', gap: 8 }}>
            {[
              { label: 'Bu Ay Ciro', value: formatMoney(monthSales.reduce((s,x)=>s+x.total,0)), color: '#10b981' },
              { label: 'Kasa', value: formatMoney(kasaToplam), color: '#06b6d4' },
              { label: 'Alacak', value: formatMoney(alacakToplam), color: '#f59e0b' },
            ].map(s => (
              <div key={s.label} style={{ flex: 1, background: `${s.color}10`, border: `1px solid ${s.color}20`, borderRadius: 8, padding: '6px 10px', textAlign: 'center' }}>
                <div style={{ color: s.color, fontWeight: 700, fontSize: '0.82rem' }}>{s.value}</div>
                <div style={{ color: '#475569', fontSize: '0.62rem', marginTop: 1 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <button onClick={() => setShowSettings(s => !s)} style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, color: '#818cf8', padding: '6px 10px', cursor: 'pointer', fontSize: '0.85rem' }}>⚙️</button>
          {messages.length > 0 && <button onClick={() => setMessages([])} style={{ background: 'rgba(255,255,255,0.04)', border: 'none', borderRadius: 8, color: '#475569', padding: '6px 10px', cursor: 'pointer', fontSize: '0.85rem' }}>🗑️</button>}
        </div>
      )}

      {/* API Ayarları */}
      {showSettings && (
        <div style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 14, padding: '16px 20px', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <h3 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.95rem' }}>⚙️ API Ayarları</h3>
            <button onClick={() => { invalidateKeyCache(); setShowSettings(false); }} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
          </div>
          <ApiSettings onClose={() => { invalidateKeyCache(); setShowSettings(false); }} />
        </div>
      )}

      {/* Quick prompts — boş ekranda büyük grid */}
      {messages.length === 0 && !showSettings && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '20px 0 16px' }}>
            <div style={{ fontSize: '3rem', marginBottom: 10, opacity: 0.5 }}>🤖</div>
            <h3 style={{ color: '#475569', fontWeight: 700, marginBottom: 6, fontSize: '0.95rem' }}>İşletmenizle ilgili her şeyi sorabilirsiniz</h3>
            <p style={{ color: '#334155', fontSize: '0.8rem', maxWidth: 360, lineHeight: 1.6 }}>{hasKeys ? 'Gerçek verilerinizi analiz ederek yanıt verir.' : '⚠️ ⚙️ Ayarlar\'dan API anahtarını girin. İnternetsiz de temel sorulara yanıt verir.'}</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {QUICK_PROMPTS.map(p => (
              <button key={p.label} onClick={() => send(p.prompt)} disabled={loading}
                style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 10, color: '#818cf8', padding: '10px 14px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, textAlign: 'left', transition: 'all 0.15s', opacity: loading ? 0.5 : 1 }}
                onMouseEnter={e => { if (!loading) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.14)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.35)'; } }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.06)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.15)'; }}
              >{p.label}</button>
            ))}
          </div>
        </div>
      )}

      {/* Chat */}
      <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: '2px 4px' }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, flexDirection: msg.role === 'user' ? 'row-reverse' : 'row', alignItems: 'flex-start' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: msg.role === 'user' ? 'linear-gradient(135deg,#ff5722,#ff7043)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', flexShrink: 0, boxShadow: msg.role === 'user' ? '0 2px 10px rgba(255,87,34,0.3)' : '0 2px 10px rgba(99,102,241,0.3)' }}>
              {msg.role === 'user' ? '👤' : '🤖'}
            </div>
            <div style={{ maxWidth: '80%', minWidth: 0 }}>
              <div style={{ background: msg.role === 'user' ? 'linear-gradient(135deg,rgba(255,87,34,0.12),rgba(255,87,34,0.06))' : 'linear-gradient(135deg,rgba(99,102,241,0.1),rgba(99,102,241,0.04))', border: `1px solid ${msg.role === 'user' ? 'rgba(255,87,34,0.2)' : 'rgba(99,102,241,0.15)'}`, borderRadius: 14, padding: '12px 15px' }}>
                <div style={{ color: '#e2e8f0', fontSize: '0.87rem', lineHeight: 1.7 }}>
                  {msg.role === 'assistant' ? <MarkdownText text={msg.content || '...'} /> : msg.content}
                </div>
              </div>
              {msg.role === 'assistant' && msg.content && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  {msg.source && <span style={{ fontSize: '0.7rem', color: sourceLabel[msg.source]?.color || '#64748b', fontWeight: 600, background: sourceLabel[msg.source]?.bg, borderRadius: 5, padding: '2px 7px' }}>{sourceLabel[msg.source]?.label}</span>}
                  <button onClick={() => copyMsg(msg.content, i)} style={{ background: 'none', border: 'none', color: copiedIdx === i ? '#10b981' : '#334155', cursor: 'pointer', fontSize: '0.72rem', padding: '2px 6px', borderRadius: 5, transition: 'color 0.2s' }}>
                    {copiedIdx === i ? '✓ Kopyalandı' : '📋 Kopyala'}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && messages[messages.length - 1]?.content === '' && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🤖</div>
            <div style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 14, padding: '12px 18px' }}>
              <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                {[0,1,2].map(i=><div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#6366f1', animation: `pulse 1.2s ease ${i*0.2}s infinite` }} />)}
                <span style={{ color: '#475569', fontSize: '0.75rem', marginLeft: 6 }}>
                  {apiStatus === 'claude' ? 'Claude düşünüyor...' : apiStatus === 'gemini' ? 'Gemini yanıtlıyor...' : 'Yanıt hazırlanıyor...'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
            placeholder={listening ? '🎤 Dinleniyor...' : 'Sorunuzu yazın veya 🎤 mikrofona basın...'}
            rows={2} disabled={loading || listening}
            style={{ width: '100%', padding: '11px 15px', background: listening ? 'rgba(239,68,68,0.08)' : 'rgba(99,102,241,0.06)', border: `1px solid ${listening ? 'rgba(239,68,68,0.4)' : 'rgba(99,102,241,0.2)'}`, borderRadius: 12, color: '#f1f5f9', fontSize: '0.88rem', resize: 'none', boxSizing: 'border-box', outline: 'none', lineHeight: 1.5, fontFamily: 'inherit', transition: 'all 0.2s' }}
            onFocus={e => (e.target.style.borderColor = 'rgba(99,102,241,0.5)')}
            onBlur={e => { if (!listening) e.target.style.borderColor = 'rgba(99,102,241,0.2)'; }}
          />
          {micError && <div style={{ position: 'absolute', bottom: -20, left: 0, fontSize: '0.72rem', color: '#f87171' }}>{micError}</div>}
        </div>

        {/* Mikrofon butonu */}
        {micSupported && (
          <button
            onPointerDown={e => { e.preventDefault(); startListen(); }}
            onPointerUp={e => { e.preventDefault(); stopListen(); }}
            onPointerLeave={() => stopListen()}
            disabled={loading}
            title="Basılı tut ve konuş"
            style={{
              width: 46, height: 46, flexShrink: 0,
              background: listening
                ? 'linear-gradient(135deg,#ef4444,#dc2626)'
                : 'rgba(239,68,68,0.1)',
              border: `1px solid ${listening ? 'rgba(239,68,68,0.6)' : 'rgba(239,68,68,0.2)'}`,
              borderRadius: 12, color: listening ? '#fff' : '#f87171',
              cursor: 'pointer', fontSize: '1.2rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: listening ? '0 0 20px rgba(239,68,68,0.5)' : 'none',
              animation: listening ? 'micPulse 1s ease-in-out infinite' : 'none',
              transition: 'all 0.2s',
            }}
          >🎤</button>
        )}

        {/* Gönder butonu */}
        <button onClick={() => send()} disabled={loading || !input.trim() || listening}
          style={{ width: 46, height: 46, flexShrink: 0, background: loading || !input.trim() ? 'rgba(99,102,241,0.1)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 'none', borderRadius: 12, color: loading || !input.trim() ? '#334155' : '#fff', cursor: loading || !input.trim() ? 'not-allowed' : 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: loading || !input.trim() ? 'none' : '0 4px 16px rgba(99,102,241,0.4)', transition: 'all 0.2s' }}>
          {loading ? '⏳' : '↑'}
        </button>
      </div>

      {/* Sesli okuma & ayar çubuğu */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        {/* Otomatik sesli okuma toggle */}
        <button
          onClick={() => { if (speaking) stopSpeak(); setAutoSpeak(a => !a); }}
          title={autoSpeak ? 'Sesli okuma açık — kapat' : 'Sesli okuma kapalı — aç'}
          style={{
            padding: '5px 12px', borderRadius: 8, border: `1px solid ${autoSpeak ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.08)'}`,
            background: autoSpeak ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.03)',
            color: autoSpeak ? '#10b981' : '#475569', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.2s',
          }}
        >
          {speaking ? '🔊' : autoSpeak ? '🔈' : '🔇'}
          <span>{autoSpeak ? 'Sesli Açık' : 'Sesli Kapalı'}</span>
        </button>

        {/* Son cevabı sesli oku */}
        {messages.length > 0 && messages[messages.length-1]?.role === 'assistant' && messages[messages.length-1]?.content && (
          <button
            onClick={() => {
              if (speaking) stopSpeak();
              else speak(messages[messages.length-1].content);
            }}
            style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(99,102,241,0.2)', background: 'rgba(99,102,241,0.06)', color: speaking ? '#818cf8' : '#475569', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.2s' }}
          >
            {speaking ? '⏹ Durdur' : '▶ Son Cevabı Oku'}
          </button>
        )}

        {micSupported && (
          <span style={{ color: '#1e3a5f', fontSize: '0.7rem', marginLeft: 'auto' }}>
            🎤 Basılı tut → konuş → bırak
          </span>
        )}
      </div>

      {/* Konuşma devam ederken mini quick prompts */}
      {messages.length > 0 && !loading && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {QUICK_PROMPTS.slice(0, 5).map(p => (
            <button key={p.label} onClick={() => send(p.prompt)} disabled={loading}
              style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.12)', borderRadius: 7, color: '#475569', padding: '4px 10px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, transition: 'all 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#818cf8'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.3)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#475569'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.12)'; }}
            >{p.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
