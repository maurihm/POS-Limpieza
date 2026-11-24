import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Delete, Lock, Printer, RefreshCw, X } from 'lucide-react';
import type { PrintFeedbackState } from '../context/AppContext';

export const Modal: React.FC<{
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  maxWidth?: string;
  children: React.ReactNode;
}> = ({ open, title, subtitle, onClose, maxWidth = 'max-w-lg', children }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]">
      <div className={`w-full ${maxWidth} rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col max-h-[92vh]`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 bg-slate-50">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 min-h-[40px]"
          >
            <X className="h-4 w-4" /> Cerrar
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
};

export const PinModal: React.FC<{
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSubmitPin: (pin: string) => Promise<void>;
}> = ({ open, title, subtitle, onClose, onSubmitPin }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPin('');
      setError('');
      setBusy(false);
    }
  }, [open]);

  const submit = async (val: string) => {
    if (val.length !== 4 || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSubmitPin(val);
      setPin('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PIN incorrecto');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const pressDigit = (d: string) => {
    if (busy || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError('');
    if (next.length === 4) {
      void submit(next);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        pressDigit(e.key);
      } else if (e.key === 'Backspace') {
        setPin((p) => p.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Modal open={open} title={title} subtitle={subtitle} onClose={onClose} maxWidth="max-w-sm">
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <Lock className="h-6 w-6" />
        </div>

        <div className="flex gap-3">
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className={`flex h-12 w-12 items-center justify-center rounded-xl border-2 text-2xl font-bold transition ${
                pin.length > idx
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-slate-50 text-slate-300'
              }`}
            >
              {pin.length > idx ? '●' : ''}
            </div>
          ))}
        </div>

        {error && (
          <div className="w-full rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-center text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        <div className="grid w-full grid-cols-3 gap-2.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => pressDigit(d)}
              className="h-14 rounded-xl border border-slate-200 bg-white text-xl font-bold text-slate-800 hover:bg-slate-50 active:bg-slate-100"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPin('')}
            className="h-14 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            Limpiar
          </button>
          <button
            type="button"
            onClick={() => pressDigit('0')}
            className="h-14 rounded-xl border border-slate-200 bg-white text-xl font-bold text-slate-800 hover:bg-slate-50 active:bg-slate-100"
          >
            0
          </button>
          <button
            type="button"
            onClick={() => setPin((p) => p.slice(0, -1))}
            className="flex h-14 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            <Delete className="h-4 w-4" /> Borrar
          </button>
        </div>

        <p className="text-xs text-slate-400 text-center">
          PINs iniciales: Admin <strong>0000</strong> · Cajero Ana <strong>1234</strong>
        </p>
      </div>
    </Modal>
  );
};

export const TicketPreviewModal: React.FC<{
  feedback: PrintFeedbackState | null;
  onClose: () => void;
}> = ({ feedback, onClose }) => {
  const [retrying, setRetrying] = useState(false);

  if (!feedback) return null;
  const failed = !feedback.result.printed;

  const handleRetry = async () => {
    if (!feedback.onRetry) return;
    setRetrying(true);
    try {
      await feedback.onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Modal
      open={Boolean(feedback)}
      title={feedback.title}
      subtitle={`Modo: ${feedback.result.mode} · ${feedback.result.escpos_hex_length} bytes ESC/POS`}
      onClose={onClose}
      maxWidth="max-w-md"
    >
      <div className="space-y-4">
        {failed ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800 flex items-start gap-2.5">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
            <div>
              <p className="font-bold">Impresora sin respuesta (venta guardada)</p>
              <p className="mt-0.5 text-xs">{feedback.result.error}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
            <span>
              {feedback.result.mode === 'PREVIEW'
                ? 'Vista previa del ticket térmico 80 mm (CP850/ESC-POS generado).'
                : 'Ticket enviado correctamente a la impresora POS-80.'}
            </span>
          </div>
        )}

        <pre className="rounded-xl border border-slate-200 bg-slate-950 p-4 font-mono text-[11.5px] leading-relaxed text-emerald-100 overflow-x-auto whitespace-pre">
          {feedback.result.preview_text}
        </pre>

        <div className="flex flex-wrap justify-end gap-2">
          {feedback.onRetry && (
            <button
              type="button"
              disabled={retrying}
              onClick={handleRetry}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50 min-h-[44px]"
            >
              <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
              Reintentar impresión
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 min-h-[44px]"
          >
            <Printer className="h-4 w-4" />
            {failed ? 'Continuar sin imprimir' : 'Listo'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
