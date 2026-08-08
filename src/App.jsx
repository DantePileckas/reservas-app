import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Plus, Home, Receipt, CreditCard, LayoutGrid, ChevronLeft, ChevronRight,
  X, Search, Pencil, Trash2, Check, AlertTriangle, TrendingUp, Wallet,
  Sparkles, Filter, ArrowUpDown, PiggyBank, SlidersHorizontal
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, AreaChart, Area, CartesianGrid
} from "recharts";

/* ------------------------------------------------------------------ */
/* Constantes y helpers                                               */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "reservas-finanzas-v1";

/* Shim de persistencia: en Claude.ai esto lo provee window.storage.
   Fuera de ese entorno usamos localStorage con la misma interfaz. */
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

const ICONS = ["🛒","🍔","🎬","👕","🚗","🏠","💊","📱","🎁","📦","💡","💧","🐾","💅","⚽","🥦","💰","✈️","📚","☕","🏦","🧴","🎓","🐶"];
const PALETTE = ["#7C9473", "#C97F86", "#CE9A45", "#6787A0", "#8B5D6B", "#B36A4E"];

const uid = () => Math.random().toString(36).slice(2, 10);

const fmt = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n || 0);

const fmtShort = (n) => {
  const v = Math.round(n || 0);
  return "$" + v.toLocaleString("es-AR");
};

const periodKey = (dateStr) => (dateStr || "").slice(0, 7);

const todayISO = () => new Date().toISOString().slice(0, 10);

const monthLabel = (key) => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const s = d.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const shiftPeriod = (period, delta) => {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const dayLabel = (dateStr) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
};

function seedData() {
  const daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const categories = [
    { id: "cat-super", name: "Supermercado", icon: "🛒", color: PALETTE[0], budget: 350000 },
    { id: "cat-salidas", name: "Salidas", icon: "🍿", color: PALETTE[1], budget: 100000 },
    { id: "cat-transporte", name: "Transporte", icon: "🚗", color: PALETTE[2], budget: 70000 },
    { id: "cat-ropa", name: "Ropa", icon: "👕", color: PALETTE[3], budget: 100000 },
    { id: "cat-hogar", name: "Hogar", icon: "🏠", color: PALETTE[4], budget: 120000 },
  ];
  const expenses = [
    { id: uid(), categoryId: "cat-super", amount: 80000, description: "Compra supermercado", date: daysAgo(6), card: "Principal", installments: 1 },
    { id: uid(), categoryId: "cat-salidas", amount: 25000, description: "Cena", date: daysAgo(4), card: "Principal", installments: 1 },
    { id: uid(), categoryId: "cat-transporte", amount: 15000, description: "Combustible", date: daysAgo(3), card: "Principal", installments: 1 },
    { id: uid(), categoryId: "cat-ropa", amount: 35000, description: "Campera", date: daysAgo(1), card: "Principal", installments: 1 },
    { id: uid(), categoryId: "cat-super", amount: 22000, description: "Verdulería", date: daysAgo(0), card: "Principal", installments: 1 },
  ];
  const settings = { warning: 70, alert: 90 };
  return { categories, expenses, settings };
}

