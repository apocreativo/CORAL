import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { kvGet, kvSet, kvIncr, kvMerge } from "./useKV";

// ===== Claves en KV =====
const STATE_KEY = "coralclub:state";
const REV_KEY = "coralclub:rev";
const HOLD_MINUTES = 15;
const DEFAULT_PIN = "1234";

// ===== Estado inicial =====
const initialData = {
  rev: 0,
  brand: { name: "Coral Club", logoUrl: "/logo.png", logoSize: 42 },
  background: { publicPath: "/Mapa.png" },
  layout: { count: 20 },
  security: { adminPin: "1234" },
  payments: {
    usdToVES: 0,
    currency: "USD",
    whatsapp: "584121234567",
    mp: { link: "", alias: "" },
    pagoMovil: { bank: "", rif: "", phone: "" },
    zelle: { email: "", name: "" },
  },
  categories: [
    {
      id: "servicios",
      name: "Servicios",
      items: [
        { id: "sombrilla", name: "Sombrilla (1 mesa + 2 sillas)", price: 10, img: "/img/sombrilla.png" },
        { id: "toalla", name: "Toalla Extra", price: 2, img: "/img/toalla.png" },
        { id: "hielera", name: "Hielera con Hielo", price: 5, img: "/img/hielera.png" },
      ],
    },
    {
      id: "bebidas",
      name: "Bebidas",
      items: [
        { id: "agua", name: "Agua Mineral", price: 2.5, img: "/img/agua.png" },
        { id: "refresco", name: "Refresco", price: 3.0, img: "/img/refresco.png" },
      ],
    },
  ],
  tents: [],         // {id,x,y,state,price}
  reservations: [],  // {id,tentId,customer,status,createdAt,expiresAt,cart}
  logs: [],
};

const nowISO = () => new Date().toISOString();
const addMinutesISO = (m) => new Date(Date.now() + m * 60000).toISOString();

// Genera IDs únicos incluso si crypto.randomUUID no existe
const safeId = () =>
  (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function makeGrid(count = 20) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const padX = 0.10, padTop = 0.16, padBottom = 0.10;
  const usableW = 1 - padX * 2;
  const usableH = 1 - padTop - padBottom;
  return Array.from({ length: count }).map((_, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = padX + ((c + 0.5) / cols) * usableW;
    const y = padTop + ((r + 0.5) / rows) * usableH;
    return { id: i + 1, state: "av", x: +x.toFixed(4), y: +y.toFixed(4) };
  });
}

const throttle = (fn, ms = 250) => {
  let t = 0; let lastArgs = null; let pending = false;
  return (...args) => {
    const now = Date.now();
    lastArgs = args;
    if (!pending && now - t > ms) {
      t = now; pending = true;
      Promise.resolve(fn(...lastArgs)).finally(() => pending = false);
    }
  };
};

function usePolling(onTick, delay = 1500) {
  useEffect(() => {
    const id = setInterval(onTick, delay);
    return () => clearInterval(id);
  }, [onTick, delay]);
}

function logEvent(setData, type, message) {
  setData(s => {
    const row = { ts: nowISO(), type, message };
    const logs = [row, ...s.logs].slice(0, 200);
    return { ...s, logs };
  });
}

