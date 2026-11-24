import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Clock,
  Droplets,
  Edit3,
  Layers,
  Minus,
  Package,
  Pause,
  Percent,
  Plus,
  Printer,
  RotateCcw,
  Scissors,
  Search,
  ShoppingCart,
  Tag,
  Trash2,
} from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import type { CartLine, HeldTicket, PaymentMethod, Product } from '../../types';
import { Modal, PinModal } from '../../ui/Components';
import { formatCents, formatQty, pesosToCents, roundHalfUpCents, unitShort } from '../../utils/money';
import { evaluateBestLinePromotionClient, resolveProductPriceClient } from '../../utils/promoEngine';
import { playAddSound, playErrorSound, playSaleSuccessSound } from '../../utils/sound';
import { PaymentModal } from './PaymentModal';

const AUTOSAVE_KEY = 'pos_limpieza_autosave_cart_v1';

interface AutosavedCart {
  price_tier_id: number;
  lines: Array<{
    product_id: number;
    quantity: number;
    unit_price_cents: number;
    price_overridden: boolean;
    manual_discount_cents: number;
  }>;
  ticket_discount_type: 'PERCENT' | 'FIXED';
  ticket_discount_value: number;
}

export const PosScreen: React.FC<{ onNavigate: (tab: string) => void }> = ({ onNavigate }) => {
  const {
    currentUser,
    settings,
    categories,
    priceTiers,
    defaultTier,
    products,
    promotions,
    activeSession,
    heldTickets,
    refreshAll,
    notify,
    setPrintFeedback,
  } = useApp();

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTierId, setSelectedTierId] = useState<number>(() => defaultTier?.id || 1);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ticketDiscountType, setTicketDiscountType] = useState<'PERCENT' | 'FIXED'>('FIXED');
  const [ticketDiscountValue, setTicketDiscountValue] = useState<number>(0);

  // Modals
  const [showPayModal, setShowPayModal] = useState(false);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [showHeldModal, setShowHeldModal] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitSelectedUids, setSplitSelectedUids] = useState<Record<string, boolean>>({});
  const [editingLine, setEditingLine] = useState<CartLine | null>(null);
  const [editQtyInput, setEditQtyInput] = useState('');
  const [editPriceInput, setEditPriceInput] = useState('');
  const [editLineDiscInput, setEditLineDiscInput] = useState('');
  const [pendingPriceOverride, setPendingPriceOverride] = useState<{
    uid: string;
    newPriceCents: number;
  } | null>(null);
  const [recoveryPrompt, setRecoveryPrompt] = useState<AutosavedCart | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sync default tier once loaded
  useEffect(() => {
    if (defaultTier && !priceTiers.some((t) => t.id === selectedTierId)) {
      setSelectedTierId(defaultTier.id);
    }
  }, [defaultTier, priceTiers, selectedTierId]);

  const currentTier = useMemo(
    () => priceTiers.find((t) => t.id === selectedTierId) || defaultTier,
    [priceTiers, selectedTierId, defaultTier]
  );
  const isResellerMode = Boolean(currentTier && defaultTier && currentTier.id !== defaultTier.id);

  // Recompute a single cart line using active tier & promos
  const computeLine = useCallback(
    (
      product: Product,
      quantity: number,
      tierId: number,
      options: {
        uid?: string;
        price_overridden?: boolean;
        override_price_cents?: number;
        manual_discount_cents?: number;
      } = {}
    ): CartLine => {
      const defId = defaultTier?.id || 1;
      const resolved = resolveProductPriceClient(product, tierId, defId);
      const unitPrice = options.price_overridden && options.override_price_cents !== undefined
        ? options.override_price_cents
        : resolved.price_cents;
      const gross = roundHalfUpCents(quantity * unitPrice);
      const promo = options.price_overridden
        ? { discount_cents: 0, promo_label: null }
        : evaluateBestLinePromotionClient(product, quantity, unitPrice, promotions);
      const manualDisc = Math.max(0, options.manual_discount_cents || 0);
      const totalDisc = Math.min(gross, promo.discount_cents + manualDisc);

      return {
        uid: options.uid || `${product.id}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        product,
        quantity: Number(quantity.toFixed(4)),
        unit_price_cents: unitPrice,
        using_fallback_tier_price: !options.price_overridden && resolved.using_fallback,
        price_overridden: Boolean(options.price_overridden),
        manual_discount_cents: manualDisc,
        promo_discount_cents: promo.discount_cents,
        promo_label: promo.promo_label,
        line_total_cents: gross - totalDisc,
      };
    },
    [defaultTier, promotions]
  );

  // Edge Case #3: Check crash-recovery cart once products are ready
  useEffect(() => {
    if (products.length === 0) return;
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AutosavedCart;
        if (parsed.lines && parsed.lines.length > 0) {
          setRecoveryPrompt(parsed);
        }
      }
    } catch {
      localStorage.removeItem(AUTOSAVE_KEY);
    }
  }, [products.length]);

  // Persist active cart automatically
  useEffect(() => {
    if (recoveryPrompt) return;
    if (lines.length === 0) {
      localStorage.removeItem(AUTOSAVE_KEY);
      return;
    }
    const payload: AutosavedCart = {
      price_tier_id: selectedTierId,
      lines: lines.map((l) => ({
        product_id: l.product.id,
        quantity: l.quantity,
        unit_price_cents: l.unit_price_cents,
        price_overridden: l.price_overridden,
        manual_discount_cents: l.manual_discount_cents,
      })),
      ticket_discount_type: ticketDiscountType,
      ticket_discount_value: ticketDiscountValue,
    };
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
  }, [lines, selectedTierId, ticketDiscountType, ticketDiscountValue, recoveryPrompt]);

  const restoreAutosavedCart = () => {
    if (!recoveryPrompt) return;
    const restored: CartLine[] = [];
    for (const item of recoveryPrompt.lines) {
      const prod = products.find((p) => p.id === item.product_id && p.is_active);
      if (!prod) continue;
      restored.push(
        computeLine(prod, item.quantity, recoveryPrompt.price_tier_id, {
          price_overridden: item.price_overridden,
          override_price_cents: item.unit_price_cents,
          manual_discount_cents: item.manual_discount_cents,
        })
      );
    }
    setSelectedTierId(recoveryPrompt.price_tier_id);
    setLines(restored);
    setTicketDiscountType(recoveryPrompt.ticket_discount_type);
    setTicketDiscountValue(recoveryPrompt.ticket_discount_value);
    setRecoveryPrompt(null);
    notify('info', 'Venta anterior recuperada correctamente.');
  };

  const discardAutosavedCart = () => {
    localStorage.removeItem(AUTOSAVE_KEY);
    setRecoveryPrompt(null);
  };

  // Add product to cart
  const addProductToCart = useCallback(
    (product: Product, qtyToAdd = 1) => {
      setLines((prev) => {
        const idx = prev.findIndex((l) => l.product.id === product.id && !l.price_overridden);
        if (idx >= 0) {
          const existing = prev[idx];
          const updated = computeLine(product, existing.quantity + qtyToAdd, selectedTierId, {
            uid: existing.uid,
            manual_discount_cents: existing.manual_discount_cents,
          });
          const copy = [...prev];
          copy[idx] = updated;
          return copy;
        }
        return [...prev, computeLine(product, qtyToAdd, selectedTierId)];
      });
      playAddSound(Boolean(settings?.sound_enabled));
    },
    [computeLine, selectedTierId, settings?.sound_enabled]
  );

  // Switch tier (Tienda <-> Revendedor) respecting Edge Case #4
  const switchTier = useCallback(
    (newTierId: number) => {
      if (!currentUser?.permissions.can_switch_tier) {
        notify('warning', 'Tu rol no tiene permiso para cambiar de tarifa.');
        return;
      }
      setSelectedTierId(newTierId);
      setLines((prev) =>
        prev.map((l) =>
          computeLine(l.product, l.quantity, newTierId, {
            uid: l.uid,
            // Edge Case #4: preserve manually overridden prices!
            price_overridden: l.price_overridden,
            override_price_cents: l.price_overridden ? l.unit_price_cents : undefined,
            manual_discount_cents: l.manual_discount_cents,
          })
        )
      );
    },
    [computeLine, currentUser, notify]
  );

  const toggleNextTier = useCallback(() => {
    if (priceTiers.length < 2) return;
    const idx = priceTiers.findIndex((t) => t.id === selectedTierId);
    const next = priceTiers[(idx + 1) % priceTiers.length];
    switchTier(next.id);
  }, [priceTiers, selectedTierId, switchTier]);

  // Global HID Barcode/QR Scanner Listener (<50ms burst ending with Enter) per §3.3
  useEffect(() => {
    let buffer = '';
    let lastKeyTime = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      // Handle global POS shortcuts first
      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (e.key === 'F4') {
        e.preventDefault();
        toggleNextTier();
        return;
      }
      if (e.key === 'F6') {
        e.preventDefault();
        if (lines.length > 0) setShowDiscountModal(true);
        return;
      }
      if (e.key === 'F8') {
        e.preventDefault();
        if (lines.length > 0) void handleHoldTicket();
        return;
      }
      if (e.key === 'F9') {
        e.preventDefault();
        void handleReprintLast();
        return;
      }
      if (e.key === 'F12' || (e.ctrlKey && e.key === 'Enter')) {
        e.preventDefault();
        if (lines.length > 0 && activeSession) setShowPayModal(true);
        return;
      }

      // Skip barcode capture when typing in a modal input
      const activeEl = document.activeElement;
      const isTextInput =
        activeEl &&
        (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');
      if (isTextInput && activeEl !== searchInputRef.current) return;

      const now = Date.now();
      if (e.key === 'Enter') {
        if (buffer.length >= 3 && now - lastKeyTime < 120) {
          e.preventDefault();
          const code = buffer.trim();
          const match = products.find(
            (p) =>
              p.is_active &&
              ((p.barcode && p.barcode.toLowerCase() === code.toLowerCase()) ||
                p.sku.toLowerCase() === code.toLowerCase())
          );
          if (match) {
            addProductToCart(match, 1);
            setSearchQuery('');
            notify('success', `Escaneado: ${match.name}`);
          } else {
            playErrorSound(Boolean(settings?.sound_enabled));
            notify('warning', `Código no encontrado: ${code}`);
          }
        }
        buffer = '';
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (now - lastKeyTime > 55) {
          buffer = e.key;
        } else {
          buffer += e.key;
        }
        lastKeyTime = now;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Filtered visual catalog
  const visibleProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (!p.is_active || !p.show_in_pos) return false;
      if (selectedCategoryId !== 'ALL' && p.category_id !== selectedCategoryId) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
      );
    });
  }, [products, selectedCategoryId, searchQuery]);

  // Cart totals
  const subtotalCents = useMemo(
    () => lines.reduce((sum, l) => sum + roundHalfUpCents(l.quantity * l.unit_price_cents), 0),
    [lines]
  );
  const lineDiscountsCents = useMemo(
    () => lines.reduce((sum, l) => sum + (roundHalfUpCents(l.quantity * l.unit_price_cents) - l.line_total_cents), 0),
    [lines]
  );
  const afterLineDiscounts = subtotalCents - lineDiscountsCents;
  const ticketDiscountCents = useMemo(() => {
    if (ticketDiscountValue <= 0) return 0;
    if (ticketDiscountType === 'PERCENT') {
      return Math.min(afterLineDiscounts, roundHalfUpCents((afterLineDiscounts * ticketDiscountValue) / 100));
    }
    return Math.min(afterLineDiscounts, Math.round(ticketDiscountValue));
  }, [afterLineDiscounts, ticketDiscountType, ticketDiscountValue]);

  const totalDiscountCents = lineDiscountsCents + ticketDiscountCents;
  const grandTotalCents = Math.max(0, subtotalCents - totalDiscountCents);

  const updateLineQuantity = (uid: string, nextQty: number) => {
    if (nextQty <= 0) {
      setLines((prev) => prev.filter((l) => l.uid !== uid));
      return;
    }
    setLines((prev) =>
      prev.map((l) =>
        l.uid === uid
          ? computeLine(l.product, nextQty, selectedTierId, {
              uid: l.uid,
              price_overridden: l.price_overridden,
              override_price_cents: l.price_overridden ? l.unit_price_cents : undefined,
              manual_discount_cents: l.manual_discount_cents,
            })
          : l
      )
    );
  };

  const openLineEditor = (line: CartLine) => {
    setEditingLine(line);
    setEditQtyInput(String(line.quantity));
    setEditPriceInput((line.unit_price_cents / 100).toFixed(2));
    setEditLineDiscInput((line.manual_discount_cents / 100).toFixed(2));
  };

  const applyLineEditor = () => {
    if (!editingLine) return;
    const qty = Number(editQtyInput);
    if (!Number.isFinite(qty) || qty <= 0) {
      notify('warning', 'La cantidad debe ser mayor a 0.');
      return;
    }
    const newPriceCents = pesosToCents(editPriceInput);
    const newDiscCents = pesosToCents(editLineDiscInput);
    const priceChanged = newPriceCents !== editingLine.unit_price_cents;

    if (priceChanged && !currentUser?.permissions.can_override_price) {
      // Request Admin PIN
      setPendingPriceOverride({ uid: editingLine.uid, newPriceCents });
      return;
    }

    setLines((prev) =>
      prev.map((l) =>
        l.uid === editingLine.uid
          ? computeLine(l.product, qty, selectedTierId, {
              uid: l.uid,
              price_overridden: l.price_overridden || priceChanged,
              override_price_cents: priceChanged ? newPriceCents : l.price_overridden ? l.unit_price_cents : undefined,
              manual_discount_cents: newDiscCents,
            })
          : l
      )
    );
    setEditingLine(null);
  };

  const handleHoldTicket = async () => {
    if (lines.length === 0) return;
    const ticket: HeldTicket = {
      id: `hold_${Date.now()}`,
      label: `Cuenta ${new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} (${lines.length} art.)`,
      price_tier_id: selectedTierId,
      lines,
      ticket_discount_type: ticketDiscountType,
      ticket_discount_value: ticketDiscountValue,
      created_at: new Date().toISOString(),
    };
    await api.saveHeldTicket(ticket);
    setLines([]);
    setTicketDiscountValue(0);
    if (defaultTier) setSelectedTierId(defaultTier.id);
    await refreshAll();
    notify('info', 'Ticket guardado en espera.');
  };

  const resumeHeldTicket = async (ticket: HeldTicket) => {
    if (lines.length > 0) {
      await handleHoldTicket();
    }
    const rebuilt = ticket.lines
      .map((l) => {
        const freshProd = products.find((p) => p.id === l.product.id) || l.product;
        return computeLine(freshProd, l.quantity, ticket.price_tier_id, {
          uid: l.uid,
          price_overridden: l.price_overridden,
          override_price_cents: l.unit_price_cents,
          manual_discount_cents: l.manual_discount_cents,
        });
      });
    setSelectedTierId(ticket.price_tier_id);
    setLines(rebuilt);
    setTicketDiscountType(ticket.ticket_discount_type);
    setTicketDiscountValue(ticket.ticket_discount_value);
    await api.deleteHeldTicket(ticket.id);
    await refreshAll();
    setShowHeldModal(false);
    notify('success', 'Ticket retomado.');
  };

  const handleSplitConfirm = async () => {
    const moving = lines.filter((l) => splitSelectedUids[l.uid]);
    const staying = lines.filter((l) => !splitSelectedUids[l.uid]);
    if (moving.length === 0 || staying.length === 0) {
      notify('warning', 'Selecciona al menos un producto para mover y deja al menos uno en el ticket actual.');
      return;
    }
    const splitTicket: HeldTicket = {
      id: `split_${Date.now()}`,
      label: `Dividida ${new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} (${moving.length} art.)`,
      price_tier_id: selectedTierId,
      lines: moving,
      ticket_discount_type: 'FIXED',
      ticket_discount_value: 0,
      created_at: new Date().toISOString(),
    };
    await api.saveHeldTicket(splitTicket);
    setLines(staying);
    setSplitSelectedUids({});
    setShowSplitModal(false);
    await refreshAll();
    notify('success', 'Cuenta dividida: los artículos seleccionados se guardaron en "En espera".');
  };

  const handleReprintLast = async () => {
    try {
      const { sale, print_result } = await api.reprintLastSale();
      setPrintFeedback({
        title: `Reimpresión Ticket #${sale.folio}`,
        result: print_result,
        onRetry: async () => {
          const retry = await api.reprintSale(sale.id);
          setPrintFeedback({ title: `Reimpresión Ticket #${sale.folio}`, result: retry.print_result });
        },
      });
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'No hay tickets para reimprimir.');
    }
  };

  const handleConfirmSale = async (
    payments: Array<{ method: PaymentMethod; amount_cents: number; tendered_cents: number }>,
    printTicket: boolean
  ) => {
    if (!currentUser) return;
    try {
      const res = await api.createSale({
        user_id: currentUser.id,
        price_tier_id: selectedTierId,
        items: lines.map((l) => ({
          product_id: l.product.id,
          quantity: l.quantity,
          unit_price_cents: l.unit_price_cents,
          price_overridden: l.price_overridden,
          manual_discount_cents: l.manual_discount_cents,
        })),
        ticket_discount_cents: ticketDiscountCents,
        payments,
        print_ticket: printTicket,
      });

      playSaleSuccessSound(Boolean(settings?.sound_enabled));
      setShowPayModal(false);
      setLines([]);
      setTicketDiscountValue(0);
      localStorage.removeItem(AUTOSAVE_KEY);

      // RF-01.2 & HU-01: Automatically reset to Tienda tier after a Revendedor sale!
      if (defaultTier && selectedTierId !== defaultTier.id) {
        setSelectedTierId(defaultTier.id);
        notify('info', 'Tarifa regresada automáticamente a TIENDA para el siguiente cliente.');
      }

      await refreshAll();

      if (!res.print_result.printed) {
        // Edge Case #1: Sale saved, show non-blocking retry modal
        setPrintFeedback({
          title: `Venta #${res.sale.folio} guardada — Error de impresora`,
          result: res.print_result,
          onRetry: async () => {
            const retry = await api.reprintSale(res.sale.id);
            setPrintFeedback({
              title: `Reimpresión Venta #${res.sale.folio}`,
              result: retry.print_result,
            });
          },
        });
      } else if (printTicket && res.print_result.mode === 'PREVIEW') {
        setPrintFeedback({
          title: `Ticket #${res.sale.folio} cobrado (${formatCents(res.sale.total_cents)})`,
          result: res.print_result,
        });
      } else {
        notify('success', `Venta #${res.sale.folio} cobrada por ${formatCents(res.sale.total_cents)}.`);
      }
    } catch (err) {
      playErrorSound(Boolean(settings?.sound_enabled));
      notify('error', err instanceof Error ? err.message : 'Error al cobrar la venta.');
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#F8FAFC]">
      {/* Crash Recovery Banner (Edge Case #3) */}
      {recoveryPrompt && (
        <div className="flex items-center justify-between gap-3 bg-amber-100 border-b border-amber-300 px-4 py-2.5 text-sm text-amber-950">
          <div className="flex items-center gap-2 font-medium">
            <RotateCcw className="h-4 w-4 text-amber-700" />
            <span>
              Se encontró una venta sin finalizar ({recoveryPrompt.lines.length} artículos). ¿Deseas recuperarla?
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={restoreAutosavedCart}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700"
            >
              Recuperar venta
            </button>
            <button
              type="button"
              onClick={discardAutosavedCart}
              className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-50"
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {/* Closed Cash Warning */}
      {!activeSession && (
        <div className="flex items-center justify-between bg-red-50 border-b border-red-200 px-4 py-2.5 text-sm text-red-800">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            La caja está cerrada. Abre un turno en "Caja y Reportes" para comenzar a cobrar.
          </div>
          <button
            type="button"
            onClick={() => onNavigate('cash')}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
          >
            Ir a Abrir Caja
          </button>
        </div>
      )}

      {/* Main 70/30 Split Area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* LEFT 70%: Search + Category Pills + Visual Product Grid */}
        <div className="flex w-[68%] xl:w-[70%] flex-col border-r border-slate-200 min-h-0">
          {/* Search Bar & Categories */}
          <div className="border-b border-slate-200 bg-white px-4 py-3 space-y-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchQuery.trim()) {
                    const exact = products.find(
                      (p) =>
                        p.is_active &&
                        ((p.barcode && p.barcode.toLowerCase() === searchQuery.trim().toLowerCase()) ||
                          p.sku.toLowerCase() === searchQuery.trim().toLowerCase())
                    );
                    if (exact) {
                      addProductToCart(exact, 1);
                      setSearchQuery('');
                    } else if (visibleProducts.length === 1) {
                      addProductToCart(visibleProducts[0], 1);
                      setSearchQuery('');
                    }
                  }
                }}
                placeholder="Buscar producto por nombre, SKU o escanear código de barras/QR... (F2)"
                className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-slate-50 pl-11 pr-4 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
              <button
                type="button"
                onClick={() => setSelectedCategoryId('ALL')}
                className={`shrink-0 min-h-[40px] rounded-xl px-4 text-sm font-bold transition ${
                  selectedCategoryId === 'ALL'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                Todos ({products.filter((p) => p.is_active && p.show_in_pos).length})
              </button>
              {categories
                .filter((c) => c.is_active)
                .map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategoryId(cat.id)}
                    className={`shrink-0 min-h-[40px] inline-flex items-center gap-2 rounded-xl px-4 text-sm font-bold transition ${
                      selectedCategoryId === cat.id
                        ? 'text-white shadow-sm'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                    style={
                      selectedCategoryId === cat.id
                        ? { backgroundColor: cat.color_hex }
                        : undefined
                    }
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{
                        backgroundColor:
                          selectedCategoryId === cat.id ? '#FFFFFF' : cat.color_hex,
                      }}
                    />
                    {cat.name}
                  </button>
                ))}
            </div>
          </div>

          {/* Product Grid */}
          <div className="flex-1 overflow-y-auto p-3.5">
            {visibleProducts.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-slate-400 gap-2">
                <Package className="h-12 w-12 opacity-40" />
                <p className="text-sm font-medium">No se encontraron productos con ese filtro.</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {visibleProducts.map((prod) => {
                  const defId = defaultTier?.id || 1;
                  const resolved = resolveProductPriceClient(prod, selectedTierId, defId);
                  const lowStock =
                    !prod.is_bundle && prod.track_inventory && prod.stock_quantity <= prod.min_stock_alert;
                  const negStock = !prod.is_bundle && prod.track_inventory && prod.stock_quantity <= 0;

                  return (
                    <button
                      key={prod.id}
                      type="button"
                      onClick={() => addProductToCart(prod, 1)}
                      className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-2.5 text-left shadow-xs transition hover:border-blue-400 hover:shadow-md active:scale-[0.98]"
                    >
                      {/* Thumbnail */}
                      <div className="relative mb-2 flex h-24 w-full items-center justify-center overflow-hidden rounded-xl bg-slate-100">
                        {prod.image_path ? (
                          <img
                            src={prod.image_path}
                            alt={prod.name}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : prod.is_bundle ? (
                          <Layers className="h-10 w-10 text-amber-500" />
                        ) : prod.unit_type === 'LITER' ? (
                          <Droplets className="h-10 w-10 text-sky-500" />
                        ) : (
                          <Package className="h-10 w-10 text-slate-400" />
                        )}

                        {prod.is_bundle && (
                          <span className="absolute left-1.5 top-1.5 rounded-md bg-amber-500 px-1.5 py-0.5 text-[10px] font-extrabold text-white shadow-xs">
                            COMBO
                          </span>
                        )}
                        {resolved.using_fallback && (
                          <span
                            title="Sin tarifa Revendedor asignada; usa precio Tienda"
                            className="absolute right-1.5 top-1.5 rounded-md bg-slate-800/80 px-1.5 py-0.5 text-[10px] font-bold text-white"
                          >
                            Base
                          </span>
                        )}
                      </div>

                      <p className="line-clamp-2 min-h-[2.4rem] text-[13px] font-bold leading-tight text-slate-900 group-hover:text-blue-700">
                        {prod.name}
                      </p>

                      <div className="mt-1.5 flex items-end justify-between gap-1">
                        <span
                          className={`text-base font-extrabold ${
                            isResellerMode ? 'text-amber-700' : 'text-slate-900'
                          }`}
                        >
                          {formatCents(resolved.price_cents)}
                        </span>
                        {!prod.is_bundle && prod.track_inventory && (
                          <span
                            className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                              negStock
                                ? 'bg-red-100 text-red-700'
                                : lowStock
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {formatQty(prod.stock_quantity, prod.unit_type)} {unitShort(prod.unit_type)}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT 30%: Active Cart, Price Tier Semaphore & Checkout */}
        <div className="flex w-[32%] xl:w-[30%] flex-col bg-white min-h-0">
          {/* Price Tier Switcher (Traffic-light UX per §8.1.3) */}
          <div
            className={`border-b px-3.5 py-3 transition-colors ${
              isResellerMode
                ? 'border-amber-300 bg-amber-100'
                : 'border-slate-200 bg-slate-50'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
                Tarifa Activa (F4)
              </span>
              {isResellerMode && (
                <span className="rounded-full bg-amber-600 px-2.5 py-0.5 text-[10px] font-extrabold uppercase text-white">
                  MODO REVENDEDOR ACTIVADO
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-white p-1 border border-slate-200">
              {priceTiers.map((tier) => {
                const active = tier.id === selectedTierId;
                return (
                  <button
                    key={tier.id}
                    type="button"
                    onClick={() => switchTier(tier.id)}
                    className={`min-h-[40px] rounded-lg px-2 text-sm font-extrabold transition ${
                      active ? 'text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                    style={active ? { backgroundColor: tier.badge_color } : undefined}
                  >
                    {tier.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Ticket Actions Header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-3.5 py-2 bg-white">
            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-800">
              <ShoppingCart className="h-4 w-4 text-slate-500" />
              Ticket ({lines.reduce((s, l) => s + l.quantity, 0).toFixed(lines.some((l) => !Number.isInteger(l.quantity)) ? 2 : 0)})
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={lines.length === 0}
                onClick={handleHoldTicket}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                title="Poner ticket en espera (F8)"
              >
                <Pause className="h-3.5 w-3.5" /> Espera
              </button>
              <button
                type="button"
                disabled={lines.length < 2}
                onClick={() => {
                  setSplitSelectedUids({});
                  setShowSplitModal(true);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                title="Dividir cuenta"
              >
                <Scissors className="h-3.5 w-3.5" /> Dividir
              </button>
              <button
                type="button"
                disabled={lines.length === 0}
                onClick={() => {
                  setLines([]);
                  setTicketDiscountValue(0);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
                title="Vaciar carrito"
              >
                <Trash2 className="h-3.5 w-3.5" /> Limpiar
              </button>
            </div>
          </div>

          {/* Cart Items List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 px-3">
            {lines.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center text-slate-400 px-4">
                <ShoppingCart className="h-10 w-10 mb-2 opacity-30" />
                <p className="text-sm font-semibold text-slate-500">Ticket vacío</p>
                <p className="text-xs mt-1">Toca un producto a la izquierda o escanea su código de barras.</p>
              </div>
            ) : (
              lines.map((line) => (
                <div key={line.uid} className="py-2.5 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-900 leading-snug truncate">
                        {line.product.name}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                        <span>{formatCents(line.unit_price_cents)} c/u</span>
                        {line.price_overridden && (
                          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-700">
                            Precio manual
                          </span>
                        )}
                        {line.using_fallback_tier_price && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                            Precio Tienda
                          </span>
                        )}
                        {line.promo_label && (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                            {line.promo_label} (-{formatCents(line.promo_discount_cents)})
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-sm font-extrabold text-slate-900 shrink-0">
                      {formatCents(line.line_total_cents)}
                    </p>
                  </div>

                  {/* Qty Controls + Edit */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          updateLineQuantity(
                            line.uid,
                            line.quantity - (line.product.unit_type === 'LITER' && line.quantity <= 1 ? 0.5 : 1)
                          )
                        }
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-200"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openLineEditor(line)}
                        className="min-w-[54px] h-8 rounded-lg border border-slate-200 bg-white px-2 text-center text-xs font-extrabold text-slate-900 hover:border-blue-400"
                      >
                        {formatQty(line.quantity, line.product.unit_type)} {unitShort(line.product.unit_type)}
                      </button>
                      <button
                        type="button"
                        onClick={() => updateLineQuantity(line.uid, line.quantity + 1)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-200"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => openLineEditor(line)}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50"
                    >
                      <Edit3 className="h-3.5 w-3.5" /> Editar
                    </button>
                  </div>

                  {/* Quick Fractional Liquid Pills (RF-01.3) */}
                  {line.product.unit_type === 'LITER' && (
                    <div className="flex items-center gap-1 pt-0.5">
                      {[0.5, 1, 4, 20].map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => updateLineQuantity(line.uid, q)}
                          className={`rounded-md px-2 py-0.5 text-[11px] font-bold border transition ${
                            Math.abs(line.quantity - q) < 0.001
                              ? 'border-sky-500 bg-sky-50 text-sky-700'
                              : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {q} L
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Totals & Primary Green COBRAR CTA */}
          <div className="border-t border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="font-semibold">{formatCents(subtotalCents)}</span>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <button
                  type="button"
                  disabled={lines.length === 0 || !currentUser?.permissions.can_apply_discount}
                  onClick={() => setShowDiscountModal(true)}
                  className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline disabled:opacity-40"
                >
                  <Percent className="h-3.5 w-3.5" /> Descuento (F6)
                </button>
                <span className={`font-semibold ${totalDiscountCents > 0 ? 'text-emerald-700' : ''}`}>
                  -{formatCents(totalDiscountCents)}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 text-lg font-extrabold text-slate-900">
                <span>TOTAL</span>
                <span>{formatCents(grandTotalCents)}</span>
              </div>
            </div>

            <button
              type="button"
              disabled={lines.length === 0 || !activeSession}
              onClick={() => setShowPayModal(true)}
              className="w-full min-h-[54px] rounded-2xl bg-[#16A34A] px-4 text-base font-extrabold text-white shadow-sm transition hover:bg-green-700 active:scale-[0.99] disabled:opacity-40"
            >
              COBRAR {formatCents(grandTotalCents)} (F12)
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Operational Bar matching Wireframe §8.3 */}
      <div className="flex items-center justify-between border-t border-slate-200 bg-white px-4 py-2 text-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReprintLast}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 font-bold text-slate-700 hover:bg-slate-100"
          >
            <Printer className="h-4 w-4 text-slate-600" />
            Reimprimir último (F9)
          </button>
          <button
            type="button"
            onClick={() => setShowHeldModal(true)}
            className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 font-bold ${
              heldTickets.length > 0
                ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Clock className="h-4 w-4" />
            En espera ({heldTickets.length})
          </button>
          <button
            type="button"
            onClick={() => onNavigate('history')}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 font-bold text-slate-700 hover:bg-slate-100"
          >
            <BarChart3 className="h-4 w-4 text-blue-600" />
            Ventas de hoy
          </button>
        </div>

        <div className="flex items-center gap-2 font-semibold text-slate-600">
          <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
          Impresora: {settings?.printer_name || 'POS-80'} ({settings?.printer_mode || 'PREVIEW'})
        </div>
      </div>

      {/* Payment Modal */}
      <PaymentModal
        open={showPayModal}
        totalCents={grandTotalCents}
        tierName={currentTier?.name || 'Tienda'}
        isReseller={isResellerMode}
        onClose={() => setShowPayModal(false)}
        onConfirm={handleConfirmSale}
      />

      {/* Ticket Discount Modal (F6) */}
      <Modal
        open={showDiscountModal}
        title="Descuento al Ticket (F6)"
        onClose={() => setShowDiscountModal(false)}
        maxWidth="max-w-sm"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setTicketDiscountType('FIXED')}
              className={`min-h-[44px] rounded-xl border-2 font-bold text-sm ${
                ticketDiscountType === 'FIXED'
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-600'
              }`}
            >
              Monto Fijo ($)
            </button>
            <button
              type="button"
              onClick={() => setTicketDiscountType('PERCENT')}
              className={`min-h-[44px] rounded-xl border-2 font-bold text-sm ${
                ticketDiscountType === 'PERCENT'
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-600'
              }`}
            >
              Porcentaje (%)
            </button>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              {ticketDiscountType === 'PERCENT' ? 'Porcentaje de descuento (0 - 100%)' : 'Monto a descontar ($)'}
            </label>
            <input
              type="number"
              min="0"
              step={ticketDiscountType === 'PERCENT' ? '1' : '0.50'}
              value={ticketDiscountType === 'PERCENT' ? ticketDiscountValue : ticketDiscountValue / 100}
              onChange={(e) => {
                const v = Number(e.target.value) || 0;
                setTicketDiscountValue(ticketDiscountType === 'PERCENT' ? Math.min(100, v) : Math.round(v * 100));
              }}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-lg font-bold"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setTicketDiscountValue(0);
                setShowDiscountModal(false);
              }}
              className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700"
            >
              Quitar descuento
            </button>
            <button
              type="button"
              onClick={() => setShowDiscountModal(false)}
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
            >
              Aplicar
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit Line Modal (Quantity / Fractional / Price Override / Line Discount) */}
      <Modal
        open={Boolean(editingLine)}
        title={editingLine?.product.name || 'Editar artículo'}
        onClose={() => setEditingLine(null)}
        maxWidth="max-w-md"
      >
        {editingLine && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Cantidad ({unitShort(editingLine.product.unit_type)})
              </label>
              <input
                type="number"
                step={editingLine.product.unit_type === 'PIECE' ? '1' : '0.05'}
                min="0.01"
                value={editQtyInput}
                onChange={(e) => setEditQtyInput(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-lg font-bold"
              />
              {editingLine.product.unit_type === 'LITER' && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[0.25, 0.5, 1, 2, 3.785, 4, 10, 20].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setEditQtyInput(String(v))}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-sky-50 hover:border-sky-300"
                    >
                      {v} L
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Precio unitario ($) {!currentUser?.permissions.can_override_price && '(requiere PIN Admin)'}
              </label>
              <input
                type="number"
                step="0.50"
                min="0"
                value={editPriceInput}
                onChange={(e) => setEditPriceInput(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-lg font-bold"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Descuento manual en esta línea ($)
              </label>
              <input
                type="number"
                step="0.50"
                min="0"
                value={editLineDiscInput}
                onChange={(e) => setEditLineDiscInput(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-lg font-bold"
              />
            </div>

            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  setLines((prev) => prev.filter((l) => l.uid !== editingLine.uid));
                  setEditingLine(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 hover:bg-red-100"
              >
                <Trash2 className="h-4 w-4" /> Eliminar línea
              </button>
              <button
                type="button"
                onClick={applyLineEditor}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
              >
                <Tag className="h-4 w-4" /> Guardar cambios
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Admin PIN for Price Override */}
      <PinModal
        open={Boolean(pendingPriceOverride)}
        title="Autorización de Administrador"
        subtitle="Ingresa PIN de Administrador para modificar el precio unitario."
        onClose={() => setPendingPriceOverride(null)}
        onSubmitPin={async (pin) => {
          await api.verifyAdminPin(pin);
          if (pendingPriceOverride && editingLine) {
            const qty = Number(editQtyInput) || editingLine.quantity;
            const newDiscCents = pesosToCents(editLineDiscInput);
            setLines((prev) =>
              prev.map((l) =>
                l.uid === pendingPriceOverride.uid
                  ? computeLine(l.product, qty, selectedTierId, {
                      uid: l.uid,
                      price_overridden: true,
                      override_price_cents: pendingPriceOverride.newPriceCents,
                      manual_discount_cents: newDiscCents,
                    })
                  : l
              )
            );
            setPendingPriceOverride(null);
            setEditingLine(null);
            notify('success', 'Precio modificado con autorización.');
          }
        }}
      />

      {/* Held Tickets Modal */}
      <Modal
        open={showHeldModal}
        title="Tickets en Espera"
        subtitle="Retoma una cuenta pausada en un clic"
        onClose={() => setShowHeldModal(false)}
        maxWidth="max-w-lg"
      >
        {heldTickets.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No hay tickets en espera actualmente.</p>
        ) : (
          <div className="space-y-2.5">
            {heldTickets.map((t) => {
              const total = t.lines.reduce((s, l) => s + l.line_total_cents, 0);
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3.5"
                >
                  <div>
                    <p className="font-bold text-slate-900">{t.label}</p>
                    <p className="text-xs text-slate-500">
                      Total estimado: <strong className="text-slate-800">{formatCents(total)}</strong> ·{' '}
                      {t.lines.map((l) => l.product.name).slice(0, 3).join(', ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => resumeHeldTicket(t)}
                      className="rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700"
                    >
                      Retomar
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.deleteHeldTicket(t.id);
                        await refreshAll();
                      }}
                      className="rounded-xl border border-red-200 bg-white px-2.5 py-2 text-xs font-bold text-red-600 hover:bg-red-50"
                    >
                      Borrar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      {/* Split Ticket Modal (RF-01.7) */}
      <Modal
        open={showSplitModal}
        title="Dividir Cuenta (Split)"
        subtitle="Marca los productos que pasarán a un segundo ticket en espera"
        onClose={() => setShowSplitModal(false)}
        maxWidth="max-w-md"
      >
        <div className="space-y-3">
          {lines.map((l) => (
            <label
              key={l.uid}
              className="flex items-center justify-between rounded-xl border border-slate-200 p-3 cursor-pointer hover:bg-slate-50"
            >
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={Boolean(splitSelectedUids[l.uid])}
                  onChange={(e) =>
                    setSplitSelectedUids((prev) => ({ ...prev, [l.uid]: e.target.checked }))
                  }
                  className="h-5 w-5 rounded border-slate-300 text-blue-600"
                />
                <div>
                  <p className="text-sm font-bold text-slate-900">{l.product.name}</p>
                  <p className="text-xs text-slate-500">
                    {formatQty(l.quantity, l.product.unit_type)} {unitShort(l.product.unit_type)}
                  </p>
                </div>
              </div>
              <span className="text-sm font-bold text-slate-800">{formatCents(l.line_total_cents)}</span>
            </label>
          ))}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowSplitModal(false)}
              className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSplitConfirm}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
            >
              <Scissors className="h-4 w-4" /> Separar en nuevo ticket
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
