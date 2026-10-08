/* ═══════════════════════════════════════════════════════════════
   ARTE PLATAXCO — ERP (app.js)
   Admin: productos, inventario, ventas, gráficas, vendedores,
          pedidos web, banners, tema y reseñas.
   Vendedor: registrar venta + su propio historial.
   Todo en tiempo real con Firestore (colecciones "ap_*").
═══════════════════════════════════════════════════════════════ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import {
  getFirestore, collection, doc, onSnapshot, query, orderBy, where, limit,
  setDoc, addDoc, getDoc, getDocs, updateDoc, deleteDoc, writeBatch, runTransaction,
  serverTimestamp, Timestamp, increment
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import {
  getAuth, initializeAuth, inMemoryPersistence, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import {
  getStorage, ref as sRef, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-storage.js";

/* ── CONFIGURACIÓN ───────────────────────────────────────────── */
const firebaseConfig = {
  apiKey: "AIzaSyAnq1OZavOTquMPyLs_etqA0qystCd7rMI",
  authDomain: "oracles-99bc3.firebaseapp.com",
  projectId: "oracles-99bc3",
  storageBucket: "oracles-99bc3.firebasestorage.app",
  messagingSenderId: "785165056789",
  appId: "1:785165056789:web:65de548f1e14331f0d871c",
  measurementId: "G-RZTQGQZ361"
};
const ADMIN_UID = "GmoVWbYskzMA51DxghPVcyhdgEA3";

const COL = {
  productos:  "ap_productos",
  privado:    "ap_productos_privado",   // costo por pieza (solo admin)
  ventas:     "ap_ventas",
  vendedores: "ap_vendedores",
  pedidos:    "ap_pedidos",
  banners:    "ap_banners",
  resenas:    "ap_resenas",
  config:     "ap_config",
  presencia:  "ap_presencia"
};
const CATS = [["anillos", "Anillos"], ["pulsos", "Pulsos"], ["cadenas", "Cadenas"], ["aretes", "Aretes"], ["dijes", "Dijes"], ["conjuntos", "Conjuntos"], ["otros", "Otros"]];
const CAT_LABEL = Object.fromEntries(CATS);
const TAGS = [["promocion", "tgPromo", "Promoción"], ["nuevo", "tgNuevo", "Nuevo"], ["piezaUnica", "tgUnica", "Pieza única"], ["edicionLimitada", "tgLim", "Ed. limitada"], ["masVendido", "tgTop", "Más vendido"]];
const SERIES = ["#3987e5", "#d95926"]; // validadas para fondo oscuro (daltonismo incluido)

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
storage.maxUploadRetryTime = 15000;
storage.maxOperationRetryTime = 15000;

// App secundaria: crea cuentas de vendedores sin cerrar la sesión del admin
const secApp = initializeApp(firebaseConfig, "alta-vendedores");
const secAuth = initializeAuth(secApp, { persistence: inMemoryPersistence });

/* ── UTILIDADES ──────────────────────────────────────────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const numOrNull = v => (v === "" || v == null || !isFinite(parseFloat(v))) ? null : parseFloat(v);
const money = n => { const v = Math.round(Number(n || 0) * 100) / 100, d = Number.isInteger(v) ? 0 : 2; return "$" + v.toLocaleString("es-MX", { minimumFractionDigits: d, maximumFractionDigits: d }); };
const moneyShort = n => { const a = Math.abs(n); return a >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : a >= 1e4 ? "$" + Math.round(n / 1e3) + "k" : money(n); };
const toDate = v => v?.toDate ? v.toDate() : v instanceof Date ? v : v ? new Date(v) : null;
const fmtDT = v => { const d = toDate(v); return d ? d.toLocaleString("es-MX", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"; };
const fmtD = v => { const d = toDate(v); return d ? d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "—"; };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const PLACEHOLDER = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#151518"/><path d="M50 28l14 14-14 30-14-30z" fill="none" stroke="#3a3830" stroke-width="2"/></svg>');
const imgOf = p => (p && ((Array.isArray(p.imagenes) && p.imagenes[0]) || p.imageUrl)) || PLACEHOLDER;
const stockOf = p => Math.max(0, Math.floor(num(p?.cantidad)));
const isAdmin = () => S.role === "admin";

function toast(msg, err = false) {
  const t = $("#toast"); t.textContent = msg; t.classList.toggle("err", err); t.classList.add("on");
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("on"), 3200);
}
const loading = on => $("#loading").classList.toggle("on", on);
const fbErr = e => {
  const c = e?.code || "";
  if (c.includes("permission-denied")) return "Sin permiso. Revisa las reglas de Firestore.";
  if (c.includes("unavailable")) return "Sin conexión. Intenta de nuevo.";
  return e?.message || "Ocurrió un error";
};

/* ── MODALES ─────────────────────────────────────────────────── */
function openModal(m) { m.classList.add("open"); document.body.style.overflow = "hidden"; }
function closeModal(m) { m.classList.remove("open"); if (!$(".modal.open")) document.body.style.overflow = ""; m.dispatchEvent(new Event("closed")); }
$$(".modal").forEach(m => {
  m.addEventListener("click", e => { if (e.target === m || e.target.closest("[data-close]")) closeModal(m); });
});
document.addEventListener("keydown", e => { if (e.key === "Escape") $$(".modal.open").forEach(closeModal); });

/** Diálogo genérico. Devuelve true/false. El cuerpo puede contener campos que se leen antes de cerrar. */
function dialog({ title, body, ok = "Aceptar", danger = false, onOk }) {
  return new Promise(resolve => {
    const m = $("#dlg");
    $("#dlgTitle").textContent = title;
    $("#dlgBody").innerHTML = body;
    const okBtn = $("#dlgOk");
    okBtn.textContent = ok; okBtn.className = "btn " + (danger ? "danger" : "gold");
    let done = false;
    const finish = v => { if (done) return; done = true; okBtn.onclick = null; resolve(v); };
    okBtn.onclick = () => { const v = onOk ? onOk() : true; if (v === false) return; finish(v === undefined ? true : v); closeModal(m); };
    m.addEventListener("closed", () => finish(false), { once: true });
    openModal(m);
  });
}

/* ═══════════════════════════════════════════════════════════════
   ESTADO + SESIÓN
═══════════════════════════════════════════════════════════════ */
const S = {
  role: null, me: null,
  products: new Map(), costs: new Map(), sales: [], vendors: new Map(),
  orders: [], banners: [], reviews: [], tema: "",
  unsubs: [], view: null, range: 30, sel: null, pedFilter: "pendiente"
};

$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("#lgBtn"); btn.disabled = true; $("#lgMsg").textContent = "";
  try { await signInWithEmailAndPassword(auth, $("#lgEmail").value.trim(), $("#lgPass").value); }
  catch { $("#lgMsg").textContent = "Correo o contraseña incorrectos."; }
  btn.disabled = false;
});
$("#lgForgot").onclick = async () => {
  const email = $("#lgEmail").value.trim();
  if (!email) { $("#lgMsg").textContent = "Escribe tu correo arriba y vuelve a tocar aquí."; return; }
  try { await sendPasswordResetEmail(auth, email); $("#lgMsg").textContent = "Te enviamos un correo para restablecer tu contraseña."; }
  catch { $("#lgMsg").textContent = "No se pudo enviar el correo."; }
};
$("#logoutBtn").onclick = () => signOut(auth);

onAuthStateChanged(auth, async user => {
  teardown();
  if (!user) { showLogin(); return; }
  loading(true);
  try {
    if (user.uid === ADMIN_UID) {
      S.role = "admin"; S.me = { uid: user.uid, nombre: "Administrador", email: user.email };
    } else {
      const v = await getDoc(doc(db, COL.vendedores, user.uid));
      if (!v.exists() || v.data().activo === false) {
        $("#lgMsg").textContent = "Esta cuenta no tiene acceso al ERP.";
        await signOut(auth); loading(false); return;
      }
      S.role = "vendedor"; S.me = { uid: user.uid, nombre: v.data().nombre || user.email, email: user.email, comision: num(v.data().comision) };
    }
    startApp();
  } catch (e) {
    $("#lgMsg").textContent = fbErr(e); await signOut(auth);
  }
  loading(false);
});

function showLogin() {
  $("#appView").classList.add("hidden"); $("#loginView").classList.remove("hidden");
  $("#lgPass").value = "";
}
function teardown() {
  S.unsubs.forEach(u => { try { u(); } catch {} }); S.unsubs = [];
  S.products.clear(); S.costs.clear(); S.sales = []; S.vendors.clear(); S.orders = []; S.banners = []; S.reviews = [];
  S.role = null; S.me = null; S.sel = null;
  Object.values(charts).forEach(c => c.destroy()); for (const k in charts) delete charts[k];
}

