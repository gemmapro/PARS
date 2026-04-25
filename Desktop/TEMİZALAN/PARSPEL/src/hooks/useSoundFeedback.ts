import { useCallback, useRef } from 'react';

export type SoundType = 'success' | 'error' | 'warning' | 'sale' | 'notification';
export type SoundTheme = 'standart' | 'minimal' | 'yogun';

export interface SoundSettings {
  enabled: boolean;
  volume: number;
  theme: SoundTheme;
}

const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  enabled: true,
  volume: 0.5,
  theme: 'standart',
};

function loadSoundSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem('sobaYonetim');
    if (!raw) return DEFAULT_SOUND_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SOUND_SETTINGS, ...(parsed.soundSettings || {}) };
  } catch {
    return DEFAULT_SOUND_SETTINGS;
  }
}

function playTone(
  ctx: AudioContext,
  freq: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sine',
  startTime: number = 0,
  fadeOut: boolean = true
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);
  gain.gain.setValueAtTime(volume, ctx.currentTime + startTime);
  if (fadeOut) {
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
  }
  osc.start(ctx.currentTime + startTime);
  osc.stop(ctx.currentTime + startTime + duration);
}

function playSuccessStandart(ctx: AudioContext, vol: number) {
  playTone(ctx, 523, 0.12, vol * 0.6, 'sine', 0);
  playTone(ctx, 659, 0.12, vol * 0.6, 'sine', 0.1);
  playTone(ctx, 784, 0.18, vol * 0.6, 'sine', 0.2);
}

function playSuccessMinimal(ctx: AudioContext, vol: number) {
  playTone(ctx, 880, 0.15, vol * 0.5, 'sine', 0);
}

function playSuccessYogun(ctx: AudioContext, vol: number) {
  playTone(ctx, 440, 0.08, vol * 0.7, 'square', 0);
  playTone(ctx, 660, 0.08, vol * 0.7, 'square', 0.08);
  playTone(ctx, 880, 0.08, vol * 0.7, 'square', 0.16);
  playTone(ctx, 1100, 0.2, vol * 0.5, 'sine', 0.24);
}

function playErrorStandart(ctx: AudioContext, vol: number) {
  playTone(ctx, 300, 0.15, vol * 0.6, 'sawtooth', 0);
  playTone(ctx, 220, 0.2, vol * 0.6, 'sawtooth', 0.12);
}

function playErrorMinimal(ctx: AudioContext, vol: number) {
  playTone(ctx, 200, 0.18, vol * 0.5, 'sine', 0);
}

function playErrorYogun(ctx: AudioContext, vol: number) {
  playTone(ctx, 150, 0.1, vol * 0.8, 'sawtooth', 0);
  playTone(ctx, 180, 0.1, vol * 0.8, 'sawtooth', 0.08);
  playTone(ctx, 120, 0.25, vol * 0.7, 'sawtooth', 0.16);
}

function playWarningStandart(ctx: AudioContext, vol: number) {
  playTone(ctx, 400, 0.12, vol * 0.5, 'triangle', 0);
  playTone(ctx, 350, 0.15, vol * 0.5, 'triangle', 0.1);
}

function playWarningMinimal(ctx: AudioContext, vol: number) {
  playTone(ctx, 440, 0.15, vol * 0.4, 'triangle', 0);
}

function playWarningYogun(ctx: AudioContext, vol: number) {
  playTone(ctx, 440, 0.08, vol * 0.6, 'square', 0);
  playTone(ctx, 440, 0.08, vol * 0.6, 'square', 0.15);
  playTone(ctx, 440, 0.12, vol * 0.6, 'square', 0.3);
}

function playSaleStandart(ctx: AudioContext, vol: number) {
  playTone(ctx, 523, 0.1, vol * 0.5, 'sine', 0);
  playTone(ctx, 659, 0.1, vol * 0.5, 'sine', 0.08);
  playTone(ctx, 784, 0.1, vol * 0.5, 'sine', 0.16);
  playTone(ctx, 1047, 0.25, vol * 0.6, 'sine', 0.24);
}

function playSaleMinimal(ctx: AudioContext, vol: number) {
  playTone(ctx, 660, 0.1, vol * 0.5, 'sine', 0);
  playTone(ctx, 880, 0.15, vol * 0.5, 'sine', 0.08);
}

function playSaleYogun(ctx: AudioContext, vol: number) {
  [0, 0.06, 0.12, 0.18].forEach((t, i) => {
    playTone(ctx, 400 + i * 150, 0.08, vol * 0.6, 'square', t);
  });
  playTone(ctx, 1000, 0.25, vol * 0.5, 'sine', 0.3);
}

function playNotificationStandart(ctx: AudioContext, vol: number) {
  playTone(ctx, 700, 0.1, vol * 0.4, 'sine', 0);
  playTone(ctx, 900, 0.12, vol * 0.4, 'sine', 0.12);
}

