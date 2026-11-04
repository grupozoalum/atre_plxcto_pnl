/* ═══════════════════════════════════════════════════════════════
   ARTE PLATAXCO — ERP (app.js)
   Admin: panel, punto de venta, apartados, inventario (SKU, metal
          por gramo, etiquetas, mermas), clientes, pedidos web,
          vendedores, tienda en línea y ajustes.
   Vendedor: punto de venta, apartados y su propio historial.
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
  config:     "ap_config",              // público: tema, datos del negocio
  presencia:  "ap_presencia",
  apartados:  "ap_apartados",           // apartados con abonos
  movs:       "ap_movimientos",         // entradas / salidas / mermas (solo admin)
  clientes:   "ap_clientes",            // cuentas de la tienda
  ajustes:    "ap_ajustes"              // privado: metal por gramo, metas (solo admin)
};
const CATS = [["anillos", "Anillos"], ["pulsos", "Pulsos"], ["cadenas", "Cadenas"], ["aretes", "Aretes"], ["dijes", "Dijes"], ["conjuntos", "Conjuntos"], ["otros", "Otros"]];
const CAT_LABEL = Object.fromEntries(CATS);
const TAGS = [["promocion", "tgPromo", "Promoción"], ["nuevo", "tgNuevo", "Nuevo"], ["piezaUnica", "tgUnica", "Pieza única"], ["edicionLimitada", "tgLim", "Ed. limitada"], ["masVendido", "tgTop", "Más vendido"]];
const SERIES = ["#3987e5", "#d95926"]; // validadas para fondo oscuro (daltonismo incluido)
const SKU_PREFIX = { anillos: "AN", pulsos: "PU", cadenas: "CA", aretes: "AR", dijes: "DI", conjuntos: "CJ", otros: "OT" };
const METALES = ["Plata .925", "Plata .950", "Oro 10k", "Oro 14k", "Oro 18k", "Oro laminado", "Chapa de oro", "Acero inoxidable"];
const DEF_AJ = { metales: {}, factor: 2.5, manoObra: 0, meta: 0, stockMin: 1, diasIdle: 90, plazo: 30, anticipo: 20 };
const DOW = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const PAYS = ["Efectivo", "Transferencia", "Tarjeta", "Mercado Pago", "Otro"];
const payOpts = (sel = "") => PAYS.map(p => `<option ${p === sel ? "selected" : ""}>${p}</option>`).join("");

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
const ue = m => Object.assign(new Error(m), { userMsg: m });
const r2 = n => Math.round(Number(n || 0) * 100) / 100;
const normTel = t => { let d = String(t || "").replace(/\D/g, ""); if (d.length === 10) d = "52" + d; return d; };
const waUrl = (tel, txt) => `https://wa.me/${normTel(tel)}?text=${encodeURIComponent(txt)}`;
const daysAgo = n => new Date(Date.now() - n * 86400000);
const AJ = () => ({ ...DEF_AJ, ...(S.ajustes || {}) });
const BIZ = () => ({ ...(S.negocio || {}), nombre: S.negocio?.nombre || "ARTE PLATAXCO" });
const metalPrice = mat => { const m = AJ().metales || {}, k = Object.keys(m).find(x => x.toLowerCase() === String(mat || "").trim().toLowerCase()); return k ? num(m[k]) : 0; };
const minOf = p => p?.stockMin != null ? num(p.stockMin) : num(AJ().stockMin);
const isLow = p => p.porPedido !== true && stockOf(p) <= minOf(p);
const folioGen = pre => pre + "-" + Date.now().toString(36).slice(-4).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
const ticketKey = s => s.ticketId || s.id;
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const download = (name, text, type = "text/csv;charset=utf-8") => {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};
const csv = (head, rows) => { const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`; return "\ufeff" + [head.map(q).join(","), ...rows.map(r => r.map(q).join(","))].join("\r\n"); };

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
function dialog({ title, body, ok = "Aceptar", danger = false, onOk, cancel = true }) {
  return new Promise(resolve => {
    const m = $("#dlg");
    $("#dlgCancel").classList.toggle("hidden", !cancel);
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
  apartados: [], movs: [], cuentas: [], ajustes: {}, negocio: {},
  cart: [], selected: new Set(), posCat: "", apFilter: "activo", pendKnown: null, rulesMissing: false,
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
  S.apartados = []; S.movs = []; S.cuentas = []; S.ajustes = {}; S.negocio = {}; S.cart = []; S.selected.clear();
  S.role = null; S.me = null; S.sel = null; S.pendKnown = null; S.rulesMissing = false;
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
  // colecciones nuevas: si aún no publicas las reglas, el panel sigue funcionando y avisa en el Panel
  const onSoft = (q, fn) => S.unsubs.push(onSnapshot(q, fn, e => { console.warn(e); if (String(e?.code).includes("permission")) { S.rulesMissing = true; schedule(); } }));
  onSoft(doc(db, COL.config, "negocio"), snap => { S.negocio = snap.exists() ? snap.data() : {}; });

  on(query(collection(db, COL.productos), orderBy("creadoEn", "desc")), snap => {
    S.products.clear(); snap.forEach(d => S.products.set(d.id, { id: d.id, ...d.data(est) })); schedule();
  });

  if (isAdmin()) {
    on(collection(db, COL.privado), snap => { S.costs.clear(); snap.forEach(d => S.costs.set(d.id, d.data())); schedule(); });
    on(query(collection(db, COL.ventas), orderBy("fecha", "desc")), snap => { S.sales = snap.docs.map(d => ({ id: d.id, ...d.data(est) })); schedule(); });
    on(collection(db, COL.vendedores), snap => { S.vendors.clear(); snap.forEach(d => S.vendors.set(d.id, { id: d.id, ...d.data(est) })); schedule(); });
    on(query(collection(db, COL.pedidos), orderBy("creadoEn", "desc")), snap => {
      S.orders = snap.docs.map(d => ({ id: d.id, ...d.data(est) }));
      const pend = S.orders.filter(o => o.estado === "pendiente").length;
      if (S.pendKnown != null && pend > S.pendKnown) toast("🛎 Nuevo pedido web por confirmar");
      S.pendKnown = pend; schedule();
    });
    onSoft(query(collection(db, COL.apartados), orderBy("creadoEn", "desc")), snap => { S.apartados = snap.docs.map(d => ({ id: d.id, ...d.data(est) })); schedule(); });
    onSoft(query(collection(db, COL.movs), orderBy("fecha", "desc"), limit(800)), snap => { S.movs = snap.docs.map(d => ({ id: d.id, ...d.data(est) })); schedule(); });
    onSoft(doc(db, COL.ajustes, "general"), snap => { S.ajustes = snap.exists() ? snap.data() : {}; schedule(); });
    onSoft(collection(db, COL.clientes), snap => { S.cuentas = snap.docs.map(d => ({ id: d.id, ...d.data(est) })); schedule(); });
    on(query(collection(db, COL.banners), orderBy("creadoEn", "desc")), snap => { S.banners = snap.docs.map(d => ({ id: d.id, ...d.data(est) })); schedule(); });
    on(query(collection(db, COL.resenas), orderBy("creadoEn", "desc")), snap => { S.reviews = snap.docs.map(d => ({ id: d.id, ...d.data(est) })); schedule(); });
    on(doc(db, COL.config, "tematica"), snap => { S.tema = snap.exists() ? (snap.data().tema || "") : ""; schedule(); });
    cleanPresence();
  } else {
    on(query(collection(db, COL.ventas), where("vendedorId", "==", S.me.uid)), snap => {
      S.sales = snap.docs.map(d => ({ id: d.id, ...d.data(est) })).sort((a, b) => (toDate(b.fecha) || 0) - (toDate(a.fecha) || 0));
      schedule();
    });
    onSoft(query(collection(db, COL.apartados), where("vendedorId", "==", S.me.uid)), snap => {
      S.apartados = snap.docs.map(d => ({ id: d.id, ...d.data(est) })).sort((a, b) => (toDate(b.creadoEn) || 0) - (toDate(a.creadoEn) || 0));
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
const TITLES = { dashboard: "Panel", vender: "Punto de venta", apartados: "Apartados", ventas: "Historial de ventas", productos: "Inventario", clientes: "Clientes", pedidos: "Pedidos web", vendedores: "Vendedores", tienda: "Tienda en línea", ajustes: "Ajustes" };
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
$("#quickSale").onclick = () => { go("vender"); setTimeout(() => $("#sfSearch").focus(), 60); };
$("#sideBackdrop").onclick = () => document.body.classList.remove("nav-open");

let rafId = 0;
function schedule() { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(render); }
function render() {
  if (!S.role) return;
  const pend = S.orders.filter(o => o.estado === "pendiente").length;
  const pb = $("#pedBadge"); pb.textContent = pend; pb.classList.toggle("on", pend > 0);
  const venc = S.apartados.filter(isOverdue).length;
  const ab = $("#apBadge"); ab.textContent = venc; ab.classList.toggle("on", venc > 0);
  document.title = (pend ? `(${pend}) ` : "") + "ERP · ARTE PLATAXCO";
  ({ dashboard: renderDashboard, vender: renderSell, apartados: renderLayaways, ventas: renderSales, productos: renderProducts, clientes: renderClients, pedidos: renderOrders, vendedores: renderVendors, tienda: renderStore, ajustes: renderSettings }[S.view] || (() => {}))();
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

function lastSales() {
  const m = new Map();
  okSales().forEach(s => { const d = toDate(s.fecha); if (d && (!m.has(s.productoId) || d > m.get(s.productoId))) m.set(s.productoId, d); });
  return m;
}
function idleList() {
  const aj = AJ(), cut = daysAgo(num(aj.diasIdle) || 90), ls = lastSales();
  return [...S.products.values()].filter(p => {
    if (stockOf(p) <= 0) return false;
    const c = toDate(p.creadoEn); if (c && c > cut) return false;
    const l = ls.get(p.id); return !l || l < cut;
  }).map(p => ({ p, last: ls.get(p.id) || null, capital: stockOf(p) * num(S.costs.get(p.id)?.costo) }))
    .sort((a, b) => b.capital - a.capital || stockOf(b.p) - stockOf(a.p));
}

function renderDashboard() {
  const now = new Date(), r = S.range, aj = AJ();
  const from = r ? startOfDay(new Date(now.getTime() - (r - 1) * 86400000)) : null;
  const prevFrom = r ? new Date(from.getTime() - r * 86400000) : null;
  const all = okSales();
  const inRange = all.filter(s => !from || toDate(s.fecha) >= from);
  const prev = r ? all.filter(s => { const d = toDate(s.fecha); return d >= prevFrom && d < from; }) : [];

  const ingresos = sum(inRange, s => num(s.total));
  const ingresosPrev = sum(prev, s => num(s.total));
  const costoVendido = sum(inRange, s => (costOf(s) ?? 0) * num(s.cantidad));
  const sinCosto = inRange.filter(s => costOf(s) == null).length;
  const ganancia = ingresos - costoVendido;
  const piezas = sum(inRange, s => num(s.cantidad));
  const tickets = new Set(inRange.map(ticketKey)).size;
  const ticket = tickets ? ingresos / tickets : 0;
  const desc = sum(inRange, s => Math.max(0, (num(s.precioLista) - num(s.precioUnit)) * num(s.cantidad)) * (s.precioLista != null ? 1 : 0));

  let inversion = 0, valor = 0, piezasStock = 0, gramos = 0, metal = 0, sinCostoP = 0, sinFoto = 0, lowN = 0;
  S.products.forEach(p => {
    const st = stockOf(p), c = num(S.costs.get(p.id)?.costo), g = st * num(p.pesoGramos);
    inversion += st * c; valor += st * num(p.precio); piezasStock += st; gramos += g; metal += g * metalPrice(p.material);
    if (S.costs.get(p.id)?.costo == null) sinCostoP++;
    if (imgOf(p) === PLACEHOLDER) sinFoto++;
    if (isLow(p)) lowN++;
  });
  const apAct = S.apartados.filter(a => a.estado === "activo");
  const porCobrar = sum(apAct, a => num(a.total) - num(a.pagado));
  const venc = apAct.filter(isOverdue).length;
  const pend = S.orders.filter(o => o.estado === "pendiente").length;
  const idle = idleList(), capIdle = sum(idle, x => x.capital);
  const delta = r && ingresosPrev > 0 ? Math.round((ingresos - ingresosPrev) / ingresosPrev * 100) : null;

  // ── alertas accionables ──
  const al = [];
  if (S.rulesMissing) al.push(["fa-shield-halved", "Publica las reglas nuevas de Firestore para activar apartados, movimientos y ajustes", "r", null]);
  if (pend) al.push(["fa-brands fa-whatsapp", `${pend} pedido(s) web por confirmar`, "r", () => go("pedidos")]);
  if (venc) al.push(["fa-hourglass-end", `${venc} apartado(s) vencido(s)`, "y", () => { S.apFilter = "vencido"; go("apartados"); }]);
  if (lowN) al.push(["fa-box-open", `${lowN} pieza(s) con stock bajo`, "y", () => { $("#pfState").value = "bajo"; go("productos"); }]);
  if (sinCostoP) al.push(["fa-calculator", `${sinCostoP} producto(s) sin costo: su ganancia no se calcula`, "", () => { $("#pfState").value = "sincosto"; go("productos"); }]);
  if (!Object.values(aj.metales || {}).some(v => num(v) > 0)) al.push(["fa-scale-balanced", "Captura el precio del metal por gramo", "", () => go("ajustes")]);
  if (sinFoto) al.push(["fa-camera", `${sinFoto} producto(s) sin foto`, "", () => { $("#pfState").value = "sinfoto"; go("productos"); }]);
  $("#alerts").innerHTML = al.map(([i, t, c], k) => `<button class="alert ${c}" data-al="${k}"><i class="${i.startsWith("fa-brands") ? i : "fa-solid " + i}"></i>${esc(t)}${al[k][3] ? '<i class="fa-solid fa-chevron-right go"></i>' : ""}</button>`).join("");
  $$("#alerts [data-al]").forEach(b => b.onclick = () => al[+b.dataset.al][3]?.());

  // ── meta del mes ──
  const mStart = new Date(now.getFullYear(), now.getMonth(), 1), dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const mInc = sum(all.filter(s => toDate(s.fecha) >= mStart), s => num(s.total)), goal = num(aj.meta);
  const proj = mInc / now.getDate() * dim, left = Math.max(0, goal - mInc), daysLeft = dim - now.getDate() + 1;
  const pct = goal ? Math.min(100, mInc / goal * 100) : 0;
  $("#goalCard").innerHTML = goal ? `
    <div class="goal-top"><div><small>Meta de ${now.toLocaleDateString("es-MX", { month: "long" })}</small><b>${money(mInc)} <span>de ${money(goal)}</span></b></div>
      <div class="goal-pct ${pct >= 100 ? "done" : ""}">${Math.round(mInc / goal * 100)}%</div></div>
    <div class="bar"><i style="width:${pct}%"></i><em style="left:${Math.min(100, now.getDate() / dim * 100)}%" title="Hoy"></em></div>
    <div class="goal-foot"><span>Proyección al cierre: <b>${money(Math.round(proj))}</b> ${proj >= goal ? '<span class="chip g">en ruta</span>' : '<span class="chip y">por debajo</span>'}</span>
      <span>${left ? `Faltan ${money(left)} · ${money(Math.ceil(left / daysLeft))} por día` : "¡Meta cumplida! 🎉"}</span></div>`
    : `<div class="goal-empty"><i class="fa-solid fa-bullseye"></i><span>Este mes llevas <b>${money(mInc)}</b>. Define una meta mensual para ver tu avance y proyección.</span><button class="btn sm ghost" id="goalSet">Definir meta</button></div>`;
  $("#goalSet")?.addEventListener("click", () => go("ajustes"));

  const kpi = (label, value, note = "", cls = "", icon = "") => `<div class="kpi">${icon ? `<i class="fa-solid ${icon} ki"></i>` : ""}<small>${label}</small><b>${value}</b>${note ? `<em class="${cls}">${note}</em>` : ""}</div>`;
  $("#kpis").innerHTML =
    kpi("Ingresos", money(ingresos), delta == null ? (r ? "sin periodo previo" : "todo el historial") : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% vs. periodo anterior`, delta == null ? "" : delta >= 0 ? "up" : "down", "fa-sack-dollar") +
    kpi("Ganancia", money(ganancia), ingresos ? `margen ${Math.round(ganancia / ingresos * 100)}%${sinCosto ? ` · ${sinCosto} sin costo` : ""}` : (sinCosto ? `${sinCosto} venta(s) sin costo` : ""), "", "fa-chart-line") +
    kpi("Piezas vendidas", piezas.toLocaleString("es-MX"), `${tickets} ticket(s)${desc ? ` · ${money(desc)} en descuentos` : ""}`, "", "fa-gem") +
    kpi("Ticket promedio", money(Math.round(ticket)), "por venta", "", "fa-receipt") +
    kpi("Por cobrar en apartados", money(porCobrar), `${apAct.length} activo(s)${venc ? ` · ${venc} vencido(s)` : ""}`, venc ? "down" : "", "fa-hand-holding-dollar") +
    kpi("Inversión en inventario", money(inversion), `${piezasStock} pieza(s) en stock`, "", "fa-vault") +
    kpi("Valor de venta del stock", money(valor), `ganancia potencial ${money(valor - inversion)}`, "", "fa-tags") +
    kpi("Valor del metal", metal ? money(metal) : gramos.toLocaleString("es-MX", { maximumFractionDigits: 1 }) + " g", metal ? `${gramos.toLocaleString("es-MX", { maximumFractionDigits: 1 })} g en inventario` : "captura el precio por gramo en Ajustes", "", "fa-scale-balanced") +
    kpi("Capital sin movimiento", money(capIdle), `${idle.length} pieza(s) sin venta en ${num(aj.diasIdle) || 90} días`, capIdle ? "down" : "up", "fa-hourglass-half");

  if (!window.Chart) { $$(".chart-box").forEach(b => { if (!b.querySelector(".empty-chart")) b.insertAdjacentHTML("beforeend", '<div class="empty-chart">No se pudo cargar la librería de gráficas</div>'); }); }
  else {
    drawTrend(inRange, from);
    drawCats(inRange);
    drawInventory();
    drawTop(inRange);
    drawSellers(inRange);
    drawPay(inRange);
    drawDow(inRange);
  }

  // stock bajo
  const low = [...S.products.values()].filter(isLow).sort((a, b) => stockOf(a) - stockOf(b));
  $("#lowStock").innerHTML = low.length
    ? `<thead><tr><th>Pieza</th><th>SKU</th><th class="num">Stock</th><th class="num">Mínimo</th><th class="num">Precio</th><th></th></tr></thead><tbody>${low.slice(0, 12).map(p => `
      <tr><td data-l="Pieza"><div class="pname"><img class="thumb" src="${esc(imgOf(p))}" alt="">${esc(p.nombre)}</div></td><td data-l="SKU">${esc(p.sku || "—")}</td>
      <td data-l="Stock" class="num">${stockOf(p) === 0 ? '<span class="chip r">Agotado</span>' : `<span class="chip y">${stockOf(p)}</span>`}</td><td data-l="Mínimo" class="num">${minOf(p)}</td><td data-l="Precio" class="num">${money(p.precio)}</td>
      <td class="num act"><button class="btn sm ghost" data-edit="${p.id}">Editar</button></td></tr>`).join("")}</tbody>`
    : `<tbody><tr><td class="empty">Todo el inventario está por encima de su stock mínimo.</td></tr></tbody>`;

  $("#idleSub").textContent = `sin venta en ${num(aj.diasIdle) || 90} días · ponles promoción o muévelas a exhibición`;
  $("#idleTbl").innerHTML = idle.length
    ? `<thead><tr><th>Pieza</th><th class="num">Stock</th><th>Última venta</th><th class="num">Capital detenido</th><th></th></tr></thead><tbody>${idle.slice(0, 10).map(({ p, last, capital }) => `
      <tr><td data-l="Pieza"><div class="pname"><img class="thumb" src="${esc(imgOf(p))}" alt="">${esc(p.nombre)}</div></td><td data-l="Stock" class="num">${stockOf(p)}</td>
      <td data-l="Última venta">${last ? fmtD(last) : '<span class="muted">nunca</span>'}</td><td data-l="Capital" class="num">${capital ? money(capital) : '<span class="chip">sin costo</span>'}</td>
      <td class="num act">${p.etiquetas?.promocion ? '<span class="chip gold">en promoción</span>' : `<button class="btn sm ghost" data-promo="${p.id}"><i class="fa-solid fa-bolt"></i> Promoción</button>`} <button class="btn sm ghost" data-edit="${p.id}">Editar</button></td></tr>`).join("")}</tbody>`
    : `<tbody><tr><td class="empty">Todas tus piezas se han movido recientemente. 👌</td></tr></tbody>`;
  $$("#lowStock [data-edit], #idleTbl [data-edit]").forEach(b => b.onclick = () => openProduct(b.dataset.edit));
  $$("#idleTbl [data-promo]").forEach(b => b.onclick = async () => {
    try { await updateDoc(doc(db, COL.productos, b.dataset.promo), { "etiquetas.promocion": true, actualizadoEn: serverTimestamp() }); toast("Marcada con la etiqueta Promoción en la tienda"); }
    catch (e) { toast(fbErr(e), true); }
  });
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
function drawPay(list) {
  const m = {}; list.forEach(s => { const k = s.apartadoId ? "Apartado" : (s.metodoPago || "Otro"); m[k] = (m[k] || 0) + num(s.total); });
  const rows = Object.entries(m).sort((a, b) => b[1] - a[1]);
  hbar("chPay", rows.map(r => r[0]), rows.map(r => r[1]), "Ingresos", money, "Sin ventas en este periodo");
}
function drawDow(list) {
  const v = [0, 0, 0, 0, 0, 0, 0]; list.forEach(s => { const d = toDate(s.fecha); if (d) v[(d.getDay() + 6) % 7] += num(s.total); });
  upsertChart("chDow", {
    type: "bar",
    data: { labels: DOW, datasets: [{ label: "Ingresos", data: v, backgroundColor: SERIES[0], borderRadius: 4, borderSkipped: "start", maxBarThickness: 34 }] },
    options: { plugins: { tooltip: moneyTip }, scales: { x: axisPlain, y: { ...axisMoney, beginAtZero: true } } }
  }, list.length ? null : "Sin ventas en este periodo");
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
   PUNTO DE VENTA (ticket con varias piezas, escáner, descuento)
═══════════════════════════════════════════════════════════════ */
const availOf = p => p.porPedido === true ? Infinity : stockOf(p);
const inCart = pid => sum(S.cart.filter(l => l.pid === pid), l => l.qty);