/* ═══════════════════════════════════════════════════════════════
   ARRANQUE + ESCUCHAS EN TIEMPO REAL
═══════════════════════════════════════════════════════════════ */
function startApp() {
  $("#loginView").classList.add("hidden"); $("#appView").classList.remove("hidden");
  $("#uName").textContent = S.me.nombre;
  $("#uRole").textContent = isAdmin() ? "Administrador" : "Vendedor";
  $("#uAvatar").textContent = (S.me.nombre || "A").trim().charAt(0).toUpperCase();
  $$("#sideNav [data-role=admin]").forEach(b => b.classList.toggle("hidden", !isAdmin()));
  $$("[data-label-vendor]").forEach(el => { if (!el.dataset.labelAdmin) el.dataset.labelAdmin = el.textContent; el.textContent = isAdmin() ? el.dataset.labelAdmin : el.dataset.labelVendor; });
  $("#vfSellerWrap").classList.toggle("hidden", !isAdmin());
  $("#sfSellerWrap").classList.toggle("hidden", !isAdmin());
  initFilters();

  const est = { serverTimestamps: "estimate" };
  const on = (q, fn) => S.unsubs.push(onSnapshot(q, fn, e => { console.error(e); toast(fbErr(e), true); }));

  on(query(collection(db, COL.productos), orderBy("creadoEn", "desc")), snap => {
    S.products.clear(); snap.forEach(d => S.products.set(d.id, { id: d.id, ...d.data(est) })); schedule();
  });

  if (isAdmin()) {
    on(collection(db, COL.privado), snap => { S.costs.clear(); snap.forEach(d => S.costs.set(d.id, d.data())); schedule(); });
    on(query(collection(db, COL.ventas), orderBy("fecha", "desc")), snap => { S.sales = snap.docs.map(d => ({ id: d.id, ...d.data(est) })); schedule(); });
    on(collection(db, COL.vendedores), snap => { S.vendors.clear(); snap.forEach(d => S.vendors.set(d.id, { id: d.id, ...d.data(est) })); schedule(); });
    on(query(collection(db, COL.pedidos), orderBy("creadoEn", "desc")), snap => { S.orders = snap.docs.map(d => ({ id: d.id, ...d.data(est) })); schedule(); });
    on(query(collection(db, COL.banners), orderBy("creadoEn", "desc")), snap => { S.banners = snap.docs.map(d => ({ id: d.id, ...d.data(est) })); schedule(); });
    on(query(collection(db, COL.resenas), orderBy("creadoEn", "desc")), snap => { S.reviews = snap.docs.map(d => ({ id: d.id, ...d.data(est) })); schedule(); });
    on(doc(db, COL.config, "tematica"), snap => { S.tema = snap.exists() ? (snap.data().tema || "") : ""; schedule(); });
    cleanPresence();
  } else {
    on(query(collection(db, COL.ventas), where("vendedorId", "==", S.me.uid)), snap => {
      S.sales = snap.docs.map(d => ({ id: d.id, ...d.data(est) })).sort((a, b) => (toDate(b.fecha) || 0) - (toDate(a.fecha) || 0));
      schedule();
    });
    on(doc(db, COL.vendedores, S.me.uid), snap => {
      if (!snap.exists() || snap.data().activo === false) { toast("Tu acceso fue desactivado.", true); signOut(auth); }
    });
  }

  let last = null; try { last = localStorage.getItem("apErpView"); } catch {}
  const allowed = $$("#sideNav button").filter(b => !b.classList.contains("hidden")).map(b => b.dataset.view);
  go(allowed.includes(last) ? last : (isAdmin() ? "dashboard" : "vender"));
}

// Borra latidos viejos de visitantes de la tienda (mantiene la colección ligera)
async function cleanPresence() {
  try {
    const old = await getDocs(query(collection(db, COL.presencia), where("ts", "<", Timestamp.fromMillis(Date.now() - 86400000)), limit(400)));
    if (old.empty) return;
    const b = writeBatch(db); old.forEach(d => b.delete(d.ref)); await b.commit();
  } catch {}
}

/* ── NAVEGACIÓN ──────────────────────────────────────────────── */
const TITLES = { dashboard: "Panel", vender: "Registrar venta", ventas: "Historial de ventas", productos: "Productos", pedidos: "Pedidos web", vendedores: "Vendedores", tienda: "Tienda en línea" };
function go(view) {
  S.view = view;
  try { localStorage.setItem("apErpView", view); } catch {}
  $$("#sideNav button").forEach(b => b.classList.toggle("on", b.dataset.view === view));
  $$(".view").forEach(v => v.classList.toggle("on", v.dataset.view === view));
  $("#viewTitle").textContent = view === "ventas" && !isAdmin() ? "Mis ventas" : TITLES[view];
  document.body.classList.remove("nav-open");
  window.scrollTo(0, 0);
  render();
}
$$("#sideNav button").forEach(b => b.addEventListener("click", () => go(b.dataset.view)));
$("#burger").onclick = () => document.body.classList.toggle("nav-open");
$("#sideBackdrop").onclick = () => document.body.classList.remove("nav-open");

let rafId = 0;
function schedule() { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(render); }
function render() {
  if (!S.role) return;
  const pend = S.orders.filter(o => o.estado === "pendiente").length;
  const pb = $("#pedBadge"); pb.textContent = pend; pb.classList.toggle("on", pend > 0);
  ({ dashboard: renderDashboard, vender: renderSell, ventas: renderSales, productos: renderProducts, pedidos: renderOrders, vendedores: renderVendors, tienda: renderStore }[S.view] || (() => {}))();
}

/* ── cálculos compartidos ───────────────────────────────────── */
const costOf = s => s.costoUnit != null ? num(s.costoUnit) : S.costs.get(s.productoId)?.costo != null ? num(S.costs.get(s.productoId).costo) : null;
const profitOf = s => { const c = costOf(s); return c == null ? null : num(s.total) - c * num(s.cantidad); };
const okSales = () => S.sales.filter(s => s.estado !== "cancelada");
const sellerLabel = s => s.canal === "tienda" ? "Tienda en línea" : (s.vendedorNombre || "—");

/* ═══════════════════════════════════════════════════════════════
   PANEL (DASHBOARD)
═══════════════════════════════════════════════════════════════ */
const charts = {};
$$("#rangeSeg button").forEach(b => b.addEventListener("click", () => {
  S.range = +b.dataset.r; $$("#rangeSeg button").forEach(x => x.classList.toggle("on", x === b)); renderDashboard();
}));