function playNotificationMinimal(ctx: AudioContext, vol: number) {
  playTone(ctx, 800, 0.12, vol * 0.35, 'sine', 0);
}

function playNotificationYogun(ctx: AudioContext, vol: number) {
  playTone(ctx, 600, 0.08, vol * 0.5, 'triangle', 0);
  playTone(ctx, 800, 0.08, vol * 0.5, 'triangle', 0.1);
  playTone(ctx, 1000, 0.12, vol * 0.5, 'triangle', 0.2);
}

function speak(text: string, volume: number) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'tr-TR';
  utter.rate = 1.05;
  utter.pitch = 1.0;
  utter.volume = Math.min(1, volume * 1.5);
  const voices = window.speechSynthesis.getVoices();
  const trVoice = voices.find(v => v.lang.startsWith('tr'));
  if (trVoice) utter.voice = trVoice;
  window.speechSynthesis.speak(utter);
}

function loadSpeechEnabled(): boolean {
  try {
    const raw = localStorage.getItem('sobaYonetim');
    if (!raw) return true;
    const parsed = JSON.parse(raw);
    return parsed.soundSettings?.speechEnabled !== false;
  } catch { return true; }
}

// Android WebView'da AudioContext'i kullanıcı etkileşimiyle başlat
let _globalCtx: AudioContext | null = null;

function getOrCreateAudioContext(): AudioContext | null {
  try {
    if (!_globalCtx || _globalCtx.state === 'closed') {
      _globalCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return _globalCtx;
  } catch {
    return null;
  }
}

// İlk dokunuşta AudioContext'i unlock et (Android WebView için kritik)
if (typeof document !== 'undefined') {
  const unlock = () => {
    const ctx = getOrCreateAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    document.removeEventListener('touchstart', unlock, true);
    document.removeEventListener('touchend', unlock, true);
    document.removeEventListener('click', unlock, true);
  };
  document.addEventListener('touchstart', unlock, true);
  document.addEventListener('touchend', unlock, true);
  document.addEventListener('click', unlock, true);
}

export function useSoundFeedback() {
  const ctxRef = useRef<AudioContext | null>(null);

  const getCtx = useCallback((): AudioContext | null => {
    // Global context'i kullan (unlock edilmiş olabilir)
    if (_globalCtx && _globalCtx.state !== 'closed') {
      ctxRef.current = _globalCtx;
    } else if (!ctxRef.current || ctxRef.current.state === 'closed') {
      try {
        ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        _globalCtx = ctxRef.current;
      } catch {
        return null;
      }
    }
    if (ctxRef.current.state === 'suspended') {
      ctxRef.current.resume().catch(() => {});
    }
    return ctxRef.current;
  }, []);

  const playSound = useCallback((type: SoundType) => {
    const settings = loadSoundSettings();
    if (!settings.enabled) return;

    const ctx = getCtx();
    if (!ctx) return;

    const vol = Math.max(0.1, settings.volume); // minimum ses seviyesi garantisi
    const theme = settings.theme;

    const resume = () => {
      if (ctx.state === 'suspended') return ctx.resume();
      return Promise.resolve();
    };

    resume().then(() => {
      switch (type) {
        case 'success':
          if (theme === 'minimal') playSuccessMinimal(ctx, vol);
          else if (theme === 'yogun') playSuccessYogun(ctx, vol);
          else playSuccessStandart(ctx, vol);
          break;
        case 'error':
          if (theme === 'minimal') playErrorMinimal(ctx, vol);
          else if (theme === 'yogun') playErrorYogun(ctx, vol);
          else playErrorStandart(ctx, vol);
          break;
        case 'warning':
          if (theme === 'minimal') playWarningMinimal(ctx, vol);
          else if (theme === 'yogun') playWarningYogun(ctx, vol);
          else playWarningStandart(ctx, vol);
          break;
        case 'sale':
          if (theme === 'minimal') playSaleMinimal(ctx, vol);
          else if (theme === 'yogun') playSaleYogun(ctx, vol);
          else playSaleStandart(ctx, vol);
          break;
        case 'notification':
          if (theme === 'minimal') playNotificationMinimal(ctx, vol);
          else if (theme === 'yogun') playNotificationYogun(ctx, vol);
          else playNotificationStandart(ctx, vol);
          break;
      }
    }).catch(() => {});
  }, [getCtx]);

  const speakMessage = useCallback((message: string) => {
    const settings = loadSoundSettings();
    if (!settings.enabled) return;
    if (!loadSpeechEnabled()) return;
    speak(message, settings.volume);
  }, []);

  const playSoundWithSpeech = useCallback((type: SoundType, message?: string) => {
    playSound(type);
    if (message) {
      setTimeout(() => speakMessage(message), 300);
    }
  }, [playSound, speakMessage]);

  return { playSound, speakMessage, playSoundWithSpeech };
}