$("#sfSearch").addEventListener("input", () => renderPickList());
// lector de código de barras: escribe el SKU y manda Enter
$("#sfSearch").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const q = e.target.value.trim().toLowerCase(); if (!q) return;
  const exact = [...S.products.values()].find(p => String(p.sku || "").toLowerCase() === q);
  const list = exact ? [exact] : pickFiltered();
  if (list.length === 1) { addToTicket(list[0].id); e.target.value = ""; renderPickList(); }
  else if (!list.length) toast("No se encontró ese código", true);
});
document.addEventListener("keydown", e => {
  if (e.key === "/" && S.view === "vender" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "") && !$(".modal.open")) { e.preventDefault(); $("#sfSearch").focus(); }
});
["#sfDisc", "#sfCash"].forEach(id => $(id).addEventListener("input", renderTicketSum));
["#sfDiscType", "#sfPay"].forEach(id => $(id).addEventListener("change", () => { $("#sfCashWrap").classList.toggle("off", $("#sfPay").value !== "Efectivo"); renderTicketSum(); }));
$("#sfClear").onclick = () => { S.cart = []; resetTicketFields(); renderTicket(); renderPickList(); };
// autocompletar cliente conocido
$("#sfClient").addEventListener("change", () => {
  if ($("#sfTel").value.trim()) return;
  const c = buildClients().find(c => c.nombre && c.nombre.toLowerCase() === $("#sfClient").value.trim().toLowerCase());
  if (c?.tel) $("#sfTel").value = c.tel;
});
$("#sfTel").addEventListener("change", () => {
  if ($("#sfClient").value.trim()) return;
  const t = normTel($("#sfTel").value); if (t.length < 10) return;
  const c = buildClients().find(c => normTel(c.tel) === t);
  if (c?.nombre) $("#sfClient").value = c.nombre;
});

function pickFiltered() {
  const q = $("#sfSearch").value.trim().toLowerCase(), cat = S.posCat;
  return [...S.products.values()]
    .filter(p => (!cat || p.categoria === cat) && (!q || [p.nombre, p.material, p.sku, p.piedra, p.talla, CAT_LABEL[p.categoria]].some(v => String(v || "").toLowerCase().includes(q))))
    .sort((a, b) => (availOf(b) > 0) - (availOf(a) > 0) || String(a.nombre).localeCompare(String(b.nombre)));
}

function renderSell() {
  const present = new Set([...S.products.values()].map(p => p.categoria));
  const cats = [["", "Todas"], ...CATS.filter(([v]) => present.has(v))];
  $("#sfCats").innerHTML = cats.map(([v, l]) => `<button type="button" class="${S.posCat === v ? "on" : ""}" data-c="${v}">${l}</button>`).join("");
  $$("#sfCats button").forEach(b => b.onclick = () => { S.posCat = b.dataset.c; renderSell(); });
  renderPickList();
  if (!$("#tkLines").contains(document.activeElement)) renderTicket(); // no interrumpir mientras se edita un precio
  if (isAdmin()) {
    const sel = $("#sfSeller"), cur = sel.value;
    sel.innerHTML = `<option value="${ADMIN_UID}">Administrador</option>` + [...S.vendors.values()].filter(v => v.activo !== false).map(v => `<option value="${v.id}">${esc(v.nombre)}</option>`).join("");
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  }
  $("#clientList").innerHTML = buildClients().filter(c => c.nombre).slice(0, 300).map(c => `<option value="${esc(c.nombre)}">${esc(c.tel || c.correo || "")}</option>`).join("");
  $("#sfCashWrap").classList.toggle("off", $("#sfPay").value !== "Efectivo");

  const today = startOfDay(new Date());
  const list = okSales().filter(s => toDate(s.fecha) >= today);
  const abonosHoy = sum(S.apartados, a => sum((a.abonos || []).filter(x => toDate(x.fecha) >= today), x => num(x.monto)));
  $("#recentTitle").textContent = isAdmin() ? "Ventas de hoy" : "Mis ventas de hoy";
  $("#todayKpis").innerHTML = `<div><small>Tickets</small><b>${new Set(list.map(ticketKey)).size}</b></div><div><small>Piezas</small><b>${sum(list, s => num(s.cantidad))}</b></div><div><small>Vendido</small><b>${money(sum(list, s => num(s.total)))}</b></div><div><small>Abonos de apartados</small><b>${money(abonosHoy)}</b></div>`;
  $("#recentFeed").innerHTML = list.length ? list.slice(0, 15).map(s => `
    <div class="feed-item"><img src="${esc(s.imagen || imgOf(S.products.get(s.productoId)))}" alt="">
      <div class="fi"><b>${esc(s.productoNombre)}</b><small>${s.cantidad} pz · ${esc(sellerLabel(s))} · ${esc(s.metodoPago || "")} · ${toDate(s.fecha)?.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) || ""}${s.ticketFolio ? " · " + esc(s.ticketFolio) : ""}</small></div>
      <div class="fv">${money(s.total)}</div></div>`).join("")
    : `<p class="muted small">Aún no hay ventas hoy.</p>`;
}

