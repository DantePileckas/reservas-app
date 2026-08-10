import React, { useState, useEffect } from "react";

// La contraseña NO se guarda en texto plano: se guarda su hash SHA-256.
// Así, si alguien inspecciona el código, no puede leer la contraseña directamente.
const PASSWORD_HASH = "7955fc3b68abf00a9aa8f7d3934a7ccce5c739b83eedbf52aa426882cd827e75";
const UNLOCK_KEY = "rf-unlocked";

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function PasswordGate({ children }) {
  const [unlocked, setUnlocked] = useState(false);
  const [checked, setChecked] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    setUnlocked(sessionStorage.getItem(UNLOCK_KEY) === "true");
    setChecked(true);
  }, []);

  if (!checked) return null;
  if (unlocked) return children;

  const submit = async (e) => {
    e.preventDefault();
    setVerifying(true);
    const hash = await sha256(input);
    if (hash === PASSWORD_HASH) {
      sessionStorage.setItem(UNLOCK_KEY, "true");
      setUnlocked(true);
    } else {
      setError("Contraseña incorrecta");
      setInput("");
    }
    setVerifying(false);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#FBF5F1",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        padding: 20,
      }}
    >
      <form
        onSubmit={submit}
        style={{
          background: "#fff",
          border: "1px solid #EBE0D8",
          borderRadius: 20,
          padding: 32,
          maxWidth: 340,
          width: "100%",
          boxShadow: "0 8px 30px rgba(43,34,48,0.08)",
          boxSizing: "border-box",
        }}
      >
        <div style={{ fontSize: 30, marginBottom: 8, textAlign: "center" }}>💌</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, textAlign: "center", color: "#2B2230" }}>
          Reservas
        </div>
        <div style={{ fontSize: 12.5, color: "#857A82", marginBottom: 20, textAlign: "center" }}>
          Ingresá la contraseña para continuar
        </div>
        <input
          type="password"
          autoFocus
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(""); }}
          placeholder="Contraseña"
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid #EBE0D8",
            background: "#F6EFE8",
            fontSize: 14.5,
            marginBottom: 10,
            boxSizing: "border-box",
          }}
        />
        {error && (
          <div style={{ color: "#B5453B", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{error}</div>
        )}
        <button
          type="submit"
          disabled={verifying}
          style={{
            width: "100%",
            padding: "12px 0",
            borderRadius: 12,
            border: "none",
            background: "#8B5D6B",
            color: "#fff",
            fontWeight: 700,
            fontSize: 14,
            cursor: verifying ? "default" : "pointer",
            opacity: verifying ? 0.7 : 1,
          }}
        >
          {verifying ? "Verificando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