function statusOf(spent, budget, settings) {
  const pct = budget > 0 ? (spent / budget) * 100 : 0;
  if (pct >= 100) return { key: "excedido", label: "Excedido", color: "#B5453B" };
  if (pct >= settings.alert) return { key: "alerta", label: "Alerta", color: "#D9762F" };
  if (pct >= settings.warning) return { key: "advertencia", label: "Cerca del límite", color: "#C99A3E" };
  return { key: "normal", label: "En orden", color: "#6B8E63" };
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

      /* Layout responsive (reemplaza utilidades de Tailwind del entorno original) */
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

/* ------------------------------------------------------------------ */
/* Componentes pequeños                                                */
/* ------------------------------------------------------------------ */

function PeriodSwitcher({ period, onChange }) {
  return (
    <div className="flex items-center gap-1">
      <button
        aria-label="Mes anterior"
        onClick={() => onChange(shiftPeriod(period, -1))}
        className="rf-tap rf-icon-btn"
        style={{ width: 30, height: 30, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center" }}
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
        style={{ width: 30, height: 30, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center" }}
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
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 18,
        padding: "14px 16px",
        minWidth: 152,
        flex: "1 1 152px",
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

function CategoryEnvelope({ cat, spent, settings, onClick }) {
  const disponible = cat.budget - spent;
  const percent = cat.budget > 0 ? (spent / cat.budget) * 100 : 0;
  const status = statusOf(spent, cat.budget, settings);

  return (
    <button
      onClick={onClick}
      className="rf-tap"
      style={{
        textAlign: "left",
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 20,
        overflow: "hidden",
        boxShadow: "0 1px 2px rgba(43,34,48,0.04)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          height: 46,
          background: cat.color,
          clipPath: "polygon(0 0, 100% 0, 100% 55%, 50% 100%, 0 55%)",
        }}
      />
      <div style={{ padding: "0 14px 14px", marginTop: -20, position: "relative" }}>
        <div
          style={{
            width: 38, height: 38, borderRadius: "50%", background: "var(--surface)",
            border: "1px solid var(--line)", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 18, marginBottom: 8,
            boxShadow: "0 2px 4px rgba(43,34,48,0.08)",
          }}
        >
          {cat.icon}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{cat.name}</div>
        <div className="rf-serif" style={{ fontSize: 19, fontWeight: 600, color: disponible < 0 ? "#B5453B" : "var(--text)" }}>
          {fmtShort(Math.max(disponible, disponible))}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-soft)", marginBottom: 8 }}>
          disponible de {fmtShort(cat.budget)}
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
        boxShadow: "0 8px 24px rgba(43,34,48,0.25)", zIndex: 80, whiteSpace: "nowrap",
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
    <div className="rf-fade" style={{ position: "fixed", inset: 0, background: "rgba(43,34,48,0.35)", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onCancel}>
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
      setCard(initial ? initial.card : "Principal");
      setInstallments(initial ? initial.installments : 1);
      setError("");
    }
  }, [open, initial]);

  if (!open) return null;

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
      card: card.trim() || "Principal",
      installments: Number(installments) || 1,
    }, !!initial);
  };

  return (
    <div className="rf-fade" style={{ position: "fixed", inset: 0, background: "rgba(43,34,48,0.4)", zIndex: 90, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="rf-sheet rf-scroll"
        style={{
          background: "var(--surface)", width: "100%", maxWidth: 480, borderRadius: "26px 26px 0 0",
          padding: "10px 22px 26px", maxHeight: "88vh", overflowY: "auto",
        }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 999, background: "var(--line)", margin: "6px auto 14px" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div className="rf-serif" style={{ fontSize: 20, fontWeight: 600 }}>{initial ? "Editar gasto" : "Nuevo gasto"}</div>
          <button onClick={onClose} className="rf-tap rf-icon-btn" style={{ width: 32, height: 32, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center" }}><X size={16} /></button>
        </div>

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
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-soft)", marginBottom: 8 }}>Categoría</div>
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
                  fontSize: 12.5, fontWeight: 600,
                }}
              >
                <span>{c.icon}</span>{c.name}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-soft)", marginBottom: 6 }}>Descripción (opcional)</div>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej. Compra mensual"
            style={{ width: "100%", padding: "11px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--cream)", fontSize: 14 }}
          />
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-soft)", marginBottom: 6 }}>Fecha</div>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--cream)", fontSize: 13.5 }}
            />
          </div>
          <div style={{ width: 90 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-soft)", marginBottom: 6 }}>Cuotas</div>
            <input
              type="number" min={1}
              value={installments}
              onChange={(e) => setInstallments(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--cream)", fontSize: 13.5 }}
            />
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-soft)", marginBottom: 6 }}>Tarjeta</div>
          <input
            value={card}
            onChange={(e) => setCard(e.target.value)}
            placeholder="Principal"
            style={{ width: "100%", padding: "11px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--cream)", fontSize: 14 }}
          />
        </div>

        {error && <div style={{ color: "#B5453B", fontSize: 12.5, marginBottom: 12, fontWeight: 600 }}>{error}</div>}

        <button
          onClick={submit}
          className="rf-tap"
          style={{ width: "100%", padding: "14px 0", borderRadius: 14, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 15 }}
        >
          {initial ? "Guardar cambios" : "Registrar gasto"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal: agregar / editar categoría                                    */
/* ------------------------------------------------------------------ */

function CategoryFormModal({ open, onClose, initial, onSave }) {
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [icon, setIcon] = useState(ICONS[0]);
  const [color, setColor] = useState(PALETTE[0]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName(initial ? initial.name : "");
      setBudget(initial ? String(initial.budget) : "");
      setIcon(initial ? initial.icon : ICONS[0]);
      setColor(initial ? initial.color : PALETTE[0]);
      setError("");
    }
  }, [open, initial]);

  if (!open) return null;

  const submit = () => {
    if (!name.trim()) { setError("Ingresá un nombre"); return; }
    const b = Number(budget);
    if (budget === "" || isNaN(b) || b < 0) { setError("Ingresá un presupuesto válido"); return; }
    onSave({ id: initial?.id || uid(), name: name.trim(), budget: b, icon, color });
  };

  return (
    <div className="rf-fade" style={{ position: "fixed", inset: 0, background: "rgba(43,34,48,0.4)", zIndex: 90, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="rf-sheet rf-scroll"
        style={{ background: "var(--surface)", width: "100%", maxWidth: 480, borderRadius: "26px 26px 0 0", padding: "10px 22px 26px", maxHeight: "88vh", overflowY: "auto" }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 999, background: "var(--line)", margin: "6px auto 14px" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div className="rf-serif" style={{ fontSize: 20, fontWeight: 600 }}>{initial ? "Editar categoría" : "Nueva categoría"}</div>
          <button onClick={onClose} className="rf-tap rf-icon-btn" style={{ width: 32, height: 32, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center" }}><X size={16} /></button>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, background: color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>{icon}</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre de la categoría"
            style={{ flex: 1, padding: "11px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--cream)", fontSize: 14.5, fontWeight: 600 }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-soft)", marginBottom: 6 }}>Presupuesto mensual</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "10px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--cream)" }}>
            <span style={{ color: "var(--text-soft)" }}>$</span>
            <input
              inputMode="numeric"
              value={budget}
              onChange={(e) => setBudget(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="0"
              style={{ border: "none", background: "transparent", fontSize: 14.5, width: "100%" }}
            />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-soft)", marginBottom: 8 }}>Ícono</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {ICONS.map((ic) => (
              <button
                key={ic}
                onClick={() => setIcon(ic)}
                className="rf-tap"
                style={{
                  width: 38, height: 38, borderRadius: 10, fontSize: 18,
                  border: icon === ic ? "1.5px solid var(--accent)" : "1px solid var(--line)",
                  background: icon === ic ? "var(--accent-soft)" : "var(--cream)",
                }}
              >
                {ic}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-soft)", marginBottom: 8 }}>Color</div>
          <div style={{ display: "flex", gap: 10 }}>
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                className="rf-tap"
                style={{
                  width: 32, height: 32, borderRadius: "50%", background: c,
                  border: color === c ? "3px solid var(--text)" : "3px solid transparent",
                  boxShadow: "0 0 0 1px var(--line)",
                }}
              />
            ))}
          </div>
        </div>

        {error && <div style={{ color: "#B5453B", fontSize: 12.5, marginBottom: 12, fontWeight: 600 }}>{error}</div>}

        <button
          onClick={submit}
          className="rf-tap"
          style={{ width: "100%", padding: "14px 0", borderRadius: 14, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 15 }}
        >
          {initial ? "Guardar cambios" : "Crear categoría"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fila de gasto                                                       */
/* ------------------------------------------------------------------ */

function ExpenseRow({ expense, category, onEdit, onDelete }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
        background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, marginBottom: 8,
      }}
    >
      <div style={{ width: 38, height: 38, borderRadius: 12, background: (category?.color || "#ddd") + "26", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
        {category?.icon || "📦"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {expense.description || category?.name || "Gasto"}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-soft)" }}>
          {category?.name || "Sin categoría"} · {dayLabel(expense.date)}
          {expense.installments > 1 ? ` · ${expense.installments} cuotas` : ""}
        </div>
      </div>
      <div className="rf-serif" style={{ fontSize: 15, fontWeight: 600, marginRight: 4, whiteSpace: "nowrap" }}>
        {fmtShort(expense.amount)}
      </div>
      <button onClick={() => onEdit(expense)} className="rf-tap rf-icon-btn" style={{ width: 30, height: 30, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Pencil size={13} />
      </button>
      <button onClick={() => onDelete(expense)} className="rf-tap" style={{ width: 30, height: 30, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: "#F6E4E1", flexShrink: 0 }}>
        <Trash2 size={13} color="#B5453B" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vistas                                                              */
/* ------------------------------------------------------------------ */

function DashboardView({ categories, spentByCategory, periodExpenses, settings, totalBudget, totalSpentCard, percentUsed, onCategoryClick, onSeeAll, allExpenses }) {
  const alertCats = categories
    .map((c) => ({ c, spent: spentByCategory[c.id] || 0 }))
    .filter(({ c, spent }) => c.budget > 0 && (spent / c.budget) * 100 >= settings.warning);

  const pieData = categories
    .map((c) => ({ name: c.name, value: spentByCategory[c.id] || 0, color: c.color }))
    .filter((d) => d.value > 0);

  const recent = [...allExpenses].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);

  return (
    <div>
      <div className="rf-scroll" style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4, marginBottom: 18 }}>
        <StatCard icon={<Wallet size={13} />} label="Total en reservas" value={fmtShort(totalBudget)} />
        <StatCard icon={<CreditCard size={13} />} label="Gastado con tarjeta" value={fmtShort(totalSpentCard)} tone="var(--accent)" />
        <StatCard icon={<PiggyBank size={13} />} label="Reservado p/ tarjeta" value={fmtShort(totalSpentCard)} sub="Pendiente: $0" />
        <StatCard icon={<TrendingUp size={13} />} label="Presupuesto usado" value={`${percentUsed.toFixed(0)}%`} tone={percentUsed >= 90 ? "#B5453B" : percentUsed >= 70 ? "#C99A3E" : "var(--text)"} />
      </div>

      {alertCats.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div className="rf-scroll" style={{ display: "flex", gap: 8, overflowX: "auto" }}>
            {alertCats.map(({ c, spent }) => {
              const st = statusOf(spent, c.budget, settings);
              return (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 999, background: st.color + "1A", color: st.color, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>
                  <AlertTriangle size={12} /> {c.name} · {((spent / c.budget) * 100).toFixed(0)}%
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
        {categories.map((c) => (
          <CategoryEnvelope key={c.id} cat={c} spent={spentByCategory[c.id] || 0} settings={settings} onClick={() => onCategoryClick(c.id)} />
        ))}
        {categories.length === 0 && (
          <div style={{ gridColumn: "1/-1", textAlign: "center", color: "var(--text-soft)", fontSize: 13, padding: "24px 0" }}>
            Todavía no creaste categorías. Andá a la sección Categorías para armar tus reservas.
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
          <ExpenseRow key={e.id} expense={e} category={categories.find((c) => c.id === e.categoryId)} onEdit={() => {}} onDelete={() => {}} />
        ))}
      </div>
    </div>
  );
}

function GastosView({ categories, allExpenses, period, onEditExpense, onDeleteExpense, initialCategoryFilter }) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(initialCategoryFilter || "all");

  useEffect(() => {
    if (initialCategoryFilter) setCategoryFilter(initialCategoryFilter);
  }, [initialCategoryFilter]);
  const [allPeriods, setAllPeriods] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);

  const filtered = useMemo(() => {
    let list = allExpenses;
    if (!allPeriods && !search) list = list.filter((e) => periodKey(e.date) === period);
    if (categoryFilter !== "all") list = list.filter((e) => e.categoryId === categoryFilter);
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      list = list.filter((e) => (e.description || "").toLowerCase().includes(s) || (categories.find((c) => c.id === e.categoryId)?.name || "").toLowerCase().includes(s));
    }
    list = [...list].sort((a, b) => (sortAsc ? (a.date > b.date ? 1 : -1) : (a.date < b.date ? 1 : -1)));
    return list;
  }, [allExpenses, period, categoryFilter, search, allPeriods, sortAsc, categories]);

  const total = filtered.reduce((s, e) => s + e.amount, 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "9px 12px" }}>
          <Search size={15} color="var(--text-soft)" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por descripción o categoría"
            style={{ border: "none", background: "transparent", fontSize: 13.5, flex: 1 }}
          />
        </div>
        <button onClick={() => setSortAsc((s) => !s)} className="rf-tap rf-icon-btn" style={{ width: 38, height: 38, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <ArrowUpDown size={15} />
        </button>
      </div>

      <div className="rf-scroll" style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 6, paddingBottom: 2 }}>
        <button
          onClick={() => setCategoryFilter("all")}
          className="rf-tap"
          style={{ padding: "7px 13px", borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", border: categoryFilter === "all" ? "1.5px solid var(--accent)" : "1px solid var(--line)", background: categoryFilter === "all" ? "var(--accent-soft)" : "var(--surface)" }}
        >
          Todas
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategoryFilter(c.id)}
            className="rf-tap"
            style={{ padding: "7px 13px", borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", border: categoryFilter === c.id ? `1.5px solid ${c.color}` : "1px solid var(--line)", background: categoryFilter === c.id ? "var(--accent-soft)" : "var(--surface)" }}
          >
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

function TarjetaView({ categories, periodExpenses, period, totalSpentCard }) {
  const barData = categories
    .map((c) => ({ name: c.name, value: periodExpenses.filter((e) => e.categoryId === c.id).reduce((s, e) => s + e.amount, 0), color: c.color }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);

  const byDay = {};
  [...periodExpenses].sort((a, b) => (a.date > b.date ? 1 : -1)).forEach((e) => {
    byDay[e.date] = (byDay[e.date] || 0) + e.amount;
  });
  let acc = 0;
  const evolution = Object.keys(byDay).sort().map((d) => {
    acc += byDay[d];
    return { day: dayLabel(d), total: acc };
  });

  const recent = [...periodExpenses].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);

  return (
    <div>
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 22, padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-soft)", fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
          <CreditCard size={14} /> Tarjeta · {monthLabel(period)}
        </div>
        <div className="rf-serif" style={{ fontSize: 34, fontWeight: 700, marginBottom: 14 }}>{fmt(totalSpentCard)}</div>
        <div style={{ display: "flex", gap: 22 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-soft)", fontWeight: 600 }}>Reservado para pagar</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{fmt(totalSpentCard)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-soft)", fontWeight: 600 }}>Pendiente de reservar</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#6B8E63" }}>{fmt(0)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-soft)", fontWeight: 600 }}>Cantidad de gastos</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{periodExpenses.length}</div>
          </div>
        </div>
      </div>

      {evolution.length > 1 && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 20, padding: "16px 10px", marginBottom: 16 }}>
          <div className="rf-serif" style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 8, paddingLeft: 8 }}>Evolución del mes</div>
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
          <div className="rf-serif" style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 8, paddingLeft: 8 }}>Gastos por categoría</div>
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

      <div className="rf-serif" style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Últimos gastos</div>
      {recent.length === 0 && <div style={{ color: "var(--text-soft)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>Sin gastos este mes.</div>}
      {recent.map((e) => (
        <ExpenseRow key={e.id} expense={e} category={categories.find((c) => c.id === e.categoryId)} onEdit={() => {}} onDelete={() => {}} />
      ))}
    </div>
  );
}

function CategoriasView({ categories, spentByCategory, settings, onAdd, onEdit, onDelete, onSettingsChange }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div className="rf-serif" style={{ fontSize: 18, fontWeight: 600 }}>Categorías</div>
        <button onClick={onAdd} className="rf-tap" style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 12.5, fontWeight: 700 }}>
          <Plus size={14} /> Nueva
        </button>
      </div>

      {categories.map((c) => {
        const spent = spentByCategory[c.id] || 0;
        const percent = c.budget > 0 ? (spent / c.budget) * 100 : 0;
        const status = statusOf(spent, c.budget, settings);
        return (
          <div key={c.id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 14, marginBottom: 10, display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 42, height: 42, borderRadius: 13, background: c.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{c.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: "var(--text-soft)" }}>{fmtShort(spent)} / {fmtShort(c.budget)}</div>
              </div>
              <ProgressBar percent={percent} color={status.color} />
            </div>
            <button onClick={() => onEdit(c)} className="rf-tap rf-icon-btn" style={{ width: 32, height: 32, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Pencil size={13} /></button>
            <button onClick={() => onDelete(c)} className="rf-tap" style={{ width: 32, height: 32, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: "#F6E4E1", flexShrink: 0 }}><Trash2 size={13} color="#B5453B" /></button>
          </div>
        );
      })}

      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 18, padding: 18, marginTop: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <SlidersHorizontal size={15} />
          <div className="rf-serif" style={{ fontSize: 15, fontWeight: 600 }}>Umbrales de alerta</div>
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
  const [settings, setSettings] = useState({ warning: 70, alert: 90 });
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("dashboard");
  const [period, setPeriod] = useState(() => todayISO().slice(0, 7));

  const [showAddExpense, setShowAddExpense] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);

  const [confirmDelete, setConfirmDelete] = useState(null); // {type:'expense'|'category', item}
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const [categoryFilterOverride, setCategoryFilterOverride] = useState(null);

  const goToView = useCallback((key) => {
    setCategoryFilterOverride(null);
    setView(key);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await storage.get(STORAGE_KEY);
        if (!cancelled && res && res.value) {
          const parsed = JSON.parse(res.value);
          setCategories(parsed.categories || []);
          setExpenses(parsed.expenses || []);
          setSettings(parsed.settings || { warning: 70, alert: 90 });
        } else if (!cancelled) {
          const seed = seedData();
          setCategories(seed.categories);
          setExpenses(seed.expenses);
          setSettings(seed.settings);
        }
      } catch (e) {
        if (!cancelled) {
          const seed = seedData();
          setCategories(seed.categories);
          setExpenses(seed.expenses);
          setSettings(seed.settings);
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        await storage.set(STORAGE_KEY, JSON.stringify({ categories, expenses, settings }));
      } catch (e) {
        console.error("No se pudo guardar", e);
      }
    })();
  }, [categories, expenses, settings, loaded]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  const periodExpenses = useMemo(() => expenses.filter((e) => periodKey(e.date) === period), [expenses, period]);

  const spentByCategory = useMemo(() => {
    const map = {};
    periodExpenses.forEach((e) => { map[e.categoryId] = (map[e.categoryId] || 0) + e.amount; });
    return map;
  }, [periodExpenses]);

  const totalBudget = useMemo(() => categories.reduce((s, c) => s + c.budget, 0), [categories]);
  const totalSpentCard = useMemo(() => periodExpenses.reduce((s, e) => s + e.amount, 0), [periodExpenses]);
  const percentUsed = totalBudget > 0 ? (totalSpentCard / totalBudget) * 100 : 0;

  const saveExpense = (data, isEdit) => {
    if (isEdit) {
      setExpenses((prev) => prev.map((e) => (e.id === data.id ? data : e)));
      showToast("Gasto actualizado");
    } else {
      setExpenses((prev) => [...prev, data]);
      showToast("Gasto registrado ✨");
    }
    setPeriod(periodKey(data.date));
    setShowAddExpense(false);
    setEditingExpense(null);
  };

  const deleteExpense = (expense) => {
    setExpenses((prev) => prev.filter((e) => e.id !== expense.id));
    showToast("Gasto eliminado");
    setConfirmDelete(null);
  };

  const saveCategory = (data) => {
    setCategories((prev) => {
      const exists = prev.some((c) => c.id === data.id);
      if (exists) return prev.map((c) => (c.id === data.id ? data : c));
      return [...prev, data];
    });
    showToast(categories.some((c) => c.id === data.id) ? "Categoría actualizada" : "Categoría creada");
    setShowCategoryModal(false);
    setEditingCategory(null);
  };

  const deleteCategory = (cat) => {
    const hasExpenses = expenses.some((e) => e.categoryId === cat.id);
    if (hasExpenses) {
      showToast("No se puede: tiene gastos asociados");
      setConfirmDelete(null);
      return;
    }
    setCategories((prev) => prev.filter((c) => c.id !== cat.id));
    showToast("Categoría eliminada");
    setConfirmDelete(null);
  };

  if (!loaded) {
    return (
      <div className="rf-root" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 400 }}>
        <GlobalStyles />
        <div style={{ color: "var(--text-soft)", fontSize: 13 }}>Cargando tus reservas…</div>
      </div>
    );
  }

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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <div>
              <div className="rf-mobile-only rf-serif" style={{ fontSize: 19, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 20 }}>💌</span> Reservas
              </div>
              <div className="rf-desktop-only rf-serif" style={{ fontSize: 24, fontWeight: 700 }}>
                {NAV_ITEMS.find((n) => n.key === view)?.label}
              </div>
            </div>
            <PeriodSwitcher period={period} onChange={setPeriod} />
          </div>

          {view === "dashboard" && (
            <DashboardView
              categories={categories}
              spentByCategory={spentByCategory}
              periodExpenses={periodExpenses}
              settings={settings}
              totalBudget={totalBudget}
              totalSpentCard={totalSpentCard}
              percentUsed={percentUsed}
              allExpenses={expenses}
              onCategoryClick={(id) => { setCategoryFilterOverride(id); setView("gastos"); }}
              onSeeAll={() => goToView("gastos")}
            />
          )}

          {view === "gastos" && (
            <GastosView
              categories={categories}
              allExpenses={expenses}
              period={period}
              initialCategoryFilter={categoryFilterOverride}
              onEditExpense={(e) => { setEditingExpense(e); setShowAddExpense(true); }}
              onDeleteExpense={(e) => setConfirmDelete({ type: "expense", item: e })}
            />
          )}

          {view === "tarjeta" && (
            <TarjetaView categories={categories} periodExpenses={periodExpenses} period={period} totalSpentCard={totalSpentCard} />
          )}

          {view === "categorias" && (
            <CategoriasView
              categories={categories}
              spentByCategory={spentByCategory}
              settings={settings}
              onAdd={() => { setEditingCategory(null); setShowCategoryModal(true); }}
              onEdit={(c) => { setEditingCategory(c); setShowCategoryModal(true); }}
              onDelete={(c) => setConfirmDelete({ type: "category", item: c })}
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
        onSave={saveCategory}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete?.type === "expense" ? "¿Eliminar este gasto?" : "¿Eliminar esta categoría?"}
        message={
          confirmDelete?.type === "expense"
            ? "Se recalcularán automáticamente los saldos de la categoría y de la tarjeta."
            : "Esta acción no se puede deshacer."
        }
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (!confirmDelete) return;
          if (confirmDelete.type === "expense") deleteExpense(confirmDelete.item);
          else deleteCategory(confirmDelete.item);
        }}
      />

      <Toast toast={toast} />
    </div>
  );
}