function renderPickList() {
  const list = pickFiltered();
  $("#sfList").innerHTML = list.length ? list.slice(0, 150).map(p => {
    const n = inCart(p.id), out = availOf(p) - n <= 0, st = stockOf(p);
    return `<button type="button" class="pk ${out ? "out" : ""} ${n ? "in" : ""}" data-id="${p.id}" ${out ? "disabled" : ""}>
      <span class="pk-img" style="background-image:url('${esc(imgOf(p))}')">${n ? `<b class="pk-n">${n}</b>` : ""}</span>
      <span class="pk-b"><b>${esc(p.nombre)}</b><small>${p.sku ? esc(p.sku) + " · " : ""}${st ? st + " pz" : p.porPedido ? "Bajo pedido" : "Agotado"}${p.pesoGramos ? " · " + p.pesoGramos + " g" : ""}</small><em>${money(p.precio)}</em></span>
    </button>`;
  }).join("") : `<p class="muted small" style="padding:14px">No hay productos que coincidan.</p>`;
  $$("#sfList .pk").forEach(b => b.onclick = () => addToTicket(b.dataset.id));
}

function addToTicket(pid) {
  const p = S.products.get(pid); if (!p) return;
  if (availOf(p) - inCart(pid) <= 0) { toast(`No hay más piezas de "${p.nombre}"`, true); return; }
  const l = S.cart.find(x => x.pid === pid);
  if (l) l.qty++; else S.cart.push({ pid, qty: 1, price: num(p.precio) });
  renderTicket(); renderPickList();
}

function renderTicket() {
  S.cart = S.cart.filter(l => S.products.has(l.pid));
  const n = sum(S.cart, l => l.qty);
  $("#tkCount").textContent = n ? `· ${n} pz` : "";
  $("#tkLines").innerHTML = S.cart.length ? S.cart.map((l, i) => {
    const p = S.products.get(l.pid), lp = num(p.precio), off = lp > 0 && l.price < lp ? Math.round((1 - l.price / lp) * 100) : 0;
    return `<div class="tk-line"><img src="${esc(imgOf(p))}" alt="">
      <div class="tk-i"><b>${esc(p.nombre)}</b><small>${p.sku ? esc(p.sku) + " · " : ""}lista ${money(lp)}${off ? ` <span class="chip y">−${off}%</span>` : ""}${stockOf(p) < l.qty ? ' <span class="chip c">bajo pedido</span>' : ""}</small>
        <div class="tk-ctl"><div class="qty-ctl"><button type="button" data-q="${i}" data-d="-1" aria-label="Menos">−</button><span>${l.qty}</span><button type="button" data-q="${i}" data-d="1" aria-label="Más">+</button></div>
        <label class="tk-price"><span>$</span><input type="number" min="0" step="0.01" value="${l.price}" data-pr="${i}" inputmode="decimal" aria-label="Precio unitario"></label></div></div>
      <div class="tk-t"><b data-lt="${i}">${money(l.qty * l.price)}</b><button type="button" class="icon-btn" data-rm="${i}" aria-label="Quitar"><i class="fa-solid fa-xmark"></i></button></div></div>`;
  }).join("") : `<div class="tk-empty"><i class="fa-regular fa-gem"></i>Toca una pieza o escanea su código para agregarla al ticket.</div>`;
  $$("#tkLines [data-q]").forEach(b => b.onclick = () => {
    const l = S.cart[+b.dataset.q], d = +b.dataset.d, p = S.products.get(l.pid);
    if (d > 0 && availOf(p) - inCart(l.pid) <= 0) { toast("No hay más piezas disponibles", true); return; }
    l.qty += d; if (l.qty <= 0) S.cart.splice(+b.dataset.q, 1);
    renderTicket(); renderPickList();
  });
  $$("#tkLines [data-pr]").forEach(inp => {
    inp.oninput = () => { const l = S.cart[+inp.dataset.pr]; l.price = Math.max(0, num(inp.value)); $(`[data-lt="${inp.dataset.pr}"]`).textContent = money(l.qty * l.price); renderTicketSum(); };
    inp.onchange = () => renderTicket();
  });
  $$("#tkLines [data-rm]").forEach(b => b.onclick = () => { S.cart.splice(+b.dataset.rm, 1); renderTicket(); renderPickList(); });
  renderTicketSum();
}
function ticketTotals() {
  const sub = r2(sum(S.cart, l => l.qty * l.price));
  const dv = Math.max(0, num($("#sfDisc").value));
  const disc = r2(Math.min(sub, $("#sfDiscType").value === "pct" ? sub * Math.min(dv, 100) / 100 : dv));
  return { sub, disc, total: r2(sub - disc) };
}
function renderTicketSum() {
  const t = ticketTotals(), cash = num($("#sfCash").value), ef = $("#sfPay").value === "Efectivo";
  $("#tkSum").innerHTML = `<div><span>Subtotal</span><span>${money(t.sub)}</span></div>${t.disc ? `<div class="g"><span>Descuento</span><span>−${money(t.disc)}</span></div>` : ""}
    <div class="tot"><span>Total</span><b>${money(t.total)}</b></div>
    ${ef && cash > 0 && S.cart.length ? `<div class="${cash >= t.total ? "g" : "r"}"><span>${cash >= t.total ? "Cambio" : "Falta"}</span><span>${money(Math.abs(cash - t.total))}</span></div>` : ""}`;
  $("#sfBtn").disabled = !S.cart.length; $("#sfLayaway").disabled = !S.cart.length;
}
function resetTicketFields() { ["#sfClient", "#sfTel", "#sfNote", "#sfCash"].forEach(id => $(id).value = ""); $("#sfDisc").value = 0; }
function currentSeller() {
  if (!isAdmin()) return { id: S.me.uid, nombre: S.me.nombre };
  const id = $("#sfSeller").value || ADMIN_UID;
  return id === ADMIN_UID ? { id, nombre: "Administrador" } : { id, nombre: S.vendors.get(id)?.nombre || "Vendedor" };
}

$("#saleForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!S.cart.length) { toast("Agrega al menos una pieza", true); return; }
  const t = ticketTotals(), seller = currentSeller(), pay = $("#sfPay").value, cash = num($("#sfCash").value);
  if (pay === "Efectivo" && cash > 0 && cash < t.total) { toast(`Falta ${money(t.total - cash)} en efectivo`, true); return; }
  const btn = $("#sfBtn"); btn.disabled = true; loading(true);
  try {
    const tk = await registerTicket({
      lines: S.cart.map(l => ({ ...l })), totals: t, pay, cash,
      client: $("#sfClient").value.trim(), tel: $("#sfTel").value.trim(), note: $("#sfNote").value.trim(),
      seller, canal: isAdmin() && seller.id === ADMIN_UID ? "admin" : "vendedor"
    });
    S.cart = []; resetTicketFields(); renderSell(); loading(false);
    showReceiptDialog(tk, "Venta registrada");
  } catch (err) { loading(false); toast(err.userMsg || fbErr(err), true); }
  btn.disabled = false;
});

/** Lee el stock de todas las piezas del ticket, valida y lo descuenta en una sola transacción. */
async function reserveLines(tx, lines) {
  const ids = [...new Set(lines.map(l => l.pid))], snaps = {};
  for (const pid of ids) snaps[pid] = await tx.get(doc(db, COL.productos, pid));
  const stock = {}; ids.forEach(pid => stock[pid] = snaps[pid].exists() ? stockOf(snaps[pid].data()) : 0);
  const plan = lines.map(l => {
    const ps = snaps[l.pid]; if (!ps.exists()) throw ue("Una pieza del ticket ya no existe en el catálogo");
    const p = ps.data(); let desc = l.qty, pp = false;
    if (stock[l.pid] < l.qty) { if (p.porPedido !== true) throw ue(`Solo hay ${stock[l.pid]} pieza(s) de "${p.nombre}"`); desc = stock[l.pid]; pp = true; }
    stock[l.pid] -= desc;
    return { l, p, desc, pp };
  });
  return { plan, commit: () => ids.forEach(pid => { if (stock[pid] !== stockOf(snaps[pid].data())) tx.update(doc(db, COL.productos, pid), { cantidad: stock[pid], actualizadoEn: serverTimestamp() }); }) };
}

async function registerTicket({ lines, totals, pay, cash = 0, client, tel, note, seller, canal }) {
  const ticketId = doc(collection(db, COL.ventas)).id, folio = folioGen("T");
  const factor = totals.sub > 0 ? totals.total / totals.sub : 1;
  let out = [];
  await runTransaction(db, async tx => {
    const { plan, commit } = await reserveLines(tx, lines);
    commit(); out = [];
    plan.forEach(({ l, p, desc, pp }) => {
      const vRef = doc(collection(db, COL.ventas)), unit = r2(l.price * factor), img = imgOf(p);
      const sale = {
        productoId: l.pid, productoNombre: p.nombre || "", sku: p.sku || "", categoria: p.categoria || "otros",
        imagen: /^https?:/.test(img) ? img : null,
        cantidad: l.qty, precioLista: num(p.precio), precioUnit: unit, total: r2(unit * l.qty),
        metodoPago: pay || "", cliente: client || "", clienteTel: tel || "", nota: note || "",
        vendedorId: seller.id, vendedorNombre: seller.nombre, canal,
        estado: "completada", bajoPedido: pp, descontado: desc, pedidoId: null,
        ticketId, ticketFolio: folio, registradoPor: S.me.uid, fecha: serverTimestamp()
      };
      if (isAdmin()) { const c = S.costs.get(l.pid)?.costo; sale.costoUnit = c != null ? num(c) : null; }
      tx.set(vRef, sale);
      out.push({ nombre: p.nombre, sku: p.sku || "", qty: l.qty, unit, total: sale.total, pp });
    });
  });
  return { kind: "Ticket de venta", folio, fecha: new Date(), lines: out, ...totals, pay, cash, client, tel, note, seller: seller.nombre };
}

