import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Plus, Home, Receipt, CreditCard, LayoutGrid, ChevronLeft, ChevronRight,
  X, Search, Pencil, Trash2, Check, AlertTriangle, TrendingUp, Wallet,
  ArrowUpDown, PiggyBank, SlidersHorizontal, Lock, Unlock, CalendarCheck, Banknote
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, AreaChart, Area, CartesianGrid
} from "recharts";

/* ------------------------------------------------------------------ */
/* Persistencia                                                        */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "reservas-finanzas-v1";

/* Shim de persistencia: usa localStorage con la misma interfaz que window.storage. */
const storage = {
  async get(key) {
    const raw = localStorage.getItem(key);
    return raw !== null ? { key, value: raw } : null;
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value };
  },
};

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

const ICONS = ["🛒","🍔","🎬","👕","🚗","🏠","💊","📱","🎁","📦","💡","💧","🐾","💅","⚽","🥦","💰","✈️","📚","☕","🏦","🧴","🎓","🐶","📺","🧾","💳","🔑"];
const PALETTE = ["#7C9473", "#C97F86", "#CE9A45", "#6787A0", "#8B5D6B", "#B36A4E"];

const DEFAULT_SETTINGS = {
  warning: 70,
  alert: 90,
  closingDay: 31,        // 31 = último día del mes
  closingOverrides: {},  // { "2026-08": 27 } cierre distinto para un período puntual
  income: 0,             // sueldo base
  incomeHistory: {},     // { "2026-08": 1500000 } vigente desde ese período
};

/* <helpers> */
const pad = (n) => String(n).padStart(2, "0");
const uid = () => Math.random().toString(36).slice(2, 10);

const toLocalISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => toLocalISO(new Date());

const fmt = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n || 0);

const fmtShort = (n) => {
  const v = Math.round(n || 0);
  return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("es-AR");
};

const monthLabel = (key) => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const s = d.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const shiftPeriod = (period, delta) => {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

const dayLabel = (dateStr) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
};

const fmtDM = (d) => d.toLocaleDateString("es-AR", { day: "numeric", month: "short" }).replace(/\./g, "");

/* Un "período" es un ciclo de tarjeta. Se nombra por el mes en que cierra.
   closingDayFor(periodKey) devuelve el día de cierre de ese mes (31 = último día). */
const periodOfDate = (dateStr, closingDayFor) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  const thisKey = `${y}-${pad(m)}`;
  const lastDay = new Date(y, m, 0).getDate();
  const cd = Math.min(closingDayFor(thisKey), lastDay);
  if (d <= cd) return thisKey;
  const next = new Date(y, m, 1);
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}`;
};

const periodRange = (period, closingDayFor) => {
  const [y, m] = period.split("-").map(Number);
  const endDay = Math.min(closingDayFor(period), new Date(y, m, 0).getDate());
  const end = new Date(y, m - 1, endDay);
  const prevLast = new Date(y, m - 1, 0).getDate();
  const prevEndDay = Math.min(closingDayFor(shiftPeriod(period, -1)), prevLast);
  const start = new Date(y, m - 2, prevEndDay + 1);
  return { start, end };
};

/* Valor vigente en un período: el último cambio hecho en o antes de ese período. */
const effectiveAmount = (base, history, period) => {
  if (!history) return base || 0;
  const keys = Object.keys(history).filter((k) => k <= period).sort();
  if (keys.length === 0) return base || 0;
  return history[keys[keys.length - 1]];
};
/* </helpers> */

function statusOf(spent, budget, settings) {
  const pct = budget > 0 ? (spent / budget) * 100 : 0;
  if (pct >= 100) return { key: "excedido", label: "Excedido", color: "#B5453B" };
  if (pct >= settings.alert) return { key: "alerta", label: "Alerta", color: "#D9762F" };
  if (pct >= settings.warning) return { key: "advertencia", label: "Cerca del límite", color: "#C99A3E" };
  return { key: "normal", label: "En orden", color: "#6B8E63" };
}

/* ------------------------------------------------------------------ */
/* Datos iniciales y migración                                         */
/* ------------------------------------------------------------------ */

const defaultFixedItems = () => [
  { id: "fix-flow", name: "Flow", icon: "📺", amount: 110000, amountHistory: {}, target: "card", paid: {} },
  { id: "fix-servicios", name: "Servicios varios", icon: "🧾", amount: 30000, amountHistory: {}, target: "card", paid: {} },
  { id: "fix-resto", name: "Resto de tarjeta", icon: "💳", amount: 45000, amountHistory: {}, target: "card", paid: {} },
];

function seedData() {
  const daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return toLocalISO(d);
  };
  const categories = [
    { id: "cat-super", name: "Supermercado", icon: "🛒", color: PALETTE[0], budget: 350000, budgetHistory: {}, payWith: "card" },
    { id: "cat-salidas", name: "Salidas", icon: "🍿", color: PALETTE[1], budget: 100000, budgetHistory: {}, payWith: "card" },
    { id: "cat-transporte", name: "Transporte", icon: "🚗", color: PALETTE[2], budget: 70000, budgetHistory: {}, payWith: "card" },
    { id: "cat-ropa", name: "Ropa", icon: "👕", color: PALETTE[3], budget: 100000, budgetHistory: {}, payWith: "card" },
    { id: "cat-hogar", name: "Hogar", icon: "🏠", color: PALETTE[4], budget: 120000, budgetHistory: {}, payWith: "card" },
  ];
  const expenses = [
    { id: uid(), categoryId: "cat-super", amount: 80000, description: "Compra supermercado", date: daysAgo(6), card: "Principal", installments: 1 },
    { id: uid(), categoryId: "cat-salidas", amount: 25000, description: "Cena", date: daysAgo(4), card: "Principal", installments: 1 },
    { id: uid(), categoryId: "cat-transporte", amount: 15000, description: "Combustible", date: daysAgo(3), card: "Principal", installments: 1 },
    { id: uid(), categoryId: "cat-ropa", amount: 35000, description: "Campera", date: daysAgo(1), card: "Principal", installments: 1 },
    { id: uid(), categoryId: "cat-super", amount: 22000, description: "Verdulería", date: daysAgo(0), card: "Principal", installments: 1 },
  ];
  return { categories, expenses, fixedItems: defaultFixedItems(), settings: { ...DEFAULT_SETTINGS }, closings: {} };
}

/* Completa campos nuevos en datos guardados por versiones anteriores (no pierde nada). */
function normalizeData(parsed) {
  const base = seedData();
  const categories = Array.isArray(parsed.categories)
    ? parsed.categories.map((c) => ({ payWith: "card", budgetHistory: {}, ...c }))
    : base.categories;
  const expenses = Array.isArray(parsed.expenses) ? parsed.expenses : base.expenses;
  const fixedItems = Array.isArray(parsed.fixedItems)
    ? parsed.fixedItems.map((f) => ({ amountHistory: {}, paid: {}, target: "card", ...f }))
    : defaultFixedItems();
  const settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
  settings.closingOverrides = settings.closingOverrides || {};
  settings.incomeHistory = settings.incomeHistory || {};
  const closings = parsed.closings && typeof parsed.closings === "object" ? parsed.closings : {};
  return { categories, expenses, fixedItems, settings, closings };
}

/* ------------------------------------------------------------------ */
/* Estilos globales                                                    */
/* ------------------------------------------------------------------ */

function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

      .rf-root {
        --bg: #FBF5F1;
        --surface: #FFFFFF;
        --line: #EBE0D8;
        --text: #2B2230;
        --text-soft: #857A82;
        --accent: #8B5D6B;
        --accent-soft: #F3E6E9;
        --cream: #F6EFE8;
        font-family: 'Plus Jakarta Sans', sans-serif;
        color: var(--text);
        background: var(--bg);
        min-height: 100%;
        position: relative;
      }
      .rf-serif { font-family: 'Fraunces', serif; }

      .rf-scroll::-webkit-scrollbar { display: none; }
      .rf-scroll { -ms-overflow-style: none; scrollbar-width: none; }

      @keyframes rf-toast-in {
        from { opacity: 0; transform: translate(-50%, 12px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
      @keyframes rf-pop {
        0% { transform: scale(1); }
        40% { transform: scale(0.92); }
        100% { transform: scale(1); }
      }
      @keyframes rf-sheet-up {
        from { transform: translateY(100%); }
        to { transform: translateY(0); }
      }
      @keyframes rf-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes rf-check-pop {
        0% { transform: scale(0.4); opacity: 0; }
        60% { transform: scale(1.15); opacity: 1; }
        100% { transform: scale(1); opacity: 1; }
      }
      .rf-fade { animation: rf-fade-in 0.2s ease; }
      .rf-sheet { animation: rf-sheet-up 0.28s cubic-bezier(.32,.72,0,1); }
      .rf-toast { animation: rf-toast-in 0.25s ease; }
      .rf-check { animation: rf-check-pop 0.35s ease; }

      .rf-fab:active { animation: rf-pop 0.25s ease; }
      .rf-tap { transition: transform 0.12s ease, box-shadow 0.12s ease; }
      .rf-tap:active { transform: scale(0.97); }

      .rf-bar-fill { transition: width 0.5s cubic-bezier(.22,.9,.3,1); }
      .rf-nav-item { transition: color 0.15s ease; }

      input[type="date"]::-webkit-calendar-picker-indicator { opacity: 0.6; }
      input, select, textarea { font-family: inherit; }
      input:focus, select:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
      button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

      .rf-icon-btn { background: var(--cream); }
      .rf-icon-btn:hover { background: var(--accent-soft); }

      .rf-range { -webkit-appearance: none; height: 6px; border-radius: 999px; background: var(--line); }
      .rf-range::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: var(--accent); cursor: pointer; border: 3px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.25); }

      /* Layout responsive */
      .rf-sidebar { display: none; }
      .rf-content { padding-left: 0; }
      .rf-desktop-only { display: none; }
      .rf-mobile-only { }
      @media (min-width: 768px) {
        .rf-sidebar { display: flex; }
        .rf-content { padding-left: 220px; }
        .rf-desktop-only { display: block; }
        .rf-mobile-only { display: none !important; }
      }
    `}</style>
  );
}

