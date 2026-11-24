let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (Ctor) audioCtx = new Ctor();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function tone(freq: number, durationMs: number, volume = 0.06, type: OscillatorType = 'sine'): void {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000);
  } catch {
    // ignore audio errors
  }
}

export function playAddSound(enabled: boolean): void {
  if (!enabled) return;
  tone(880, 55, 0.05, 'sine');
}

export function playSaleSuccessSound(enabled: boolean): void {
  if (!enabled) return;
  tone(660, 80, 0.06, 'sine');
  setTimeout(() => tone(990, 120, 0.06, 'sine'), 85);
}

export function playErrorSound(enabled: boolean): void {
  if (!enabled) return;
  tone(260, 160, 0.07, 'triangle');
}