/* ── Recibos: impresión (80 mm) y WhatsApp ── */
const RCPT_CSS = `@page{size:80mm auto;margin:4mm}*{box-sizing:border-box}body{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#000;width:72mm;margin:0 auto;padding:6px 0}
h1{font-family:Georgia,'Times New Roman',serif;letter-spacing:4px;text-align:center;font-size:19px;margin:2px 0 4px}.c{text-align:center}.s{font-size:10.5px}
table{width:100%;border-collapse:collapse}td{padding:2px 0;vertical-align:top}.r{text-align:right;white-space:nowrap;padding-left:6px}
hr{border:none;border-top:1px dashed #000;margin:7px 0}.tot td{font-weight:700;font-size:15px;padding-top:4px}.big{font-size:15px;font-weight:700}
@media screen{body{padding:16px 0}.np{display:block;margin:14px auto;padding:10px 18px;font:inherit;border:1px solid #000;background:#fff;cursor:pointer}}@media print{.np{display:none}}`;
function printDoc(title, inner, css, autoprint = true) {
  const w = window.open("", "_blank", "width=440,height=720");
  if (!w) { toast("Permite las ventanas emergentes para imprimir", true); return null; }
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${css}</style></head><body>${inner}${autoprint ? `<script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script>` : ""}</body></html>`);
  w.document.close();
  return w;
}
function receiptHtml(tk) {
  const b = BIZ();
  const lines = tk.lines.map(l => `<tr><td>${l.qty} × ${esc(l.nombre)}${l.sku ? `<br><span class="s">${esc(l.sku)}</span>` : ""}${l.pp ? '<br><span class="s">(bajo pedido)</span>' : ""}</td><td class="r">${money(l.total)}</td></tr>`).join("");
  const abonos = (tk.abonos || []).map(a => `<tr><td class="s">${fmtD(a.fecha)} · ${esc(a.metodo || "")}</td><td class="r s">${money(a.monto)}</td></tr>`).join("");
  return `<h1>${esc(b.nombre)}</h1>
    <div class="c s">${[b.dir, b.tel ? "Tel. " + b.tel : "", b.ig].filter(Boolean).map(esc).join("<br>")}</div><hr>
    <div class="c big">${esc(tk.kind)}</div>
    <div class="c">Folio <b>${esc(tk.folio)}</b><br>${esc(fmtDT(tk.fecha))}</div><hr>
    ${tk.client ? `<div>Cliente: ${esc(tk.client)}${tk.tel ? " · " + esc(tk.tel) : ""}</div>` : ""}
    <div>Atendió: ${esc(tk.seller || "")}</div><hr>
    <table>${lines}</table><hr>
    <table><tr><td>Subtotal</td><td class="r">${money(tk.sub)}</td></tr>
    ${tk.disc ? `<tr><td>Descuento</td><td class="r">−${money(tk.disc)}</td></tr>` : ""}
    <tr class="tot"><td>TOTAL</td><td class="r">${money(tk.total)}</td></tr>
    ${tk.pagado != null ? `<tr><td>Pagado</td><td class="r">${money(tk.pagado)}</td></tr><tr class="tot"><td>SALDO</td><td class="r">${money(Math.max(0, tk.total - tk.pagado))}</td></tr>` : `<tr><td>Pago</td><td class="r">${esc(tk.pay || "")}</td></tr>`}
    ${tk.cash > 0 && tk.pay === "Efectivo" ? `<tr><td>Recibido</td><td class="r">${money(tk.cash)}</td></tr><tr><td>Cambio</td><td class="r">${money(Math.max(0, tk.cash - tk.total))}</td></tr>` : ""}</table>
    ${abonos ? `<hr><div class="s"><b>Abonos</b></div><table>${abonos}</table>` : ""}
    ${tk.limite ? `<hr><div class="c">Fecha límite para liquidar:<br><b>${esc(fmtD(tk.limite))}</b></div>` : ""}
    ${tk.note ? `<hr><div class="s">Nota: ${esc(tk.note)}</div>` : ""}
    <hr><div class="c s">${esc(b.pie || "Gracias por tu compra")}</div><div class="c s" style="margin-top:6px">¡Gracias por elegirnos! ✦</div>
    <button class="np" onclick="window.print()">Imprimir</button>`;
}
const printReceipt = tk => printDoc(`${tk.kind} ${tk.folio}`, receiptHtml(tk), RCPT_CSS);
function receiptText(tk) {
  const b = BIZ();
  const L = [`💎 *${b.nombre}*`, `${tk.kind} *${tk.folio}*`, fmtDT(tk.fecha), ""];
  tk.lines.forEach(l => L.push(`• ${l.qty} × ${l.nombre} — ${money(l.total)}`));
  L.push("");
  if (tk.disc) L.push(`Subtotal: ${money(tk.sub)}`, `Descuento: −${money(tk.disc)}`);
  L.push(`*Total: ${money(tk.total)}*`);
  if (tk.pagado != null) { L.push(`Pagado: ${money(tk.pagado)}`, `*Saldo: ${money(Math.max(0, tk.total - tk.pagado))}*`); if (tk.limite) L.push(`Fecha límite: ${fmtD(tk.limite)}`); }
  else if (tk.pay) L.push(`Pago: ${tk.pay}`);
  if (b.pie) L.push("", b.pie);
  L.push("", "¡Gracias por tu compra! ✨");
  return L.join("\n");
}
const sendReceiptWa = tk => window.open(tk.tel ? waUrl(tk.tel, receiptText(tk)) : `https://wa.me/?text=${encodeURIComponent(receiptText(tk))}`, "_blank", "noopener");
function showReceiptDialog(tk, title) {
  const p = dialog({
    title: `${title} · ${tk.folio}`, ok: "Listo", cancel: false,
    body: `<div class="rcpt-sum"><i class="fa-solid fa-circle-check"></i><b>${money(tk.pagado != null ? tk.pagado : tk.total)}</b>
      <small>${tk.pagado != null ? `anticipo · saldo ${money(Math.max(0, tk.total - tk.pagado))}` : `${sum(tk.lines, l => l.qty)} pieza(s) · ${esc(tk.pay)}`}${tk.cash > tk.total && tk.pay === "Efectivo" ? ` · <b>cambio ${money(tk.cash - tk.total)}</b>` : ""}</small></div>
      <div class="stack"><button type="button" class="btn ghost block" id="rcPrint"><i class="fa-solid fa-print"></i> Imprimir ticket</button>
      <button type="button" class="btn ok block" id="rcWa"><i class="fa-brands fa-whatsapp"></i> Enviar por WhatsApp${tk.tel ? "" : " (elegir contacto)"}</button></div>`
  });
  $("#rcPrint").onclick = () => printReceipt(tk);
  $("#rcWa").onclick = () => sendReceiptWa(tk);
  return p;
}
/** Reconstruye un ticket a partir de sus ventas (para reimprimir). */
function ticketFromSales(key) {
  const rows = S.sales.filter(s => ticketKey(s) === key && s.estado !== "cancelada");
  if (!rows.length) return null;
  const f = rows[0], total = sum(rows, s => num(s.total)), lista = sum(rows, s => (s.precioLista != null ? num(s.precioLista) : num(s.precioUnit)) * num(s.cantidad));
  return {
    kind: f.apartadoId ? "Ticket de apartado liquidado" : "Ticket de venta", folio: f.ticketFolio || f.id.slice(0, 6).toUpperCase(), fecha: toDate(f.fecha) || new Date(),
    lines: rows.map(s => ({ nombre: s.productoNombre, sku: s.sku || "", qty: num(s.cantidad), unit: num(s.precioUnit), total: num(s.total), pp: s.bajoPedido })),
    sub: r2(Math.max(lista, total)), disc: r2(Math.max(0, lista - total)), total: r2(total), pay: f.apartadoId ? "Apartado" : f.metodoPago, client: f.cliente, tel: f.clienteTel, note: f.nota, seller: sellerLabel(f)
  };
}

/* ── Apartar desde el ticket ── */
$("#sfLayaway").onclick = async () => {
  if (!S.cart.length) return;
  const client = $("#sfClient").value.trim(), tel = $("#sfTel").value.trim();
  if (!client) { toast("Escribe el nombre del cliente para apartar", true); $("#sfClient").focus(); return; }
  const t = ticketTotals(), aj = AJ(), minDown = Math.ceil(t.total * num(aj.anticipo) / 100);
  let down = minDown, pay = $("#sfPay").value, limitD = ymd(new Date(Date.now() + (num(aj.plazo) || 30) * 86400000));
  const ok = await dialog({
    title: "Nuevo apartado", ok: "Crear apartado",
    body: `<div class="stack"><p class="muted small">Total <b>${money(t.total)}</b> · anticipo mínimo ${num(aj.anticipo)}% = <b>${money(minDown)}</b>. Las piezas se reservan: salen del stock y de la tienda hasta que se liquide o se cancele.</p>
      <label class="fld"><span>Anticipo que deja hoy</span><input type="number" id="apDown" min="0" step="0.01" value="${minDown}" inputmode="decimal"></label>
      <label class="fld"><span>Método del anticipo</span><select id="apPay">${payOpts(pay)}</select></label>
      <label class="fld"><span>Fecha límite para liquidar</span><input type="date" id="apLimit" value="${limitD}"></label></div>`,
    onOk: () => {
      down = r2(num($("#apDown").value)); pay = $("#apPay").value; limitD = $("#apLimit").value;
      if (down < 0 || down > t.total) { toast("Anticipo inválido", true); return false; }
      if (down < minDown && !isAdmin()) { toast(`El anticipo mínimo es ${money(minDown)}`, true); return false; }
      if (!limitD) { toast("Elige la fecha límite", true); return false; }
    }
  });
  if (!ok) return;
  loading(true);
  try {
    const tk = await createLayaway({ lines: S.cart.map(l => ({ ...l })), totals: t, client, tel, note: $("#sfNote").value.trim(), seller: currentSeller(), down, pay, limitD });
    S.cart = []; resetTicketFields(); renderSell(); loading(false);
    showReceiptDialog(tk, "Apartado creado");
  } catch (err) { loading(false); toast(err.userMsg || fbErr(err), true); }
};

/* ═══════════════════════════════════════════════════════════════
   CORTE DE CAJA (ventas directas + abonos de apartados del día)
═══════════════════════════════════════════════════════════════ */
function cutData(day) {
  const from = new Date(day + "T00:00:00"), to = new Date(day + "T23:59:59.999");
  const inDay = v => { const d = toDate(v); return d && d >= from && d <= to; };
  const sales = S.sales.filter(s => inDay(s.fecha));
  const ok = sales.filter(s => s.estado !== "cancelada"), canc = sales.filter(s => s.estado === "cancelada");
  const direct = ok.filter(s => !s.apartadoId);
  const byPay = {}, bySeller = {};
  direct.forEach(s => { const k = s.metodoPago || "Otro"; byPay[k] = (byPay[k] || 0) + num(s.total); });
  const abonos = [];
  S.apartados.forEach(a => (a.abonos || []).forEach(x => { if (inDay(x.fecha)) abonos.push({ ...x, folio: a.folio, cliente: a.cliente }); }));
  abonos.forEach(x => { const k = x.metodo || "Otro"; byPay[k] = (byPay[k] || 0) + num(x.monto); });
  ok.forEach(s => { const k = sellerLabel(s); bySeller[k] = (bySeller[k] || 0) + num(s.total); });
  return {
    day, ok, canc, direct, abonos, byPay, bySeller,
    tickets: new Set(direct.map(ticketKey)).size, piezas: sum(ok, s => num(s.cantidad)),
    vendido: sum(direct, s => num(s.total)), entregados: sum(ok.filter(s => s.apartadoId), s => num(s.total)),
    cobrado: sum(direct, s => num(s.total)) + sum(abonos, x => num(x.monto)),
    descuentos: sum(ok, s => s.precioLista != null ? Math.max(0, (num(s.precioLista) - num(s.precioUnit)) * num(s.cantidad)) : 0)
  };
}
function cutHtml(c, forPrint = false) {
  const rows = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => forPrint ? `<tr><td>${esc(k)}</td><td class="r">${money(v)}</td></tr>` : `<div class="oline"><span>${esc(k)}</span><span>${money(v)}</span></div>`).join("") || (forPrint ? "<tr><td>—</td></tr>" : '<p class="muted small">—</p>');
  if (forPrint) return `<h1>${esc(BIZ().nombre)}</h1><div class="c big">Corte de caja</div><div class="c">${esc(fmtD(new Date(c.day + "T12:00:00")))}${isAdmin() ? "" : "<br>" + esc(S.me.nombre)}</div><hr>
    <table><tr><td>Tickets</td><td class="r">${c.tickets}</td></tr><tr><td>Piezas</td><td class="r">${c.piezas}</td></tr><tr><td>Ventas directas</td><td class="r">${money(c.vendido)}</td></tr><tr><td>Abonos de apartados</td><td class="r">${money(sum(c.abonos, x => num(x.monto)))}</td></tr><tr><td>Descuentos dados</td><td class="r">${money(c.descuentos)}</td></tr><tr><td>Cancelaciones</td><td class="r">${c.canc.length}</td></tr></table><hr>
    <div><b>Dinero recibido por método</b></div><table>${rows(c.byPay)}<tr class="tot"><td>TOTAL</td><td class="r">${money(c.cobrado)}</td></tr></table><hr>
    <div><b>Por vendedor</b></div><table>${rows(c.bySeller)}</table><hr><div class="c s">Impreso ${esc(fmtDT(new Date()))}</div><br><div class="c s">Firma: ____________________</div><button class="np" onclick="window.print()">Imprimir</button>`;
  return `<div class="mini-kpis"><div><small>Cobrado</small><b>${money(c.cobrado)}</b></div><div><small>Tickets</small><b>${c.tickets}</b></div><div><small>Piezas</small><b>${c.piezas}</b></div></div>
    <div class="cut-sec"><h4>Dinero recibido por método</h4>${rows(c.byPay)}</div>
    <div class="cut-sec"><h4>Por vendedor</h4>${rows(c.bySeller)}</div>
    <div class="cut-sec"><div class="oline"><span>Ventas directas</span><span>${money(c.vendido)}</span></div><div class="oline"><span>Abonos de apartados (${c.abonos.length})</span><span>${money(sum(c.abonos, x => num(x.monto)))}</span></div>
    <div class="oline"><span>Apartados entregados</span><span>${money(c.entregados)}</span></div><div class="oline"><span>Descuentos dados</span><span>${money(c.descuentos)}</span></div><div class="oline ${c.canc.length ? "warn" : ""}"><span>Cancelaciones</span><span>${c.canc.length}</span></div></div>`;
}
async function cashCut() {
  let day = ymd(new Date());
  const p = dialog({
    title: "Corte de caja", ok: "Cerrar", cancel: false,
    body: `<div class="stack"><div class="url-row"><input type="date" id="cutDay" value="${day}" aria-label="Día"><button type="button" class="btn ghost sm" id="cutPrint"><i class="fa-solid fa-print"></i> Imprimir</button></div><div id="cutBody"></div></div>`
  });
  const draw = () => { day = $("#cutDay").value || ymd(new Date()); $("#cutBody").innerHTML = cutHtml(cutData(day)); };
  $("#cutDay").onchange = draw; draw();
  $("#cutPrint").onclick = () => printDoc("Corte " + day, cutHtml(cutData(day), true), RCPT_CSS);
  return p;
}
$("#sfCut").onclick = cashCut;
$("#vfCut2").onclick = cashCut;

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
    if (q && ![s.productoNombre, s.cliente, s.nota, s.ticketFolio, s.sku, s.clienteTel].some(v => String(v || "").toLowerCase().includes(q))) return false;
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
  let k = `<div><small>Tickets</small><b>${new Set(ok.map(ticketKey)).size}</b></div><div><small>Piezas</small><b>${ok.reduce((a, s) => a + num(s.cantidad), 0)}</b></div><div><small>Total</small><b>${money(total)}</b></div>`;
  if (isAdmin()) k += `<div><small>Ganancia</small><b>${money(ok.reduce((a, s) => a + (profitOf(s) ?? 0), 0))}</b></div>`;
  else if (S.me.comision) k += `<div><small>Comisión (${S.me.comision}%)</small><b>${money(total * S.me.comision / 100)}</b></div>`;
  $("#histKpis").innerHTML = k;

  const head = `<thead><tr><th>Fecha</th><th>Pieza</th><th class="num">Cant.</th><th class="num">Precio u.</th><th class="num">Total</th>${isAdmin() ? '<th class="num">Ganancia</th><th>Vendedor</th>' : ""}<th>Pago</th><th>Cliente</th><th>Estado</th><th></th></tr></thead>`;
  const body = rows.length ? rows.slice(0, 500).map(s => {
    const pr = profitOf(s), canc = s.estado === "cancelada";
    return `<tr class="${canc ? "cancel" : ""}">
      <td data-l="Fecha">${fmtDT(s.fecha)}</td>
      <td data-l="Pieza"><div class="pname"><img class="thumb" src="${esc(s.imagen || imgOf(S.products.get(s.productoId)))}" alt="" loading="lazy"><span>${esc(s.productoNombre)}${s.ticketFolio ? `<br><small class="muted">${esc(s.ticketFolio)}${s.sku ? " · " + esc(s.sku) : ""}</small>` : ""}</span></div></td>
      <td data-l="Cantidad" class="num">${s.cantidad}</td>
      <td data-l="Precio u." class="num">${money(s.precioUnit)}${s.precioLista != null && num(s.precioLista) > num(s.precioUnit) ? `<br><small class="muted" style="text-decoration:line-through">${money(s.precioLista)}</small>` : ""}</td>
      <td data-l="Total" class="num"><b>${money(s.total)}</b></td>
      ${isAdmin() ? `<td data-l="Ganancia" class="num">${pr == null ? '<span class="chip">sin costo</span>' : money(pr)}</td><td data-l="Vendedor">${esc(sellerLabel(s))}</td>` : ""}
      <td data-l="Pago">${esc(s.metodoPago || "—")}</td>
      <td data-l="Cliente">${esc(s.cliente || "—")}${s.nota ? `<br><small class="muted">${esc(s.nota)}</small>` : ""}</td>
      <td data-l="Estado">${canc ? '<span class="chip r">Cancelada</span>' : s.bajoPedido ? '<span class="chip c">Bajo pedido</span>' : s.apartadoId ? '<span class="chip gold">Apartado</span>' : '<span class="chip g">Completada</span>'}</td>
      <td class="act num">${canc ? "" : `<button class="icon-btn" data-tk="${esc(ticketKey(s))}" title="Reimprimir ticket" aria-label="Reimprimir ticket"><i class="fa-solid fa-print"></i></button>${isAdmin() ? `<button class="btn sm danger ghost" data-cancel="${s.id}">Cancelar</button>` : ""}`}</td>
    </tr>`;
  }).join("") : `<tr><td class="empty" colspan="12">No hay ventas con estos filtros.</td></tr>`;
  $("#salesTbl").innerHTML = head + "<tbody>" + body + "</tbody>";
  $$("#salesTbl [data-cancel]").forEach(b => b.onclick = () => cancelSale(b.dataset.cancel));
  $$("#salesTbl [data-tk]").forEach(b => b.onclick = () => { const tk = ticketFromSales(b.dataset.tk); if (tk) showReceiptDialog(tk, "Ticket"); });
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
  const head = ["Fecha", "Folio", "ID venta", "SKU", "Pieza", "Categoría", "Cantidad", "Precio lista", "Precio unitario", "Total", ...(isAdmin() ? ["Costo unitario", "Ganancia"] : []), "Vendedor", "Canal", "Método de pago", "Cliente", "Teléfono", "Nota", "Estado"];
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map(s => [fmtDT(s.fecha), s.ticketFolio || "", s.id, s.sku || "", s.productoNombre, CAT_LABEL[s.categoria] || "", s.cantidad, s.precioLista ?? "", s.precioUnit, s.total,
    ...(isAdmin() ? [costOf(s) ?? "", profitOf(s) ?? ""] : []), sellerLabel(s), s.canal, s.apartadoId ? "Apartado" : s.metodoPago, s.cliente, s.clienteTel || "", s.nota, s.estado].map(q).join(","));
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