function renderDashboard() {
  const now = new Date(), r = S.range;
  const from = r ? startOfDay(new Date(now.getTime() - (r - 1) * 86400000)) : null;
  const prevFrom = r ? new Date(from.getTime() - r * 86400000) : null;
  const all = okSales();
  const inRange = all.filter(s => !from || toDate(s.fecha) >= from);
  const prev = r ? all.filter(s => { const d = toDate(s.fecha); return d >= prevFrom && d < from; }) : [];

  const sum = (arr, f) => arr.reduce((a, s) => a + f(s), 0);
  const ingresos = sum(inRange, s => num(s.total));
  const ingresosPrev = sum(prev, s => num(s.total));
  const costoVendido = sum(inRange, s => (costOf(s) ?? 0) * num(s.cantidad));
  const sinCosto = inRange.filter(s => costOf(s) == null).length;
  const ganancia = ingresos - costoVendido;
  const piezas = sum(inRange, s => num(s.cantidad));
  const ticket = inRange.length ? ingresos / inRange.length : 0;

  let inversion = 0, valor = 0, piezasStock = 0, gramos = 0;
  S.products.forEach(p => {
    const st = stockOf(p), c = num(S.costs.get(p.id)?.costo);
    inversion += st * c; valor += st * num(p.precio); piezasStock += st; gramos += st * num(p.pesoGramos);
  });
  const pend = S.orders.filter(o => o.estado === "pendiente").length;
  const delta = r && ingresosPrev > 0 ? Math.round((ingresos - ingresosPrev) / ingresosPrev * 100) : null;

  const kpi = (label, value, note = "", cls = "") => `<div class="kpi"><small>${label}</small><b>${value}</b>${note ? `<em class="${cls}">${note}</em>` : ""}</div>`;
  $("#kpis").innerHTML =
    kpi("Ingresos", money(ingresos), delta == null ? (r ? "sin periodo previo" : "todo el historial") : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% vs. periodo anterior`, delta == null ? "" : delta >= 0 ? "up" : "down") +
    kpi("Ganancia", money(ganancia), ingresos ? `margen ${Math.round(ganancia / ingresos * 100)}%${sinCosto ? ` · ${sinCosto} venta(s) sin costo` : ""}` : (sinCosto ? `${sinCosto} venta(s) sin costo` : "")) +
    kpi("Piezas vendidas", piezas.toLocaleString("es-MX"), `${inRange.length} venta(s)`) +
    kpi("Ticket promedio", money(Math.round(ticket)), "por venta") +
    kpi("Inversión en inventario", money(inversion), `${piezasStock} pieza(s) en stock`) +
    kpi("Valor de venta del stock", money(valor), `ganancia potencial ${money(valor - inversion)}`) +
    kpi("Peso en stock", gramos.toLocaleString("es-MX", { maximumFractionDigits: 1 }) + " g", "material en inventario") +
    kpi("Pedidos web pendientes", pend, pend ? "por confirmar" : "al día", pend ? "down" : "up");

  if (!window.Chart) { $$(".chart-box").forEach(b => { if (!b.querySelector(".empty-chart")) b.insertAdjacentHTML("beforeend", '<div class="empty-chart">No se pudo cargar la librería de gráficas</div>'); }); }
  else {
    drawTrend(inRange, from);
    drawCats(inRange);
    drawInventory();
    drawTop(inRange);
    drawSellers(inRange);
  }

  // stock bajo
  const low = [...S.products.values()].filter(p => stockOf(p) <= 1 && p.porPedido !== true).sort((a, b) => stockOf(a) - stockOf(b));
  $("#lowStock").innerHTML = low.length
    ? `<thead><tr><th>Pieza</th><th>Categoría</th><th class="num">Stock</th><th class="num">Precio</th><th></th></tr></thead><tbody>${low.slice(0, 12).map(p => `
      <tr><td data-l="Pieza"><div class="pname"><img class="thumb" src="${esc(imgOf(p))}" alt="">${esc(p.nombre)}</div></td><td data-l="Categoría">${esc(CAT_LABEL[p.categoria] || "—")}</td>
      <td data-l="Stock" class="num">${stockOf(p) === 0 ? '<span class="chip r">Agotado</span>' : '<span class="chip y">1</span>'}</td><td data-l="Precio" class="num">${money(p.precio)}</td>
      <td class="num act"><button class="btn sm ghost" data-edit="${p.id}">Editar</button></td></tr>`).join("")}</tbody>`
    : `<tbody><tr><td class="empty">Todo el inventario tiene más de una pieza o es bajo pedido.</td></tr></tbody>`;
  $$("#lowStock [data-edit]").forEach(b => b.onclick = () => openProduct(b.dataset.edit));
}

/* ── Chart.js: estilo base ── */
function chartBase() {
  const C = window.Chart;
  C.defaults.color = "#a8a49c";
  C.defaults.font.family = "Jost, system-ui, sans-serif";
  C.defaults.font.size = 11;
  C.defaults.borderColor = "rgba(255,255,255,.06)";
  C.defaults.plugins.tooltip.backgroundColor = "#0b0b0d";
  C.defaults.plugins.tooltip.borderColor = "rgba(212,175,55,.3)";
  C.defaults.plugins.tooltip.borderWidth = 1;
  C.defaults.plugins.tooltip.titleColor = "#f0ede8";
  C.defaults.plugins.tooltip.bodyColor = "#f0ede8";
  C.defaults.plugins.tooltip.padding = 10;
  C.defaults.plugins.tooltip.boxPadding = 4;
  C.defaults.plugins.legend.display = false;
  C.defaults.maintainAspectRatio = false;
}
let chartReady = false;
function upsertChart(id, cfg, empty) {
  const canvas = document.getElementById(id), box = canvas.parentElement;
  box.querySelector(".empty-chart")?.remove();
  if (empty) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    box.insertAdjacentHTML("beforeend", `<div class="empty-chart">${empty}</div>`); return;
  }
  if (!chartReady) { chartBase(); chartReady = true; }
  if (charts[id] && charts[id].config.type === cfg.type) { charts[id].data = cfg.data; charts[id].options = cfg.options; charts[id].update("none"); }
  else { charts[id]?.destroy(); charts[id] = new window.Chart(canvas, cfg); }
}
const axisMoney = { ticks: { callback: v => moneyShort(v) }, grid: { color: "rgba(255,255,255,.05)" }, border: { display: false } };
const axisPlain = { grid: { display: false }, border: { color: "rgba(255,255,255,.12)" } };
const moneyTip = { callbacks: { label: c => ` ${c.dataset.label}: ${money(c.parsed.y ?? c.parsed.x)}` } };
const legendHtml = items => items.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join("");

function drawTrend(list, from) {
  const dates = list.map(s => toDate(s.fecha)).filter(Boolean);
  const start = from || (dates.length ? startOfDay(new Date(Math.min(...dates))) : startOfDay(new Date()));
  const spanDays = Math.max(1, Math.ceil((Date.now() - start) / 86400000));
  const unit = spanDays <= 31 ? "day" : spanDays <= 120 ? "week" : "month";
  const keyOf = d => {
    if (unit === "day") return ymd(d);
    if (unit === "week") { const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x); }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  // eje continuo (incluye días sin ventas)
  const keys = [], labels = [];
  const cur = startOfDay(start);
  if (unit === "week") cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7));
  if (unit === "month") cur.setDate(1);
  while (cur <= new Date()) {
    const k = keyOf(cur); if (!keys.includes(k)) { keys.push(k);
      labels.push(unit === "month" ? cur.toLocaleDateString("es-MX", { month: "short", year: "2-digit" }) : cur.toLocaleDateString("es-MX", { day: "numeric", month: "short" })); }
    if (unit === "day") cur.setDate(cur.getDate() + 1); else if (unit === "week") cur.setDate(cur.getDate() + 7); else cur.setMonth(cur.getMonth() + 1);
  }
  const inc = Object.fromEntries(keys.map(k => [k, 0])), pro = Object.fromEntries(keys.map(k => [k, 0]));
  list.forEach(s => { const d = toDate(s.fecha); if (!d) return; const k = keyOf(d); if (k in inc) { inc[k] += num(s.total); pro[k] += num(s.total) - (costOf(s) ?? 0) * num(s.cantidad); } });
  $("#chTrendSub").textContent = { day: "por día", week: "por semana", month: "por mes" }[unit];
  $("#lgTrend").innerHTML = legendHtml([[SERIES[0], "Ingresos"], [SERIES[1], "Ganancia"]]);
  upsertChart("chTrend", {
    type: "line",
    data: { labels, datasets: [
      { label: "Ingresos", data: keys.map(k => inc[k]), borderColor: SERIES[0], backgroundColor: SERIES[0], borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBorderColor: "#0f0f11", pointHoverBorderWidth: 2, cubicInterpolationMode: "monotone" },
      { label: "Ganancia", data: keys.map(k => pro[k]), borderColor: SERIES[1], backgroundColor: SERIES[1], borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBorderColor: "#0f0f11", pointHoverBorderWidth: 2, cubicInterpolationMode: "monotone" }
    ] },
    options: { interaction: { mode: "index", intersect: false }, plugins: { tooltip: moneyTip },
      scales: { x: { ...axisPlain, ticks: { maxRotation: 0, autoSkipPadding: 14 } }, y: { ...axisMoney, beginAtZero: true } } }
  }, list.length ? null : "Aún no hay ventas en este periodo");
}

function hbar(id, labels, data, label, fmt, empty) {
  upsertChart(id, {
    type: "bar",
    data: { labels, datasets: [{ label, data, backgroundColor: SERIES[0], borderRadius: 4, borderSkipped: "start", maxBarThickness: 22 }] },
    options: { indexAxis: "y", plugins: { tooltip: { callbacks: { label: c => ` ${label}: ${fmt(c.parsed.x)}` } } },
      scales: { x: { ...axisMoney, ticks: { callback: v => fmt === money ? moneyShort(v) : v, precision: 0 }, beginAtZero: true }, y: { ...axisPlain, ticks: { callback(v) { const s = this.getLabelForValue(v); return s.length > 22 ? s.slice(0, 21) + "…" : s; } } } } }
  }, labels.length ? null : empty);
}
function drawCats(list) {
  const m = {}; list.forEach(s => { const k = CAT_LABEL[s.categoria] || "Otros"; m[k] = (m[k] || 0) + num(s.total); });
  const rows = Object.entries(m).sort((a, b) => b[1] - a[1]);
  hbar("chCat", rows.map(r => r[0]), rows.map(r => r[1]), "Ingresos", money, "Sin ventas en este periodo");
}
function drawTop(list) {
  const m = {}; list.forEach(s => { const k = s.productoNombre || "—"; m[k] = (m[k] || 0) + num(s.cantidad); });
  const rows = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8);
  hbar("chTop", rows.map(r => r[0]), rows.map(r => r[1]), "Piezas", v => v + " pz", "Sin ventas en este periodo");
}
function drawSellers(list) {
  const m = {}; list.forEach(s => { const k = sellerLabel(s); m[k] = (m[k] || 0) + num(s.total); });
  const rows = Object.entries(m).sort((a, b) => b[1] - a[1]);
  hbar("chSeller", rows.map(r => r[0]), rows.map(r => r[1]), "Ingresos", money, "Sin ventas en este periodo");
}
function drawInventory() {
  const inv = {}, val = {};
  S.products.forEach(p => { const k = CAT_LABEL[p.categoria] || "Otros", st = stockOf(p); inv[k] = (inv[k] || 0) + st * num(S.costs.get(p.id)?.costo); val[k] = (val[k] || 0) + st * num(p.precio); });
  const labels = Object.keys(val).filter(k => val[k] > 0 || inv[k] > 0).sort((a, b) => val[b] - val[a]);
  $("#lgInv").innerHTML = legendHtml([[SERIES[0], "Inversión (costo)"], [SERIES[1], "Valor a precio de venta"]]);
  upsertChart("chInv", {
    type: "bar",
    data: { labels, datasets: [
      { label: "Inversión", data: labels.map(k => inv[k]), backgroundColor: SERIES[0], borderRadius: 4, borderSkipped: "start", maxBarThickness: 26 },
      { label: "Valor de venta", data: labels.map(k => val[k]), backgroundColor: SERIES[1], borderRadius: 4, borderSkipped: "start", maxBarThickness: 26 }
    ] },
    options: { plugins: { tooltip: moneyTip }, datasets: { bar: { categoryPercentage: .7, barPercentage: .9 } },
      scales: { x: { ...axisPlain, ticks: { maxRotation: 0 } }, y: { ...axisMoney, beginAtZero: true } } }
  }, labels.length ? null : "Sin piezas en inventario");
}

/* ═══════════════════════════════════════════════════════════════
   REGISTRAR VENTA
═══════════════════════════════════════════════════════════════ */
$("#sfSearch").addEventListener("input", () => renderPickList());
$$(".stepper button").forEach(b => b.addEventListener("click", () => { const i = $("#sfQty"); i.value = Math.max(1, (parseInt(i.value, 10) || 1) + +b.dataset.st); clampQty(); updateTotal(); }));
$("#sfQty").addEventListener("input", () => { clampQty(); updateTotal(); });
$("#sfPrice").addEventListener("input", updateTotal);

function renderSell() {
  renderPickList();
  renderPicked();
  // selector de vendedor (admin)
  if (isAdmin()) {
    const sel = $("#sfSeller"), cur = sel.value;
    sel.innerHTML = `<option value="${ADMIN_UID}">Administrador</option>` + [...S.vendors.values()].filter(v => v.activo !== false).map(v => `<option value="${v.id}">${esc(v.nombre)}</option>`).join("");
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  }
  // ventas de hoy
  const today = startOfDay(new Date());
  const list = okSales().filter(s => toDate(s.fecha) >= today);
  $("#recentTitle").textContent = isAdmin() ? "Ventas de hoy" : "Mis ventas de hoy";
  $("#todayKpis").innerHTML = `<div><small>Ventas</small><b>${list.length}</b></div><div><small>Piezas</small><b>${list.reduce((a, s) => a + num(s.cantidad), 0)}</b></div><div><small>Total</small><b>${money(list.reduce((a, s) => a + num(s.total), 0))}</b></div>`;
  $("#recentFeed").innerHTML = list.length ? list.slice(0, 15).map(s => `
    <div class="feed-item"><img src="${esc(imgOf(S.products.get(s.productoId)) || PLACEHOLDER)}" alt="">
      <div class="fi"><b>${esc(s.productoNombre)}</b><small>${s.cantidad} pz · ${esc(sellerLabel(s))} · ${toDate(s.fecha)?.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) || ""}</small></div>
      <div class="fv">${money(s.total)}</div></div>`).join("")
    : `<p class="muted small">Aún no hay ventas hoy.</p>`;
}
function renderPickList() {
  const q = $("#sfSearch").value.trim().toLowerCase();
  const list = [...S.products.values()]
    .filter(p => !q || [p.nombre, p.material, CAT_LABEL[p.categoria]].some(v => String(v || "").toLowerCase().includes(q)))
    .sort((a, b) => (stockOf(b) > 0 || b.porPedido) - (stockOf(a) > 0 || a.porPedido) || String(a.nombre).localeCompare(String(b.nombre)));
  $("#sfList").innerHTML = list.length ? list.map(p => {
    const out = stockOf(p) === 0 && p.porPedido !== true;
    return `<button type="button" class="pick ${out ? "out" : ""} ${S.sel === p.id ? "on" : ""}" data-id="${p.id}" ${out ? "disabled" : ""}>
      <img src="${esc(imgOf(p))}" alt="" loading="lazy"><div class="pi"><b>${esc(p.nombre)}</b><small>${out ? "Agotado" : stockOf(p) ? stockOf(p) + " en stock" : "Bajo pedido"} · ${esc(CAT_LABEL[p.categoria] || "Otros")}${p.pesoGramos ? " · " + p.pesoGramos + " g" : ""}</small></div>
      <span class="pp">${money(p.precio)}</span></button>`;
  }).join("") : `<p class="muted small" style="padding:14px">No hay productos que coincidan.</p>`;
  $$("#sfList .pick").forEach(b => b.onclick = () => { S.sel = b.dataset.id; const p = S.products.get(S.sel); $("#sfQty").value = 1; $("#sfPrice").value = num(p.precio); renderPickList(); renderPicked(); });
}
function renderPicked() {
  const p = S.products.get(S.sel);
  if (!p) { S.sel = null; $("#sfPicked").innerHTML = `<p class="muted">Selecciona una pieza de la lista.</p>`; $("#sfQtyHint").textContent = ""; updateTotal(); return; }
  const st = stockOf(p);
  $("#sfPicked").innerHTML = `<img src="${esc(imgOf(p))}" alt=""><div><b>${esc(p.nombre)}</b><small>${esc(p.material || "")}${p.pesoGramos ? " · " + p.pesoGramos + " g" : ""} · Precio lista ${money(p.precio)}</small></div>`;
  $("#sfQtyHint").textContent = st ? `${st} disponible(s)` : "Bajo pedido (sin stock)";
  clampQty(); updateTotal();
}
function clampQty() {
  const p = S.products.get(S.sel), i = $("#sfQty"); let v = parseInt(i.value, 10) || 1;
  if (p && p.porPedido !== true) v = Math.min(v, Math.max(1, stockOf(p)));
  if (String(v) !== i.value) i.value = v;
}
function updateTotal() { $("#sfTotal").textContent = money((parseInt($("#sfQty").value, 10) || 0) * num($("#sfPrice").value)); }

$("#saleForm").addEventListener("submit", async e => {
  e.preventDefault();
  const p = S.products.get(S.sel);
  if (!p) { toast("Selecciona una pieza", true); return; }
  const qty = parseInt($("#sfQty").value, 10) || 0, price = num($("#sfPrice").value);
  if (qty < 1) { toast("Cantidad inválida", true); return; }
  let seller = { id: S.me.uid, nombre: S.me.nombre };
  if (isAdmin()) { const id = $("#sfSeller").value; seller = id === ADMIN_UID ? { id, nombre: "Administrador" } : { id, nombre: S.vendors.get(id)?.nombre || "Vendedor" }; }
  const btn = $("#sfBtn"); btn.disabled = true;
  try {
    await registerSale({ pid: p.id, qty, price, pay: $("#sfPay").value, client: $("#sfClient").value.trim(), note: $("#sfNote").value.trim(), seller, canal: isAdmin() && seller.id === ADMIN_UID ? "admin" : "vendedor" });
    toast(`Venta registrada: ${qty} × ${p.nombre}`);
    $("#sfClient").value = ""; $("#sfNote").value = ""; $("#sfQty").value = 1;
    S.sel = null; renderSell();
  } catch (err) { toast(err.userMsg || fbErr(err), true); }
  btn.disabled = false;
});

/** Registra una venta y descuenta stock de forma atómica (nadie vende la misma pieza dos veces). */
async function registerSale({ pid, qty, price, pay, client, note, seller, canal, pedidoId = null }) {
  const pRef = doc(db, COL.productos, pid), vRef = doc(collection(db, COL.ventas));
  await runTransaction(db, async tx => {
    const snap = await tx.get(pRef);
    if (!snap.exists()) throw Object.assign(new Error(), { userMsg: "El producto ya no existe" });
    const p = snap.data(), st = stockOf(p);
    let descontado = qty, bajoPedido = false;
    if (st < qty) {
      if (p.porPedido !== true) throw Object.assign(new Error(), { userMsg: `Solo hay ${st} pieza(s) de "${p.nombre}"` });
      descontado = st; bajoPedido = true;
    }
    if (descontado > 0) tx.update(pRef, { cantidad: st - descontado, actualizadoEn: serverTimestamp() });
    const img = imgOf(p);
    const sale = {
      productoId: pid, productoNombre: p.nombre || "", categoria: p.categoria || "otros",
      imagen: /^https?:/.test(img) ? img : null,
      cantidad: qty, precioUnit: price, total: Math.round(qty * price * 100) / 100,
      metodoPago: pay || "", cliente: client || "", nota: note || "",
      vendedorId: seller.id, vendedorNombre: seller.nombre, canal,
      estado: "completada", bajoPedido, descontado, pedidoId,
      registradoPor: S.me.uid, fecha: serverTimestamp()
    };
    if (isAdmin()) { const c = S.costs.get(pid)?.costo; sale.costoUnit = c != null ? num(c) : null; }
    tx.set(vRef, sale);
  });
  return vRef.id;
}

/* ═══════════════════════════════════════════════════════════════
   HISTORIAL DE VENTAS
═══════════════════════════════════════════════════════════════ */
function initFilters() {
  const t = new Date();
  $("#vfTo").value = ymd(t);
  $("#vfFrom").value = ymd(new Date(t.getTime() - 29 * 86400000));
}
["#vfFrom", "#vfTo", "#vfSeller", "#vfSearch", "#vfCancel"].forEach(id => $(id).addEventListener(id === "#vfSearch" ? "input" : "change", () => renderSales()));

function filteredSales() {
  const f = $("#vfFrom").value ? new Date($("#vfFrom").value + "T00:00:00") : null;
  const t = $("#vfTo").value ? new Date($("#vfTo").value + "T23:59:59.999") : null;
  const seller = isAdmin() ? $("#vfSeller").value : "";
  const q = $("#vfSearch").value.trim().toLowerCase();
  const showCancel = $("#vfCancel").checked;
  return S.sales.filter(s => {
    const d = toDate(s.fecha);
    if (f && d && d < f) return false;
    if (t && d && d > t) return false;
    if (!showCancel && s.estado === "cancelada") return false;
    if (seller === "__tienda") { if (s.canal !== "tienda") return false; }
    else if (seller && s.vendedorId !== seller) return false;
    if (q && ![s.productoNombre, s.cliente, s.nota].some(v => String(v || "").toLowerCase().includes(q))) return false;
    return true;
  });
}
function renderSales() {
  if (isAdmin()) {
    const sel = $("#vfSeller"), cur = sel.value;
    sel.innerHTML = `<option value="">Todos</option><option value="${ADMIN_UID}">Administrador</option><option value="__tienda">Tienda en línea</option>` + [...S.vendors.values()].map(v => `<option value="${v.id}">${esc(v.nombre)}</option>`).join("");
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : "";
  }
  const rows = filteredSales(), ok = rows.filter(s => s.estado !== "cancelada");
  const total = ok.reduce((a, s) => a + num(s.total), 0);
  let k = `<div><small>Ventas</small><b>${ok.length}</b></div><div><small>Piezas</small><b>${ok.reduce((a, s) => a + num(s.cantidad), 0)}</b></div><div><small>Total</small><b>${money(total)}</b></div>`;
  if (isAdmin()) k += `<div><small>Ganancia</small><b>${money(ok.reduce((a, s) => a + (profitOf(s) ?? 0), 0))}</b></div>`;
  else if (S.me.comision) k += `<div><small>Comisión (${S.me.comision}%)</small><b>${money(total * S.me.comision / 100)}</b></div>`;
  $("#histKpis").innerHTML = k;

  const head = `<thead><tr><th>Fecha</th><th>Pieza</th><th class="num">Cant.</th><th class="num">Precio u.</th><th class="num">Total</th>${isAdmin() ? '<th class="num">Ganancia</th><th>Vendedor</th>' : ""}<th>Pago</th><th>Cliente</th><th>Estado</th>${isAdmin() ? "<th></th>" : ""}</tr></thead>`;
  const body = rows.length ? rows.slice(0, 500).map(s => {
    const pr = profitOf(s), canc = s.estado === "cancelada";
    return `<tr class="${canc ? "cancel" : ""}">
      <td data-l="Fecha">${fmtDT(s.fecha)}</td>
      <td data-l="Pieza"><div class="pname"><img class="thumb" src="${esc(s.imagen || imgOf(S.products.get(s.productoId)))}" alt="" loading="lazy">${esc(s.productoNombre)}</div></td>
      <td data-l="Cantidad" class="num">${s.cantidad}</td>
      <td data-l="Precio u." class="num">${money(s.precioUnit)}</td>
      <td data-l="Total" class="num"><b>${money(s.total)}</b></td>
      ${isAdmin() ? `<td data-l="Ganancia" class="num">${pr == null ? '<span class="chip">sin costo</span>' : money(pr)}</td><td data-l="Vendedor">${esc(sellerLabel(s))}</td>` : ""}
      <td data-l="Pago">${esc(s.metodoPago || "—")}</td>
      <td data-l="Cliente">${esc(s.cliente || "—")}${s.nota ? `<br><small class="muted">${esc(s.nota)}</small>` : ""}</td>
      <td data-l="Estado">${canc ? '<span class="chip r">Cancelada</span>' : s.bajoPedido ? '<span class="chip c">Bajo pedido</span>' : '<span class="chip g">Completada</span>'}</td>
      ${isAdmin() ? `<td class="act num">${canc ? "" : `<button class="btn sm danger ghost" data-cancel="${s.id}">Cancelar</button>`}</td>` : ""}
    </tr>`;
  }).join("") : `<tr><td class="empty" colspan="12">No hay ventas con estos filtros.</td></tr>`;
  $("#salesTbl").innerHTML = head + "<tbody>" + body + "</tbody>";
  $$("#salesTbl [data-cancel]").forEach(b => b.onclick = () => cancelSale(b.dataset.cancel));
}

async function cancelSale(id) {
  const s = S.sales.find(x => x.id === id); if (!s) return;
  const ok = await dialog({ title: "Cancelar venta", body: `<p>Se marcará como cancelada la venta de <b>${s.cantidad} × ${esc(s.productoNombre)}</b> (${money(s.total)}) y ${num(s.descontado ?? s.cantidad) > 0 ? `se regresarán <b>${num(s.descontado ?? s.cantidad)}</b> pieza(s) al inventario` : "no se modifica el inventario"}.</p>`, ok: "Cancelar venta", danger: true });
  if (!ok) return;
  loading(true);
  try {
    await runTransaction(db, async tx => {
      const vRef = doc(db, COL.ventas, id), pRef = doc(db, COL.productos, s.productoId);
      const [vs, ps] = [await tx.get(vRef), await tx.get(pRef)];
      if (!vs.exists() || vs.data().estado === "cancelada") return;
      const back = num(vs.data().descontado ?? vs.data().cantidad);
      if (ps.exists() && back > 0) tx.update(pRef, { cantidad: stockOf(ps.data()) + back, actualizadoEn: serverTimestamp() });
      tx.update(vRef, { estado: "cancelada", canceladaEn: serverTimestamp(), canceladaPor: S.me.uid });
    });
    toast("Venta cancelada y stock restaurado");
  } catch (e) { toast(fbErr(e), true); }
  loading(false);
}

$("#vfCsv").onclick = () => {
  const rows = filteredSales();
  if (!rows.length) { toast("No hay ventas para exportar", true); return; }
  const head = ["Fecha", "ID venta", "Pieza", "Categoría", "Cantidad", "Precio unitario", "Total", ...(isAdmin() ? ["Costo unitario", "Ganancia"] : []), "Vendedor", "Canal", "Método de pago", "Cliente", "Nota", "Estado"];
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map(s => [fmtDT(s.fecha), s.id, s.productoNombre, CAT_LABEL[s.categoria] || "", s.cantidad, s.precioUnit, s.total,
    ...(isAdmin() ? [costOf(s) ?? "", profitOf(s) ?? ""] : []), sellerLabel(s), s.canal, s.metodoPago, s.cliente, s.nota, s.estado].map(q).join(","));
  const blob = new Blob(["﻿" + [head.map(q).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `ventas_arte_plataxco_${ymd(new Date())}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};

