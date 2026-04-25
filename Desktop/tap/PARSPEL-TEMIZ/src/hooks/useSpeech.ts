import { useState, useRef, useCallback, useEffect } from 'react';

// Android WebView'da Web Speech API çalışmaz.
// Capacitor + Android için SpeechRecognition plugin kullanılır.
// Fallback: getUserMedia ile mikrofon izni alınır.

function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

function isCapacitor(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

// ── Sesli Tanıma (Speech-to-Text) ────────────────────────────────────────
export function useSpeechRecognition(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState('');
  const recRef = useRef<any>(null);

  useEffect(() => {
    // Android native'de Web Speech API çalışmaz ama kontrol edelim
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition ||
      (window as any).mozSpeechRecognition;
    // Android'de desteklenmiyor olarak işaretle (WebView kısıtı)
    const androidNative = isCapacitor() && isAndroid();
    setSupported(!!SpeechRecognition && !androidNative);
  }, []);

  const start = useCallback(async () => {
    // Android native'de desteklenmiyor
    if (isCapacitor() && isAndroid()) {
      setError('Sesli giriş Android uygulamasında desteklenmiyor. Web tarayıcısından kullanın.');
      setTimeout(() => setError(''), 4000);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError('Bu cihaz sesli girişi desteklemiyor');
      setTimeout(() => setError(''), 3000);
      return;
    }

    // Mikrofon izni iste
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setError('Mikrofon izni gerekli — Ayarlar > Uygulama İzinleri');
        setTimeout(() => setError(''), 4000);
        return;
      }
    }

    const rec = new SpeechRecognition();
    rec.lang = 'tr-TR';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => { setListening(true); setError(''); };
    rec.onend = () => setListening(false);
    rec.onerror = (e: any) => {
      setListening(false);
      if (e.error === 'no-speech') setError('Ses algılanamadı, tekrar deneyin');
      else if (e.error === 'not-allowed') setError('Mikrofon izni gerekli');
      else setError('Ses tanıma hatası: ' + e.error);
      setTimeout(() => setError(''), 3000);
    };
    rec.onresult = (e: any) => {
      const text = e.results[0][0].transcript;
      if (text.trim()) onResult(text.trim());
    };

    recRef.current = rec;
    try { rec.start(); } catch { setError('Ses tanıma başlatılamadı'); }
  }, [onResult]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  return { listening, supported, error, start, stop };
}

// ── Sesli Okuma (Text-to-Speech) ─────────────────────────────────────────
export function useSpeechSynthesis() {
  const [speaking, setSpeaking] = useState(false);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Android WebView'da speechSynthesis var ama Türkçe ses olmayabilir
  const supported = 'speechSynthesis' in window;

  const speak = useCallback((text: string) => {
    if (!supported) return;

    // Önceki konuşmayı durdur
    window.speechSynthesis.cancel();

    // Markdown temizle
    const clean = text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/#{1,6}\s/g, '')
      .replace(/`{1,3}[^`]*`{1,3}/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[-•]\s/g, '')
      // Sayıları Türkçe okunabilir hale getir
      .replace(/₺(\d+)/g, '$1 lira')
      .replace(/(\d+)%/g, 'yüzde $1')
      .slice(0, 500);

    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = 'tr-TR';
    // Daha doğal ses için ayarlar
    utter.rate = 0.95;   // biraz yavaş = daha net
    utter.pitch = 1.05;  // hafif yüksek = daha canlı
    utter.volume = 1;

    // En iyi Türkçe sesi seç
    const trySpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      // Öncelik sırası: Google TR > Microsoft TR > herhangi TR
      const trVoice =
        voices.find(v => v.lang === 'tr-TR' && v.name.includes('Google')) ||
        voices.find(v => v.lang === 'tr-TR' && v.name.includes('Microsoft')) ||
        voices.find(v => v.lang === 'tr-TR') ||
        voices.find(v => v.lang.startsWith('tr'));
      if (trVoice) utter.voice = trVoice;
      utter.onstart = () => setSpeaking(true);
      utter.onend = () => setSpeaking(false);
      utter.onerror = () => setSpeaking(false);
      utterRef.current = utter;
      window.speechSynthesis.speak(utter);
    };

    if (window.speechSynthesis.getVoices().length > 0) {
      trySpeak();
    } else {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        trySpeak();
      };
      setTimeout(trySpeak, 500);
    }
  }, [supported]);

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  return { speaking, supported, speak, stop };
}