["#pfSort"].forEach(id => $(id).addEventListener("change", () => renderProducts()));

function productFiltered() {
  const q = $("#pfSearch").value.trim().toLowerCase(), cat = $("#pfCat").value, st = $("#pfState").value, sort = $("#pfSort").value;
  const idleIds = st === "idle" ? new Set(idleList().map(x => x.p.id)) : null;
  const sold90 = {}; if (sort === "top") okSales().filter(s => toDate(s.fecha) >= daysAgo(90)).forEach(s => sold90[s.productoId] = (sold90[s.productoId] || 0) + num(s.cantidad));
  const marg = p => { const c = S.costs.get(p.id)?.costo; return c != null && num(p.precio) > 0 ? (num(p.precio) - num(c)) / num(p.precio) : -1; };
  const list = [...S.products.values()].filter(p => {
    if (q && ![p.nombre, p.material, p.descripcion, p.sku, p.piedra, p.talla, S.costs.get(p.id)?.proveedor].some(v => String(v || "").toLowerCase().includes(q))) return false;
    if (cat && p.categoria !== cat) return false;
    const s = stockOf(p);
    if (st === "disp" && s === 0) return false;
    if (st === "bajo" && !isLow(p)) return false;
    if (st === "agot" && (s > 0 || p.porPedido)) return false;
    if (st === "pp" && !p.porPedido) return false;
    if (st === "oculto" && p.visible !== false) return false;
    if (st === "idle" && !idleIds.has(p.id)) return false;
    if (st === "sincosto" && S.costs.get(p.id)?.costo != null) return false;
    if (st === "sinfoto" && imgOf(p) !== PLACEHOLDER) return false;
    return true;
  });
  const by = { name: (a, b) => String(a.nombre).localeCompare(String(b.nombre)), priceD: (a, b) => num(b.precio) - num(a.precio), priceA: (a, b) => num(a.precio) - num(b.precio),
    stock: (a, b) => stockOf(a) - stockOf(b), margin: (a, b) => marg(b) - marg(a), top: (a, b) => (sold90[b.id] || 0) - (sold90[a.id] || 0) }[sort];
  return by ? list.sort(by) : list;
}

function renderProducts() {
  const all = [...S.products.values()];
  let inv = 0, val = 0, pcs = 0, g = 0, metal = 0;
  all.forEach(p => { const s = stockOf(p); pcs += s; inv += s * num(S.costs.get(p.id)?.costo); val += s * num(p.precio); g += s * num(p.pesoGramos); metal += s * num(p.pesoGramos) * metalPrice(p.material); });
  $("#prodKpis").innerHTML = `<div><small>Productos</small><b>${all.length}</b></div><div><small>Piezas en stock</small><b>${pcs}</b></div><div><small>Inversión</small><b>${money(inv)}</b></div><div><small>Valor de venta</small><b>${money(val)}</b></div><div><small>Metal</small><b>${g.toLocaleString("es-MX", { maximumFractionDigits: 1 })} g${metal ? ` · ${moneyShort(metal)}` : ""}</b></div>`;
  $("#provList").innerHTML = [...new Set([...S.costs.values()].map(c => c.proveedor).filter(Boolean))].map(v => `<option>${esc(v)}</option>`).join("");
  [...S.selected].forEach(id => { if (!S.products.has(id)) S.selected.delete(id); });
  $("#pfSelCount").textContent = S.selected.size ? `(${S.selected.size})` : "";
  $("#pfSelAll").innerHTML = S.selected.size ? '<i class="fa-solid fa-xmark"></i> Quitar selección' : '<i class="fa-regular fa-square-check"></i> Seleccionar visibles';

  const list = productFiltered();
  $("#prodGrid").innerHTML = list.length ? list.map(p => {
    const s = stockOf(p), c = S.costs.get(p.id)?.costo, t = p.etiquetas || {};
    const chip = s > 0 ? `<span class="chip ${isLow(p) ? "y" : "g"}">${s} en stock</span>` : p.porPedido ? '<span class="chip c">Bajo pedido</span>' : '<span class="chip r">Agotado</span>';
    const margin = c != null && num(p.precio) > 0 ? Math.round((num(p.precio) - num(c)) / num(p.precio) * 100) : null;
    return `<div class="pcard ${S.selected.has(p.id) ? "sel" : ""}">
      <div class="pimg ${p.visible === false ? "hid" : ""}" style="background-image:url('${esc(imgOf(p))}')" data-edit="${p.id}">
        <div class="st">${chip}</div>
        <label class="pick-sel" title="Seleccionar para etiquetas"><input type="checkbox" data-sel="${p.id}" ${S.selected.has(p.id) ? "checked" : ""} aria-label="Seleccionar"><i class="fa-solid fa-check"></i></label>
        <div class="tg">${TAGS.filter(([k]) => t[k]).map(([, , l]) => `<span>${l}</span>`).join("")}</div>
      </div>
      <div class="pbody">
        <h4>${esc(p.nombre)}</h4>
        <div class="meta">${p.sku ? `<b class="sku">${esc(p.sku)}</b> · ` : ""}${esc(CAT_LABEL[p.categoria] || "Otros")}${p.material ? " · " + esc(p.material) : ""}${p.pesoGramos ? " · " + p.pesoGramos + " g" : ""}${p.talla ? " · talla " + esc(p.talla) : ""}</div>
        <div class="prices"><b>${money(p.precio)}</b><small>${c != null ? `costo ${money(c)} · ${margin}%` : '<span class="warn-txt">sin costo</span>'}</small></div>
      </div>
      <div class="pfoot">
        <div class="qty-ctl"><button data-adj="${p.id}" data-d="-1" aria-label="Restar pieza">−</button><span>${s}</span><button data-adj="${p.id}" data-d="1" aria-label="Sumar pieza">+</button></div>
        <span class="grow"></span>
        <button class="btn sm ghost" data-edit="${p.id}"><i class="fa-solid fa-pen"></i> Editar</button>
      </div>
    </div>`;
  }).join("") : `<div class="empty-state"><i class="fa-regular fa-gem"></i>${all.length ? "Ningún producto coincide con los filtros." : "Aún no hay productos. Crea el primero con “Nuevo producto”."}</div>`;
  $$("#prodGrid [data-edit]").forEach(b => b.onclick = e => { if (e.target.closest(".pick-sel")) return; openProduct(b.dataset.edit); });
  $$("#prodGrid [data-sel]").forEach(c => { c.onclick = e => e.stopPropagation(); c.onchange = () => { c.checked ? S.selected.add(c.dataset.sel) : S.selected.delete(c.dataset.sel); renderProducts(); }; });
  $$("#prodGrid [data-adj]").forEach(b => b.onclick = () => adjustStock(b.dataset.adj, +b.dataset.d));
}
$("#pfSelAll").onclick = () => { if (S.selected.size) S.selected.clear(); else productFiltered().forEach(p => S.selected.add(p.id)); renderProducts(); };

/* ── Movimientos de inventario (entradas, mermas, robo, correcciones) ── */
function logMov(b, p, delta, tipo, motivo) {
  if (S.rulesMissing || !delta) return;
  b.set(doc(collection(db, COL.movs)), {
    productoId: p.id, productoNombre: p.nombre || "", sku: p.sku || "", delta, tipo, motivo: motivo || "",
    costoUnit: S.costs.get(p.id)?.costo ?? null, por: S.me.uid, porNombre: S.me.nombre, fecha: serverTimestamp()
  });
}
const SALIDAS = ["Corrección de conteo", "Merma / daño", "Pérdida / robo", "Muestra / exhibición", "Devolución a proveedor", "Otro"];
async function adjustStock(pid, d) {
  const p = S.products.get(pid); if (!p) return;
  if (d < 0 && stockOf(p) === 0) return;
  let motivo = "Entrada de mercancía";
  if (d < 0) {
    const ok = await dialog({
      title: `Restar 1 pieza · ${p.nombre}`, ok: "Restar",
      body: `<div class="stack"><label class="fld"><span>Motivo</span><select id="mvWhy">${SALIDAS.map(x => `<option>${x}</option>`).join("")}</select></label><p class="muted small">Para registrar una venta usa el punto de venta; así queda en tus ingresos.</p></div>`,
      onOk: () => { motivo = $("#mvWhy").value; }
    });
    if (!ok) return;
  }
  const b = writeBatch(db);
  b.update(doc(db, COL.productos, pid), { cantidad: increment(d), actualizadoEn: serverTimestamp() });
  logMov(b, p, d, d > 0 ? "entrada" : "salida", motivo);
  try { await b.commit(); if (d < 0) toast(`−1 ${p.nombre} · ${motivo}`); } catch (e) { toast(fbErr(e), true); }
}
$("#pfMovs").onclick = () => {
  const since = daysAgo(90), m = S.movs;
  const loss = m.filter(x => toDate(x.fecha) >= since && /Merma|Pérdida/.test(x.motivo || ""));
  const lossVal = sum(loss, x => Math.abs(num(x.delta)) * num(x.costoUnit));
  dialog({
    title: "Movimientos de inventario", ok: "Cerrar", cancel: false,
    body: S.rulesMissing ? `<p class="muted">Publica las reglas nuevas de Firestore para registrar movimientos.</p>` : `
      <div class="mini-kpis"><div><small>Mermas y pérdidas (90 d)</small><b>${sum(loss, x => Math.abs(num(x.delta)))} pz</b></div><div><small>Valor a costo</small><b>${money(lossVal)}</b></div></div>
      <div class="mov-list">${m.length ? m.slice(0, 150).map(x => `<div class="mov"><span class="dl ${num(x.delta) > 0 ? "up" : "down"}">${num(x.delta) > 0 ? "+" : ""}${num(x.delta)}</span>
        <div><b>${esc(x.productoNombre)}</b>${x.sku ? ` <small class="muted">${esc(x.sku)}</small>` : ""}<br><small class="muted">${fmtDT(x.fecha)} · ${esc(x.motivo || x.tipo)} · ${esc(x.porNombre || "")}</small></div></div>`).join("")
        : '<p class="muted small">Aún no hay movimientos. Se registran al sumar o restar piezas, editar el stock o dar de alta productos.</p>'}</div>`
  });
};

/* ── SKU ── */
function nextSku(cat) {
  const pre = SKU_PREFIX[cat] || "OT", re = new RegExp("^" + pre + "-(\\d+)$", "i"); let max = 0;
  S.products.forEach(p => { const m = String(p.sku || "").match(re); if (m) max = Math.max(max, +m[1]); });
  return `${pre}-${String(max + 1).padStart(4, "0")}`;
}
$("#pmSkuGen").onclick = () => { $("#pmSku").value = nextSku($("#pmCat").value); };

/* ── Exportar inventario ── */
$("#pfCsv").onclick = () => {
  const rows = productFiltered();
  if (!rows.length) { toast("No hay productos para exportar", true); return; }
  download(`inventario_arte_plataxco_${ymd(new Date())}.csv`, csv(
    ["SKU", "Nombre", "Categoría", "Material", "Peso (g)", "Talla", "Piedra / acabado", "Stock", "Stock mínimo", "Precio", "Precio anterior", "Costo", "Margen %", "Proveedor", "Valor metal", "Inversión en stock", "Valor de venta del stock", "Visible", "Bajo pedido"],
    rows.map(p => { const c = S.costs.get(p.id)?.costo, s = stockOf(p); return [p.sku || "", p.nombre, CAT_LABEL[p.categoria] || "", p.material || "", p.pesoGramos ?? "", p.talla || "", p.piedra || "", s, minOf(p), num(p.precio), p.precioAnterior ?? "", c ?? "",
      c != null && num(p.precio) ? Math.round((num(p.precio) - num(c)) / num(p.precio) * 100) : "", S.costs.get(p.id)?.proveedor || "", r2(num(p.pesoGramos) * metalPrice(p.material)), c != null ? r2(s * num(c)) : "", r2(s * num(p.precio)), p.visible === false ? "No" : "Sí", p.porPedido ? "Sí" : "No"]; })
  ));
};