/* ═══════════════════════════════════════════════════════════════
   PRODUCTOS
═══════════════════════════════════════════════════════════════ */
$("#pfCat").insertAdjacentHTML("beforeend", CATS.map(([v, l]) => `<option value="${v}">${l}</option>`).join(""));
$("#pmCat").innerHTML = CATS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
["#pfSearch", "#pfCat", "#pfState"].forEach(id => $(id).addEventListener(id === "#pfSearch" ? "input" : "change", () => renderProducts()));
$("#newProd").onclick = () => openProduct(null);

function renderProducts() {
  const q = $("#pfSearch").value.trim().toLowerCase(), cat = $("#pfCat").value, st = $("#pfState").value;
  const all = [...S.products.values()];
  let inv = 0, val = 0, pcs = 0;
  all.forEach(p => { const s = stockOf(p); pcs += s; inv += s * num(S.costs.get(p.id)?.costo); val += s * num(p.precio); });
  $("#prodKpis").innerHTML = `<div><small>Productos</small><b>${all.length}</b></div><div><small>Piezas en stock</small><b>${pcs}</b></div><div><small>Inversión</small><b>${money(inv)}</b></div><div><small>Valor de venta</small><b>${money(val)}</b></div>`;

  const list = all.filter(p => {
    if (q && ![p.nombre, p.material, p.descripcion].some(v => String(v || "").toLowerCase().includes(q))) return false;
    if (cat && p.categoria !== cat) return false;
    const s = stockOf(p);
    if (st === "disp" && s === 0) return false;
    if (st === "agot" && (s > 0 || p.porPedido)) return false;
    if (st === "pp" && !p.porPedido) return false;
    if (st === "oculto" && p.visible !== false) return false;
    return true;
  });
  $("#prodGrid").innerHTML = list.length ? list.map(p => {
    const s = stockOf(p), c = S.costs.get(p.id)?.costo, t = p.etiquetas || {};
    const chip = s > 0 ? `<span class="chip g">${s} en stock</span>` : p.porPedido ? '<span class="chip c">Bajo pedido</span>' : '<span class="chip r">Agotado</span>';
    const margin = c != null && num(p.precio) > 0 ? Math.round((num(p.precio) - num(c)) / num(p.precio) * 100) : null;
    return `<div class="pcard">
      <div class="pimg ${p.visible === false ? "hid" : ""}" style="background-image:url('${esc(imgOf(p))}')" data-edit="${p.id}">
        <div class="st">${chip}</div>
        <div class="tg">${TAGS.filter(([k]) => t[k]).map(([, , l]) => `<span>${l}</span>`).join("")}</div>
      </div>
      <div class="pbody">
        <h4>${esc(p.nombre)}</h4>
        <div class="meta">${esc(CAT_LABEL[p.categoria] || "Otros")}${p.material ? " · " + esc(p.material) : ""}${p.pesoGramos ? " · " + p.pesoGramos + " g" : ""}</div>
        <div class="prices"><b>${money(p.precio)}</b><small>${c != null ? `costo ${money(c)} · ${margin}%` : "sin costo"}</small></div>
      </div>
      <div class="pfoot">
        <div class="qty-ctl"><button data-adj="${p.id}" data-d="-1" aria-label="Restar pieza">−</button><span>${s}</span><button data-adj="${p.id}" data-d="1" aria-label="Sumar pieza">+</button></div>
        <span class="grow"></span>
        <button class="btn sm ghost" data-edit="${p.id}"><i class="fa-solid fa-pen"></i> Editar</button>
      </div>
    </div>`;
  }).join("") : `<div class="empty-state"><i class="fa-regular fa-gem"></i>${all.length ? "Ningún producto coincide con los filtros." : "Aún no hay productos. Crea el primero con “Nuevo producto”."}</div>`;
  $$("#prodGrid [data-edit]").forEach(b => b.onclick = () => openProduct(b.dataset.edit));
  $$("#prodGrid [data-adj]").forEach(b => b.onclick = async () => {
    const p = S.products.get(b.dataset.adj), d = +b.dataset.d;
    if (d < 0 && stockOf(p) === 0) return;
    try { await updateDoc(doc(db, COL.productos, p.id), { cantidad: increment(d), actualizadoEn: serverTimestamp() }); }
    catch (e) { toast(fbErr(e), true); }
  });
}

