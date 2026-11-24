import React, { useMemo, useState } from 'react';
import {
  Edit3,
  ImagePlus,
  Layers,
  Package,
  Plus,
  Sparkles,
  Tag,
  Trash2,
} from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import type { Product, PromoScope, PromoType, Promotion, UnitType } from '../../types';
import { Modal } from '../../ui/Components';
import { centsToPesosInput, formatCents, pesosToCents } from '../../utils/money';

const WEEKDAYS = [
  { id: 1, label: 'Lun' },
  { id: 2, label: 'Mar' },
  { id: 3, label: 'Mié' },
  { id: 4, label: 'Jue' },
  { id: 5, label: 'Vie' },
  { id: 6, label: 'Sáb' },
  { id: 7, label: 'Dom' },
];

export const CatalogScreen: React.FC = () => {
  const {
    currentUser,
    categories,
    priceTiers,
    defaultTier,
    products,
    promotions,
    refreshAll,
    notify,
  } = useApp();

  const [tab, setTab] = useState<'products' | 'combos' | 'promos'>('products');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<number | 'ALL'>('ALL');

  // Product / Combo Modal state
  const [prodModalOpen, setProdModalOpen] = useState(false);
  const [editingProdId, setEditingProdId] = useState<number | undefined>(undefined);
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [unitType, setUnitType] = useState<UnitType>('PIECE');
  const [costPesos, setCostPesos] = useState('0.00');
  const [stockQty, setStockQty] = useState('0');
  const [minStock, setMinStock] = useState('5');
  const [isBundle, setIsBundle] = useState(false);
  const [trackInventory, setTrackInventory] = useState(true);
  const [showInPos, setShowInPos] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [tierPrices, setTierPrices] = useState<Record<number, string>>({});
  const [bundleItems, setBundleItems] = useState<Array<{ component_product_id: number; quantity: number }>>([]);
  const [uploadingImg, setUploadingImg] = useState(false);

  // Category quick modal
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('#0EA5E9');

  // Promo Modal state
  const [promoModalOpen, setPromoModalOpen] = useState(false);
  const [editingPromoId, setEditingPromoId] = useState<number | undefined>(undefined);
  const [promoName, setPromoName] = useState('');
  const [promoType, setPromoType] = useState<PromoType>('BUY_X_PAY_Y');
  const [promoScope, setPromoScope] = useState<PromoScope>('PRODUCT');
  const [promoTargetId, setPromoTargetId] = useState<number | ''>('');
  const [ruleBuy, setRuleBuy] = useState('2');
  const [rulePay, setRulePay] = useState('1');
  const [rulePercent, setRulePercent] = useState('10');
  const [ruleFixedPesos, setRuleFixedPesos] = useState('5.00');
  const [ruleMinQty, setRuleMinQty] = useState('5');
  const [ruleBulkPricePesos, setRuleBulkPricePesos] = useState('14.00');
  const [promoFrom, setPromoFrom] = useState('');
  const [promoUntil, setPromoUntil] = useState('');
  const [promoDays, setPromoDays] = useState<number[]>([]);
  const [promoActive, setPromoActive] = useState(true);

  const canViewCosts = Boolean(currentUser?.permissions.can_view_costs);
  const canEdit = Boolean(currentUser?.permissions.can_edit_catalog);

  const tiendaTier = defaultTier || priceTiers[0];
  const resellerTier = priceTiers.find((t) => t.id !== tiendaTier?.id);

  const nonBundleProducts = useMemo(
    () => products.filter((p) => !p.is_bundle && p.is_active),
    [products]
  );

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (tab === 'combos' && !p.is_bundle) return false;
      if (tab === 'products' && p.is_bundle) return false;
      if (catFilter !== 'ALL' && p.category_id !== catFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
      );
    });
  }, [products, tab, catFilter, search]);

  const openProductModal = (prod?: Product, forceBundle = false) => {
    setEditingProdId(prod?.id);
    setSku(prod?.sku || `${forceBundle ? 'CMB' : 'PRD'}-${String(products.length + 1).padStart(3, '0')}`);
    setBarcode(prod?.barcode || '');
    setName(prod?.name || '');
    const combosCat = categories.find((c) => c.name.toLowerCase().includes('combo'));
    setCategoryId(prod?.category_id ?? (forceBundle && combosCat ? combosCat.id : categories[0]?.id || ''));
    setUnitType(prod?.unit_type || 'PIECE');
    setCostPesos(centsToPesosInput(prod?.cost_cents ?? 0));
    setStockQty(String(prod?.stock_quantity ?? 0));
    setMinStock(String(prod?.min_stock_alert ?? 5));
    setIsBundle(prod ? prod.is_bundle : forceBundle);
    setTrackInventory(prod ? prod.track_inventory : !forceBundle);
    setShowInPos(prod ? prod.show_in_pos : true);
    setIsActive(prod ? prod.is_active : true);
    setImagePath(prod?.image_path || null);
    const tp: Record<number, string> = {};
    for (const t of priceTiers) {
      tp[t.id] = prod && prod.prices[t.id] !== undefined ? centsToPesosInput(prod.prices[t.id]) : '';
    }
    setTierPrices(tp);
    setBundleItems(
      prod?.bundle_items?.map((b) => ({
        component_product_id: b.component_product_id,
        quantity: b.quantity,
      })) || []
    );
    setProdModalOpen(true);
  };

  const bundleComputedCostCents = useMemo(() => {
    return bundleItems.reduce((sum, bi) => {
      const comp = products.find((p) => p.id === bi.component_product_id);
      return sum + (comp ? Math.round(comp.cost_cents * bi.quantity) : 0);
    }, 0);
  }, [bundleItems, products]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImg(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await api.uploadProductImage(dataUrl, sku || 'prod');
      setImagePath(res.image_path);
      notify('success', `Imagen optimizada a 256×256 .webp (${(res.size_bytes / 1024).toFixed(1)} KB).`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error subiendo imagen');
    } finally {
      setUploadingImg(false);
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sku.trim() || !name.trim()) {
      notify('warning', 'SKU y Nombre son obligatorios.');
      return;
    }
    if (isBundle && bundleItems.length === 0) {
      notify('warning', 'Un combo debe tener al menos un producto componente.');
      return;
    }
    const pricesPayload: Record<number, number | null> = {};
    for (const t of priceTiers) {
      const raw = tierPrices[t.id];
      pricesPayload[t.id] = raw && raw.trim() !== '' ? pesosToCents(raw) : null;
    }
    if (tiendaTier && (pricesPayload[tiendaTier.id] === null || pricesPayload[tiendaTier.id] === undefined)) {
      notify('warning', `Debes asignar el precio ${tiendaTier.name}.`);
      return;
    }

    try {
      await api.saveProduct(
        {
          id: editingProdId,
          sku: sku.trim(),
          barcode: barcode.trim() || null,
          name: name.trim(),
          category_id: categoryId === '' ? null : Number(categoryId),
          unit_type: isBundle ? 'PIECE' : unitType,
          cost_cents: isBundle ? bundleComputedCostCents : pesosToCents(costPesos),
          stock_quantity: Number(stockQty) || 0,
          min_stock_alert: Number(minStock) || 0,
          is_bundle: isBundle,
          track_inventory: isBundle ? false : trackInventory,
          image_path: imagePath,
          show_in_pos: showInPos,
          is_active: isActive,
          prices: pricesPayload,
          bundle_items: isBundle ? bundleItems : [],
        },
        currentUser?.id || 1
      );
      setProdModalOpen(false);
      await refreshAll();
      notify('success', isBundle ? 'Combo guardado correctamente.' : 'Producto guardado correctamente.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error guardando producto');
    }
  };

  const openPromoModal = (promo?: Promotion) => {
    setEditingPromoId(promo?.id);
    setPromoName(promo?.name || '');
    setPromoType(promo?.type || 'BUY_X_PAY_Y');
    setPromoScope(promo?.target_scope || 'PRODUCT');
    setPromoTargetId(promo?.target_id ?? '');
    setRuleBuy(String(promo?.rule.buy ?? 2));
    setRulePay(String(promo?.rule.pay ?? 1));
    setRulePercent(String(promo?.rule.percent ?? 10));
    setRuleFixedPesos(centsToPesosInput(promo?.rule.amount_cents ?? 500));
    setRuleMinQty(String(promo?.rule.min_qty ?? 5));
    setRuleBulkPricePesos(centsToPesosInput(promo?.rule.unit_price_cents ?? 1400));
    setPromoFrom(promo?.valid_from || '');
    setPromoUntil(promo?.valid_until || '');
    setPromoDays(promo?.days_of_week || []);
    setPromoActive(promo ? promo.is_active : true);
    setPromoModalOpen(true);
  };

  const handleSavePromo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoName.trim()) {
      notify('warning', 'Asigna un nombre a la promoción.');
      return;
    }
    const rule =
      promoType === 'BUY_X_PAY_Y'
        ? { buy: Number(ruleBuy) || 2, pay: Number(rulePay) || 1 }
        : promoType === 'PERCENT_DISCOUNT'
        ? { percent: Number(rulePercent) || 10 }
        : promoType === 'FIXED_AMOUNT_DISCOUNT'
        ? { amount_cents: pesosToCents(ruleFixedPesos) }
        : { min_qty: Number(ruleMinQty) || 5, unit_price_cents: pesosToCents(ruleBulkPricePesos) };

    try {
      await api.savePromotion({
        id: editingPromoId,
        name: promoName.trim(),
        type: promoType,
        target_scope: promoScope,
        target_id: promoScope === 'ALL' ? null : Number(promoTargetId) || null,
        rule,
        valid_from: promoFrom || null,
        valid_until: promoUntil || null,
        days_of_week: promoDays,
        is_active: promoActive,
      });
      setPromoModalOpen(false);
      await refreshAll();
      notify('success', 'Promoción guardada correctamente.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error guardando promoción');
    }
  };

  const togglePromoActive = async (promo: Promotion) => {
    await api.savePromotion({ ...promo, is_active: !promo.is_active });
    await refreshAll();
    notify('info', `Promoción "${promo.name}" ${!promo.is_active ? 'activada' : 'pausada'}.`);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden p-5 gap-4">
      {/* Header + Subtabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Catálogo, Combos y Promociones</h1>
          <p className="text-xs text-slate-500">
            Un solo inventario por artículo con tarifas Tienda y Revendedor, paquetes visuales y promociones sin código
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canEdit && (
            <>
              <button
                type="button"
                onClick={() => setCatModalOpen(true)}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                <Tag className="h-4 w-4" /> Nueva Categoría
              </button>
              {tab === 'promos' ? (
                <button
                  type="button"
                  onClick={() => openPromoModal()}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" /> Nueva Promoción
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => openProductModal(undefined, tab === 'combos')}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" /> {tab === 'combos' ? 'Nuevo Combo' : 'Nuevo Producto'}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setTab('products')}
          className={`inline-flex min-h-[42px] items-center gap-2 rounded-xl px-4 text-sm font-bold ${
            tab === 'products' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700'
          }`}
        >
          <Package className="h-4 w-4" /> Productos ({products.filter((p) => !p.is_bundle).length})
        </button>
        <button
          type="button"
          onClick={() => setTab('combos')}
          className={`inline-flex min-h-[42px] items-center gap-2 rounded-xl px-4 text-sm font-bold ${
            tab === 'combos' ? 'bg-amber-600 text-white' : 'bg-white border border-slate-200 text-slate-700'
          }`}
        >
          <Layers className="h-4 w-4" /> Combos / Paquetes ({products.filter((p) => p.is_bundle).length})
        </button>
        <button
          type="button"
          onClick={() => setTab('promos')}
          className={`inline-flex min-h-[42px] items-center gap-2 rounded-xl px-4 text-sm font-bold ${
            tab === 'promos' ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-700'
          }`}
        >
          <Sparkles className="h-4 w-4" /> Promociones ({promotions.length})
        </button>
      </div>

      {/* Products & Combos View */}
      {tab !== 'promos' ? (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <input
              type="text"
              placeholder="Buscar por nombre, SKU o código de barras..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-72 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm"
            />
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium"
            >
              <option value="ALL">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3">SKU / Código</th>
                  <th className="px-4 py-3">Categoría</th>
                  {canViewCosts && <th className="px-4 py-3 text-right">Costo</th>}
                  <th className="px-4 py-3 text-right text-blue-700">Precio Tienda</th>
                  <th className="px-4 py-3 text-right text-amber-700">Precio Revendedor</th>
                  <th className="px-4 py-3 text-right">{tab === 'combos' ? 'Componentes' : 'Stock'}</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProducts.map((p) => {
                  const pTienda = tiendaTier ? p.prices[tiendaTier.id] : undefined;
                  const pRev = resellerTier ? p.prices[resellerTier.id] : undefined;
                  return (
                    <tr key={p.id} className={!p.is_active ? 'opacity-50 bg-slate-50' : 'hover:bg-slate-50'}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 shrink-0 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center">
                            {p.image_path ? (
                              <img src={p.image_path} alt={p.name} className="h-full w-full object-cover" />
                            ) : p.is_bundle ? (
                              <Layers className="h-5 w-5 text-amber-500" />
                            ) : (
                              <Package className="h-5 w-5 text-slate-400" />
                            )}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900">{p.name}</p>
                            {!p.is_active && (
                              <span className="text-[10px] font-bold text-red-600 uppercase">Inactivo</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <div className="font-mono font-bold text-slate-800">{p.sku}</div>
                        <div>{p.barcode || '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold text-slate-600">
                        {p.category_name || 'Sin categoría'}
                      </td>
                      {canViewCosts && (
                        <td className="px-4 py-3 text-right text-slate-600">{formatCents(p.cost_cents)}</td>
                      )}
                      <td className="px-4 py-3 text-right font-extrabold text-blue-700">
                        {pTienda !== undefined ? formatCents(pTienda) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-extrabold text-amber-700">
                        {pRev !== undefined ? formatCents(pRev) : <span className="text-xs text-slate-400 font-normal">Usa Tienda</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-xs">
                        {p.is_bundle ? (
                          <div className="text-slate-600">
                            {p.bundle_items?.map((b) => `${b.quantity}× ${b.component_name}`).join(', ')}
                          </div>
                        ) : (
                          <span className="font-bold text-slate-800">
                            {p.stock_quantity} {p.unit_type === 'LITER' ? 'L' : p.unit_type === 'WEIGHT' ? 'kg' : 'pz'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => openProductModal(p, p.is_bundle)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                          >
                            <Edit3 className="h-3.5 w-3.5" /> Editar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        /* Promotions View (RF-03.3) */
        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 content-start">
          {promotions.map((promo) => {
            const targetLabel =
              promo.target_scope === 'ALL'
                ? 'Todo el catálogo'
                : promo.target_scope === 'CATEGORY'
                ? `Categoría: ${categories.find((c) => c.id === promo.target_id)?.name || '#' + promo.target_id}`
                : `Producto: ${products.find((p) => p.id === promo.target_id)?.name || '#' + promo.target_id}`;

            const ruleText =
              promo.type === 'BUY_X_PAY_Y'
                ? `Lleva ${promo.rule.buy}, paga ${promo.rule.pay}`
                : promo.type === 'PERCENT_DISCOUNT'
                ? `${promo.rule.percent}% de descuento`
                : promo.type === 'FIXED_AMOUNT_DISCOUNT'
                ? `-${formatCents(promo.rule.amount_cents || 0)} por unidad`
                : `Desde ${promo.rule.min_qty} unid. a ${formatCents(promo.rule.unit_price_cents || 0)} c/u`;

            return (
              <div
                key={promo.id}
                className={`rounded-2xl border p-4 bg-white flex flex-col justify-between gap-3 ${
                  promo.is_active ? 'border-emerald-200' : 'border-slate-200 opacity-65'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-extrabold text-slate-900">{promo.name}</h3>
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => void togglePromoActive(promo)}
                      className={`rounded-full px-3 py-1 text-xs font-extrabold transition ${
                        promo.is_active
                          ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                          : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                      }`}
                    >
                      {promo.is_active ? 'Activa' : 'Pausada'}
                    </button>
                  </div>
                  <p className="text-sm font-bold text-emerald-700">{ruleText}</p>
                  <p className="text-xs text-slate-600">{targetLabel}</p>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {promo.days_of_week.length === 0 ? (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        Todos los días
                      </span>
                    ) : (
                      promo.days_of_week.map((d) => (
                        <span key={d} className="rounded bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                          {WEEKDAYS.find((w) => w.id === d)?.label}
                        </span>
                      ))
                    )}
                    {(promo.valid_from || promo.valid_until) && (
                      <span className="rounded bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        {promo.valid_from || '∞'} → {promo.valid_until || '∞'}
                      </span>
                    )}
                  </div>
                </div>

                {canEdit && (
                  <div className="flex justify-end gap-2 border-t border-slate-100 pt-2.5">
                    <button
                      type="button"
                      onClick={() => openPromoModal(promo)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <Edit3 className="h-3.5 w-3.5" /> Editar
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.deletePromotion(promo.id);
                        await refreshAll();
                        notify('info', 'Promoción eliminada.');
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Eliminar
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Product / Combo Editor Modal */}
      <Modal
        open={prodModalOpen}
        title={editingProdId ? (isBundle ? 'Editar Combo' : 'Editar Producto') : isBundle ? 'Crear Nuevo Combo' : 'Crear Nuevo Producto'}
        subtitle="Asigna precios Tienda y Revendedor simultáneamente sobre un único registro"
        onClose={() => setProdModalOpen(false)}
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSaveProduct} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">SKU único *</label>
              <input
                type="text"
                required
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Código de Barras / QR</label>
              <input
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Categoría</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                <option value="">Sin categoría</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-600 mb-1">Nombre del producto *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"
              />
            </div>
            {!isBundle && (
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Tipo de unidad</label>
                <select
                  value={unitType}
                  onChange={(e) => setUnitType(e.target.value as UnitType)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white"
                >
                  <option value="PIECE">Pieza (enteros)</option>
                  <option value="LITER">Litro (fraccionable)</option>
                  <option value="WEIGHT">Peso / Kg (fraccionable)</option>
                </select>
              </div>
            )}
          </div>

          {/* Prices & Cost */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">
                Costo ($) {isBundle && '(auto-calculado)'}
              </label>
              <input
                type="number"
                step="0.01"
                disabled={isBundle}
                value={isBundle ? (bundleComputedCostCents / 100).toFixed(2) : costPesos}
                onChange={(e) => setCostPesos(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold disabled:bg-slate-100"
              />
            </div>
            {priceTiers.map((t) => (
              <div key={t.id}>
                <label className="block text-xs font-bold mb-1" style={{ color: t.badge_color }}>
                  Precio {t.name} ($) {t.is_default ? '*' : '(opcional)'}
                </label>
                <input
                  type="number"
                  step="0.01"
                  required={t.is_default}
                  value={tierPrices[t.id] ?? ''}
                  onChange={(e) => setTierPrices((prev) => ({ ...prev, [t.id]: e.target.value }))}
                  placeholder={t.is_default ? '0.00' : 'Vacío = usa Tienda'}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-extrabold"
                />
              </div>
            ))}
          </div>

          {/* Stock fields OR Combo Component Builder */}
          {!isBundle ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {!editingProdId && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Stock inicial</label>
                  <input
                    type="number"
                    step="0.5"
                    value={stockQty}
                    onChange={(e) => setStockQty(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Alerta stock mínimo</label>
                <input
                  type="number"
                  step="0.5"
                  value={minStock}
                  onChange={(e) => setMinStock(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"
                />
              </div>
              <label className="flex items-center gap-2 pt-5 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={trackInventory}
                  onChange={(e) => setTrackInventory(e.target.checked)}
                  className="h-4 w-4 rounded"
                />
                Controlar stock
              </label>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-extrabold text-amber-900">Receta del Combo (Deducción automática)</p>
                  <p className="text-xs text-amber-700">
                    Costo sumado: <strong>{formatCents(bundleComputedCostCents)}</strong>
                    {tiendaTier && tierPrices[tiendaTier.id] && (
                      <>
                        {' '}· Margen Tienda:{' '}
                        <strong>
                          {formatCents(pesosToCents(tierPrices[tiendaTier.id]) - bundleComputedCostCents)}
                        </strong>
                      </>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const first = nonBundleProducts[0];
                    if (first) {
                      setBundleItems((prev) => [...prev, { component_product_id: first.id, quantity: 1 }]);
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700"
                >
                  <Plus className="h-3.5 w-3.5" /> Agregar insumo
                </button>
              </div>

              {bundleItems.map((bi, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    value={bi.component_product_id}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setBundleItems((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, component_product_id: val } : item))
                      );
                    }}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm"
                  >
                    {nonBundleProducts.map((np) => (
                      <option key={np.id} value={np.id}>
                        {np.name} (Costo: {formatCents(np.cost_cents)})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.25"
                    min="0.01"
                    value={bi.quantity}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 0;
                      setBundleItems((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, quantity: val } : item))
                      );
                    }}
                    className="w-24 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-bold text-right"
                  />
                  <button
                    type="button"
                    onClick={() => setBundleItems((prev) => prev.filter((_, i) => i !== idx))}
                    className="rounded-lg border border-red-200 bg-white p-2 text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Auto WebP Image Upload (RF-02.2) */}
          <div className="flex items-center gap-4 rounded-xl border border-slate-200 p-3">
            <div className="h-16 w-16 rounded-xl bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">
              {imagePath ? (
                <img src={imagePath} alt="Vista previa" className="h-full w-full object-cover" />
              ) : (
                <ImagePlus className="h-6 w-6 text-slate-400" />
              )}
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-slate-800">Foto del producto (Auto-compresión 256×256 .webp)</p>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                disabled={uploadingImg}
                className="mt-1 block text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-blue-700 hover:file:bg-blue-100"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
            <div className="flex items-center gap-4 text-sm">
              <label className="flex items-center gap-1.5 font-medium text-slate-700">
                <input type="checkbox" checked={showInPos} onChange={(e) => setShowInPos(e.target.checked)} className="h-4 w-4" />
                Mostrar en POS
              </label>
              <label className="flex items-center gap-1.5 font-medium text-slate-700">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4" />
                Activo
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setProdModalOpen(false)}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
              >
                Guardar
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* New Category Modal */}
      <Modal open={catModalOpen} title="Nueva Categoría" onClose={() => setCatModalOpen(false)} maxWidth="max-w-sm">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Nombre *</label>
            <input
              type="text"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="Ej. Aromatizantes"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Color identificador</label>
            <input
              type="color"
              value={newCatColor}
              onChange={(e) => setNewCatColor(e.target.value)}
              className="h-10 w-24 rounded-lg border border-slate-300"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCatModalOpen(false)}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!newCatName.trim()) return;
                await api.saveCategory({ name: newCatName.trim(), color_hex: newCatColor, sort_order: categories.length + 1 });
                setNewCatName('');
                setCatModalOpen(false);
                await refreshAll();
                notify('success', 'Categoría creada.');
              }}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white"
            >
              Crear Categoría
            </button>
          </div>
        </div>
      </Modal>

      {/* Guided Promotions Wizard Modal (RF-03.3) */}
      <Modal
        open={promoModalOpen}
        title={editingPromoId ? 'Editar Promoción' : 'Asistente de Nueva Promoción'}
        subtitle="Configura ofertas 2x1, descuentos o precio por volumen sin escribir código"
        onClose={() => setPromoModalOpen(false)}
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleSavePromo} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Nombre de la promoción *</label>
            <input
              type="text"
              required
              placeholder="Ej. 2x1 Suavizante Fin de Semana"
              value={promoName}
              onChange={(e) => setPromoName(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Tipo de oferta</label>
              <select
                value={promoType}
                onChange={(e) => setPromoType(e.target.value as PromoType)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white font-semibold"
              >
                <option value="BUY_X_PAY_Y">2x1 / 3x2 (Lleva X, Paga Y)</option>
                <option value="PERCENT_DISCOUNT">Descuento por porcentaje (%)</option>
                <option value="FIXED_AMOUNT_DISCOUNT">Descuento fijo por unidad ($)</option>
                <option value="BULK_QUANTITY_PRICE">Precio especial por volumen</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Aplica a</label>
              <select
                value={promoScope}
                onChange={(e) => {
                  setPromoScope(e.target.value as PromoScope);
                  setPromoTargetId('');
                }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white font-semibold"
              >
                <option value="PRODUCT">Un producto específico</option>
                <option value="CATEGORY">Toda una categoría</option>
                <option value="ALL">Todo el catálogo</option>
              </select>
            </div>
          </div>

          {promoScope !== 'ALL' && (
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">
                {promoScope === 'PRODUCT' ? 'Selecciona el producto' : 'Selecciona la categoría'}
              </label>
              <select
                required
                value={promoTargetId}
                onChange={(e) => setPromoTargetId(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                <option value="">— Elegir —</option>
                {promoScope === 'PRODUCT'
                  ? products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))
                  : categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
              </select>
            </div>
          )}

          {/* Dynamic Rule Inputs */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5">
            {promoType === 'BUY_X_PAY_Y' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-emerald-900 mb-1">Cliente lleva (X)</label>
                  <input type="number" min="2" value={ruleBuy} onChange={(e) => setRuleBuy(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-bold" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-emerald-900 mb-1">Cliente paga (Y)</label>
                  <input type="number" min="1" value={rulePay} onChange={(e) => setRulePay(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-bold" />
                </div>
              </div>
            )}
            {promoType === 'PERCENT_DISCOUNT' && (
              <div>
                <label className="block text-xs font-bold text-emerald-900 mb-1">Porcentaje de descuento (%)</label>
                <input type="number" min="1" max="100" value={rulePercent} onChange={(e) => setRulePercent(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-bold" />
              </div>
            )}
            {promoType === 'FIXED_AMOUNT_DISCOUNT' && (
              <div>
                <label className="block text-xs font-bold text-emerald-900 mb-1">Descuento por unidad ($)</label>
                <input type="number" step="0.50" value={ruleFixedPesos} onChange={(e) => setRuleFixedPesos(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-bold" />
              </div>
            )}
            {promoType === 'BULK_QUANTITY_PRICE' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-emerald-900 mb-1">A partir de (cantidad)</label>
                  <input type="number" min="2" step="0.5" value={ruleMinQty} onChange={(e) => setRuleMinQty(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-bold" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-emerald-900 mb-1">Nuevo precio unitario ($)</label>
                  <input type="number" step="0.50" value={ruleBulkPricePesos} onChange={(e) => setRuleBulkPricePesos(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-bold" />
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Vigente desde (opcional)</label>
              <input type="date" value={promoFrom} onChange={(e) => setPromoFrom(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Vigente hasta (opcional)</label>
              <input type="date" value={promoUntil} onChange={(e) => setPromoUntil(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">
              Días activos (deja vacío para todos los días)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((w) => {
                const selected = promoDays.includes(w.id);
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() =>
                      setPromoDays((prev) =>
                        prev.includes(w.id) ? prev.filter((x) => x !== w.id) : [...prev, w.id].sort()
                      )
                    }
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold border ${
                      selected
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    {w.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={promoActive} onChange={(e) => setPromoActive(e.target.checked)} className="h-4 w-4" />
              Promoción activa
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPromoModalOpen(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700"
              >
                Guardar Promoción
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
};