/* ── Etiquetas con código de barras (hoja carta, 4 columnas) ── */
const LABEL_CSS = `@page{size:letter;margin:8mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:0}
.sheet{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm}.lb{border:1px dashed #9a9a9a;padding:2mm 2.5mm;height:25mm;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;break-inside:avoid}
.ln{font-size:8pt;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bc{width:100%;height:9mm;display:block}.bc.txt{font:700 11pt monospace;letter-spacing:2px;text-align:center;line-height:9mm}.lf{display:flex;justify-content:space-between;align-items:baseline;font-size:7.5pt;font-family:monospace}
.lf b{font-size:10pt;font-family:Arial,sans-serif}.lm{font-size:6.5pt;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.br{font-family:Georgia,serif;letter-spacing:2px;font-size:6pt;color:#555}@media screen{body{padding:10px}.np{display:block;margin:0 0 12px;padding:10px 18px;border:1px solid #000;background:#fff;cursor:pointer}}@media print{.np{display:none}}`;
$("#pfLabels").onclick = async () => {
  let ids = [...S.selected].filter(id => S.products.has(id));
  const fromSel = ids.length > 0;
  if (!ids.length) ids = productFiltered().map(p => p.id);
  if (!ids.length) { toast("No hay productos para etiquetar", true); return; }
  let mode = "one", showPrice = true;
  const ok = await dialog({
    title: "Imprimir etiquetas", ok: "Imprimir",
    body: `<div class="stack"><p class="muted small">${ids.length} producto(s) ${fromSel ? "seleccionados" : "de la vista actual"}. Hoja carta, 4 columnas, con código de barras para escanear en el punto de venta.</p>
      <label class="fld"><span>Cantidad</span><select id="lbMode"><option value="one">Una por producto</option><option value="stock">Una por cada pieza en stock</option></select></label>
      <label class="chk"><input type="checkbox" id="lbPrice" checked> Mostrar precio</label>
      <p class="muted small">Los productos sin SKU reciben uno automático.</p></div>`,
    onOk: () => { mode = $("#lbMode").value; showPrice = $("#lbPrice").checked; }
  });
  if (!ok) return;
  const prods = ids.map(id => S.products.get(id));
  const missing = prods.filter(p => !p.sku);
  if (missing.length) {
    const b = writeBatch(db);
    missing.forEach(p => { p.sku = nextSku(p.categoria); b.update(doc(db, COL.productos, p.id), { sku: p.sku }); });
    try { await b.commit(); } catch (e) { toast(fbErr(e), true); return; }
  }
  const items = []; prods.forEach(p => { const n = mode === "stock" ? Math.max(1, stockOf(p)) : 1; for (let i = 0; i < n; i++) items.push(p); });
  // los códigos se dibujan aquí (más confiable que cargar la librería dentro de la ventana de impresión)
  const bars = {};
  prods.forEach(p => {
    try {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      window.JsBarcode(svg, p.sku, { format: "CODE128", width: 1.3, height: 30, displayValue: false, margin: 0 });
      svg.setAttribute("class", "bc"); svg.setAttribute("preserveAspectRatio", "none");
      bars[p.id] = svg.outerHTML;
    } catch { bars[p.id] = `<div class="bc txt">${esc(p.sku)}</div>`; }
  });
  printDoc("Etiquetas", `<button class="np" onclick="window.print()">Imprimir ${items.length} etiqueta(s)</button><div class="sheet">${items.map(p => `
    <div class="lb"><div class="ln">${esc(p.nombre)}</div>${bars[p.id]}
      <div class="lf"><span>${esc(p.sku)}</span>${showPrice ? `<b>${money(p.precio)}</b>` : `<span class="br">${esc(BIZ().nombre)}</span>`}</div>
      <div class="lm">${esc([p.material, p.pesoGramos ? p.pesoGramos + " g" : "", p.talla, p.piedra].filter(Boolean).join(" · "))}</div></div>`).join("")}</div>`, LABEL_CSS);
};

/* ── Modal de producto ── */
const PM = { id: null, isNew: true, imgs: [], uploading: 0, newUploads: [], removed: [] };
let storageOK = true;

function syncTagUI() { $$(".tag").forEach(l => l.classList.toggle("on", l.querySelector("input").checked)); }
$$(".tag input").forEach(i => i.addEventListener("change", syncTagUI));
$("#tgUnica").addEventListener("change", e => { if (e.target.checked) $("#pmStock").value = 1; });
["#pmPrice", "#pmCost", "#pmWeight"].forEach(id => $(id).addEventListener("input", updateMargin));
["#pmWeight", "#pmMat"].forEach(id => $(id).addEventListener("input", updateSuggest));
function updateMargin() {
  const p = num($("#pmPrice").value), c = numOrNull($("#pmCost").value), g = num($("#pmWeight").value);
  $("#pmMargin").textContent = p > 0 && c != null ? `${money(p - c)} de ganancia (${Math.round((p - c) / p * 100)}%)${g ? ` · ${money(p / g)}/g venta` : ""}` : p > 0 && g ? `${money(p / g)} por gramo` : "—";
}
function updateSuggest() {
  const g = num($("#pmWeight").value), mat = $("#pmMat").value.trim(), pg = metalPrice(mat), aj = AJ(), box = $("#pmSuggest");
  if (!g || !mat) { box.innerHTML = ""; box.classList.remove("on"); return; }
  box.classList.add("on");
  if (!pg) { box.innerHTML = `<i class="fa-solid fa-scale-balanced"></i><span class="muted">Captura el precio por gramo de “${esc(mat)}” en Ajustes para ver el valor del metal y un precio sugerido.</span>`; return; }
  const metal = g * pg, sug = Math.ceil((metal * (num(aj.factor) || 1) + num(aj.manoObra)) / 10) * 10;
  box.innerHTML = `<i class="fa-solid fa-scale-balanced"></i><span>Metal: <b>${money(r2(metal))}</b> <small class="muted">(${g} g × ${money(pg)})</small> · Sugerido: <b>${money(sug)}</b></span><button type="button" class="btn sm ghost" id="pmUseSug">Usar</button>`;
  $("#pmUseSug").onclick = () => { $("#pmPrice").value = sug; updateMargin(); };
}
function renderPmHist(pid) {
  const box = $("#pmHist"), p = S.products.get(pid);
  if (!p) { box.innerHTML = ""; return; }
  const sales = S.sales.filter(s => s.productoId === pid), ok = sales.filter(s => s.estado !== "cancelada");
  const ev = [...sales.map(s => ({ d: toDate(s.fecha), t: `${s.estado === "cancelada" ? "Venta cancelada" : "Venta"} · ${num(s.cantidad)} pz · ${money(s.total)} · ${sellerLabel(s)}${s.cliente ? " · " + s.cliente : ""}`, c: s.estado === "cancelada" ? "" : "down", n: -num(s.cantidad) })),
    ...S.movs.filter(m => m.productoId === pid).map(m => ({ d: toDate(m.fecha), t: `${m.motivo || m.tipo} · ${m.porNombre || ""}`, c: num(m.delta) > 0 ? "up" : "down", n: num(m.delta) }))]
    .filter(x => x.d).sort((a, b) => b.d - a.d).slice(0, 12);
  const last = ok.map(s => toDate(s.fecha)).filter(Boolean).sort((a, b) => b - a)[0];
  box.innerHTML = `<div class="card-hd"><h3>Historial de la pieza</h3><small>${ok.length ? `${sum(ok, s => num(s.cantidad))} vendida(s) · ${money(sum(ok, s => num(s.total)))} · última ${fmtD(last)}` : "sin ventas aún"}</small></div>
    ${ev.length ? `<div class="mov-list">${ev.map(x => `<div class="mov"><span class="dl ${x.c}">${x.n > 0 ? "+" : ""}${x.n}</span><div><small class="muted">${fmtDT(x.d)}</small><br>${esc(x.t)}</div></div>`).join("")}</div>` : '<p class="muted small">Sin movimientos registrados.</p>'}`;
}