const inputStyle = {
  width: "100%", padding: "11px 14px", borderRadius: 12,
  border: "1px solid var(--line)", background: "var(--cream)", fontSize: 14,
};

/* ------------------------------------------------------------------ */
/* Componentes pequeños                                                */
/* ------------------------------------------------------------------ */

function PeriodSwitcher({ period, onChange }) {
  return (
    <div className="flex items-center gap-1" style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <button
        aria-label="Mes anterior"
        onClick={() => onChange(shiftPeriod(period, -1))}
        className="rf-tap rf-icon-btn"
        style={{ width: 30, height: 30, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", border: "none" }}
      >
        <ChevronLeft size={16} />
      </button>
      <div className="rf-serif" style={{ fontSize: 14, fontWeight: 600, minWidth: 130, textAlign: "center" }}>
        {monthLabel(period)}
      </div>
      <button
        aria-label="Mes siguiente"
        onClick={() => onChange(shiftPeriod(period, 1))}
        className="rf-tap rf-icon-btn"
        style={{ width: 30, height: 30, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", border: "none" }}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

function StatCard({ label, value, sub, icon, tone }) {
  return (
    <div
      className="rf-tap"
      style={{
        background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 18,
        padding: "14px 16px", minWidth: 152, flex: "1 1 152px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-soft)", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
        <span style={{ opacity: 0.8 }}>{icon}</span>
        {label}
      </div>
      <div className="rf-serif" style={{ fontSize: 21, fontWeight: 600, color: tone || "var(--text)", lineHeight: 1.15 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-soft)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function ProgressBar({ percent, color }) {
  const p = Math.min(100, Math.max(0, percent));
  return (
    <div style={{ height: 7, borderRadius: 999, background: "var(--cream)", overflow: "hidden" }}>
      <div className="rf-bar-fill" style={{ width: `${p}%`, height: "100%", borderRadius: 999, background: color }} />
    </div>
  );
}

function Label({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-soft)", marginBottom: 6 }}>{children}</div>;
}

function SegmentedToggle({ value, options, onChange }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className="rf-tap"
          style={{
            flex: 1, padding: "10px 8px", borderRadius: 12, fontSize: 12.5, fontWeight: 700,
            border: value === o.key ? "1.5px solid var(--accent)" : "1px solid var(--line)",
            background: value === o.key ? "var(--accent-soft)" : "var(--cream)",
            color: "var(--text)",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ClosingDaySelect({ value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ...inputStyle, padding: "9px 12px", fontSize: 13 }}>
      {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
        <option key={n} value={n}>{n === 31 ? "Último día del mes" : `Día ${n}`}</option>
      ))}
    </select>
  );
}

function CategoryEnvelope({ reserve, settings, onClick }) {
  const { budget, spent } = reserve;
  const disponible = budget - spent;
  const percent = budget > 0 ? (spent / budget) * 100 : 0;
  const status = statusOf(spent, budget, settings);

  return (
    <button
      onClick={onClick}
      className="rf-tap"
      style={{
        textAlign: "left", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 20,
        overflow: "hidden", boxShadow: "0 1px 2px rgba(43,34,48,0.04)", cursor: "pointer",
        display: "flex", flexDirection: "column", padding: 0,
      }}
    >
      <div style={{ height: 46, background: reserve.color, clipPath: "polygon(0 0, 100% 0, 100% 55%, 50% 100%, 0 55%)" }} />
      <div style={{ padding: "0 14px 14px", marginTop: -20, position: "relative" }}>
        <div
          style={{
            width: 38, height: 38, borderRadius: "50%", background: "var(--surface)",
            border: "1px solid var(--line)", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 18, marginBottom: 8,
            boxShadow: "0 2px 4px rgba(43,34,48,0.08)",
          }}
        >
          {reserve.icon}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>
          {reserve.name}
          {reserve.payWith === "other" && <span style={{ fontSize: 10.5, color: "var(--text-soft)", fontWeight: 600 }}> · 💵</span>}
        </div>
        <div className="rf-serif" style={{ fontSize: 19, fontWeight: 600, color: disponible < 0 ? "#B5453B" : "var(--text)" }}>
          {fmtShort(disponible)}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-soft)", marginBottom: 8 }}>
          disponible de {fmtShort(budget)}
        </div>
        <ProgressBar percent={percent} color={status.color} />
        {status.key !== "normal" && (
          <div style={{ fontSize: 10.5, color: status.color, fontWeight: 700, marginTop: 6 }}>
            {status.key === "excedido" ? "⚠ Presupuesto excedido" : status.key === "alerta" ? "⚠ Cerca del límite" : "Atención al consumo"}
          </div>
        )}
      </div>
    </button>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div
      className="rf-toast"
      style={{
        position: "fixed", left: "50%", bottom: 96, transform: "translateX(-50%)",
        background: "var(--text)", color: "#fff", padding: "10px 18px", borderRadius: 999,
        fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 8,
        boxShadow: "0 8px 24px rgba(43,34,48,0.25)", zIndex: 120, maxWidth: "90vw",
      }}
    >
      <span className="rf-check" style={{ display: "inline-flex" }}><Check size={15} /></span>
      {toast}
    </div>
  );
}

function ConfirmDialog({ open, title, message, confirmLabel = "Eliminar", danger = true, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="rf-fade" style={{ position: "fixed", inset: 0, background: "rgba(43,34,48,0.35)", zIndex: 110, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", borderRadius: 20, padding: 22, maxWidth: 340, width: "100%", boxShadow: "0 20px 50px rgba(0,0,0,0.2)" }}>
        <div className="rf-serif" style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: "var(--text-soft)", marginBottom: 20, lineHeight: 1.5 }}>{message}</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} className="rf-tap" style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: "1px solid var(--line)", background: "transparent", fontWeight: 600, fontSize: 13.5 }}>Cancelar</button>
          <button onClick={onConfirm} className="rf-tap" style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: "none", background: danger ? "#B5453B" : "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 13.5 }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/* Contenedor genérico de "bottom sheet" para los formularios */
function Sheet({ title, onClose, children, maxWidth = 480 }) {
  return (
    <div className="rf-fade" style={{ position: "fixed", inset: 0, background: "rgba(43,34,48,0.4)", zIndex: 90, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="rf-sheet rf-scroll"
        style={{ background: "var(--surface)", width: "100%", maxWidth, borderRadius: "26px 26px 0 0", padding: "10px 22px 26px", maxHeight: "90vh", overflowY: "auto" }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 999, background: "var(--line)", margin: "6px auto 14px" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div className="rf-serif" style={{ fontSize: 20, fontWeight: 600 }}>{title}</div>
          <button onClick={onClose} className="rf-tap rf-icon-btn" style={{ width: 32, height: 32, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", border: "none" }}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PrimaryButton({ onClick, children }) {
  return (
    <button onClick={onClick} className="rf-tap" style={{ width: "100%", padding: "14px 0", borderRadius: 14, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 15 }}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Modal: agregar / editar gasto                                       */
/* ------------------------------------------------------------------ */

function ExpenseFormModal({ open, onClose, categories, initial, onSave }) {
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayISO());
  const [card, setCard] = useState("Principal");
  const [installments, setInstallments] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setAmount(initial ? String(initial.amount) : "");
      setCategoryId(initial ? initial.categoryId : (categories[0]?.id || ""));
      setDescription(initial ? initial.description : "");
      setDate(initial ? initial.date : todayISO());
      setCard(initial ? (initial.card || "Principal") : "Principal");
      setInstallments(initial ? initial.installments : 1);
      setError("");
    }
  }, [open, initial]);

  if (!open) return null;

  const selectedCat = categories.find((c) => c.id === categoryId);
  const isCard = !selectedCat || (selectedCat.payWith || "card") === "card";

  const submit = () => {
    const n = Number(amount);
    if (!amount || isNaN(n) || n <= 0) { setError("Ingresá un monto válido"); return; }
    if (!categoryId) { setError("Elegí una categoría"); return; }
    if (!date) { setError("Elegí una fecha"); return; }
    onSave({
      id: initial?.id || uid(),
      categoryId,
      amount: n,
      description: description.trim(),
      date,
      card: isCard ? (card.trim() || "Principal") : "",
      installments: isCard ? (Number(installments) || 1) : 1,
    }, !!initial);
  };

  return (
    <Sheet title={initial ? "Editar gasto" : "Nuevo gasto"} onClose={onClose}>
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: "var(--text-soft)", marginBottom: 4, fontWeight: 600 }}>Monto</div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4 }}>
          <span className="rf-serif" style={{ fontSize: 26, color: "var(--text-soft)" }}>$</span>
          <input
            autoFocus
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="0"
            className="rf-serif"
            style={{ fontSize: 40, fontWeight: 600, border: "none", background: "transparent", width: 220, textAlign: "center" }}
          />
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Label>Categoría</Label>
        {categories.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--text-soft)" }}>Primero creá una reserva en la pestaña Categorías.</div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryId(c.id)}
              className="rf-tap"
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 999,
                border: categoryId === c.id ? `1.5px solid ${c.color}` : "1px solid var(--line)",
                background: categoryId === c.id ? "var(--accent-soft)" : "var(--cream)",
                fontSize: 12.5, fontWeight: 600, color: "var(--text)",
              }}
            >
              <span>{c.icon}</span>{c.name}{(c.payWith || "card") === "other" && <span style={{ fontSize: 11 }}>💵</span>}
            </button>
          ))}
        </div>
        {!isCard && (
          <div style={{ fontSize: 11.5, color: "var(--text-soft)", marginTop: 8 }}>
            💵 Esta reserva se paga por otro medio: el gasto descuenta de la reserva pero no suma a la tarjeta.
          </div>
        )}
      </div>

      <div style={{ marginBottom: 14 }}>
        <Label>Descripción (opcional)</Label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej. Compra mensual" style={inputStyle} />
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <Label>Fecha</Label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, padding: "10px 12px", fontSize: 13.5 }} />
        </div>
        {isCard && (
          <div style={{ width: 90 }}>
            <Label>Cuotas</Label>
            <input type="number" min={1} value={installments} onChange={(e) => setInstallments(e.target.value)} style={{ ...inputStyle, padding: "10px 12px", fontSize: 13.5 }} />
          </div>
        )}
      </div>

      {isCard && (
        <div style={{ marginBottom: 18 }}>
          <Label>Tarjeta</Label>
          <input value={card} onChange={(e) => setCard(e.target.value)} placeholder="Principal" style={inputStyle} />
        </div>
      )}

      {error && <div style={{ color: "#B5453B", fontSize: 12.5, marginBottom: 12, fontWeight: 600 }}>{error}</div>}
      <PrimaryButton onClick={submit}>{initial ? "Guardar cambios" : "Registrar gasto"}</PrimaryButton>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Modal: reserva (categoría)                                          */
/* ------------------------------------------------------------------ */

function CategoryFormModal({ open, onClose, initial, periodLabel, onSave }) {
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [icon, setIcon] = useState(ICONS[0]);
  const [color, setColor] = useState(PALETTE[0]);
  const [payWith, setPayWith] = useState("card");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName(initial ? initial.name : "");
      setBudget(initial ? String(initial.budget) : "");
      setIcon(initial ? initial.icon : ICONS[0]);
      setColor(initial ? initial.color : PALETTE[0]);
      setPayWith(initial ? (initial.payWith || "card") : "card");
      setError("");
    }
  }, [open, initial]);

  if (!open) return null;

  const submit = () => {
    if (!name.trim()) { setError("Ingresá un nombre"); return; }
    const b = Number(budget);
    if (budget === "" || isNaN(b) || b < 0) { setError("Ingresá un presupuesto válido"); return; }
    onSave({ id: initial?.id || uid(), name: name.trim(), budget: b, icon, color, payWith });
  };

  return (
    <Sheet title={initial ? "Editar reserva" : "Nueva reserva"} onClose={onClose}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div style={{ width: 52, height: 52, borderRadius: 16, background: color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>{icon}</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la reserva" style={{ ...inputStyle, flex: 1, fontSize: 14.5, fontWeight: 600 }} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Label>¿Cómo se paga?</Label>
        <SegmentedToggle
          value={payWith}
          onChange={setPayWith}
          options={[{ key: "card", label: "💳 Con tarjeta" }, { key: "other", label: "💵 Otro medio" }]}
        />
        <div style={{ fontSize: 11.5, color: "var(--text-soft)", marginTop: 6 }}>
          {payWith === "card"
            ? "Los gastos de esta reserva suman al total a pagar de la tarjeta."
            : "Se paga a mano o por otro medio: descuenta de la reserva y cuenta en tu sueldo, pero no suma a la tarjeta."}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Label>Presupuesto del mes</Label>
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "10px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--cream)" }}>
          <span style={{ color: "var(--text-soft)" }}>$</span>
          <input inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" style={{ border: "none", background: "transparent", fontSize: 14.5, width: "100%" }} />
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-soft)", marginTop: 6 }}>
          Vale desde {periodLabel} en adelante. Los meses anteriores no se modifican.
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Label>Ícono</Label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {ICONS.map((ic) => (
            <button key={ic} onClick={() => setIcon(ic)} className="rf-tap" style={{ width: 38, height: 38, borderRadius: 10, fontSize: 18, border: icon === ic ? "1.5px solid var(--accent)" : "1px solid var(--line)", background: icon === ic ? "var(--accent-soft)" : "var(--cream)" }}>
              {ic}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <Label>Color</Label>
        <div style={{ display: "flex", gap: 10 }}>
          {PALETTE.map((c) => (
            <button key={c} onClick={() => setColor(c)} aria-label={`Color ${c}`} className="rf-tap" style={{ width: 32, height: 32, borderRadius: "50%", background: c, border: color === c ? "3px solid var(--text)" : "3px solid transparent", boxShadow: "0 0 0 1px var(--line)" }} />
          ))}
        </div>
      </div>

      {error && <div style={{ color: "#B5453B", fontSize: 12.5, marginBottom: 12, fontWeight: 600 }}>{error}</div>}
      <PrimaryButton onClick={submit}>{initial ? "Guardar cambios" : "Crear reserva"}</PrimaryButton>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Modal: pago fijo                                                    */
/* ------------------------------------------------------------------ */

function FixedFormModal({ open, onClose, initial, periodLabel, onSave }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [icon, setIcon] = useState("🧾");
  const [target, setTarget] = useState("card");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName(initial ? initial.name : "");
      setAmount(initial ? String(initial.amount) : "");
      setIcon(initial ? initial.icon : "🧾");
      setTarget(initial ? initial.target : "card");
      setError("");
    }
  }, [open, initial]);

  if (!open) return null;

  const submit = () => {
    if (!name.trim()) { setError("Ingresá un nombre"); return; }
    const a = Number(amount);
    if (amount === "" || isNaN(a) || a < 0) { setError("Ingresá un monto válido"); return; }
    onSave({ id: initial?.id || uid(), name: name.trim(), icon, amount: a, target });
  };

  return (
    <Sheet title={initial ? "Editar pago fijo" : "Nuevo pago fijo"} onClose={onClose}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div style={{ width: 52, height: 52, borderRadius: 16, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>{icon}</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Flow, Alquiler…" style={{ ...inputStyle, flex: 1, fontSize: 14.5, fontWeight: 600 }} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Label>¿Dónde se paga?</Label>
        <SegmentedToggle
          value={target}
          onChange={setTarget}
          options={[{ key: "card", label: "💳 Va a la tarjeta" }, { key: "manual", label: "💵 Pago manual" }]}
        />
        <div style={{ fontSize: 11.5, color: "var(--text-soft)", marginTop: 6 }}>
          {target === "card"
            ? "Suma directo al total a pagar de la tarjeta, sin pasar por ninguna reserva."
            : "No suma a la tarjeta. Lo pagás vos por otro medio; podés marcarlo como pagado y cuenta en tu sueldo."}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Label>Monto fijo</Label>
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "10px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--cream)" }}>
          <span style={{ color: "var(--text-soft)" }}>$</span>
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" style={{ border: "none", background: "transparent", fontSize: 14.5, width: "100%" }} />
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-soft)", marginTop: 6 }}>
          Vale desde {periodLabel} en adelante. Los meses anteriores no se modifican.
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <Label>Ícono</Label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {ICONS.map((ic) => (
            <button key={ic} onClick={() => setIcon(ic)} className="rf-tap" style={{ width: 38, height: 38, borderRadius: 10, fontSize: 18, border: icon === ic ? "1.5px solid var(--accent)" : "1px solid var(--line)", background: icon === ic ? "var(--accent-soft)" : "var(--cream)" }}>
              {ic}
            </button>
          ))}
        </div>
      </div>

      {error && <div style={{ color: "#B5453B", fontSize: 12.5, marginBottom: 12, fontWeight: 600 }}>{error}</div>}
      <PrimaryButton onClick={submit}>{initial ? "Guardar cambios" : "Crear pago fijo"}</PrimaryButton>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Modal: cierre de tarjeta                                            */
/* ------------------------------------------------------------------ */

function ClosingModal({ open, snapshot, readOnly, settings, nextLabel, onClose, onConfirm, onReopen }) {
  if (!open || !snapshot) return null;
  const s = snapshot;
  const sorted = [...s.reserves].sort((a, b) => b.left - a.left);

  return (
    <Sheet title={`Cierre · ${monthLabel(s.period)}`} onClose={onClose} maxWidth={520}>
      <div style={{ fontSize: 12, color: "var(--text-soft)", marginTop: -10, marginBottom: 14 }}>
        Ciclo del {s.rangeLabel}
      </div>

      <div style={{ background: "var(--accent-soft)", borderRadius: 18, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "var(--text-soft)", fontWeight: 700 }}>Total a pagar de la tarjeta</div>
        <div className="rf-serif" style={{ fontSize: 30, fontWeight: 700, margin: "2px 0 6px" }}>{fmt(s.cardTotal)}</div>
        <div style={{ fontSize: 12, color: "var(--text-soft)" }}>
          Gastos {fmtShort(s.variableCard)} + pagos fijos {fmtShort(s.fixedCard)}
        </div>
      </div>

      <div className="rf-serif" style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Lo que sobró de cada reserva</div>
      <div style={{ fontSize: 12, color: "var(--text-soft)", marginBottom: 10 }}>Ordenadas de mayor a menor sobrante.</div>

      {sorted.length === 0 && <div style={{ fontSize: 13, color: "var(--text-soft)", padding: "10px 0" }}>No hay reservas en este período.</div>}
      {sorted.map((r) => {
        const pct = r.budget > 0 ? (r.spent / r.budget) * 100 : 0;
        const st = statusOf(r.spent, r.budget, settings);
        const over = r.left < 0;
        return (
          <div key={r.id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: r.color + "26", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{r.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{r.name}{r.payWith === "other" && " 💵"}</div>
                <div style={{ fontSize: 11, color: "var(--text-soft)" }}>
                  Gastaste {fmtShort(r.spent)} de {fmtShort(r.budget)} ({pct.toFixed(0)}%)
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="rf-serif" style={{ fontSize: 15, fontWeight: 700, color: over ? "#B5453B" : "#5E8456" }}>
                  {over ? "-" : ""}{fmtShort(Math.abs(r.left))}
                </div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: over ? "#B5453B" : "var(--text-soft)" }}>{over ? "excedido" : "sobró"}</div>
              </div>
            </div>
            <ProgressBar percent={pct} color={st.color} />
          </div>
        );
      })}

      <div style={{ background: "var(--cream)", borderRadius: 16, padding: 14, margin: "14px 0 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
          <span style={{ color: "var(--text-soft)", fontWeight: 600 }}>Sobrante total</span>
          <span className="rf-serif" style={{ fontWeight: 700, color: "#5E8456" }}>{fmtShort(s.leftPositive)}</span>
        </div>
        {s.overspent > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
            <span style={{ color: "var(--text-soft)", fontWeight: 600 }}>Excedido</span>
            <span className="rf-serif" style={{ fontWeight: 700, color: "#B5453B" }}>-{fmtShort(s.overspent)}</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6, paddingTop: 6, borderTop: "1px solid var(--line)" }}>
          <span style={{ color: "var(--text-soft)", fontWeight: 600 }}>Neto</span>
          <span className="rf-serif" style={{ fontWeight: 700 }}>{fmtShort(s.totalLeft)}</span>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-soft)" }}>
          En reservas de tarjeta {fmtShort(s.leftCard)} · En otros medios {fmtShort(s.leftOther)}
        </div>
      </div>

      {s.fixed.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="rf-serif" style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Pagos fijos</div>
          {s.fixed.map((f) => (
            <div key={f.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "5px 0" }}>
              <span>{f.icon} {f.name} <span style={{ color: "var(--text-soft)" }}>· {f.target === "card" ? "💳 tarjeta" : f.paid ? "💵 pagado" : "💵 pendiente"}</span></span>
              <span style={{ fontWeight: 700 }}>{fmtShort(f.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {readOnly ? (
        <div>
          <div style={{ fontSize: 12, color: "var(--text-soft)", marginBottom: 12, textAlign: "center" }}>
            Cerrada el {s.closedAt ? new Date(s.closedAt).toLocaleDateString("es-AR") : "—"}
          </div>
          <button onClick={onReopen} className="rf-tap" style={{ width: "100%", padding: "13px 0", borderRadius: 14, border: "1px solid var(--line)", background: "transparent", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Unlock size={15} /> Reabrir período
          </button>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 11.5, color: "var(--text-soft)", marginBottom: 12, textAlign: "center" }}>
            Al confirmar se guarda una foto de este ciclo para compararlo después y pasás a {nextLabel}.
          </div>
          <PrimaryButton onClick={onConfirm}>Confirmar cierre</PrimaryButton>
        </div>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Fila de gasto                                                       */
/* ------------------------------------------------------------------ */

function ExpenseRow({ expense, category, onEdit, onDelete }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, marginBottom: 8 }}>
      <div style={{ width: 38, height: 38, borderRadius: 12, background: (category?.color || "#dddddd") + "26", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
        {category?.icon || "📦"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {expense.description || category?.name || "Gasto"}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-soft)" }}>
          {category?.name || "Sin categoría"} · {dayLabel(expense.date)}
          {expense.installments > 1 ? ` · ${expense.installments} cuotas` : ""}
          {category?.payWith === "other" ? " · 💵" : ""}
        </div>
      </div>
      <div className="rf-serif" style={{ fontSize: 15, fontWeight: 600, marginRight: 4, whiteSpace: "nowrap" }}>
        {fmtShort(expense.amount)}
      </div>
      <button onClick={() => onEdit(expense)} aria-label="Editar gasto" className="rf-tap rf-icon-btn" style={{ width: 30, height: 30, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "none" }}>
        <Pencil size={13} />
      </button>
      <button onClick={() => onDelete(expense)} aria-label="Eliminar gasto" className="rf-tap" style={{ width: 30, height: 30, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: "#F6E4E1", flexShrink: 0, border: "none" }}>
        <Trash2 size={13} color="#B5453B" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Plan del sueldo                                                     */
/* ------------------------------------------------------------------ */

function SalaryPlan({ summary, onGoSettings }) {
  const { income, budgetCard, budgetOther, fixedCard, fixedManual, fixedManualPaid, assigned, free } = summary;
  const segments = [
    { label: "Reservas con tarjeta", value: budgetCard, color: "#7C9473" },
    { label: "Reservas otro medio", value: budgetOther, color: "#6787A0" },
    { label: "Fijos en tarjeta", value: fixedCard, color: "#8B5D6B" },
    { label: "Pagos manuales fijos", value: fixedManual, color: "#CE9A45" },
  ];
  const denom = Math.max(income, assigned, 1);

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 20, padding: 18, marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div className="rf-serif" style={{ fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <Banknote size={16} /> Plan del sueldo
        </div>
        {income > 0 && <div style={{ fontSize: 12, color: "var(--text-soft)", fontWeight: 700 }}>Sueldo {fmtShort(income)}</div>}
      </div>

      {income <= 0 ? (
        <div>
          <div style={{ fontSize: 13, color: "var(--text-soft)", marginBottom: 10, lineHeight: 1.5 }}>
            Ya asignaste {fmtShort(assigned)} entre reservas y pagos fijos. Cargá tu sueldo para ver cuánto te queda libre.
          </div>
          <button onClick={onGoSettings} className="rf-tap" style={{ padding: "9px 16px", borderRadius: 999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 12.5, fontWeight: 700 }}>
            Cargar sueldo
          </button>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", background: "var(--cream)", marginBottom: 14 }}>
            {segments.map((s) => s.value > 0 && (
              <div key={s.label} className="rf-bar-fill" style={{ width: `${(s.value / denom) * 100}%`, background: s.color }} />
            ))}
          </div>
          {segments.map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12.5, padding: "4px 0" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-soft)", fontWeight: 600 }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.color }} /> {s.label}
              </span>
              <span style={{ fontWeight: 700 }}>{fmtShort(s.value)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{free >= 0 ? "Te queda libre" : "Te pasás por"}</span>
            <span className="rf-serif" style={{ fontSize: 20, fontWeight: 700, color: free >= 0 ? "#5E8456" : "#B5453B" }}>{fmtShort(Math.abs(free))}</span>
          </div>
          {fixedManual > 0 && (
            <div style={{ fontSize: 11.5, color: "var(--text-soft)", marginTop: 8 }}>
              Pagos manuales fijos: pagaste {fmtShort(fixedManualPaid)} de {fmtShort(fixedManual)}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vistas                                                              */
/* ------------------------------------------------------------------ */

function DashboardView({ summary, settings, percentUsed, allExpenses, categories, onCategoryClick, onSeeAll, onGoSettings, onEditExpense, onDeleteExpense }) {
  const alertCats = summary.reserves.filter((r) => r.budget > 0 && (r.spent / r.budget) * 100 >= settings.warning);
  const pieData = summary.reserves.map((r) => ({ name: r.name, value: r.spent, color: r.color })).filter((d) => d.value > 0);
  const recent = [...allExpenses].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);

  return (
    <div>
      <div className="rf-scroll" style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4, marginBottom: 18 }}>
        <StatCard icon={<Wallet size={13} />} label="Total en reservas" value={fmtShort(summary.totalBudget)} />
        <StatCard icon={<CreditCard size={13} />} label="Tarjeta a pagar" value={fmtShort(summary.cardTotal)} tone="var(--accent)" sub={`Gastos ${fmtShort(summary.variableCard)} + fijos ${fmtShort(summary.fixedCard)}`} />
        <StatCard icon={<PiggyBank size={13} />} label="Reservado p/ tarjeta" value={fmtShort(summary.cardTotal)} sub="Pendiente: $0" />
        <StatCard icon={<TrendingUp size={13} />} label="Presupuesto usado" value={`${percentUsed.toFixed(0)}%`} tone={percentUsed >= 90 ? "#B5453B" : percentUsed >= 70 ? "#C99A3E" : "var(--text)"} />
      </div>

      <SalaryPlan summary={summary} onGoSettings={onGoSettings} />

      {alertCats.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div className="rf-scroll" style={{ display: "flex", gap: 8, overflowX: "auto" }}>
            {alertCats.map((r) => {
              const st = statusOf(r.spent, r.budget, settings);
              return (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 999, background: st.color + "1A", color: st.color, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>
                  <AlertTriangle size={12} /> {r.name} · {((r.spent / r.budget) * 100).toFixed(0)}%
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div className="rf-serif" style={{ fontSize: 17, fontWeight: 600 }}>Tus reservas</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12, marginBottom: 22 }}>
        {summary.reserves.map((r) => (
          <CategoryEnvelope key={r.id} reserve={r} settings={settings} onClick={() => onCategoryClick(r.id)} />
        ))}
        {summary.reserves.length === 0 && (
          <div style={{ gridColumn: "1/-1", textAlign: "center", color: "var(--text-soft)", fontSize: 13, padding: "24px 0" }}>
            Todavía no creaste reservas. Andá a la sección Categorías para armarlas.
          </div>
        )}
      </div>

      {pieData.length > 0 && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 20, padding: "16px 8px", marginBottom: 22 }}>
          <div className="rf-serif" style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, paddingLeft: 12 }}>Distribución del mes</div>
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={3}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.color} stroke="none" />)}
                </Pie>
                <Tooltip formatter={(v) => fmt(v)} contentStyle={{ borderRadius: 10, border: "1px solid var(--line)", fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", justifyContent: "center", marginTop: 4 }}>
            {pieData.map((d) => (
              <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--text-soft)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: d.color }} /> {d.name}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div className="rf-serif" style={{ fontSize: 17, fontWeight: 600 }}>Últimos gastos</div>
        <button onClick={onSeeAll} style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Ver todos</button>
      </div>
      <div>
        {recent.length === 0 && <div style={{ color: "var(--text-soft)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>Todavía no registraste gastos.</div>}
        {recent.map((e) => (
          <ExpenseRow key={e.id} expense={e} category={categories.find((c) => c.id === e.categoryId)} onEdit={onEditExpense} onDelete={onDeleteExpense} />
        ))}
      </div>
    </div>
  );
}

function GastosView({ categories, allExpenses, period, periodOf, onEditExpense, onDeleteExpense, initialCategoryFilter }) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(initialCategoryFilter || "all");
  const [allPeriods, setAllPeriods] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    if (initialCategoryFilter) setCategoryFilter(initialCategoryFilter);
  }, [initialCategoryFilter]);

  const filtered = useMemo(() => {
    let list = allExpenses;
    if (!allPeriods && !search) list = list.filter((e) => periodOf(e.date) === period);
    if (categoryFilter !== "all") list = list.filter((e) => e.categoryId === categoryFilter);
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      list = list.filter((e) => (e.description || "").toLowerCase().includes(s) || (categories.find((c) => c.id === e.categoryId)?.name || "").toLowerCase().includes(s));
    }
    return [...list].sort((a, b) => (sortAsc ? (a.date > b.date ? 1 : -1) : (a.date < b.date ? 1 : -1)));
  }, [allExpenses, period, periodOf, categoryFilter, search, allPeriods, sortAsc, categories]);

  const total = filtered.reduce((s, e) => s + e.amount, 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "9px 12px" }}>
          <Search size={15} color="var(--text-soft)" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por descripción o categoría" style={{ border: "none", background: "transparent", fontSize: 13.5, flex: 1 }} />
        </div>
        <button onClick={() => setSortAsc((s) => !s)} aria-label="Cambiar orden" className="rf-tap rf-icon-btn" style={{ width: 38, height: 38, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "none" }}>
          <ArrowUpDown size={15} />
        </button>
      </div>

      <div className="rf-scroll" style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 6, paddingBottom: 2 }}>
        <button onClick={() => setCategoryFilter("all")} className="rf-tap" style={{ padding: "7px 13px", borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", color: "var(--text)", border: categoryFilter === "all" ? "1.5px solid var(--accent)" : "1px solid var(--line)", background: categoryFilter === "all" ? "var(--accent-soft)" : "var(--surface)" }}>
          Todas
        </button>
        {categories.map((c) => (
          <button key={c.id} onClick={() => setCategoryFilter(c.id)} className="rf-tap" style={{ padding: "7px 13px", borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", color: "var(--text)", border: categoryFilter === c.id ? `1.5px solid ${c.color}` : "1px solid var(--line)", background: categoryFilter === c.id ? "var(--accent-soft)" : "var(--surface)" }}>
            {c.icon} {c.name}
          </button>
        ))}
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--text-soft)", marginBottom: 14, cursor: "pointer" }}>
        <input type="checkbox" checked={allPeriods} onChange={(e) => setAllPeriods(e.target.checked)} />
        Ver todos los períodos (no solo {monthLabel(period)})
      </label>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: "var(--text-soft)", fontWeight: 600 }}>{filtered.length} gasto{filtered.length !== 1 ? "s" : ""}</div>
        <div className="rf-serif" style={{ fontSize: 15, fontWeight: 600 }}>{fmtShort(total)}</div>
      </div>

      {filtered.length === 0 && <div style={{ color: "var(--text-soft)", fontSize: 13, textAlign: "center", padding: "30px 0" }}>No hay gastos que coincidan con la búsqueda.</div>}
      {filtered.map((e) => (
        <ExpenseRow key={e.id} expense={e} category={categories.find((c) => c.id === e.categoryId)} onEdit={onEditExpense} onDelete={onDeleteExpense} />
      ))}
    </div>
  );
}

function TarjetaView({
  summary, categories, periodExpenses, period, rangeLabel, closingDay, hasClosingOverride,
  closing, closings, onChangeClosingDay, onResetClosingDay, onCloseCard, onViewClosing,
  onEditExpense, onDeleteExpense,
}) {
  const payMap = {};
  categories.forEach((c) => { payMap[c.id] = c.payWith || "card"; });
  const cardExpenses = periodExpenses.filter((e) => (payMap[e.categoryId] || "card") === "card");

  const barData = summary.reserves
    .filter((r) => r.payWith === "card" && r.spent > 0)
    .map((r) => ({ name: r.name, value: r.spent, color: r.color }));
  if (summary.fixedCard > 0) barData.push({ name: "Pagos fijos", value: summary.fixedCard, color: "#B9AEB4" });
  barData.sort((a, b) => b.value - a.value);

  const byDay = {};
  [...cardExpenses].sort((a, b) => (a.date > b.date ? 1 : -1)).forEach((e) => { byDay[e.date] = (byDay[e.date] || 0) + e.amount; });
  let acc = 0;
  const evolution = Object.keys(byDay).sort().map((d) => { acc += byDay[d]; return { day: dayLabel(d), total: acc }; });

  const recent = [...cardExpenses].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);
  const fixedCardItems = summary.fixed.filter((f) => f.target === "card");
  const closingList = Object.keys(closings).sort().reverse().map((k) => closings[k]);

  return (
    <div>
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 22, padding: 20, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-soft)", fontSize: 12.5, fontWeight: 700 }}>
            <CreditCard size={14} /> A pagar · {monthLabel(period)}
          </div>
          {closing && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, background: "#E3EDDF", color: "#4F7347", fontSize: 11, fontWeight: 700 }}>
              <Lock size={11} /> Cerrada
            </div>
          )}
        </div>
        <div className="rf-serif" style={{ fontSize: 34, fontWeight: 700, marginBottom: 4 }}>{fmt(summary.cardTotal)}</div>
        <div style={{ fontSize: 12, color: "var(--text-soft)", marginBottom: 14 }}>Ciclo del {rangeLabel}</div>
        <div style={{ display: "flex", gap: "12px 22px", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-soft)", fontWeight: 600 }}>Gastos con tarjeta</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{fmt(summary.variableCard)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-soft)", fontWeight: 600 }}>Pagos fijos</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{fmt(summary.fixedCard)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-soft)", fontWeight: 600 }}>Reservado para pagar</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{fmt(summary.cardTotal)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-soft)", fontWeight: 600 }}>Pendiente de reservar</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#6B8E63" }}>{fmt(0)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-soft)", fontWeight: 600 }}>Cantidad de gastos</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{cardExpenses.length}</div>
          </div>
        </div>
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 18, padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
          <CalendarCheck size={15} /> Cierre de este ciclo
        </div>
        <ClosingDaySelect value={closingDay} onChange={onChangeClosingDay} />
        <div style={{ fontSize: 11.5, color: "var(--text-soft)", margin: "8px 0 12px", lineHeight: 1.5 }}>
          Solo cambia el cierre de {monthLabel(period)}. Los gastos se reacomodan solos según la fecha.
          {hasClosingOverride && (
            <button onClick={onResetClosingDay} style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 700, fontSize: 11.5, cursor: "pointer", marginLeft: 6, padding: 0 }}>
              Volver al cierre habitual
            </button>
          )}
        </div>
        {closing ? (
          <button onClick={() => onViewClosing(period)} className="rf-tap" style={{ width: "100%", padding: "12px 0", borderRadius: 14, border: "1px solid var(--line)", background: "var(--cream)", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Lock size={15} /> Ver cierre y sobrantes
          </button>
        ) : (
          <button onClick={onCloseCard} className="rf-tap" style={{ width: "100%", padding: "12px 0", borderRadius: 14, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Lock size={15} /> Cerrar tarjeta
          </button>
        )}
      </div>

      {fixedCardItems.length > 0 && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 20, padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <div className="rf-serif" style={{ fontSize: 14.5, fontWeight: 600 }}>Pagos fijos en la tarjeta</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{fmtShort(summary.fixedCard)}</div>
          </div>
          {fixedCardItems.map((f) => (
            <div key={f.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0" }}>
              <span>{f.icon} {f.name}</span>
              <span style={{ fontWeight: 700 }}>{fmtShort(f.amountNow)}</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: "var(--text-soft)", marginTop: 8 }}>Se editan desde Categorías → Pagos fijos.</div>
        </div>
      )}

      {evolution.length > 1 && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 20, padding: "16px 10px", marginBottom: 16 }}>
          <div className="rf-serif" style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 8, paddingLeft: 8 }}>Evolución de gastos del ciclo</div>
          <div style={{ width: "100%", height: 150 }}>
            <ResponsiveContainer>
              <AreaChart data={evolution} margin={{ left: -18, right: 8 }}>
                <defs>
                  <linearGradient id="rfArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8B5D6B" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#8B5D6B" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#EBE0D8" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#857A82" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#857A82" }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => fmtShort(v)} />
                <Tooltip formatter={(v) => fmt(v)} contentStyle={{ borderRadius: 10, border: "1px solid var(--line)", fontSize: 12 }} />
                <Area type="monotone" dataKey="total" stroke="#8B5D6B" strokeWidth={2} fill="url(#rfArea)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {barData.length > 0 && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 20, padding: "16px 10px", marginBottom: 16 }}>
          <div className="rf-serif" style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 8, paddingLeft: 8 }}>De dónde sale el total</div>
          <div style={{ width: "100%", height: Math.max(120, barData.length * 40) }}>
            <ResponsiveContainer>
              <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 16 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11.5, fill: "#2B2230" }} axisLine={false} tickLine={false} width={92} />
                <Tooltip formatter={(v) => fmt(v)} contentStyle={{ borderRadius: 10, border: "1px solid var(--line)", fontSize: 12 }} />
                <Bar dataKey="value" radius={[0, 8, 8, 0]} barSize={16}>
                  {barData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="rf-serif" style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Últimos gastos con tarjeta</div>
      {recent.length === 0 && <div style={{ color: "var(--text-soft)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>Sin gastos en este ciclo.</div>}
      {recent.map((e) => (
        <ExpenseRow key={e.id} expense={e} category={categories.find((c) => c.id === e.categoryId)} onEdit={onEditExpense} onDelete={onDeleteExpense} />
      ))}

      {closingList.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div className="rf-serif" style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Cierres anteriores</div>
          {closingList.map((c) => (
            <button key={c.period} onClick={() => onViewClosing(c.period)} className="rf-tap" style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 14px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{monthLabel(c.period)}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-soft)" }}>A pagar {fmtShort(c.cardTotal)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="rf-serif" style={{ fontSize: 15, fontWeight: 700, color: "#5E8456" }}>{fmtShort(c.leftPositive)}</div>
                <div style={{ fontSize: 10.5, color: "var(--text-soft)", fontWeight: 700 }}>sobró</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoriasView({
  summary, settings, period, incomeNow, onAdd, onEdit, onDelete,
  onAddFixed, onEditFixed, onDeleteFixed, onTogglePaid,
  onSaveIncome, onChangeDefaultClosing, onSettingsChange,
}) {
  const [incomeInput, setIncomeInput] = useState(String(incomeNow || ""));

  useEffect(() => { setIncomeInput(incomeNow ? String(incomeNow) : ""); }, [incomeNow, period]);

  return (
    <div>
      {/* Reservas */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div className="rf-serif" style={{ fontSize: 18, fontWeight: 600 }}>Reservas</div>
          <div style={{ fontSize: 11.5, color: "var(--text-soft)" }}>Presupuesto de {monthLabel(period)}</div>
        </div>
        <button onClick={onAdd} className="rf-tap" style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 12.5, fontWeight: 700 }}>
          <Plus size={14} /> Nueva
        </button>
      </div>

      {summary.reserves.length === 0 && <div style={{ color: "var(--text-soft)", fontSize: 13, textAlign: "center", padding: "16px 0" }}>Todavía no hay reservas.</div>}
      {summary.reserves.map((r) => {
        const percent = r.budget > 0 ? (r.spent / r.budget) * 100 : 0;
        const status = statusOf(r.spent, r.budget, settings);
        return (
          <div key={r.id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 14, marginBottom: 10, display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 42, height: 42, borderRadius: 13, background: r.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{r.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2, gap: 8 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{r.name}</div>
                <div style={{ fontSize: 12, color: "var(--text-soft)", whiteSpace: "nowrap" }}>{fmtShort(r.spent)} / {fmtShort(r.budget)}</div>
              </div>
              <div style={{ fontSize: 10.5, color: "var(--text-soft)", fontWeight: 600, marginBottom: 5 }}>
                {r.payWith === "card" ? "💳 Con tarjeta" : "💵 Otro medio"}
              </div>
              <ProgressBar percent={percent} color={status.color} />
            </div>
            <button onClick={() => onEdit(r.id)} aria-label="Editar reserva" className="rf-tap rf-icon-btn" style={{ width: 32, height: 32, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "none" }}><Pencil size={13} /></button>
            <button onClick={() => onDelete(r.id)} aria-label="Eliminar reserva" className="rf-tap" style={{ width: 32, height: 32, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: "#F6E4E1", flexShrink: 0, border: "none" }}><Trash2 size={13} color="#B5453B" /></button>
          </div>
        );
      })}

      {/* Pagos fijos */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "26px 0 14px" }}>
        <div>
          <div className="rf-serif" style={{ fontSize: 18, fontWeight: 600 }}>Pagos fijos</div>
          <div style={{ fontSize: 11.5, color: "var(--text-soft)" }}>Montos que vos definís, sin reserva de por medio</div>
        </div>
        <button onClick={onAddFixed} className="rf-tap" style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 12.5, fontWeight: 700 }}>
          <Plus size={14} /> Nuevo
        </button>
      </div>

      {summary.fixed.length === 0 && <div style={{ color: "var(--text-soft)", fontSize: 13, textAlign: "center", padding: "16px 0" }}>Todavía no hay pagos fijos.</div>}
      {summary.fixed.map((f) => (
        <div key={f.id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 14, marginBottom: 10, display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 42, height: 42, borderRadius: 13, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{f.icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{f.name}</div>
              <div className="rf-serif" style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: "nowrap" }}>{fmtShort(f.amountNow)}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10.5, color: "var(--text-soft)", fontWeight: 600 }}>
                {f.target === "card" ? "💳 Va a la tarjeta" : "💵 Pago manual"}
              </span>
              {f.target === "manual" && (
                <button
                  onClick={() => onTogglePaid(f.id)}
                  className="rf-tap"
                  style={{
                    padding: "3px 10px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, border: "none",
                    background: f.paidNow ? "#E3EDDF" : "#F6EBD4", color: f.paidNow ? "#4F7347" : "#8A6A1F",
                  }}
                >
                  {f.paidNow ? "✓ Pagado" : "Pendiente"}
                </button>
              )}
            </div>
          </div>
          <button onClick={() => onEditFixed(f.id)} aria-label="Editar pago fijo" className="rf-tap rf-icon-btn" style={{ width: 32, height: 32, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "none" }}><Pencil size={13} /></button>
          <button onClick={() => onDeleteFixed(f.id)} aria-label="Eliminar pago fijo" className="rf-tap" style={{ width: 32, height: 32, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: "#F6E4E1", flexShrink: 0, border: "none" }}><Trash2 size={13} color="#B5453B" /></button>
        </div>
      ))}

      {/* Ajustes */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 18, padding: 18, marginTop: 26 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <SlidersHorizontal size={15} />
          <div className="rf-serif" style={{ fontSize: 15, fontWeight: 600 }}>Ajustes</div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <Label>Sueldo de {monthLabel(period)}</Label>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 4, padding: "9px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--cream)" }}>
              <span style={{ color: "var(--text-soft)" }}>$</span>
              <input inputMode="numeric" value={incomeInput} onChange={(e) => setIncomeInput(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" style={{ border: "none", background: "transparent", fontSize: 14, width: "100%" }} />
            </div>
            <button onClick={() => onSaveIncome(Number(incomeInput) || 0)} className="rf-tap" style={{ padding: "0 16px", borderRadius: 12, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 13 }}>Guardar</button>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-soft)", marginTop: 6 }}>Vale desde este mes en adelante. Se usa en el Plan del sueldo del inicio.</div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <Label>Cierre habitual de la tarjeta</Label>
          <ClosingDaySelect value={settings.closingDay} onChange={onChangeDefaultClosing} />
          <div style={{ fontSize: 11.5, color: "var(--text-soft)", marginTop: 6 }}>
            Si un mes cierra otro día, cambialo solo para ese mes desde la pestaña Tarjeta.
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-soft)", marginBottom: 6, fontWeight: 600 }}>
            <span>Advertencia</span><span>{settings.warning}%</span>
          </div>
          <input type="range" min={30} max={95} value={settings.warning} onChange={(e) => onSettingsChange({ ...settings, warning: Math.min(Number(e.target.value), settings.alert - 1) })} className="rf-range" style={{ width: "100%" }} />
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-soft)", marginBottom: 6, fontWeight: 600 }}>
            <span>Alerta</span><span>{settings.alert}%</span>
          </div>
          <input type="range" min={50} max={99} value={settings.alert} onChange={(e) => onSettingsChange({ ...settings, alert: Math.max(Number(e.target.value), settings.warning + 1) })} className="rf-range" style={{ width: "100%" }} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App principal                                                       */
/* ------------------------------------------------------------------ */

const NAV_ITEMS = [
  { key: "dashboard", label: "Inicio", icon: Home },
  { key: "gastos", label: "Gastos", icon: Receipt },
  { key: "tarjeta", label: "Tarjeta", icon: CreditCard },
  { key: "categorias", label: "Categorías", icon: LayoutGrid },
];

export default function App() {
  const [categories, setCategories] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [fixedItems, setFixedItems] = useState([]);
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const [closings, setClosings] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("dashboard");
  const [period, setPeriod] = useState(() => todayISO().slice(0, 7));

  const [showAddExpense, setShowAddExpense] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [showFixedModal, setShowFixedModal] = useState(false);
  const [editingFixed, setEditingFixed] = useState(null);
  const [closingModal, setClosingModal] = useState(null); // { snapshot, readOnly }

  const [confirmDelete, setConfirmDelete] = useState(null); // { type, item }
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const [categoryFilterOverride, setCategoryFilterOverride] = useState(null);

  const goToView = useCallback((key) => {
    setCategoryFilterOverride(null);
    setView(key);
  }, []);

  /* Cierre de tarjeta de un período (por defecto el habitual, o uno puntual) */
  const closingDayFor = useCallback(
    (p) => (settings.closingOverrides && settings.closingOverrides[p]) || settings.closingDay || 31,
    [settings.closingOverrides, settings.closingDay]
  );
  const periodOf = useCallback((dateStr) => periodOfDate(dateStr, closingDayFor), [closingDayFor]);

  /* Carga */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let data;
      try {
        const res = await storage.get(STORAGE_KEY);
        data = res && res.value ? normalizeData(JSON.parse(res.value)) : seedData();
      } catch (e) {
        data = seedData();
      }
      if (cancelled) return;
      setCategories(data.categories);
      setExpenses(data.expenses);
      setFixedItems(data.fixedItems);
      setSettings(data.settings);
      setClosings(data.closings);
      const cd = (p) => (data.settings.closingOverrides && data.settings.closingOverrides[p]) || data.settings.closingDay || 31;
      setPeriod(periodOfDate(todayISO(), cd));
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  /* Guardado */
  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        await storage.set(STORAGE_KEY, JSON.stringify({ categories, expenses, fixedItems, settings, closings }));
      } catch (e) {
        console.error("No se pudo guardar", e);
      }
    })();
  }, [categories, expenses, fixedItems, settings, closings, loaded]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const periodExpenses = useMemo(() => expenses.filter((e) => periodOf(e.date) === period), [expenses, period, periodOf]);

  /* Todos los números del período, calculados en un solo lugar */
  const summary = useMemo(() => {
    const payOf = (catId) => {
      const c = categories.find((x) => x.id === catId);
      return c ? (c.payWith || "card") : "card";
    };
    const sum = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);

    const spentBy = {};
    periodExpenses.forEach((e) => { spentBy[e.categoryId] = (spentBy[e.categoryId] || 0) + e.amount; });

    const reserves = categories.map((c) => {
      const budget = effectiveAmount(c.budget, c.budgetHistory, period);
      const spent = spentBy[c.id] || 0;
      return { id: c.id, name: c.name, icon: c.icon, color: c.color, payWith: c.payWith || "card", budget, spent, left: budget - spent };
    });

    const fixed = fixedItems.map((f) => ({
      ...f,
      amountNow: effectiveAmount(f.amount, f.amountHistory, period),
      paidNow: !!(f.paid && f.paid[period]),
    }));

    const variableCard = sum(periodExpenses.filter((e) => payOf(e.categoryId) === "card"), (e) => e.amount);
    const variableOther = sum(periodExpenses.filter((e) => payOf(e.categoryId) === "other"), (e) => e.amount);
    const fixedCard = sum(fixed.filter((f) => f.target === "card"), (f) => f.amountNow);
    const fixedManual = sum(fixed.filter((f) => f.target === "manual"), (f) => f.amountNow);
    const fixedManualPaid = sum(fixed.filter((f) => f.target === "manual" && f.paidNow), (f) => f.amountNow);
    const budgetCard = sum(reserves.filter((r) => r.payWith === "card"), (r) => r.budget);
    const budgetOther = sum(reserves.filter((r) => r.payWith === "other"), (r) => r.budget);
    const totalBudget = budgetCard + budgetOther;
    const income = effectiveAmount(settings.income || 0, settings.incomeHistory, period);
    const assigned = totalBudget + fixedCard + fixedManual;

    return {
      reserves, fixed, variableCard, variableOther, fixedCard, fixedManual, fixedManualPaid,
      budgetCard, budgetOther, totalBudget, totalSpent: variableCard + variableOther,
      cardTotal: variableCard + fixedCard, income, assigned, free: income - assigned,
    };
  }, [categories, fixedItems, periodExpenses, period, settings.income, settings.incomeHistory]);

  const percentUsed = summary.totalBudget > 0 ? (summary.totalSpent / summary.totalBudget) * 100 : 0;

  const rangeLabel = useMemo(() => {
    const { start, end } = periodRange(period, closingDayFor);
    return `${fmtDM(start)} al ${fmtDM(end)}`;
  }, [period, closingDayFor]);

  const closing = closings[period];

  /* ------------------------- Gastos ------------------------- */

  const saveExpense = (data, isEdit) => {
    if (isEdit) {
      setExpenses((prev) => prev.map((e) => (e.id === data.id ? data : e)));
      showToast("Gasto actualizado");
    } else {
      setExpenses((prev) => [...prev, data]);
      showToast("Gasto registrado ✨");
    }
    setPeriod(periodOf(data.date));
    setShowAddExpense(false);
    setEditingExpense(null);
  };

  const deleteExpense = (expense) => {
    setExpenses((prev) => prev.filter((e) => e.id !== expense.id));
    showToast("Gasto eliminado");
    setConfirmDelete(null);
  };

  const openEditExpense = (e) => { setEditingExpense(e); setShowAddExpense(true); };
  const askDeleteExpense = (e) => setConfirmDelete({ type: "expense", item: e });

  /* ------------------------- Reservas ------------------------- */

  const openEditCategory = (id) => {
    const c = categories.find((x) => x.id === id);
    if (!c) return;
    setEditingCategory({ ...c, budget: effectiveAmount(c.budget, c.budgetHistory, period) });
    setShowCategoryModal(true);
  };

  const saveCategory = (data) => {
    const isNew = !categories.some((c) => c.id === data.id);
    setCategories((prev) => {
      const existing = prev.find((c) => c.id === data.id);
      if (!existing) {
        return [...prev, {
          id: data.id, name: data.name, icon: data.icon, color: data.color, payWith: data.payWith,
          budget: 0, budgetHistory: { [period]: data.budget },
        }];
      }
      const current = effectiveAmount(existing.budget, existing.budgetHistory, period);
      const history = { ...(existing.budgetHistory || {}) };
      if (data.budget !== current) history[period] = data.budget;
      return prev.map((c) => (c.id === data.id
        ? { ...c, name: data.name, icon: data.icon, color: data.color, payWith: data.payWith, budgetHistory: history }
        : c));
    });
    showToast(isNew ? "Reserva creada" : "Reserva actualizada");
    setShowCategoryModal(false);
    setEditingCategory(null);
  };

  const deleteCategory = (cat) => {
    if (expenses.some((e) => e.categoryId === cat.id)) {
      showToast("No se puede: tiene gastos asociados");
      setConfirmDelete(null);
      return;
    }
    setCategories((prev) => prev.filter((c) => c.id !== cat.id));
    showToast("Reserva eliminada");
    setConfirmDelete(null);
  };

  /* ------------------------- Pagos fijos ------------------------- */

  const openEditFixed = (id) => {
    const f = summary.fixed.find((x) => x.id === id);
    if (!f) return;
    setEditingFixed({ id: f.id, name: f.name, icon: f.icon, target: f.target, amount: f.amountNow });
    setShowFixedModal(true);
  };

  const saveFixed = (data) => {
    const isNew = !fixedItems.some((f) => f.id === data.id);
    setFixedItems((prev) => {
      const existing = prev.find((f) => f.id === data.id);
      if (!existing) {
        return [...prev, {
          id: data.id, name: data.name, icon: data.icon, target: data.target,
          amount: 0, amountHistory: { [period]: data.amount }, paid: {},
        }];
      }
      const current = effectiveAmount(existing.amount, existing.amountHistory, period);
      const history = { ...(existing.amountHistory || {}) };
      if (data.amount !== current) history[period] = data.amount;
      return prev.map((f) => (f.id === data.id
        ? { ...f, name: data.name, icon: data.icon, target: data.target, amountHistory: history }
        : f));
    });
    showToast(isNew ? "Pago fijo creado" : "Pago fijo actualizado");
    setShowFixedModal(false);
    setEditingFixed(null);
  };

  const deleteFixed = (item) => {
    setFixedItems((prev) => prev.filter((f) => f.id !== item.id));
    showToast("Pago fijo eliminado");
    setConfirmDelete(null);
  };

  const togglePaid = (id) => {
    setFixedItems((prev) => prev.map((f) => (f.id === id
      ? { ...f, paid: { ...(f.paid || {}), [period]: !(f.paid && f.paid[period]) } }
      : f)));
  };

  /* ------------------------- Ajustes ------------------------- */

  const saveIncome = (value) => {
    setSettings((s) => ({ ...s, incomeHistory: { ...(s.incomeHistory || {}), [period]: value } }));
    showToast("Sueldo actualizado");
  };

  const changeDefaultClosing = (day) => {
    setSettings((s) => ({ ...s, closingDay: day }));
    showToast("Cierre habitual actualizado");
  };

  const changePeriodClosing = (day) => {
    setSettings((s) => ({ ...s, closingOverrides: { ...(s.closingOverrides || {}), [period]: day } }));
    showToast(`Cierre de ${monthLabel(period)} actualizado`);
  };

  const resetPeriodClosing = () => {
    setSettings((s) => {
      const next = { ...(s.closingOverrides || {}) };
      delete next[period];
      return { ...s, closingOverrides: next };
    });
  };

  /* ------------------------- Cierre de tarjeta ------------------------- */

  const buildSnapshot = () => {
    const reserves = summary.reserves.map((r) => ({ ...r }));
    const totalLeft = reserves.reduce((s, r) => s + r.left, 0);
    const leftPositive = reserves.reduce((s, r) => s + Math.max(r.left, 0), 0);
    const overspent = reserves.reduce((s, r) => s + Math.max(-r.left, 0), 0);
    const leftCard = reserves.filter((r) => r.payWith === "card").reduce((s, r) => s + r.left, 0);
    const leftOther = reserves.filter((r) => r.payWith === "other").reduce((s, r) => s + r.left, 0);
    return {
      period,
      rangeLabel,
      closedAt: null,
      cardTotal: summary.cardTotal,
      variableCard: summary.variableCard,
      fixedCard: summary.fixedCard,
      income: summary.income,
      reserves,
      fixed: summary.fixed.map((f) => ({ id: f.id, name: f.name, icon: f.icon, target: f.target, amount: f.amountNow, paid: f.paidNow })),
      totalBudget: summary.totalBudget,
      totalSpent: summary.totalSpent,
      totalLeft, leftPositive, overspent, leftCard, leftOther,
    };
  };

  const openClosePreview = () => setClosingModal({ snapshot: buildSnapshot(), readOnly: false });

  const viewClosing = (p) => {
    if (closings[p]) setClosingModal({ snapshot: closings[p], readOnly: true });
  };

  const confirmClose = () => {
    if (!closingModal) return;
    const snap = { ...closingModal.snapshot, closedAt: new Date().toISOString() };
    setClosings((prev) => ({ ...prev, [snap.period]: snap }));
    setClosingModal(null);
    setPeriod(shiftPeriod(snap.period, 1));
    showToast(`Tarjeta cerrada. Arrancaste ${monthLabel(shiftPeriod(snap.period, 1))}`);
  };

  const reopenPeriod = () => {
    if (!closingModal) return;
    const p = closingModal.snapshot.period;
    setClosings((prev) => {
      const next = { ...prev };
      delete next[p];
      return next;
    });
    setClosingModal(null);
    showToast("Período reabierto");
  };

  if (!loaded) {
    return (
      <div className="rf-root" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 400 }}>
        <GlobalStyles />
        <div style={{ color: "var(--text-soft)", fontSize: 13 }}>Cargando tus reservas…</div>
      </div>
    );
  }

  const confirmCopy = {
    expense: { title: "¿Eliminar este gasto?", message: "Se recalcularán automáticamente los saldos de la reserva y de la tarjeta." },
    category: { title: "¿Eliminar esta reserva?", message: "Esta acción no se puede deshacer." },
    fixed: { title: "¿Eliminar este pago fijo?", message: "Se elimina de todos los meses. Si solo querés que deje de aplicar desde este mes, mejor editalo y poné el monto en $0." },
  };

  return (
    <div className="rf-root" style={{ minHeight: "100%" }}>
      <GlobalStyles />

      {/* Sidebar desktop */}
      <div className="rf-sidebar" style={{ position: "fixed", left: 0, top: 0, bottom: 0, width: 220, borderRight: "1px solid var(--line)", background: "var(--surface)", flexDirection: "column", padding: "26px 16px", zIndex: 30 }}>
        <div className="rf-serif" style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, paddingLeft: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22 }}>💌</span> Reservas
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-soft)", paddingLeft: 8, marginBottom: 26 }}>tu control de gastos</div>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = view === item.key;
          return (
            <button
              key={item.key}
              onClick={() => goToView(item.key)}
              className="rf-nav-item rf-tap"
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 12,
                border: "none", background: active ? "var(--accent-soft)" : "transparent",
                color: active ? "var(--accent)" : "var(--text-soft)", fontWeight: 700, fontSize: 13.5, marginBottom: 4, textAlign: "left",
              }}
            >
              <Icon size={17} /> {item.label}
            </button>
          );
        })}
        <button
          onClick={() => { setEditingExpense(null); setShowAddExpense(true); }}
          className="rf-tap"
          style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 0", borderRadius: 14, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 13.5 }}
        >
          <Plus size={16} /> Nuevo gasto
        </button>
      </div>

      {/* Contenido */}
      <div className="rf-content" style={{ paddingBottom: 96 }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "20px 16px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div className="rf-mobile-only rf-serif" style={{ fontSize: 19, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 20 }}>💌</span> Reservas
              </div>
              <div className="rf-desktop-only rf-serif" style={{ fontSize: 24, fontWeight: 700 }}>
                {NAV_ITEMS.find((n) => n.key === view)?.label}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <PeriodSwitcher period={period} onChange={setPeriod} />
              <div style={{ fontSize: 11, color: "var(--text-soft)", marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}>
                {rangeLabel}
                {closing && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#4F7347", fontWeight: 700 }}><Lock size={10} /> cerrada</span>}
              </div>
            </div>
          </div>

          {view === "dashboard" && (
            <DashboardView
              summary={summary}
              settings={settings}
              percentUsed={percentUsed}
              allExpenses={expenses}
              categories={categories}
              onCategoryClick={(id) => { setCategoryFilterOverride(id); setView("gastos"); }}
              onSeeAll={() => goToView("gastos")}
              onGoSettings={() => goToView("categorias")}
              onEditExpense={openEditExpense}
              onDeleteExpense={askDeleteExpense}
            />
          )}

          {view === "gastos" && (
            <GastosView
              categories={categories}
              allExpenses={expenses}
              period={period}
              periodOf={periodOf}
              initialCategoryFilter={categoryFilterOverride}
              onEditExpense={openEditExpense}
              onDeleteExpense={askDeleteExpense}
            />
          )}

          {view === "tarjeta" && (
            <TarjetaView
              summary={summary}
              categories={categories}
              periodExpenses={periodExpenses}
              period={period}
              rangeLabel={rangeLabel}
              closingDay={closingDayFor(period)}
              hasClosingOverride={!!(settings.closingOverrides && settings.closingOverrides[period])}
              closing={closing}
              closings={closings}
              onChangeClosingDay={changePeriodClosing}
              onResetClosingDay={resetPeriodClosing}
              onCloseCard={openClosePreview}
              onViewClosing={viewClosing}
              onEditExpense={openEditExpense}
              onDeleteExpense={askDeleteExpense}
            />
          )}

          {view === "categorias" && (
            <CategoriasView
              summary={summary}
              settings={settings}
              period={period}
              incomeNow={summary.income}
              onAdd={() => { setEditingCategory(null); setShowCategoryModal(true); }}
              onEdit={openEditCategory}
              onDelete={(id) => setConfirmDelete({ type: "category", item: categories.find((c) => c.id === id) })}
              onAddFixed={() => { setEditingFixed(null); setShowFixedModal(true); }}
              onEditFixed={openEditFixed}
              onDeleteFixed={(id) => setConfirmDelete({ type: "fixed", item: fixedItems.find((f) => f.id === id) })}
              onTogglePaid={togglePaid}
              onSaveIncome={saveIncome}
              onChangeDefaultClosing={changeDefaultClosing}
              onSettingsChange={setSettings}
            />
          )}
        </div>
      </div>

      {/* Nav inferior mobile */}
      <div className="rf-mobile-only" style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: "var(--surface)", borderTop: "1px solid var(--line)", display: "flex", padding: "8px 6px calc(8px + env(safe-area-inset-bottom))", zIndex: 40 }}>
        {NAV_ITEMS.slice(0, 2).map((item) => {
          const Icon = item.icon; const active = view === item.key;
          return (
            <button key={item.key} onClick={() => goToView(item.key)} className="rf-nav-item" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "4px 0", background: "none", border: "none", color: active ? "var(--accent)" : "var(--text-soft)" }}>
              <Icon size={19} strokeWidth={active ? 2.4 : 2} /> <span style={{ fontSize: 10, fontWeight: 700 }}>{item.label}</span>
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        {NAV_ITEMS.slice(2).map((item) => {
          const Icon = item.icon; const active = view === item.key;
          return (
            <button key={item.key} onClick={() => goToView(item.key)} className="rf-nav-item" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "4px 0", background: "none", border: "none", color: active ? "var(--accent)" : "var(--text-soft)" }}>
              <Icon size={19} strokeWidth={active ? 2.4 : 2} /> <span style={{ fontSize: 10, fontWeight: 700 }}>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* FAB mobile */}
      <button
        onClick={() => { setEditingExpense(null); setShowAddExpense(true); }}
        className="rf-mobile-only rf-fab rf-tap"
        aria-label="Nuevo gasto"
        style={{
          position: "fixed", left: "50%", bottom: 40, transform: "translateX(-50%)", width: 58, height: 58,
          borderRadius: "50%", background: "var(--accent)", border: "4px solid var(--bg)", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 18px rgba(139,93,107,0.45)", zIndex: 50,
        }}
      >
        <Plus size={26} />
      </button>

      <ExpenseFormModal
        open={showAddExpense}
        onClose={() => { setShowAddExpense(false); setEditingExpense(null); }}
        categories={categories}
        initial={editingExpense}
        onSave={saveExpense}
      />

      <CategoryFormModal
        open={showCategoryModal}
        onClose={() => { setShowCategoryModal(false); setEditingCategory(null); }}
        initial={editingCategory}
        periodLabel={monthLabel(period)}
        onSave={saveCategory}
      />

      <FixedFormModal
        open={showFixedModal}
        onClose={() => { setShowFixedModal(false); setEditingFixed(null); }}
        initial={editingFixed}
        periodLabel={monthLabel(period)}
        onSave={saveFixed}
      />

      <ClosingModal
        open={!!closingModal}
        snapshot={closingModal?.snapshot}
        readOnly={closingModal?.readOnly}
        settings={settings}
        nextLabel={monthLabel(shiftPeriod(closingModal?.snapshot?.period || period, 1))}
        onClose={() => setClosingModal(null)}
        onConfirm={confirmClose}
        onReopen={reopenPeriod}
      />

      <ConfirmDialog
        open={!!confirmDelete && !!confirmDelete.item}
        title={confirmDelete ? confirmCopy[confirmDelete.type].title : ""}
        message={confirmDelete ? confirmCopy[confirmDelete.type].message : ""}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (!confirmDelete) return;
          if (confirmDelete.type === "expense") deleteExpense(confirmDelete.item);
          else if (confirmDelete.type === "category") deleteCategory(confirmDelete.item);
          else deleteFixed(confirmDelete.item);
        }}
      />

      <Toast toast={toast} />
    </div>
  );
}