/* ── Modal de producto ── */
const PM = { id: null, isNew: true, imgs: [], uploading: 0, newUploads: [], removed: [] };
let storageOK = true;

function syncTagUI() { $$(".tag").forEach(l => l.classList.toggle("on", l.querySelector("input").checked)); }
$$(".tag input").forEach(i => i.addEventListener("change", syncTagUI));
$("#tgUnica").addEventListener("change", e => { if (e.target.checked) $("#pmStock").value = 1; });
["#pmPrice", "#pmCost"].forEach(id => $(id).addEventListener("input", updateMargin));
function updateMargin() {
  const p = num($("#pmPrice").value), c = numOrNull($("#pmCost").value);
  $("#pmMargin").textContent = p > 0 && c != null ? `${money(p - c)} (${Math.round((p - c) / p * 100)}%)` : "—";
}

function openProduct(id) {
  const p = id ? S.products.get(id) : null;
  PM.id = id || doc(collection(db, COL.productos)).id; PM.isNew = !p;
  PM.imgs = p ? (Array.isArray(p.imagenes) && p.imagenes.length ? [...p.imagenes] : p.imageUrl ? [p.imageUrl] : []) : [];
  PM.newUploads = []; PM.removed = []; PM.uploading = 0;
  $("#pmTitle").textContent = p ? "Editar producto" : "Nuevo producto";
  $("#pmName").value = p?.nombre || "";
  $("#pmCat").value = p?.categoria || "anillos";
  $("#pmMat").value = p?.material || "";
  $("#pmPrice").value = p?.precio ?? "";
  $("#pmOld").value = p?.precioAnterior ?? "";
  $("#pmCost").value = S.costs.get(PM.id)?.costo ?? "";
  $("#pmWeight").value = p?.pesoGramos ?? "";
  $("#pmStock").value = p ? stockOf(p) : 1;
  $("#pmDesc").value = p?.descripcion || "";
  $("#pmPP").checked = p?.porPedido === true;
  $("#pmVis").checked = p ? p.visible !== false : true;
  const t = p?.etiquetas || {};
  TAGS.forEach(([k, id]) => $("#" + id).checked = !!t[k]);
  $("#pmDelete").classList.toggle("hidden", !p);
  $("#pmUrl").value = "";
  syncTagUI(); updateMargin(); renderPmImgs();
  openModal($("#prodModal"));
}
function renderPmImgs() {
  const slots = PM.imgs.map((u, i) => `<div class="img-slot ${i === 0 ? "cover" : ""}" style="background-image:url('${esc(u)}')" data-i="${i}"><button type="button" class="rm" data-rm="${i}" aria-label="Quitar foto"><i class="fa-solid fa-xmark"></i></button></div>`);
  for (let i = 0; i < PM.uploading; i++) slots.push(`<div class="img-slot"><div class="up"><div class="spinner" style="width:24px;height:24px"></div></div></div>`);
  if (!slots.length) slots.push(`<div class="img-slot ph">Sin fotos</div>`);
  $("#pmImgs").innerHTML = slots.join("");
  $$("#pmImgs [data-rm]").forEach(b => b.onclick = e => { e.stopPropagation(); const [u] = PM.imgs.splice(+b.dataset.rm, 1); PM.removed.push(u); renderPmImgs(); });
  $$("#pmImgs .img-slot[data-i]").forEach(s => s.onclick = () => { const i = +s.dataset.i; if (!i) return; const [u] = PM.imgs.splice(i, 1); PM.imgs.unshift(u); renderPmImgs(); });
  $("#pmSave").disabled = PM.uploading > 0;
}
$("#pmFile").addEventListener("change", async e => {
  const files = Array.from(e.target.files || []).slice(0, Math.max(0, 4 - PM.imgs.length - PM.uploading));
  e.target.value = "";
  if (!files.length) { toast("Máximo 4 fotos por producto", true); return; }
  PM.uploading += files.length; renderPmImgs();
  await Promise.all(files.map(async f => {
    try { const url = await uploadImage(f, `arte_plataxco/productos/${PM.id}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, 1400, 640); PM.imgs.push(url); PM.newUploads.push(url); }
    catch (err) { toast("No se pudo procesar una imagen", true); console.error(err); }
    PM.uploading--; renderPmImgs();
  }));
});
$("#pmUrlAdd").onclick = () => {
  const u = $("#pmUrl").value.trim();
  if (!/^https?:\/\//.test(u)) { toast("Pega una URL que empiece con https://", true); return; }
  if (PM.imgs.length >= 4) { toast("Máximo 4 fotos por producto", true); return; }
  PM.imgs.push(u); $("#pmUrl").value = ""; renderPmImgs();
};
$("#prodModal").addEventListener("closed", () => {
  // si se cerró sin guardar, borra las fotos recién subidas
  if (PM._saved) { PM._saved = false; return; }
  PM.newUploads.forEach(deleteStorageUrl); PM.newUploads = [];
});

$("#prodForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (PM.uploading) return;
  const nombre = $("#pmName").value.trim(), precio = num($("#pmPrice").value);
  if (!nombre || precio <= 0) { toast("Nombre y precio son obligatorios", true); return; }
  const etiquetas = Object.fromEntries(TAGS.map(([k, id]) => [k, $("#" + id).checked]));
  const data = {
    nombre, categoria: $("#pmCat").value, material: $("#pmMat").value.trim(),
    precio, precioAnterior: numOrNull($("#pmOld").value), pesoGramos: numOrNull($("#pmWeight").value),
    cantidad: Math.max(0, parseInt($("#pmStock").value, 10) || 0),
    porPedido: $("#pmPP").checked, visible: $("#pmVis").checked,
    descripcion: $("#pmDesc").value.trim(), etiquetas,
    imagenes: PM.imgs, imageUrl: PM.imgs[0] || "",
    actualizadoEn: serverTimestamp()
  };
  if (data.precioAnterior != null && data.precioAnterior <= precio) data.precioAnterior = null;
  loading(true);
  try {
    const b = writeBatch(db), pRef = doc(db, COL.productos, PM.id);
    if (PM.isNew) b.set(pRef, { ...data, creadoEn: serverTimestamp() }); else b.update(pRef, data);
    b.set(doc(db, COL.privado, PM.id), { costo: numOrNull($("#pmCost").value), actualizadoEn: serverTimestamp() }, { merge: true });
    await b.commit();
    PM.removed.filter(u => !PM.imgs.includes(u)).forEach(deleteStorageUrl);
    PM._saved = true; closeModal($("#prodModal"));
    toast(PM.isNew ? "Producto publicado en la tienda" : "Producto actualizado");
  } catch (err) { toast(fbErr(err), true); }
  loading(false);
});
$("#pmDelete").onclick = async () => {
  const p = S.products.get(PM.id); if (!p) return;
  const ok = await dialog({ title: "Eliminar producto", body: `<p>¿Eliminar <b>${esc(p.nombre)}</b>? Desaparece de la tienda al instante. Su historial de ventas se conserva.</p>`, ok: "Eliminar", danger: true });
  if (!ok) return;
  loading(true);
  try {
    const b = writeBatch(db); b.delete(doc(db, COL.productos, PM.id)); b.delete(doc(db, COL.privado, PM.id)); await b.commit();
    [...PM.imgs, ...PM.removed].forEach(deleteStorageUrl);
    PM._saved = true; closeModal($("#prodModal")); toast("Producto eliminado");
  } catch (err) { toast(fbErr(err), true); }
  loading(false);
};

/* ── Imágenes: compresión + Storage (con respaldo si Storage no está habilitado) ── */
function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("imagen inválida")); };
    img.src = url;
  });
}
function drawScaled(img, max) {
  const s = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * s)); c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * s));
  const ctx = c.getContext("2d"); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
async function uploadImage(file, path, max, fallbackMax) {
  const img = await loadImage(file);
  if (storageOK) {
    try {
      const c = drawScaled(img, max);
      const blob = await new Promise(r => c.toBlob(r, "image/jpeg", .84));
      const r = sRef(storage, path + ".jpg");
      await uploadBytes(r, blob, { contentType: "image/jpeg", cacheControl: "public,max-age=31536000" });
      return await getDownloadURL(r);
    } catch (e) {
      console.warn("Storage no disponible; la imagen se guarda comprimida dentro de Firestore.", e);
      storageOK = false;
      toast("Storage no disponible: las fotos se guardan comprimidas en la base de datos");
    }
  }
  return drawScaled(img, fallbackMax).toDataURL("image/jpeg", .72);
}
function deleteStorageUrl(u) {
  if (typeof u === "string" && u.includes("firebasestorage")) { try { deleteObject(sRef(storage, u)).catch(() => {}); } catch {} }
}

/* ═══════════════════════════════════════════════════════════════
   PEDIDOS WEB
═══════════════════════════════════════════════════════════════ */
$$("#pedSeg button").forEach(b => b.addEventListener("click", () => { S.pedFilter = b.dataset.e; $$("#pedSeg button").forEach(x => x.classList.toggle("on", x === b)); renderOrders(); }));

function renderOrders() {
  const list = S.orders.filter(o => (o.estado || "pendiente") === S.pedFilter);
  $("#ordersList").innerHTML = list.length ? list.map(o => {
    const lines = (o.items || []).map(it => {
      const p = S.products.get(it.productoId);
      const warn = o.estado === "pendiente" && (!p || (stockOf(p) < num(it.cantidad) && p.porPedido !== true));
      return `<div class="oline ${warn ? "warn" : ""}"><span>${num(it.cantidad)} × ${esc(it.nombre)}${warn ? (p ? ` (stock ${stockOf(p)})` : " (ya no existe)") : ""}</span><span>${money(num(it.precio) * num(it.cantidad))}</span></div>`;
    }).join("");
    return `<div class="order">
      <div class="order-hd"><div><b>${esc(o.folio || o.id.slice(0, 6).toUpperCase())}</b><br><small>${fmtDT(o.creadoEn)}</small></div>
        <div style="text-align:right"><small>${esc(o.clienteNombre || "Invitado")}</small><br><small>${esc(o.clienteCorreo || "")}</small></div></div>
      <div class="order-bd">${lines}
        ${num(o.descuento) ? `<div class="oline"><span>Cupón ${esc(o.cupon || "")}</span><span>−${money(o.descuento)}</span></div>` : ""}
        <div class="otot"><span>Total</span><span>${money(o.total)}</span></div></div>
      <div class="order-ft">
        ${o.estado === "pendiente" ? `<button class="btn sm ok" data-conf="${o.id}"><i class="fa-solid fa-check"></i> Confirmar venta</button><button class="btn sm danger ghost" data-canc="${o.id}">Cancelar</button>`
          : o.estado === "confirmado" ? `<span class="chip g">Confirmado ${fmtD(o.confirmadoEn)}</span>`
          : `<span class="chip r">Cancelado</span><span class="grow"></span><button class="btn sm ghost" data-del="${o.id}"><i class="fa-solid fa-trash"></i></button>`}
      </div></div>`;
  }).join("") : `<div class="empty-state"><i class="fa-brands fa-whatsapp"></i>No hay pedidos ${S.pedFilter === "pendiente" ? "pendientes" : S.pedFilter === "confirmado" ? "confirmados" : "cancelados"}.</div>`;
  $$("#ordersList [data-conf]").forEach(b => b.onclick = () => confirmOrder(b.dataset.conf));
  $$("#ordersList [data-canc]").forEach(b => b.onclick = async () => {
    if (!await dialog({ title: "Cancelar pedido", body: "<p>El pedido pasará a cancelados. No se modifica el inventario.</p>", ok: "Cancelar pedido", danger: true })) return;
    try { await updateDoc(doc(db, COL.pedidos, b.dataset.canc), { estado: "cancelado", canceladoEn: serverTimestamp() }); toast("Pedido cancelado"); } catch (e) { toast(fbErr(e), true); }
  });
  $$("#ordersList [data-del]").forEach(b => b.onclick = async () => {
    if (!await dialog({ title: "Eliminar pedido", body: "<p>Se borrará definitivamente.</p>", ok: "Eliminar", danger: true })) return;
    try { await deleteDoc(doc(db, COL.pedidos, b.dataset.del)); } catch (e) { toast(fbErr(e), true); }
  });
}

async function confirmOrder(id) {
  const o = S.orders.find(x => x.id === id); if (!o) return;
  const sellers = `<option value="${ADMIN_UID}">Tienda en línea (Administrador)</option>` + [...S.vendors.values()].filter(v => v.activo !== false).map(v => `<option value="${v.id}">${esc(v.nombre)}</option>`).join("");
  let pay = "Transferencia", sellerId = ADMIN_UID;
  const ok = await dialog({
    title: `Confirmar pedido ${o.folio || ""}`,
    body: `<div class="stack"><p class="muted small">Se descontará el stock y se creará una venta por cada pieza.</p>
      <label class="fld"><span>Método de pago</span><select id="ocPay"><option>Transferencia</option><option>Efectivo</option><option>Tarjeta</option><option>Otro</option></select></label>
      <label class="fld"><span>Atendió</span><select id="ocSeller">${sellers}</select></label></div>`,
    ok: "Confirmar",
    onOk: () => { pay = $("#ocPay").value; sellerId = $("#ocSeller").value; }
  });
  if (!ok) return;
  const seller = sellerId === ADMIN_UID ? { id: ADMIN_UID, nombre: "Administrador" } : { id: sellerId, nombre: S.vendors.get(sellerId)?.nombre || "Vendedor" };
  const factor = num(o.subtotal) > 0 ? (num(o.subtotal) - num(o.descuento)) / num(o.subtotal) : 1;
  loading(true);
  try {
    const oRef = doc(db, COL.pedidos, id);
    const items = (o.items || []).filter(it => it.productoId && num(it.cantidad) > 0);
    const ids = [...new Set(items.map(it => it.productoId))];
    const ventaIds = [];
    await runTransaction(db, async tx => {
      const os = await tx.get(oRef);
      if (!os.exists() || os.data().estado !== "pendiente") throw Object.assign(new Error(), { userMsg: "El pedido ya fue procesado" });
      const snaps = {}; for (const pid of ids) snaps[pid] = await tx.get(doc(db, COL.productos, pid));
      const stock = {}; ids.forEach(pid => stock[pid] = snaps[pid].exists() ? stockOf(snaps[pid].data()) : 0);
      const plan = items.map(it => {
        const ps = snaps[it.productoId];
        if (!ps.exists()) throw Object.assign(new Error(), { userMsg: `"${it.nombre}" ya no existe en el catálogo` });
        const p = ps.data(), q = num(it.cantidad);
        let desc = q, pp = false;
        if (stock[it.productoId] < q) { if (p.porPedido !== true) throw Object.assign(new Error(), { userMsg: `Solo hay ${stock[it.productoId]} pieza(s) de "${p.nombre}"` }); desc = stock[it.productoId]; pp = true; }
        stock[it.productoId] -= desc;
        return { it, p, q, desc, pp };
      });
      ids.forEach(pid => { if (snaps[pid].exists() && stock[pid] !== stockOf(snaps[pid].data())) tx.update(doc(db, COL.productos, pid), { cantidad: stock[pid], actualizadoEn: serverTimestamp() }); });
      plan.forEach(({ it, p, q, desc, pp }) => {
        const vRef = doc(collection(db, COL.ventas)); ventaIds.push(vRef.id);
        const unit = Math.round(num(it.precio) * factor * 100) / 100, img = imgOf(p), c = S.costs.get(it.productoId)?.costo;
        tx.set(vRef, {
          productoId: it.productoId, productoNombre: p.nombre || it.nombre, categoria: p.categoria || "otros",
          imagen: /^https?:/.test(img) ? img : null, cantidad: q, precioUnit: unit, total: Math.round(unit * q * 100) / 100,
          costoUnit: c != null ? num(c) : null, metodoPago: pay, cliente: o.clienteNombre || o.clienteCorreo || "", nota: `Pedido web ${o.folio || ""}${o.cupon ? " · cupón " + o.cupon : ""}`,
          vendedorId: seller.id, vendedorNombre: seller.nombre, canal: "tienda", estado: "completada",
          bajoPedido: pp, descontado: desc, pedidoId: id, registradoPor: S.me.uid, fecha: serverTimestamp()
        });
      });
      tx.update(oRef, { estado: "confirmado", confirmadoEn: serverTimestamp(), ventaIds, metodoPago: pay });
    });
    toast("Pedido confirmado: stock descontado y ventas creadas");
  } catch (e) { toast(e.userMsg || fbErr(e), true); }
  loading(false);
}

/* ═══════════════════════════════════════════════════════════════
   VENDEDORES
═══════════════════════════════════════════════════════════════ */
$("#vendorForm").addEventListener("submit", async e => {
  e.preventDefault();
  const nombre = $("#vnName").value.trim(), correo = $("#vnEmail").value.trim().toLowerCase(), pass = $("#vnPass").value;
  if (pass.length < 6) { toast("La contraseña debe tener al menos 6 caracteres", true); return; }
  const btn = $("#vnBtn"); btn.disabled = true; loading(true);
  try {
    const cred = await createUserWithEmailAndPassword(secAuth, correo, pass);
    await setDoc(doc(db, COL.vendedores, cred.user.uid), {
      nombre, correo, telefono: $("#vnPhone").value.trim(), comision: num($("#vnCom").value),
      activo: true, creadoEn: serverTimestamp(), creadoPor: S.me.uid
    });
    await signOut(secAuth);
    $("#vendorForm").reset(); $("#vnCom").value = 0;
    toast(`Vendedor ${nombre} creado. Ya puede entrar con su correo.`);
  } catch (err) {
    const c = err.code || "";
    toast(c === "auth/email-already-in-use" ? "Ese correo ya tiene cuenta en Firebase. Usa otro correo." : c === "auth/invalid-email" ? "Correo no válido." : fbErr(err), true);
  }
  btn.disabled = false; loading(false);
});

function renderVendors() {
  const vs = [...S.vendors.values()].sort((a, b) => (b.activo !== false) - (a.activo !== false) || String(a.nombre).localeCompare(String(b.nombre)));
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  $("#vendorList").innerHTML = vs.length ? vs.map(v => {
    const mine = okSales().filter(s => s.vendedorId === v.id);
    const month = mine.filter(s => toDate(s.fecha) >= monthStart);
    const tot = mine.reduce((a, s) => a + num(s.total), 0), totM = month.reduce((a, s) => a + num(s.total), 0);
    const pcs = mine.reduce((a, s) => a + num(s.cantidad), 0);
    return `<div class="vcard ${v.activo === false ? "off" : ""}">
      <div class="vhd"><div class="avatar">${esc((v.nombre || "?").charAt(0).toUpperCase())}</div>
        <div class="vi"><b>${esc(v.nombre)}</b><small>${esc(v.correo || "")}${v.telefono ? " · " + esc(v.telefono) : ""}</small></div>
        ${v.activo === false ? '<span class="chip r">Inactivo</span>' : '<span class="chip g">Activo</span>'}</div>
      <div class="vstats">
        <div><small>Ventas</small><b>${mine.length}</b></div><div><small>Piezas</small><b>${pcs}</b></div>
        <div><small>Total vendido</small><b>${moneyShort(tot)}</b></div><div><small>Este mes</small><b>${moneyShort(totM)}</b></div>
      </div>
      ${num(v.comision) ? `<p class="muted small" style="margin:-4px 0 12px">Comisión ${num(v.comision)}% → este mes ${money(totM * num(v.comision) / 100)}</p>` : ""}
      <div class="vact">
        <button class="btn sm ghost" data-hist="${v.id}"><i class="fa-solid fa-receipt"></i> Historial</button>
        <button class="btn sm ghost" data-com="${v.id}"><i class="fa-solid fa-percent"></i> Comisión</button>
        <button class="btn sm ghost" data-reset="${v.id}"><i class="fa-solid fa-key"></i> Restablecer contraseña</button>
        <button class="btn sm ${v.activo === false ? "ok" : "danger"} ghost" data-tog="${v.id}">${v.activo === false ? "Activar" : "Desactivar"}</button>
      </div></div>`;
  }).join("") : `<div class="empty-state"><i class="fa-solid fa-user-tie"></i>Aún no hay vendedores.</div>`;

  $$("#vendorList [data-hist]").forEach(b => b.onclick = () => {
    go("ventas"); $("#vfSeller").value = b.dataset.hist; $("#vfFrom").value = ""; renderSales();
  });
  $$("#vendorList [data-tog]").forEach(b => b.onclick = async () => {
    const v = S.vendors.get(b.dataset.tog);
    try { await updateDoc(doc(db, COL.vendedores, v.id), { activo: v.activo === false }); toast(v.activo === false ? "Vendedor activado" : "Vendedor desactivado: ya no puede entrar"); } catch (e) { toast(fbErr(e), true); }
  });
  $$("#vendorList [data-reset]").forEach(b => b.onclick = async () => {
    const v = S.vendors.get(b.dataset.reset);
    try { await sendPasswordResetEmail(auth, v.correo); toast(`Correo de restablecimiento enviado a ${v.correo}`); } catch (e) { toast(fbErr(e), true); }
  });
  $$("#vendorList [data-com]").forEach(b => b.onclick = async () => {
    const v = S.vendors.get(b.dataset.com); let val = num(v.comision);
    const ok = await dialog({ title: `Comisión de ${v.nombre}`, body: `<label class="fld"><span>Porcentaje sobre sus ventas</span><input type="number" id="dlgCom" min="0" max="100" step="0.5" value="${val}" inputmode="decimal"></label>`, onOk: () => { val = num($("#dlgCom").value); } });
    if (!ok) return;
    try { await updateDoc(doc(db, COL.vendedores, v.id), { comision: val }); toast("Comisión actualizada"); } catch (e) { toast(fbErr(e), true); }
  });
}

/* ═══════════════════════════════════════════════════════════════
   TIENDA EN LÍNEA: tema, banners y reseñas
═══════════════════════════════════════════════════════════════ */
$("#themeSel").addEventListener("change", async e => {
  try { await setDoc(doc(db, COL.config, "tematica"), { tema: e.target.value || null, actualizadoEn: serverTimestamp() }, { merge: true }); toast("Tema aplicado en la tienda"); }
  catch (err) { toast(fbErr(err), true); }
});
$("#bannerForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = $("#bnFile").files[0]; if (!f) return;
  const btn = $("#bnBtn"); btn.disabled = true; loading(true);
  try {
    const url = await uploadImage(f, `arte_plataxco/banners/${Date.now()}`, 1800, 1100);
    await addDoc(collection(db, COL.banners), { url, titulo: $("#bnTitle").value.trim(), activo: true, creadoEn: serverTimestamp() });
    $("#bannerForm").reset(); toast("Banner publicado");
  } catch (err) { toast(fbErr(err), true); }
  btn.disabled = false; loading(false);
});
$("#rvDate").value = ymd(new Date());
$("#reviewForm").addEventListener("submit", async e => {
  e.preventDefault();
  const d = $("#rvDate").value ? new Date($("#rvDate").value + "T12:00:00") : new Date();
  try {
    await addDoc(collection(db, COL.resenas), { nombre: $("#rvName").value.trim(), texto: $("#rvText").value.trim(), estrellas: +$("#rvStars").value, verificada: $("#rvVer").checked, visible: true, fecha: Timestamp.fromDate(d), creadoEn: serverTimestamp() });
    $("#reviewForm").reset(); $("#rvDate").value = ymd(new Date()); toast("Reseña publicada");
  } catch (err) { toast(fbErr(err), true); }
});

function renderStore() {
  $("#themeSel").value = S.tema || "";
  $("#bannerList").innerHTML = S.banners.length ? S.banners.map(b => `
    <div class="bn ${b.activo === false ? "off" : ""}" style="background-image:url('${esc(b.url)}')">
      <div class="ba"><button data-btog="${b.id}" title="${b.activo === false ? "Mostrar" : "Ocultar"}" aria-label="Mostrar u ocultar"><i class="fa-solid ${b.activo === false ? "fa-eye" : "fa-eye-slash"}"></i></button>
      <button data-bdel="${b.id}" title="Eliminar" aria-label="Eliminar"><i class="fa-solid fa-trash"></i></button></div>
      ${b.titulo ? `<div class="bt">${esc(b.titulo)}</div>` : ""}</div>`).join("")
    : `<p class="muted small">Sin banners: el carrusel no se muestra en la tienda.</p>`;
  $$("[data-btog]").forEach(x => x.onclick = () => { const b = S.banners.find(y => y.id === x.dataset.btog); updateDoc(doc(db, COL.banners, b.id), { activo: b.activo === false }).catch(e => toast(fbErr(e), true)); });
  $$("[data-bdel]").forEach(x => x.onclick = async () => {
    const b = S.banners.find(y => y.id === x.dataset.bdel);
    if (!await dialog({ title: "Eliminar banner", body: "<p>Se quitará del carrusel de la tienda.</p>", ok: "Eliminar", danger: true })) return;
    try { await deleteDoc(doc(db, COL.banners, b.id)); deleteStorageUrl(b.url); } catch (e) { toast(fbErr(e), true); }
  });

  $("#reviewList").innerHTML = S.reviews.length ? S.reviews.map(r => `
    <div class="rv ${r.visible === false ? "off" : ""}">
      <div class="stars">${"★".repeat(num(r.estrellas) || 5)}</div>
      <p>"${esc(r.texto)}"</p>
      <div class="rf"><span>— ${esc(r.nombre)} · ${fmtD(r.fecha)}${r.verificada ? ' <span class="chip g">verificada</span>' : ""}</span>
        <span><button class="icon-btn" data-rtog="${r.id}" aria-label="Mostrar u ocultar"><i class="fa-solid ${r.visible === false ? "fa-eye" : "fa-eye-slash"}"></i></button><button class="icon-btn" data-rdel="${r.id}" aria-label="Eliminar"><i class="fa-solid fa-trash"></i></button></span></div>
    </div>`).join("") : `<p class="muted small">Sin reseñas todavía.</p>`;
  $$("[data-rtog]").forEach(x => x.onclick = () => { const r = S.reviews.find(y => y.id === x.dataset.rtog); updateDoc(doc(db, COL.resenas, r.id), { visible: r.visible === false }).catch(e => toast(fbErr(e), true)); });
  $$("[data-rdel]").forEach(x => x.onclick = async () => {
    if (!await dialog({ title: "Eliminar reseña", body: "<p>Se quitará de la tienda.</p>", ok: "Eliminar", danger: true })) return;
    deleteDoc(doc(db, COL.resenas, x.dataset.rdel)).catch(e => toast(fbErr(e), true));
  });
}