// ===== Componente principal =====
export default function App() {
  const [data, setData] = useState(initialData);
  const [rev, setRev] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // UI States
  const [adminOpen, setAdminOpen] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [adminTab, setAdminTab] = useState("catalogo");
  const [sheetTab, setSheetTab] = useState("toldo");
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  const [editingMap, setEditingMap] = useState(false);
  const [selectedTent, setSelectedTent] = useState(null);
  const [dragId, setDragId] = useState(null);

  const [sessionRevParam, setSessionRevParam] = useState("0");
  const [bgOk, setBgOk] = useState(true);

  const topbarRef = useRef(null);
  const [topInsetPx, setTopInsetPx] = useState(70);

  // Pago y usuario
  const [payOpen, setPayOpen] = useState(false);
  const [payTab, setPayTab] = useState("mp");
  const [userForm, setUserForm] = useState({
    name: "",
    phoneCountry: "+58",
    phone: "",
    email: "",
  });
  const [myPendingResId, setMyPendingResId] = useState(null);

  // Efecto: leer localStorage y sembrar toldos si no hay
  useEffect(() => {
    try {
      const saved = localStorage.getItem("coralclub:localState");
      if (saved) {
        const parsed = JSON.parse(saved);
        setData(d => ({
          ...d,
          ...parsed,
          tents: parsed.tents?.length
            ? parsed.tents
            : (d.tents?.length ? d.tents : makeGrid(d.layout?.count || 20)),
        }));
      } else {
        setData(d => ({
          ...d,
          tents: d.tents?.length ? d.tents : makeGrid(d.layout?.count || 20),
        }));
      }
    } catch {}
  }, []);

  // Persistir en localStorage
  useEffect(() => {
    try {
      const minimal = {
        tents: data.tents,
        reservations: data.reservations,
        payments: data.payments,
        security: data.security,
      };
      localStorage.setItem("coralclub:localState", JSON.stringify(minimal));
    } catch {}
  }, [data.tents, data.reservations, data.payments, data.security]);

  // Cargar imagen de fondo
  useEffect(() => {
    const img = new Image();
    img.onload = () => setBgOk(true);
    img.onerror = () => setBgOk(false);
    if (data?.background?.publicPath) {
      img.src = `${data.background.publicPath}?v=${sessionRevParam}`;
    }
  }, [data.background?.publicPath, sessionRevParam]);

  // Ajustar topbar dinámicamente con guard para ResizeObserver
  useEffect(() => {
    if (!topbarRef.current || typeof ResizeObserver === "undefined") return;
    const el = topbarRef.current;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const h = entry.contentRect.height || el.offsetHeight || 46;
        setTopInsetPx(12 + h + 12);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (topbarRef.current) {
      const h = topbarRef.current.offsetHeight || 46;
      setTopInsetPx(12 + h + 12);
    }
  }, [data.brand.logoSize, data.brand.name]);

  // ===== Carga inicial desde KV (o seedea) =====
  useEffect(() => {
    (async () => {
      try {
        const cur = await kvGet(STATE_KEY);
        if (!cur) {
          const seeded = {
            ...initialData,
            tents: makeGrid(initialData.layout.count),
          };
          await kvSet(STATE_KEY, seeded);
          await kvSet(REV_KEY, 1);
          setData(seeded);
          setRev(1);
          setSessionRevParam("1");
          logEvent(setData, "system", "Seed inicial");
        } else {
          // Generar rejilla si no hay toldos en el estado
          if (!cur.tents || cur.tents.length === 0) {
            setData(d => ({
              ...d,
              ...cur,
              tents: makeGrid(cur.layout?.count || initialData.layout.count),
            }));
          } else {
            setData(cur);
          }
          const r = Number(await kvGet(REV_KEY)) || 1;
          setRev(r);
          setSessionRevParam(String(r));
        }
        setLoaded(true);
      } catch (e) {
        console.error(e);
        setLoaded(true);
      }
    })();
  }, []);

  // ===== Polling de rev =====
  usePolling(async () => {
    try {
      const r = Number(await kvGet(REV_KEY)) || 0;
      if (r !== rev) {
        setRev(r);
        const cur = await kvGet(STATE_KEY);
        if (cur) {
          setData(cur);
          setSessionRevParam(String(r));
        }
      }
    } catch {}
  }, 1500);

  // ===== Expiración de reservas pendientes =====
  useEffect(() => {
    const id = setInterval(async () => {
      const now = nowISO();
      const expired = data.reservations.filter(
        r => r.status === "pending" && r.expiresAt && r.expiresAt <= now
      );
      if (expired.length) {
        const tentsUpd = data.tents.map(t => {
          const hit = expired.find(r => r.tentId === t.id);
          if (hit) return { ...t, state: "av" };
          return t;
        });
        const resUpd = data.reservations.map(r =>
          expired.some(x => x.id === r.id)
            ? { ...r, status: "expired" }
            : r
        );
        await kvMerge(
          STATE_KEY,
          { tents: tentsUpd, reservations: resUpd },
          REV_KEY
        );
        logEvent(
          setData,
          "system",
          `Expiraron ${expired.length} reservas`
        );
      }
    }, 10000);
    return () => clearInterval(id);
  }, [data.reservations, data.tents]);

  // ===== MergeState helper =====
  const mergeState = async (patch, logMsg) => {
    try {
      const next = await kvMerge(STATE_KEY, patch, REV_KEY);
      if (next) {
        setData(next);
        const r = Number(await kvGet(REV_KEY)) || 0;
        setRev(r);
        setSessionRevParam(String(r));
        if (logMsg) logEvent(setData, "action", logMsg);
        return;
      }
      throw new Error("kvMerge returned null");
    } catch (e) {
      // fallback local
      setData(s => ({ ...s, ...patch }));
      setRev(r => (r || 0) + 1);
      setSessionRevParam(v => String((+v || 0) + 1));
      if (logMsg) logEvent(setData, "action (local)", logMsg);
    }
  };

  // ===== Drag & selección de toldos =====
  const onTentClick = (t) => {
    if (editingMap) return;
    if (t.state !== "av") {
      alert("Ese toldo no está disponible");
      return;
    }
    setSelectedTent(c => (c && c.id === t.id ? null : t));
  };

  const onTentDown = (id) => {
    if (editingMap) setDragId(id);
  };

  const onMouseMove = throttle(async (e) => {
    if (!editingMap || dragId == null) return;
    const el = document.querySelector(".tents-abs");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let x = (e.clientX - rect.left) / rect.width;
    let y = (e.clientY - rect.top) / rect.height;
    x = Math.min(0.98, Math.max(0.02, x));
    y = Math.min(0.98, Math.max(0.02, y));
    const tentsUpd = data.tents.map(t =>
      t.id === dragId ? { ...t, x: +x.toFixed(4), y: +y.toFixed(4) } : t
    );
    setData(s => ({ ...s, tents: tentsUpd })); // preview local
  }, 150);

  const onMouseUp = async () => {
    if (!editingMap || dragId == null) return;
    const t = data.tents.find(x => x.id === dragId);
    await mergeState({ tents: data.tents }, `Mover toldo #${t?.id}`);
    setDragId(null);
  };

  // ===== Funciones de carrito =====
  const qtyOf = (itemId) =>
    cart.find(x => x.key === `extra:${itemId}`)?.qty || 0;

  const addOne = (it) =>
    setCart(s => {
      const key = `extra:${it.id}`;
      const ex = s.find(x => x.key === key);
      if (ex)
        return s.map(x =>
          x.key === key ? { ...x, qty: x.qty + 1 } : x
        );
      return [...s, { key, name: it.name, price: it.price, qty: 1 }];
    });

  const removeOne = (it) =>
    setCart(s =>
      s
        .map(x =>
          x.key === `extra:${it.id}`
            ? { ...x, qty: Math.max(0, x.qty - 1) }
            : x
        )
        .filter(x => x.qty > 0)
    );

  const delLine = (key) =>
    setCart(s => s.filter(x => x.key !== key));

  const emptyCart = () => setCart([]);

  // ===== Reservar toldo =====
  async function reservar() {
    if (!selectedTent) {
      alert("Selecciona un toldo disponible primero");
      return;
    }
    // Verifica que el toldo sigue disponible
    const t = data.tents.find(x => x.id === selectedTent.id);
    if (!t || t.state !== "av") {
      alert("Ese toldo ya no está disponible");
      return;
    }
    const expiresAt = addMinutesISO(HOLD_MINUTES);
    const reservation = {
      id: safeId(),
      tentId: selectedTent.id,
      status: "pending",
      createdAt: nowISO(),
      expiresAt,
      customer: {
        name: userForm.name || "",
        phone: `${userForm.phoneCountry}${(userForm.phone || "").replace(/[^0-9]/g, "")}`,
        email: userForm.email || "",
      },
      cart,
    };
    // Poner el toldo en "pr" (amarillo)
    const tentsUpd = data.tents.map(x =>
      x.id === t.id ? { ...x, state: "pr" } : x
    );
    const reservationsUpd = [reservation, ...(data.reservations || [])];
    await mergeState(
      { tents: tentsUpd, reservations: reservationsUpd },
      `Reserva creada toldo #${t.id}`
    );
    setMyPendingResId(reservation.id);
    setPayOpen(true);
  }

  async function releaseTent(tentId, resId, toState = "av", newStatus = "expired") {
    const tentsUpd = data.tents.map(t =>
      t.id === tentId ? { ...t, state: toState } : t
    );
    const resUpd = data.reservations.map(r =>
      r.id === resId ? { ...r, status: newStatus } : r
    );
    await mergeState(
      { tents: tentsUpd, reservations: resUpd },
      `Liberar toldo #${tentId}`
    );
    if (myPendingResId === resId) setMyPendingResId(null);
    if (selectedTent?.id === tentId && toState !== "pr") setSelectedTent(null);
  }

  async function confirmPaid(tentId, resId) {
    const tentsUpd = data.tents.map(t =>
      t.id === tentId ? { ...t, state: "oc" } : t
    );
    const resUpd = data.reservations.map(r =>
      r.id === resId ? { ...r, status: "paid" } : r
    );
    await mergeState(
      { tents: tentsUpd, reservations: resUpd },
      `Pago confirmado #${tentId}`
    );
    if (myPendingResId === resId) setMyPendingResId(null);
  }

  // ===== WhatsApp =====
  const openWhatsApp = () => {
    const num = (data.payments.whatsapp || "").replace(/[^0-9]/g, "");
    if (!num) {
      alert("Configura el número de WhatsApp en Admin → Pagos");
      return;
    }
    if (!selectedTent) {
      alert("Selecciona un toldo disponible primero");
      return;
    }
    if (!userForm.name || !userForm.phone) {
      alert("Completa tu nombre y teléfono.");
      return;
    }
    const cur = data.payments.currency || "USD";
    const extrasLines =
      cart.length > 0
        ? cart
            .map(
              x =>
                `• ${x.name} x${x.qty} — ${cur} ${(x.price * x.qty).toFixed(2)}`
            )
            .join("\n")
        : "• Sin extras";
    const metodo =
      payTab === "mp"
        ? "Mercado Pago"
        : payTab === "pm"
        ? "Pago Móvil"
        : payTab === "zelle"
        ? "Zelle"
        : "—";
    const fechaTxt =
      new Date().toLocaleDateString() +
      " " +
      new Date().toLocaleTimeString();
    const totalLine = `*Total estimado:* ${cur} ${total.toFixed(2)}${
      data.payments.usdToVES
        ? ` (Bs ${(total * (data.payments.usdToVES || 0)).toFixed(2)})`
        : ""
    }`;
    const phoneE164 = `${userForm.phoneCountry}${(
      userForm.phone || ""
    ).replace(/[^0-9]/g, "")}`;
    const msg = [
      `Hola 👋, me gustaría realizar una *reserva en ${
        data.brand?.name || "su establecimiento"
      }*.`,
      "",
      `*Código:* ${resCode}`,
      `*Toldo:* #${selectedTent?.id}`,
      `*Fecha/hora:* ${fechaTxt}`,
      "",
      "*Cliente*",
      `• Nombre: ${userForm.name}`,
      `• Teléfono (WhatsApp): ${phoneE164}`,
      userForm.email ? `• Email: ${userForm.email}` : null,
      "",
      "*Extras*",
      extrasLines,
      "",
      totalLine,
      `*Método de pago:* ${metodo}`,
      "",
      "Adjunto mi comprobante. ¿Podrían confirmar la reserva cuando esté verificado? ✅",
      "¡Muchas gracias! 🙌",
    ]
      .filter(Boolean)
      .join("\n");
    const txt = encodeURIComponent(msg);
    window.open(`https://wa.me/${num}?text=${txt}`, "_blank");
  };

  // ===== Handlers de Admin =====
  const onChangeBrandName = async (v) =>
    mergeState({ brand: { ...data.brand, name: v } }, "Editar marca");

  const onChangeLogoUrl = async (v) =>
    mergeState({ brand: { ...data.brand, logoUrl: v } }, "Editar logo");

  const onChangeLogoSize = async (v) =>
    mergeState(
      { brand: { ...data.brand, logoSize: v } },
      "Tamaño logo"
    );

  const onChangeBgPath = async (v) =>
    mergeState(
      { background: { ...data.background, publicPath: v } },
      "Editar fondo"
    );

  const onChangePayments = async (patch) =>
    mergeState(
      { payments: { usdToVES: 0, ...data.payments, ...patch } },
      "Editar pagos"
    );

  const regenGrid = async () => {
    const tents = makeGrid(data.layout.count || 20);
    await mergeState({ tents }, "Regenerar grilla");
  };

  // Hotkey: Alt/⌥ + A para abrir admin
  useEffect(() => {
    const onKey = (e) => {
      if (
        (e.key === "a" || e.key === "A") &&
        (e.altKey || e.metaKey)
      ) {
        setAdminOpen(true);
        setAuthed(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const bustLogo = `${data.brand.logoUrl || "/logo.png"}?v=${sessionRevParam}`;
  const bustMap = `${data.background.publicPath || "/Mapa.png"}?v=${sessionRevParam}`;

  // ===== JSX =====
  return (
    <div className="app-shell" onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
      <div className="phone">
        {/* Fondo */}
        <div className="bg" style={{ backgroundImage: `url('${bustMap}')` }} />
        {!bgOk && (
          <div className="bg-fallback">
            No se encontró el mapa en {data.background.publicPath}. Verifica nombre/capitalización o súbelo a /public.
          </div>
        )}

        {/* TOPBAR */}
        <div className="topbar" ref={topbarRef}>
          <img
            src={bustLogo}
            alt="logo"
            width={data.brand.logoSize}
            height={data.brand.logoSize}
            style={{
              objectFit: "contain",
              borderRadius: 12,
              filter: "drop-shadow(0 1px 2px rgba(0,0,0,.5))",
            }}
            onDoubleClick={() => {
              setAdminOpen(true);
              setAuthed(false);
            }}
            onError={(e) => {
              e.currentTarget.src = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='100%' height='100%' fill='%23131a22'/><text x='50%' y='55%' dominant-baseline='middle' text-anchor='middle' fill='%23cbd5e1' font-size='10'>LOGO</text></svg>`;
            }}
          />
          <div className="brand">{data.brand.name}</div>
          {myRes && remainingMs > 0 && (
            <div className="timer-inline" title="Reserva en proceso">
              <span className="timer-emoji">⏳</span>
              <span className="timer-text">
                {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
              </span>
            </div>
          )}
          <div className="spacer" />
          {/* Leyenda */}
          <div className="legend" style={{ top: `${topInsetPx}px` }}>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>Estados</div>
            <div className="row">
              <span className="dot av"></span> Disponible
            </div>
            <div className="row">
              <span className="dot pr"></span> En proceso
            </div>
            <div className="row">
              <span className="dot oc"></span> Ocupada
            </div>
            <div className="row">
              <span className="dot bl"></span> Bloqueada
            </div>
          </div>
          <button
            className="iconbtn"
            title="Admin"
            onClick={() => {
              setAdminOpen(true);
              setAuthed(false);
            }}
          >
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path
                fill="#cbd5e1"
                d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 1h-3.8a.5.5 0 0 0-.49.41l-.36 2.54c-.58.22-1.13.52-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.81 7.97a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.69.22l2.39-.96c.5.42 1.05.72 1.63.94l.36 2.54c.04.24.25.41.49.41h3.8c.24 0 .45-.17.49-.41l.36-2.54c.58-.22 1.13-.52 1.63-.94l2.39.96c.26.12.55.02.69-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
              />
            </svg>
          </button>
        </div>

        {/* TOLDOS ABSOLUTOS */}
        <div
          className="tents-abs"
          style={{ inset: `${topInsetPx}px 12px 12px 12px` }}
        >
          {data.tents.map((t) => (
            <div
              key={t.id}
              className={`tent ${t.state} ${
                selectedTent?.id === t.id ? "selected" : ""
              }`}
              style={{
                left: `${t.x * 100}%`,
                top: `${t.y * 100}%`,
              }}
              title={`Toldo ${t.id}`}
              onMouseDown={() => onTentDown(t.id)}
              onClick={() => onTentClick(t)}
            >
              {t.id}
            </div>
          ))}
        </div>

        {/* SHEET INFERIOR */}
        {!editingMap && (
          <div className={`sheet ${sheetCollapsed ? "collapsed" : ""}`}>
            <div className="sheet-header">
              <div
                className={`tab ${
                  sheetTab === "toldo" ? "active" : ""
                }`}
                onClick={() => setSheetTab("toldo")}
              >
                Toldo
              </div>
              <div
                className={`tab ${
                  sheetTab === "extras" ? "active" : ""
                }`}
                onClick={() => setSheetTab("extras")}
              >
                Extras
              </div>
              <div
                className={`tab ${
                  sheetTab === "carrito" ? "active" : ""
                }`}
                onClick={() => setSheetTab("carrito")}
              >
                Carrito
              </div>
              <div className="spacer"></div>
              <button
                className="iconbtn"
                title={sheetCollapsed ? "Expandir" : "Colapsar"}
                onClick={() => setSheetCollapsed((v) => !v)}
              >
                {sheetCollapsed ? "▲" : "▼"}
              </button>
            </div>
            <div className="sheet-body">
              {sheetTab === "toldo" && (
                <div className="list">
                  <div className="item">
                    <div className="title">Reservar Toldo</div>
                    <div className="hint" style={{ marginTop: 6 }}>
                      Toca un toldo <b>disponible</b> en el mapa. Luego pulsa
                      “Continuar”.
                    </div>
                    <div style={{ marginTop: 8 }}>
                      {selectedTent ? (
                        <div>
                          Seleccionado: <b>Toldo {selectedTent.id}</b>
                        </div>
                      ) : (
                        <div className="hint">Ningún toldo seleccionado</div>
                      )}
                    </div>
                    <div
                      className="row"
                      style={{ marginTop: 8, gap: 8 }}
                    >
                      <button
                        className="btn"
                        onClick={() => {
                          if (!selectedTent) return;
                          setSelectedTent(null);
                          emptyCart();
                        }}
                      >
                        Quitar selección
                      </button>
                      <button
                        className="btn primary"
                        disabled={!selectedTent}
                        onClick={() => setSheetTab("extras")}
                        title={
                          !selectedTent
                            ? "Primero selecciona un toldo"
                            : ""
                        }
                      >
                        Continuar a Extras
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {sheetTab === "extras" && (
                <div className="list">
                  {data.categories.map((cat) => (
                    <div key={cat.id} className="item">
                      <div
                        className="title"
                        style={{ marginBottom: 6 }}
                      >
                        {cat.name}
                      </div>
                      <div className="list">
                        {cat.items.length === 0 ? (
                          <div className="hint">Sin ítems</div>
                        ) : (
                          cat.items.map((it) => (
                            <div
                              key={it.id}
                              className="row"
                              style={{
                                justifyContent: "space-between",
                              }}
                            >
                              <div className="row" style={{ gap: 8 }}>
                                {it.img && (
                                  <img
                                    src={`${it.img}?v=${sessionRevParam}`}
                                    alt=""
                                    className="thumb"
                                  />
                                )}
                                <div>
                                  {it.name}{" "}
                                  <span className="hint">
                                    ${it.price.toFixed(2)}
                                  </span>
                                </div>
                              </div>
                              <div className="row">
                                <button
                                  className="btn"
                                  onClick={() => removeOne(it)}
                                >
                                  -
                                </button>
                                <div className="btn alt">
                                  {qtyOf(it.id)}
                                </div>
                                <button
                                  className="btn"
                                  onClick={() => addOne(it)}
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {sheetTab === "carrito" && (
                <div className="list">
                  {!selectedTent && cart.length === 0 && (
                    <div className="hint">
                      Aún no seleccionas toldo ni extras.
                    </div>
                  )}
                  {selectedTent && (
                    <div className="item">
                      <div className="title">Toldo seleccionado</div>
                      <div>
                        Toldo <b>#{selectedTent.id}</b>
                      </div>
                    </div>
                  )}
                  {cart.length > 0 && (
                    <div class conclusion.