function openProduct(id, from = null) {
  const p = from || (id ? S.products.get(id) : null);
  PM.id = from ? doc(collection(db, COL.productos)).id : (id || doc(collection(db, COL.productos)).id); PM.isNew = !id || !!from;
  PM.oldStock = PM.isNew ? 0 : stockOf(p);
  PM.imgs = p ? (Array.isArray(p.imagenes) && p.imagenes.length ? [...p.imagenes] : p.imageUrl ? [p.imageUrl] : []) : [];
  PM.newUploads = []; PM.removed = []; PM.uploading = 0;
  $("#pmTitle").textContent = from ? "Duplicar producto" : p ? "Editar producto" : "Nuevo producto";
  $("#pmName").value = from ? `${p.nombre} (copia)` : p?.nombre || "";
  $("#pmSku").value = from ? "" : p?.sku || "";
  $("#pmTalla").value = p?.talla || "";
  $("#pmPiedra").value = p?.piedra || "";
  $("#pmMin").value = p?.stockMin ?? "";
  $("#pmProv").value = S.costs.get(from ? from.id : PM.id)?.proveedor || "";
  $("#pmCat").value = p?.categoria || "anillos";
  $("#pmMat").value = p?.material || "";
  $("#pmPrice").value = p?.precio ?? "";
  $("#pmOld").value = p?.precioAnterior ?? "";
  $("#pmCost").value = S.costs.get(from ? from.id : PM.id)?.costo ?? "";
  $("#pmWeight").value = p?.pesoGramos ?? "";
  $("#pmStock").value = p && !from ? stockOf(p) : 1;
  $("#pmDesc").value = p?.descripcion || "";
  $("#pmPP").checked = p?.porPedido === true;
  $("#pmVis").checked = p ? p.visible !== false : true;
  const t = p?.etiquetas || {};
  TAGS.forEach(([k, id]) => $("#" + id).checked = !!t[k]);
  $("#pmDelete").classList.toggle("hidden", PM.isNew);
  $("#pmDup").classList.toggle("hidden", PM.isNew);
  $("#pmUrl").value = "";
  syncTagUI(); updateMargin(); updateSuggest(); renderPmImgs();
  renderPmHist(PM.isNew ? null : PM.id);
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
$("#pmDup").onclick = () => {
  const p = S.products.get(PM.id); if (!p) return;
  PM._saved = true; closeModal($("#prodModal"));
  setTimeout(() => openProduct(null, p), 60);
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
  let sku = $("#pmSku").value.trim().toUpperCase();
  if (!sku) sku = nextSku($("#pmCat").value);
  const dupSku = [...S.products.values()].find(x => x.id !== PM.id && String(x.sku || "").toUpperCase() === sku);
  if (dupSku) { toast(`El SKU ${sku} ya lo usa "${dupSku.nombre}"`, true); $("#pmSku").focus(); return; }
  const minV = numOrNull($("#pmMin").value);
  const data = {
    nombre, categoria: $("#pmCat").value, material: $("#pmMat").value.trim(),
    precio, precioAnterior: numOrNull($("#pmOld").value), pesoGramos: numOrNull($("#pmWeight").value),
    cantidad: Math.max(0, parseInt($("#pmStock").value, 10) || 0),
    porPedido: $("#pmPP").checked, visible: $("#pmVis").checked,
    descripcion: $("#pmDesc").value.trim(), etiquetas,
    sku, talla: $("#pmTalla").value.trim(), piedra: $("#pmPiedra").value.trim(), stockMin: minV == null ? null : Math.max(0, Math.floor(minV)),
    imagenes: PM.imgs, imageUrl: PM.imgs[0] || "",
    actualizadoEn: serverTimestamp()
  };
  if (data.precioAnterior != null && data.precioAnterior <= precio) data.precioAnterior = null;
  loading(true);
  try {
    const b = writeBatch(db), pRef = doc(db, COL.productos, PM.id);
    if (PM.isNew) b.set(pRef, { ...data, creadoEn: serverTimestamp() }); else b.update(pRef, data);
    b.set(doc(db, COL.privado, PM.id), { costo: numOrNull($("#pmCost").value), proveedor: $("#pmProv").value.trim(), actualizadoEn: serverTimestamp() }, { merge: true });
    const dStock = data.cantidad - (PM.oldStock || 0);
    logMov(b, { id: PM.id, nombre, sku }, dStock, PM.isNew ? "alta" : "edicion", PM.isNew ? "Alta de producto" : "Edición manual de stock");
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
  if ([...S.products.values()].some(p => p.id !== PM.id && (p.imagenes || []).includes(u))) return;
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
        <div style="text-align:right"><small>${esc(o.clienteNombre || "Invitado")}</small><br>${o.clienteCorreo ? `<a class="muted small" href="mailto:${esc(o.clienteCorreo)}?subject=${encodeURIComponent("Tu pedido " + (o.folio || "") + " en ARTE PLATAXCO")}">${esc(o.clienteCorreo)}</a>` : ""}</div></div>
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
          costoUnit: c != null ? num(c) : null, metodoPago: pay, cliente: o.clienteNombre || o.clienteCorreo || "", clienteCorreo: o.clienteCorreo || "", nota: `Pedido web ${o.folio || ""}${o.cupon ? " · cupón " + o.cupon : ""}`,
          sku: p.sku || "", precioLista: num(it.precio), ticketId: id, ticketFolio: o.folio || id.slice(0, 6).toUpperCase(),
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
/* ═══════════════════════════════════════════════════════════════
   APARTADOS (reserva stock · abonos · liquidar → ventas)
═══════════════════════════════════════════════════════════════ */
function isOverdue(a) { const d = toDate(a.fechaLimite); return a.estado === "activo" && d && d < startOfDay(new Date()); }
const apSaldo = a => r2(Math.max(0, num(a.total) - num(a.pagado)));
function layawayTicket(a) {
  return {
    kind: a.estado === "liquidado" ? "Apartado liquidado" : "Comprobante de apartado", folio: a.folio, fecha: toDate(a.creadoEn) || new Date(),
    lines: (a.items || []).map(it => ({ nombre: it.nombre, sku: it.sku || "", qty: num(it.cantidad), unit: num(it.precioUnit), total: r2(num(it.precioUnit) * num(it.cantidad)), pp: it.bajoPedido })),
    sub: num(a.subtotal), disc: num(a.descuento), total: num(a.total), pagado: num(a.pagado), abonos: a.abonos || [],
    limite: a.estado === "activo" ? toDate(a.fechaLimite) : null, client: a.cliente, tel: a.clienteTel, note: a.nota, seller: a.vendedorNombre
  };
}

async function createLayaway({ lines, totals, client, tel, note, seller, down, pay, limitD }) {
  const aRef = doc(collection(db, COL.apartados)), folio = folioGen("AP");
  const factor = totals.sub > 0 ? totals.total / totals.sub : 1;
  const abonos = down > 0 ? [{ monto: down, metodo: pay, fecha: Timestamp.now(), por: S.me.uid, porNombre: S.me.nombre }] : [];
  let items = [];
  await runTransaction(db, async tx => {
    const { plan, commit } = await reserveLines(tx, lines);
    commit();
    items = plan.map(({ l, p, desc, pp }) => {
      const img = imgOf(p);
      return { productoId: l.pid, nombre: p.nombre || "", sku: p.sku || "", categoria: p.categoria || "otros", imagen: /^https?:/.test(img) ? img : null,
        cantidad: l.qty, precioLista: num(p.precio), precioUnit: r2(l.price * factor), descontado: desc, bajoPedido: pp };
    });
    tx.set(aRef, {
      folio, cliente: client, clienteTel: tel || "", nota: note || "", items,
      subtotal: totals.sub, descuento: totals.disc, total: totals.total, pagado: down, abonos,
      estado: "activo", fechaLimite: Timestamp.fromDate(new Date(limitD + "T23:59:59")),
      vendedorId: seller.id, vendedorNombre: seller.nombre, registradoPor: S.me.uid, creadoEn: serverTimestamp()
    });
  });
  return layawayTicket({ folio, items, subtotal: totals.sub, descuento: totals.disc, total: totals.total, pagado: down, abonos, estado: "activo", fechaLimite: new Date(limitD + "T23:59:59"), cliente: client, clienteTel: tel, nota: note, vendedorNombre: seller.nombre, creadoEn: new Date() });
}

$$("#apSeg button").forEach(b => b.addEventListener("click", () => { S.apFilter = b.dataset.e; renderLayaways(); }));
$("#apSearch").addEventListener("input", () => renderLayaways());

function renderLayaways() {
  $$("#apSeg button").forEach(x => x.classList.toggle("on", x.dataset.e === S.apFilter));
  const act = S.apartados.filter(a => a.estado === "activo");
  $("#apKpis").innerHTML = `<div><small>Activos</small><b>${act.length}</b></div><div><small>Por cobrar</small><b>${money(sum(act, apSaldo))}</b></div>
    <div><small>Anticipos recibidos</small><b>${money(sum(act, a => num(a.pagado)))}</b></div><div><small>Vencidos</small><b>${act.filter(isOverdue).length}</b></div>`;
  const q = $("#apSearch").value.trim().toLowerCase(), f = S.apFilter;
  const list = S.apartados.filter(a => {
    if (f === "vencido" ? !isOverdue(a) : a.estado !== f) return false;
    if (q && ![a.folio, a.cliente, a.clienteTel, ...(a.items || []).map(i => i.nombre)].some(v => String(v || "").toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => f === "activo" || f === "vencido" ? (toDate(a.fechaLimite) || 0) - (toDate(b.fechaLimite) || 0) : 0);
  const today = startOfDay(new Date());
  $("#apList").innerHTML = list.length ? list.map(a => {
    const saldo = apSaldo(a), pct = num(a.total) ? Math.min(100, num(a.pagado) / num(a.total) * 100) : 0;
    const lim = toDate(a.fechaLimite), dl = lim ? Math.ceil((startOfDay(lim) - today) / 86400000) : null;
    const limChip = a.estado !== "activo" ? "" : dl < 0 ? `<span class="chip r">vencido hace ${-dl} d</span>` : dl <= 3 ? `<span class="chip y">vence en ${dl} d</span>` : `<span class="chip">vence ${fmtD(lim)}</span>`;
    return `<div class="order ap ${isOverdue(a) ? "late" : ""}">
      <div class="order-hd"><div><b>${esc(a.folio)}</b><br><small>${fmtDT(a.creadoEn)} · ${esc(a.vendedorNombre || "")}</small></div>
        <div style="text-align:right"><small>${esc(a.cliente || "")}</small><br><small>${esc(a.clienteTel || "")}</small></div></div>
      <div class="order-bd">
        ${(a.items || []).map(it => `<div class="oline"><span>${num(it.cantidad)} × ${esc(it.nombre)}${it.bajoPedido ? ' <span class="chip c">bajo pedido</span>' : ""}</span><span>${money(num(it.precioUnit) * num(it.cantidad))}</span></div>`).join("")}
        ${num(a.descuento) ? `<div class="oline"><span>Descuento</span><span>−${money(a.descuento)}</span></div>` : ""}
        <div class="otot"><span>Total</span><span>${money(a.total)}</span></div>
        <div class="bar sm"><i style="width:${pct}%"></i></div>
        <div class="oline"><span>Pagado ${Math.round(pct)}%</span><span>${money(a.pagado)}</span></div>
        <div class="oline ${saldo && a.estado === "activo" ? "big" : ""}"><span>Saldo</span><span>${money(saldo)}</span></div>
        ${limChip ? `<div>${limChip}</div>` : ""}
        ${(a.abonos || []).length ? `<details class="abonos"><summary>${a.abonos.length} abono(s)</summary>${a.abonos.map(x => `<div class="oline"><span>${fmtD(x.fecha)} · ${esc(x.metodo || "")} · ${esc(x.porNombre || "")}</span><span>${money(x.monto)}</span></div>`).join("")}</details>` : ""}
        ${a.nota ? `<small class="muted">${esc(a.nota)}</small>` : ""}
      </div>
      <div class="order-ft">
        ${a.estado === "activo" ? `<button class="btn sm ok" data-abo="${a.id}"><i class="fa-solid fa-coins"></i> Abonar</button>
          <button class="btn sm gold" data-liq="${a.id}"><i class="fa-solid fa-gift"></i> ${saldo ? "Liquidar y entregar" : "Entregar"}</button>
          ${a.clienteTel ? `<button class="icon-btn" data-wa="${a.id}" title="Recordatorio por WhatsApp" aria-label="WhatsApp"><i class="fa-brands fa-whatsapp"></i></button>` : ""}
          <button class="icon-btn" data-prn="${a.id}" title="Imprimir comprobante" aria-label="Imprimir"><i class="fa-solid fa-print"></i></button>
          ${isAdmin() ? `<span class="grow"></span><button class="btn sm danger ghost" data-apc="${a.id}">Cancelar</button>` : ""}`
        : a.estado === "liquidado" ? `<span class="chip g">Entregado ${fmtD(a.liquidadoEn)}</span><span class="grow"></span><button class="icon-btn" data-prn="${a.id}" aria-label="Imprimir"><i class="fa-solid fa-print"></i></button>`
        : `<span class="chip r">Cancelado ${fmtD(a.canceladoEn)}</span><small class="muted">${a.anticipo === "retenido" ? "anticipo retenido" : a.anticipo === "devuelto" ? "anticipo devuelto" : ""}</small>`}
      </div></div>`;
  }).join("") : `<div class="empty-state"><i class="fa-solid fa-hand-holding-dollar"></i>${S.rulesMissing ? "Publica las reglas nuevas de Firestore para usar apartados." : "No hay apartados en esta sección. Crea uno desde el punto de venta con el botón “Apartar”."}</div>`;

  $$("#apList [data-abo]").forEach(b => b.onclick = () => addPayment(b.dataset.abo));
  $$("#apList [data-liq]").forEach(b => b.onclick = () => liquidate(b.dataset.liq));
  $$("#apList [data-apc]").forEach(b => b.onclick = () => cancelLayaway(b.dataset.apc));
  $$("#apList [data-prn]").forEach(b => b.onclick = () => printReceipt(layawayTicket(S.apartados.find(a => a.id === b.dataset.prn))));
  $$("#apList [data-wa]").forEach(b => b.onclick = () => {
    const a = S.apartados.find(x => x.id === b.dataset.wa), lim = toDate(a.fechaLimite), first = String(a.cliente || "").split(" ")[0];
    const txt = `Hola ${first} 👋, te saluda ${BIZ().nombre} 💎\n\nTe recordamos tu apartado *${a.folio}*:\n${(a.items || []).map(i => `• ${i.nombre}`).join("\n")}\n\nTotal: ${money(a.total)}\nAbonado: ${money(a.pagado)}\n*Saldo: ${money(apSaldo(a))}*\n${lim ? `Fecha límite: ${fmtD(lim)}\n` : ""}\n¿Te gustaría pasar a liquidarlo o hacer un abono? Con gusto te ayudamos ✨`;
    window.open(waUrl(a.clienteTel, txt), "_blank", "noopener");
  });
}

async function addPayment(id) {
  const a = S.apartados.find(x => x.id === id); if (!a) return;
  const saldo = apSaldo(a); let monto = saldo, metodo = "Efectivo";
  const ok = await dialog({
    title: `Abono a ${a.folio}`, ok: "Registrar abono",
    body: `<div class="stack"><p class="muted small">${esc(a.cliente)} · saldo actual <b>${money(saldo)}</b></p>
      <label class="fld"><span>Monto</span><input type="number" id="abMonto" min="0.01" step="0.01" max="${saldo}" value="${saldo}" inputmode="decimal"></label>
      <label class="fld"><span>Método</span><select id="abPay">${payOpts()}</select></label></div>`,
    onOk: () => { monto = r2(num($("#abMonto").value)); metodo = $("#abPay").value; if (monto <= 0 || monto > saldo + 0.009) { toast(`El abono debe ser entre $0.01 y ${money(saldo)}`, true); return false; } }
  });
  if (!ok) return;
  loading(true);
  try {
    const aRef = doc(db, COL.apartados, id);
    await runTransaction(db, async tx => {
      const sn = await tx.get(aRef); if (!sn.exists() || sn.data().estado !== "activo") throw ue("El apartado ya no está activo");
      const d = sn.data();
      tx.update(aRef, { pagado: r2(num(d.pagado) + monto), abonos: [...(d.abonos || []), { monto, metodo, fecha: Timestamp.now(), por: S.me.uid, porNombre: S.me.nombre }], actualizadoEn: serverTimestamp() });
    });
    loading(false);
    toast(`Abono de ${money(monto)} registrado`);
    if (monto >= saldo - 0.009) {
      if (await dialog({ title: "Apartado pagado por completo", body: `<p>¿Entregar las piezas ahora? Se registrarán las ventas de <b>${esc(a.folio)}</b>.</p>`, ok: "Entregar ahora" })) liquidate(id, true);
    }
  } catch (e) { loading(false); toast(e.userMsg || fbErr(e), true); }
}

async function liquidate(id, skipAsk = false) {
  const a = S.apartados.find(x => x.id === id); if (!a) return;
  const saldo = apSaldo(a); let metodo = "Efectivo";
  if (!skipAsk) {
    const ok = await dialog({
      title: `Entregar ${a.folio}`, ok: saldo ? `Cobrar ${money(saldo)} y entregar` : "Entregar",
      body: `<div class="stack"><p>Se entregan las piezas a <b>${esc(a.cliente)}</b> y se registran como venta.</p>
        ${saldo ? `<label class="fld"><span>Pago del saldo (${money(saldo)})</span><select id="lqPay">${payOpts()}</select></label>` : ""}</div>`,
      onOk: () => { if (saldo) metodo = $("#lqPay").value; }
    });
    if (!ok) return;
  }
  loading(true);
  try {
    const aRef = doc(db, COL.apartados, id), ventaIds = [];
    let final = null;
    await runTransaction(db, async tx => {
      const sn = await tx.get(aRef); if (!sn.exists() || sn.data().estado !== "activo") throw ue("El apartado ya no está activo");
      const d = sn.data(), rest = r2(Math.max(0, num(d.total) - num(d.pagado)));
      const abonos = [...(d.abonos || [])];
      if (rest > 0) abonos.push({ monto: rest, metodo, fecha: Timestamp.now(), por: S.me.uid, porNombre: S.me.nombre });
      (d.items || []).forEach(it => {
        const vRef = doc(collection(db, COL.ventas)); ventaIds.push(vRef.id);
        const sale = {
          productoId: it.productoId, productoNombre: it.nombre, sku: it.sku || "", categoria: it.categoria || "otros", imagen: it.imagen || null,
          cantidad: num(it.cantidad), precioLista: num(it.precioLista), precioUnit: num(it.precioUnit), total: r2(num(it.precioUnit) * num(it.cantidad)),
          metodoPago: "Apartado", cliente: d.cliente || "", clienteTel: d.clienteTel || "", nota: `Apartado ${d.folio}`,
          vendedorId: d.vendedorId, vendedorNombre: d.vendedorNombre, canal: d.vendedorId === ADMIN_UID ? "admin" : "vendedor",
          estado: "completada", bajoPedido: !!it.bajoPedido, descontado: num(it.descontado ?? it.cantidad), pedidoId: null,
          apartadoId: id, ticketId: id, ticketFolio: d.folio, registradoPor: S.me.uid, fecha: serverTimestamp()
        };
        if (isAdmin()) { const c = S.costs.get(it.productoId)?.costo; sale.costoUnit = c != null ? num(c) : null; }
        tx.set(vRef, sale);
      });
      tx.update(aRef, { estado: "liquidado", pagado: num(d.total), abonos, ventaIds, liquidadoEn: serverTimestamp() });
      final = { ...d, pagado: num(d.total), abonos, estado: "liquidado" };
    });
    loading(false);
    toast(`${a.folio} entregado y registrado como venta`);
    if (final) showReceiptDialog(layawayTicket(final), "Apartado entregado");
  } catch (e) { loading(false); toast(e.userMsg || fbErr(e), true); }
}

async function cancelLayaway(id) {
  const a = S.apartados.find(x => x.id === id); if (!a) return;
  let anticipo = "devuelto";
  const ok = await dialog({
    title: `Cancelar ${a.folio}`, ok: "Cancelar apartado", danger: true,
    body: `<div class="stack"><p>Las piezas regresan al inventario y vuelven a aparecer en la tienda.</p>
      ${num(a.pagado) ? `<label class="fld"><span>Anticipo recibido (${money(a.pagado)})</span><select id="cnAnt"><option value="devuelto">Se le devolvió al cliente</option><option value="retenido">Se retuvo (penalización)</option></select></label>` : ""}</div>`,
    onOk: () => { if (num(a.pagado)) anticipo = $("#cnAnt").value; }
  });
  if (!ok) return;
  loading(true);
  try {
    const aRef = doc(db, COL.apartados, id);
    await runTransaction(db, async tx => {
      const sn = await tx.get(aRef); if (!sn.exists() || sn.data().estado !== "activo") throw ue("El apartado ya no está activo");
      const items = sn.data().items || [], back = {};
      items.forEach(it => { if (num(it.descontado) > 0) back[it.productoId] = (back[it.productoId] || 0) + num(it.descontado); });
      const snaps = {}; for (const pid of Object.keys(back)) snaps[pid] = await tx.get(doc(db, COL.productos, pid));
      Object.entries(back).forEach(([pid, n]) => { if (snaps[pid].exists()) tx.update(doc(db, COL.productos, pid), { cantidad: stockOf(snaps[pid].data()) + n, actualizadoEn: serverTimestamp() }); });
      tx.update(aRef, { estado: "cancelado", anticipo: num(sn.data().pagado) ? anticipo : null, canceladoEn: serverTimestamp(), canceladoPor: S.me.uid });
    });
    toast("Apartado cancelado y piezas devueltas al inventario");
  } catch (e) { toast(e.userMsg || fbErr(e), true); }
  loading(false);
}

/* ═══════════════════════════════════════════════════════════════
   CLIENTES (se arma solo con ventas, apartados y cuentas de la tienda)
═══════════════════════════════════════════════════════════════ */
function buildClients() {
  const m = new Map();
  const keyOf = (name, tel, mail) => { const t = normTel(tel); if (t.length >= 12) return "t" + t; if (mail) return "m" + String(mail).toLowerCase(); const n = String(name || "").trim().toLowerCase(); return n ? "n" + n : null; };
  const get = k => { if (!m.has(k)) m.set(k, { key: k, nombre: "", tel: "", correo: "", tickets: new Set(), piezas: 0, total: 0, primera: null, ultima: null, cuenta: false, cupon: "", apN: 0, apSaldo: 0 }); return m.get(k); };
  okSales().forEach(s => {
    const k = keyOf(s.cliente, s.clienteTel, s.clienteCorreo); if (!k) return;
    const c = get(k); c.nombre ||= s.cliente || ""; c.tel ||= s.clienteTel || ""; c.correo ||= s.clienteCorreo || "";
    c.tickets.add(ticketKey(s)); c.piezas += num(s.cantidad); c.total += num(s.total);
    const d = toDate(s.fecha); if (d) { if (!c.ultima || d > c.ultima) c.ultima = d; if (!c.primera || d < c.primera) c.primera = d; }
  });
  S.apartados.filter(a => a.estado === "activo").forEach(a => {
    const k = keyOf(a.cliente, a.clienteTel); if (!k) return;
    const c = get(k); c.nombre ||= a.cliente || ""; c.tel ||= a.clienteTel || ""; c.apN++; c.apSaldo += apSaldo(a);
  });
  S.cuentas.forEach(u => {
    const k = keyOf(u.nombre, u.telefono, u.correo); if (!k) return;
    const c = get(k); c.nombre ||= u.nombre || u.correo || ""; c.correo ||= u.correo || ""; c.cuenta = true;
    c.cupon = u.cuponUsado ? "usado" : u.cuponActivo ? "activo" : "";
    const d = toDate(u.creadoEn); if (d && (!c.primera || d < c.primera)) c.primera = c.primera || d;
  });
  const list = [...m.values()].map(c => ({ ...c, compras: c.tickets.size }));
  const totals = list.map(c => c.total).filter(v => v > 0).sort((a, b) => b - a);
  const vipLine = Math.max(3000, totals.length >= 5 ? totals[Math.max(0, Math.ceil(totals.length * .1) - 1)] : Infinity);
  const d30 = daysAgo(30), d120 = daysAgo(120);
  list.forEach(c => {
    c.vip = c.total > 0 && c.total >= vipLine;
    c.frec = c.compras >= 3;
    c.nuevo = !!c.primera && c.primera >= d30;
    c.inact = !!c.ultima && c.ultima < d120;
  });
  return list;
}

["#clSearch", "#clSeg", "#clSort"].forEach(id => $(id).addEventListener(id === "#clSearch" ? "input" : "change", () => renderClients()));
function clientsFiltered() {
  const q = $("#clSearch").value.trim().toLowerCase(), seg = $("#clSeg").value, sort = $("#clSort").value;
  const list = buildClients().filter(c => {
    if (q && ![c.nombre, c.tel, c.correo].some(v => String(v || "").toLowerCase().includes(q))) return false;
    if (seg === "vip" && !c.vip) return false;
    if (seg === "frec" && !c.frec) return false;
    if (seg === "nuevo" && !c.nuevo) return false;
    if (seg === "inact" && !c.inact) return false;
    if (seg === "apart" && !c.apN) return false;
    if (seg === "web" && !c.cuenta) return false;
    return true;
  });
  const by = { total: (a, b) => b.total - a.total, last: (a, b) => (b.ultima || 0) - (a.ultima || 0), count: (a, b) => b.compras - a.compras, name: (a, b) => String(a.nombre).localeCompare(String(b.nombre)) }[sort];
  return list.sort(by);
}
function renderClients() {
  const all = buildClients(), buyers = all.filter(c => c.compras > 0);
  $("#clKpis").innerHTML = `<div><small>Clientes</small><b>${all.length}</b></div><div><small>Recompra</small><b>${buyers.length ? Math.round(buyers.filter(c => c.compras >= 2).length / buyers.length * 100) : 0}%</b></div>
    <div><small>VIP</small><b>${all.filter(c => c.vip).length}</b></div><div><small>Inactivos +120 d</small><b>${all.filter(c => c.inact).length}</b></div><div><small>Gasto promedio</small><b>${money(buyers.length ? Math.round(sum(buyers, c => c.total) / buyers.length) : 0)}</b></div>`;
  const list = clientsFiltered();
  $("#clTbl").innerHTML = list.length ? `<thead><tr><th>Cliente</th><th>Contacto</th><th class="num">Compras</th><th class="num">Piezas</th><th class="num">Total</th><th class="num">Ticket prom.</th><th>Última compra</th><th></th></tr></thead><tbody>${list.slice(0, 400).map((c, i) => `
    <tr><td data-l="Cliente"><div class="pname"><div class="avatar sm">${esc((c.nombre || "?").charAt(0).toUpperCase())}</div><span>${esc(c.nombre || "—")}<br>
      ${c.vip ? '<span class="chip gold">VIP</span> ' : ""}${c.frec ? '<span class="chip g">frecuente</span> ' : ""}${c.nuevo ? '<span class="chip c">nuevo</span> ' : ""}${c.inact ? '<span class="chip y">inactivo</span> ' : ""}${c.apN ? `<span class="chip">apartado ${money(c.apSaldo)}</span> ` : ""}${c.cuenta ? `<span class="chip">tienda${c.cupon === "activo" ? " · cupón sin usar" : ""}</span>` : ""}</span></div></td>
      <td data-l="Contacto">${esc(c.tel || "")}${c.tel && c.correo ? "<br>" : ""}<small class="muted">${esc(c.correo || "")}</small>${!c.tel && !c.correo ? "—" : ""}</td>
      <td data-l="Compras" class="num">${c.compras}</td><td data-l="Piezas" class="num">${c.piezas}</td><td data-l="Total" class="num"><b>${money(c.total)}</b></td>
      <td data-l="Ticket prom." class="num">${c.compras ? money(Math.round(c.total / c.compras)) : "—"}</td><td data-l="Última compra">${c.ultima ? fmtD(c.ultima) : "—"}</td>
      <td class="act num">${c.tel ? `<button class="icon-btn" data-cw="${i}" title="WhatsApp" aria-label="WhatsApp"><i class="fa-brands fa-whatsapp"></i></button>` : ""}${c.compras ? `<button class="btn sm ghost" data-ch="${i}">Compras</button>` : ""}</td></tr>`).join("")}</tbody>`
    : `<tbody><tr><td class="empty">${all.length ? "Ningún cliente coincide." : "Aún no hay clientes. Se agregan solos cuando capturas el nombre o WhatsApp en una venta o apartado."}</td></tr></tbody>`;
  $$("#clTbl [data-cw]").forEach(b => b.onclick = () => {
    const c = list[+b.dataset.cw], first = String(c.nombre || "").split(" ")[0];
    const txt = c.inact ? `Hola ${first} 👋, te saluda ${BIZ().nombre} 💎\nTe extrañamos. Tenemos piezas nuevas que creemos que te van a encantar. ¿Te mando fotos?`
      : `Hola ${first} 👋, te saluda ${BIZ().nombre} 💎`;
    window.open(waUrl(c.tel, txt), "_blank", "noopener");
  });
  $$("#clTbl [data-ch]").forEach(b => b.onclick = () => {
    const c = list[+b.dataset.ch]; go("ventas");
    $("#vfFrom").value = ""; $("#vfTo").value = ymd(new Date()); $("#vfSeller").value = ""; $("#vfSearch").value = c.tel || c.nombre; renderSales();
  });
}
$("#clCsv").onclick = () => {
  const rows = clientsFiltered();
  if (!rows.length) { toast("No hay clientes para exportar", true); return; }
  download(`clientes_arte_plataxco_${ymd(new Date())}.csv`, csv(["Nombre", "Teléfono", "Correo", "Compras", "Piezas", "Total", "Ticket promedio", "Primera compra", "Última compra", "Segmentos", "Saldo en apartados", "Cuenta en tienda"],
    rows.map(c => [c.nombre, c.tel, c.correo, c.compras, c.piezas, r2(c.total), c.compras ? r2(c.total / c.compras) : "", c.primera ? fmtD(c.primera) : "", c.ultima ? fmtD(c.ultima) : "",
      [c.vip && "VIP", c.frec && "Frecuente", c.nuevo && "Nuevo", c.inact && "Inactivo"].filter(Boolean).join(" / "), r2(c.apSaldo), c.cuenta ? "Sí" : "No"])));
};

/* ═══════════════════════════════════════════════════════════════
   AJUSTES (metal por gramo, metas, datos del negocio)
═══════════════════════════════════════════════════════════════ */
const notEditing = f => !f.contains(document.activeElement);
function renderSettings() {
  const aj = AJ(), b = BIZ();
  if (notEditing($("#metalForm"))) {
    const keys = [...new Set([...METALES, ...Object.keys(aj.metales || {})])];
    $("#metalGrid").innerHTML = keys.map(k => `<label class="fld"><span>${esc(k)}</span><input type="number" min="0" step="0.01" data-metal="${esc(k)}" value="${aj.metales?.[k] ?? ""}" inputmode="decimal" placeholder="$/g"></label>`).join("");
    $("#ajFactor").value = aj.factor ?? ""; $("#ajLabor").value = aj.manoObra ?? "";
  }
  if (notEditing($("#goalForm"))) {
    $("#ajGoal").value = aj.meta || ""; $("#ajMin").value = aj.stockMin ?? ""; $("#ajIdle").value = aj.diasIdle ?? ""; $("#ajTerm").value = aj.plazo ?? ""; $("#ajDown").value = aj.anticipo ?? "";
  }
  if (notEditing($("#bizForm"))) {
    $("#bzName").value = S.negocio?.nombre || ""; $("#bzTel").value = b.tel || ""; $("#bzIg").value = b.ig || ""; $("#bzAddr").value = b.dir || ""; $("#bzFoot").value = b.pie || "";
  }
}
const saveAj = async (data, msg) => {
  try { await setDoc(doc(db, COL.ajustes, "general"), { ...data, actualizadoEn: serverTimestamp() }, { merge: true }); toast(msg); document.activeElement?.blur(); }
  catch (e) { toast(String(e?.code).includes("permission") ? "Publica las reglas nuevas de Firestore (ap_ajustes) para guardar." : fbErr(e), true); }
};
$("#metalForm").addEventListener("submit", e => {
  e.preventDefault();
  const metales = {}; $$("#metalGrid [data-metal]").forEach(i => { const v = numOrNull(i.value); if (v != null) metales[i.dataset.metal] = v; });
  saveAj({ metales, factor: numOrNull($("#ajFactor").value) ?? DEF_AJ.factor, manoObra: num($("#ajLabor").value) }, "Precios del metal guardados");
});
$("#goalForm").addEventListener("submit", e => {
  e.preventDefault();
  saveAj({ meta: num($("#ajGoal").value), stockMin: Math.max(0, parseInt($("#ajMin").value, 10) || 0), diasIdle: Math.max(15, parseInt($("#ajIdle").value, 10) || 90),
    plazo: Math.max(1, parseInt($("#ajTerm").value, 10) || 30), anticipo: Math.min(100, Math.max(0, num($("#ajDown").value))) }, "Metas y reglas guardadas");
});
$("#bizForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    await setDoc(doc(db, COL.config, "negocio"), { nombre: $("#bzName").value.trim(), tel: $("#bzTel").value.trim(), ig: $("#bzIg").value.trim(), dir: $("#bzAddr").value.trim(), pie: $("#bzFoot").value.trim(), actualizadoEn: serverTimestamp() }, { merge: true });
    toast("Datos del negocio guardados"); document.activeElement?.blur();
  } catch (err) { toast(fbErr(err), true); }
});