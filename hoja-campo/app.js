/* Hoja de campo de la empresa: la app. Guarda en el dispositivo (IndexedDB) cada hoja cargada y lo rellenado, y lo manda
   a Drive (acción guardar_hoja): al .json de la visita (desde el 12-11-2026) o a la hoja de Google de antes. */
"use strict";

/* ---------- almacenamiento en el dispositivo ---------- */
const DB = (() => {
  let db = null;
  const abrir = () => db ? Promise.resolve(db) : new Promise((ok, mal) => {
    const rq = indexedDB.open("hoja-campo-eltejar", 1);
    rq.onupgradeneeded = () => { rq.result.createObjectStore("hojas", { keyPath: "id" }); rq.result.createObjectStore("varios"); };
    rq.onsuccess = () => { db = rq.result; ok(db); }; rq.onerror = () => mal(rq.error);
  });
  const tx = async (store, modo, fn) => { const d = await abrir(); return new Promise((ok, mal) => { const t = d.transaction(store, modo); const s = t.objectStore(store); const r = fn(s); t.oncomplete = () => ok(r && "result" in r ? r.result : undefined); t.onerror = () => mal(t.error); }); };
  return {
    lista: () => tx("hojas", "readonly", s => s.getAll()),
    leer: id => tx("hojas", "readonly", s => s.get(id)),
    guardar: h => tx("hojas", "readwrite", s => s.put(h)),
    borrar: id => tx("hojas", "readwrite", s => s.delete(id)),
    get: k => tx("varios", "readonly", s => s.get(k)),
    set: (k, v) => tx("varios", "readwrite", s => s.put(v, k)),
  };
})();

/* ---------- utilidades de interfaz ---------- */
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [a, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (a === "class") e.className = v; else if (a.startsWith("on")) e.addEventListener(a.slice(2), v); else e.setAttribute(a, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const $ = s => document.querySelector(s);
const slug = s => s.replace(/[^a-z0-9]/gi, "_");
function aviso(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(aviso.t); aviso.t = setTimeout(() => (t.hidden = true), 4500); }
const TONO = { "Hecha y eficaz": "ok", "Conforme": "ok", "Cumple": "ok", "Hecha": "ok", "Hecho": "ok", "Confirmada": "ok", "Cerrar como verificada": "ok", "Por teléfono": "ok", "Sí": "ok",
  "No hecha": "mal", "No conforme": "mal", "No cumple": "mal", "Hecha a medias": "medio", "Conforme sin documentar": "medio", "En parte": "medio", "A medias": "medio", "Solo la medida provisional": "medio", "Descartada": "medio" };

/* ---------- estado ---------- */
const E = { vista: "hoja", hoja: null, libro: null, modelo: null, sec: null, grupo: {}, abiertos: new Set(), instalar: null };
const val = (hoja, f) => { const ed = E.hoja.edits[hoja] || {}; return f.ref in ed ? ed[f.ref] : f.v; };
let guardarT = null;
// Autoguardado (Bernardo, 12-11-2026: «cada vez que actualice un campo»): al momento en el dispositivo y en Drive
// enseguida: las casillas de elegir (chips, Sí/No, listas, fechas) al instante; el texto, al dejar de escribir y al salir de él.
function poner(hoja, f, v, ms = 2000) {
  (E.hoja.edits[hoja] ||= {});
  if (v === f.v) delete E.hoja.edits[hoja][f.ref]; else E.hoja.edits[hoja][f.ref] = v;
  ((E.hoja.pendiente ||= {})[hoja] ||= {})[f.ref] = v;   // lo que falta escribir en la hoja de Google
  E.hoja.actualizada = Date.now();
  programarGuardado(ms);
  clearTimeout(guardarT);
  guardarT = setTimeout(async () => {
    try { await DB.guardar(E.hoja); estadoGuardado(); }
    catch (e) { $("#guardado").textContent = "No se pudo guardar en el dispositivo"; }
  }, 250);
}

/* ---------- avance ---------- */
function contestada(hoja, it, g) {
  const ref = it.claves.get(g || ""); if (!ref) return null;
  const f = it.campos.find(x => x.ref === ref); const v = val(hoja, f);
  if (!v) return false;
  const comp = it.campos.find(x => x.etiqueta === "Comprobado" && (x.grupo || "") === (g || ""));
  // el porqué de una retrasada: «Motivo del retraso» o, en la ficha del 12-11-2026, las Observaciones
  const mot = it.campos.find(x => x.etiqueta === "Motivo del retraso" && (x.grupo || "") === (g || "")) ||
              (it.nativa ? it.campos.find(x => x.etiqueta === "Observaciones") : null);
  if (it.obligatoria && comp && mot && !["Hecha y eficaz", "No se pudo ver"].includes(val(hoja, comp)) && !val(hoja, mot)) return false;
  return true;
}
function fichas(p) { return p.secciones.flatMap(s => s.entradas.filter(e => e.tipo === "ficha").map(it => ({ s, it }))); }
function avance(p) {
  let hechas = 0, total = 0;
  for (const { s, it } of fichas(p)) {
    if (it.plantilla && !it.campos.some(f => val(p.nombre, f))) continue;
    if (it.si_ref && !fichaVisible(p, it)) continue;          // las que no salen no cuentan
    if (p.nombre === "Verificaciones" && !it.si_ref) continue;    // el hueco de verificación vacío no es una tarea pendiente
    const gs = s.grupos.length ? s.grupos.filter(g => g.conDatos || it.campos.some(f => f.grupo === g.id && val(p.nombre, f))).map(g => g.id) : [""];
    for (const g of gs) { const c = contestada(p.nombre, it, g); if (c === null) continue; total++; if (c) hechas++; }
  }
  return { hechas, total };
}
function antesDeIrte() {
  const out = [];
  for (const p of E.modelo) {
    if (/Tareas/i.test(p.nombre)) {
      const n = fichas(p).filter(({ it }) => it.obligatoria && contestada(p.nombre, it, "") === false).length;
      out.push({ ok: !n, texto: n ? `${n} tareas retrasadas sin contestar` : "Tareas retrasadas contestadas", hoja: p.nombre });
    }
    if (p.nombre === "Hoy") for (const s of p.secciones) {
      if (!/ENTREVISTAS|FALTA RECIBIR|AVISOS|ANTES DE IRTE/.test(s.titulo)) continue;
      const pend = s.entradas.filter(e => e.tipo === "ficha" && !e.plantilla && (e.titulo || e.info.length) && contestada(p.nombre, e, "") === false);
      const nombre = /ENTREVISTAS/.test(s.titulo) ? "entrevistas" : /FALTA/.test(s.titulo) ? "lo que falta recibir" : /AVISOS/.test(s.titulo) ? "avisos" : null;
      if (nombre) out.push({ ok: !pend.length, texto: pend.length ? `${nombre[0].toUpperCase() + nombre.slice(1)}: ${pend.length} sin contestar` : `${nombre[0].toUpperCase() + nombre.slice(1)}: al día`, hoja: "Hoy" });
      else for (const e of s.entradas.filter(e => e.tipo === "ficha" && e.campos.length)) out.push({ ok: contestada(p.nombre, e, "") !== false, texto: e.titulo || "Casilla de «Antes de irte»", hoja: "Hoy" });
    }
  }
  return out;
}

/* ---------- carga ---------- */
async function cargarArchivo(file) {
  if (!file) return;
  if (/\.json$/i.test(file.name)) {   // la hoja de campo en JSON (12-11-2026)
    try { const v = deVisita(JSON.parse(await file.text()), file.name); return cargarBytes(v.nombre, v.bytes, null, null, v); }
    catch (e) { console.error(e); aviso("Ese .json no es una hoja de campo."); return; }
  }
  return cargarBytes(file.name, await file.arrayBuffer());
}
/* La hoja de campo en JSON (12-11-2026): {formato: "hoja-campo/1", esqueleto (el .xlsx de siempre, en base64), editables,
   respuestas {pestaña: {A1: valor}}}. Se pinta el esqueleto como hasta ahora y lo ya guardado en Drive (respuestas) se pone
   en sus casillas. Las hojas de Google de antes llegan como .xlsx. */
function deVisita(v, nombre) {
  if (!v || !/^hoja-campo\//.test(v.formato || "") || !v.esqueleto) throw new Error("no es una hoja de campo en JSON");
  return { nombre: (v.nombre || nombre.replace(/\.json$/i, "")) + ".json", bytes: base64ABytes(v.esqueleto), respuestas: v.respuestas || {},
           nativas: v.pestanas || [], orden: v.orden || [], miniaturas: v.miniaturas || null };
}
function deDrive(r) {   // la respuesta de la acción «hoja»: .json o .xlsx
  if (r.formato === "json") return deVisita(JSON.parse(r.json), r.nombre);
  return { nombre: /\.xlsx$/i.test(r.nombre) ? r.nombre : r.nombre + ".xlsx", bytes: base64ABytes(r.datos), respuestas: null, nativas: [], orden: [] };
}
const idDe = nombre => nombre.replace(/\.(xlsx|json)$/i, "");
const extraVisita = v => ({ respuestas: (v && v.respuestas) || null, nativas: (v && v.nativas) || [], orden: (v && v.orden) || [], miniaturas: (v && v.miniaturas) || null });
/* guarda una hoja de Drive en el dispositivo sin abrirla (la de hoy o la próxima, para tenerla sin cobertura);
   nunca pisa una que ya tenga casillas rellenadas */
async function guardarSinAbrir(nombre, bytes, modificado, driveId, v) {
  const id = idDe(nombre);
  const previa = await DB.leer(id);
  if (previa && Object.keys(previa.edits || {}).some(k => Object.keys(previa.edits[k] || {}).length)) return false;
  const libro = await XL.read(bytes);
  const hoy = libro.sheets.find(s => s.name === "Hoy"); if (!hoy) return false;
  await DB.guardar({ id, nombre, titulo: (hoy.cells.get("A1") || {}).v || nombre, bytes, edits: {}, cargada: Date.now(),
    actualizada: Date.now(), drive: modificado || null, driveId: driveId || null, precargada: true, ...extraVisita(v) });
  return true;
}
const RE_NOMBRE = /^([A-Z]{3}) (\d{2})(\d{2})(\d{4}) - Hoja de campo/;
const fechaDe = id => { const m = RE_NOMBRE.exec(id || ""); return m ? `${m[4]}-${m[3]}-${m[2]}` : null; };
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
function base64ABytes(b64) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }

/* al abrir la app: la hoja de la visita de hoy se abre sola; con conexión, se traen de Drive la de hoy y la de la
   próxima visita (si en el dispositivo no hay ya una con datos rellenados) */
async function sincronizarDrive() {
  if (!REPO.conectado() || !navigator.onLine) return [];
  const espera = new Promise((_, mal) => setTimeout(() => mal(new Error("Drive tarda demasiado")), 12000));
  const j = await Promise.race([REPO.pedir({ accion: "hojas" }), espera]);
  hojasD = j.hojas;
  const hoy = hoyISO();
  const proxima = hojasD.filter(x => x.fecha > hoy).sort((a, b) => a.fecha < b.fecha ? -1 : 1)[0];
  const traer = [...hojasD.filter(x => x.fecha === hoy), ...(proxima ? hojasD.filter(x => x.fecha === proxima.fecha) : [])];
  const traidas = [];
  for (const x of traer) {
    const local = await DB.leer(x.nombre);
    if (local && local.drive && local.drive >= x.modificado) continue;   // ya está la última versión
    if (local && !local.drive && !local.precargada) continue;            // cargada a mano: no se toca
    if (local && Object.values(local.edits || {}).some(o => Object.keys(o || {}).length)) continue;  // ya rellenada aquí
    try { const v = deDrive(await REPO.pedir({ accion: "hoja", id: x.id })); if (await guardarSinAbrir(v.nombre, v.bytes, x.modificado, x.id, v)) traidas.push(x); }
    catch (e) { console.error(e); }
  }
  return traidas;
}
async function abrirLaDeHoy() {
  const hoy = hoyISO();
  const deHoy = async () => (await DB.lista()).filter(x => fechaDe(x.id) === hoy);
  let locales = await deHoy();
  const abierta = locales.length === 1 ? locales[0].id : null;
  if (abierta) { await abrirHoja(abierta); aviso(`Hoja de hoy abierta: ${locales[0].titulo}`); }
  let traidas = [];
  try { traidas = await sincronizarDrive(); } catch (e) { console.error(e); }
  if (abierta) {  // la abierta se ha actualizado en Drive y aquí no se había rellenado nada: se recarga
    if (traidas.some(x => x.nombre === abierta) && E.hoja && E.hoja.id === abierta) { await abrirHoja(abierta); aviso("Hoja de hoy actualizada desde Drive."); }
    return true;
  }
  locales = await deHoy();
  if (locales.length === 1) { await abrirHoja(locales[0].id); aviso(`Hoja de hoy abierta: ${locales[0].titulo}`); return true; }
  if (locales.length > 1) { E.vista = "inicio"; E.modelo = null; pintar(); aviso(`Hoy tienes ${locales.length} visitas: elige la hoja.`); return true; }
  return false;
}

async function cargarBytes(nombre, bytes, drive, driveId, v) {
  const file = { name: nombre };
  try {
    const libro = await XL.read(bytes);
    if (!libro.sheets.some(s => s.name === "Hoy")) { aviso("Este Excel no es una hoja de campo: no tiene la pestaña «Hoy»."); return; }
    const hoy = libro.sheets.find(s => s.name === "Hoy");
    const titulo = (hoy.cells.get("A1") || {}).v || file.name;
    const id = idDe(file.name);
    const previa = await DB.leer(id);
    const hoja = { id, nombre: file.name, titulo, bytes, edits: {}, cargada: Date.now(), actualizada: Date.now(), drive: drive || null, driveId: driveId || null, ...extraVisita(v) };
    if (previa && Object.keys(previa.edits || {}).length) {
      if (!await confirmar(`Ya tienes «${previa.titulo}» con datos rellenados en este dispositivo. ¿Sustituirla por el archivo nuevo? Lo rellenado aquí y no exportado se pierde.`, "Sustituir")) return;
    }
    await DB.guardar(hoja);
    await abrirHoja(id);
    aviso("Hoja cargada: " + titulo);
  } catch (e) { console.error(e); aviso("No se pudo leer el archivo. Tiene que ser la hoja de campo (.json o .xlsx)."); }
}
async function abrirHoja(id) {
  const hoja = await DB.leer(id); if (!hoja) return;
  E.hoja = hoja; E.libro = await XL.read(hoja.bytes);
  const nativas = hoja.nativas || [];
  E.modelo = MODELO.libro(E.libro, nativas.map(p => p.nombre));
  if (nativas.length) {   // las pestañas nativas del JSON, cada una en su sitio (tramo 2, 12-11-2026)
    const nombres = new Set([...E.modelo.map(p => p.nombre), ...nativas.map(p => p.nombre)]);
    const orden = hoja.orden || [];
    for (const p of nativas) {
      const m = MODELO.nativa(p, nombres);
      const antes = new Set(orden.slice(0, Math.max(0, orden.indexOf(p.nombre))));
      const i = orden.includes(p.nombre) ? E.modelo.filter(x => antes.has(x.nombre)).length : E.modelo.length;
      E.modelo.splice(i, 0, m);
    }
  }
  ponerRespuestas(hoja.respuestas);
  marcarObligatorias();
  E.sec = E.modelo[0].nombre; E.vista = "hoja"; E.grupo = {};
  await DB.set("ultima", id);
  pintar();
  precargarFotos();
  if (nPendientes()) guardarEnDrive(false);
}
function ponerRespuestas(resp) {   // lo ya guardado en el .json de Drive, como valor de partida de cada casilla
  if (!resp) return;
  for (const p of E.modelo) { const r = resp[p.nombre]; if (!r) continue;
    for (const s of p.secciones) for (const e of s.entradas) if (e.tipo === "ficha") for (const f of e.campos) if (f.ref in r) f.v = r[f.ref]; }
}
function marcarObligatorias() {  // las tareas bajo el rótulo rojo (retrasadas) se contestan siempre (las nativas ya lo traen)
  for (const p of E.modelo.filter(p => !p.nativa)) for (const s of p.secciones) { let rojo = false;
    for (const e of s.entradas) { if (e.tipo === "rotulo") rojo = e.color === "rojo"; else if (e.tipo === "ficha") e.obligatoria = rojo; } }
}

/* ---------- guardar en la hoja de Google (sin exportar: 14-10-2026) ----------
   Lo rellenado se guarda al momento en el dispositivo y, con conexión, se escribe en la hoja de Google de la visita
   (acción guardar_hoja de la Apps Script): enseguida tras cada cambio (las de elegir al instante; el texto al dejar de escribir), al volver la conexión, al salir de
   la app y con el botón «Guardar». Sin conexión queda pendiente y se manda en cuanto la haya. */
const nPendientes = () => Object.values((E.hoja && E.hoja.pendiente) || {}).reduce((a, o) => a + Object.keys(o || {}).length, 0);
const horaCorta = t => new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
function estadoGuardado(txt) {
  const el = $("#guardado"); if (!el || !E.hoja) return;
  const n = nPendientes();
  el.textContent = txt || (!n ? (E.hoja.enDrive ? `Guardado en Drive ${horaCorta(E.hoja.enDrive)}` : "Guardado en este dispositivo")
    : !REPO.conectado() ? `${n} cambios en este dispositivo · conecta la app con Drive para guardarlos en la hoja`
    : navigator.onLine ? `${n} cambios sin guardar en Drive` : `Sin conexión · ${n} cambios se guardarán al volver`);
}
let guardadoT = null, guardando = false;
function programarGuardado(ms = 2000) { clearTimeout(guardadoT); guardadoT = setTimeout(() => guardarEnDrive(false), ms); }
async function idDrive(h) {   // la hoja de Google de esta hoja: la que se trajo, o la que se llama igual en Drive
  if (h.driveId) return h.driveId;
  const j = await REPO.pedir({ accion: "hojas" });
  const x = (j.hojas || []).find(x => x.nombre === h.id);
  if (x) { h.driveId = x.id; await DB.guardar(h); }
  return h.driveId || null;
}
async function guardarEnDrive(aMano) {
  if (!E.hoja || guardando) return;
  const n = nPendientes();
  if (!n) { if (aMano) aviso(E.hoja.enDrive ? `Todo guardado en Drive (último, ${horaCorta(E.hoja.enDrive)}): se guarda solo al cambiar cada casilla.` : "No hay cambios por guardar: la hoja de Drive está al día."); estadoGuardado(); return; }
  if (!REPO.conectado()) { if (aMano) aviso("Conecta la app con Drive (Repositorio PRL → Conectar con Drive) para guardar en la hoja de Google."); estadoGuardado(); return; }
  if (!navigator.onLine) { if (aMano) aviso("Sin conexión: lo rellenado está a salvo en el dispositivo y se guardará en Drive al volver la conexión."); estadoGuardado(); return; }
  guardando = true; estadoGuardado("Guardando en Drive…");
  const h = E.hoja; const enviado = JSON.parse(JSON.stringify(h.pendiente));
  try {
    const id = await idDrive(h);
    if (!id) throw new Error("no encuentro en Drive una hoja de Google que se llame «" + h.id + "»");
    const r = await REPO.pedir({ accion: "guardar_hoja", id, cambios: enviado });
    // Solo cuenta como guardado si la Apps Script dice cuántas casillas escribió: una versión publicada antigua, sin
    // «guardar_hoja», contestaba otra cosa y lo pendiente se daba por guardado sin estarlo (03-11-2026).
    if (typeof r.guardadas !== "number") throw new Error("la aplicación de Apps Script publicada no sabe guardar la hoja (hay que publicar la versión nueva)");
    for (const [p, o] of Object.entries(enviado)) for (const [ref, v] of Object.entries(o))   // fuera lo guardado, si no ha vuelto a cambiar
      if (h.pendiente[p] && h.pendiente[p][ref] === v) delete h.pendiente[p][ref];
    for (const p of Object.keys(h.pendiente)) if (!Object.keys(h.pendiente[p]).length) delete h.pendiente[p];
    h.enDrive = Date.now(); await DB.guardar(h);
    if (r.rechazadas && r.rechazadas.length) aviso(`Guardado en Drive, salvo ${r.rechazadas.length} casilla(s) que en la hoja de Google no son de rellenar.`);
    else if (aMano) aviso(`Guardado en la hoja de Google (${r.guardadas} casillas).`);
  } catch (e) { if (aMano) aviso("No se pudo guardar en Drive: " + e.message + ". Lo rellenado sigue en el dispositivo."); }
  finally { guardando = false; estadoGuardado(); if (h.enDrive && Date.now() - h.enDrive < 5000 && nPendientes()) programarGuardado(); }   // lo cambiado mientras guardaba (solo si este guardado fue bien: sin bucle si Drive falla)
}

/* ✕ junto a «Guardar» (Bernardo, 03-11-2026): cerrar siempre guarda antes (en el dispositivo y, con conexión, en la hoja
   de Google) y vuelve a la lista de hojas. Lo que no se pueda mandar a Drive queda pendiente, como siempre. */
async function cerrarHoja() {
  if (!E.hoja) return;
  clearTimeout(guardarT); clearTimeout(guardadoT);
  try { await DB.guardar(E.hoja); } catch (e) { console.error(e); }
  await guardarEnDrive(true);
  E.vista = "inicio"; E.modelo = null; pintar();
}

/* ---------- diálogo propio (sin confirm del navegador) ---------- */
function confirmar(texto, si) {
  return new Promise(ok => {
    const d = $("#dialogo"); d.innerHTML = "";
    d.append(h("p", {}, texto), h("div", { class: "acciones" },
      h("button", { class: "btn", type: "button", onclick: () => { d.close(); ok(false); } }, "Cancelar"),
      h("button", { class: "btn peligro", type: "button", onclick: () => { d.close(); ok(true); } }, si)));
    d.showModal();
  });
}

/* ---------- pintar ---------- */
function pintar() {
  $("#tab-hoja").setAttribute("aria-current", String(E.vista === "hoja" || E.vista === "inicio"));
  $("#tab-repo").setAttribute("aria-current", String(E.vista === "repo"));
  $("#tab-correo").setAttribute("aria-current", String(E.vista === "correo"));
  const hayHoja = E.vista === "hoja" && E.modelo;
  $("#acciones-hoja").hidden = !hayHoja;
  $("#titulo").textContent = hayHoja ? E.hoja.titulo : E.vista === "repo" ? "Repositorio del sistema de PRL" : E.vista === "correo" ? "Correo" : "Hoja de campo";
  $("#guardado").textContent = ""; if (hayHoja) estadoGuardado();
  const nav = $("#nav"); nav.innerHTML = ""; nav.hidden = !hayHoja;
  document.querySelector(".app").classList.toggle("sin-nav", !hayHoja);
  const main = $("#vista"); main.innerHTML = "";
  if (E.vista === "repo") return REPO.pintar(main);
  if (E.vista === "correo") return CORREO.pintar(main);
  if (!hayHoja) return pintarInicio(main);
  for (const p of E.modelo) {
    const [cod, nom] = p.nombre.includes(" · ") ? p.nombre.split(" · ") : ["", p.nombre];
    let punto = "", cuenta = "";
    if (p.nombre === "Hoy") { const pend = antesDeIrte().filter(x => !x.ok).length; punto = pend ? "mal" : "ok"; cuenta = pend ? `${pend} pend.` : "listo"; }
    else { const a = avance(p); if (a.total) { punto = a.hechas === a.total ? "ok" : a.hechas ? "medio" : ""; cuenta = `${a.hechas}/${a.total}`; } }
    nav.append(h("button", { type: "button", class: "navbtn", "aria-current": String(E.sec === p.nombre), onclick: () => { E.sec = p.nombre; pintar(); window.scrollTo({ top: 0 }); } },
      h("span", { class: "punto " + punto }), h("span", { class: "lbl" }, nom, cod ? h("small", {}, cod) : null), h("span", { class: "cnt" }, cuenta)));
  }
  const p = E.modelo.find(x => x.nombre === E.sec) || E.modelo[0];
  main.append(pintarHoja(p));
}

function pintarInicio(main) {
  const s = h("section", { class: "vista" });
  if (REPO.conectado()) s.append(hojasDrive());
  s.append(REPO.conectado() ? h("div", { class: "panel" }, h("p", { class: "nota" }, "¿La hoja no está en Drive? Cárgala desde un archivo (.json o .xlsx)."), h("label", { class: "btn", for: "cargar" }, "Cargar desde archivo")) : h("div", { class: "panel bienvenida" },
    h("h2", {}, "Carga la hoja de campo de la visita"),
    h("p", {}, "En Drive, abre la hoja de campo de la visita y descárgala como Excel (Archivo → Descargar → Microsoft Excel). Después cárgala aquí. Todo lo que rellenes se queda en este dispositivo hasta que lo exportes."),
    h("label", { class: "btn primario grande", for: "cargar" }, "Cargar hoja de campo (.json o .xlsx)")));
  const lista = h("div", { class: "lista-hojas" });
  s.append(h("h3", {}, "Hojas en este dispositivo"), lista);
  DB.lista().then(hs => {
    if (!hs.length) { lista.append(h("p", { class: "vacio" }, "Todavía no hay ninguna. La primera que cargues aparecerá aquí.")); return; }
    for (const x of hs.sort((a, b) => b.actualizada - a.actualizada)) {
      const n = Object.values(x.edits || {}).reduce((a, o) => a + Object.keys(o).length, 0);
      lista.append(h("div", { class: "fila-hoja" },
        h("button", { type: "button", class: "abrir" + (fechaDe(x.id) === hoyISO() ? " destacada" : ""), onclick: () => abrirHoja(x.id) }, h("strong", {}, (fechaDe(x.id) === hoyISO() ? "Hoy · " : "") + x.titulo), h("span", {}, !n && x.precargada ? "descargada de Drive, lista para usar sin conexión" : `${n} casillas rellenadas · ${Object.values(x.pendiente || {}).some(o => Object.keys(o).length) ? "con cambios sin guardar en Drive" : x.enDrive ? "guardada en Drive " + new Date(x.enDrive).toLocaleDateString("es-ES") : "en este dispositivo"}`)),
        h("button", { type: "button", class: "btn", onclick: async () => { if (await confirmar(`¿Quitar «${x.titulo}» de este dispositivo?${x.exportada ? "" : " No se ha exportado: lo rellenado se pierde."}`, "Quitar")) { await DB.borrar(x.id); pintar(); } } }, "Quitar")));
    }
  });
  if (E.instalar) s.append(h("div", { class: "panel" }, h("p", {}, "Instala la app para abrirla desde su icono y usarla sin conexión."), h("button", { class: "btn primario", type: "button", onclick: async () => { E.instalar.prompt(); await E.instalar.userChoice; E.instalar = null; pintar(); } }, "Instalar la app")));
  main.append(s);
}

/* ---------- hojas de campo de Drive (por la conexión del repositorio) ---------- */
const DATOS_EMPRESA = self.EMPRESA || {};   // empresa.js: lo escribe publicar.sh desde config/empresa.toml
const CENTROS = DATOS_EMPRESA.centros || {};   // código → nombre; sin él, el código
if (DATOS_EMPRESA.nombre_corto) document.title = `Hoja de campo · ${DATOS_EMPRESA.nombre_corto}`;
const fechaES = iso => iso.split("-").reverse().join("/");
let hojasD = null, centroD = null;
function hojasDrive() {
  const panel = h("div", { class: "panel" }, h("h3", {}, "Hojas de campo en Drive"));
  const cuerpo = h("div", { class: "cuerpo-drive" }, h("p", { class: "nota" }, navigator.onLine ? "Buscando en Drive…" : "Sin conexión: conéctate para traer una hoja de Drive."));
  panel.append(cuerpo);
  const pintarLista = () => {
    cuerpo.innerHTML = "";
    if (!hojasD.length) { cuerpo.append(h("p", { class: "nota" }, "No hay hojas de campo en Drive.")); return; }
    const centros = [...new Set(hojasD.map(x => x.centro))];
    const hoy = new Date().toISOString().slice(0, 10);
    centroD = centroD || (hojasD.find(x => x.fecha >= hoy) || hojasD[0]).centro;
    cuerpo.append(h("p", { class: "nota" }, "¿Qué centro visitas?"), h("div", { class: "chips" }, centros.map(c => h("button", { type: "button", class: "chip", "aria-pressed": String(c === centroD), onclick: () => { centroD = c; pintarLista(); } }, CENTROS[c] || c))));
    const visitas = hojasD.filter(x => x.centro === centroD);
    for (const x of visitas) {
      const proxima = x === visitas.filter(v => v.fecha >= hoy).slice(-1)[0];
      cuerpo.append(h("div", { class: "fila-hoja" },
        h("button", { type: "button", class: "abrir" + (proxima ? " destacada" : ""), onclick: () => traerHoja(x) },
          h("strong", {}, `${CENTROS[x.centro] || x.centro} · visita del ${fechaES(x.fecha)}`), h("span", {}, (proxima ? "Próxima visita · " : "") + "cambiada en Drive " + new Date(x.modificado).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })))));
    }
  };
  if (hojasD) pintarLista();
  else if (navigator.onLine) REPO.pedir({ accion: "hojas" }).then(j => { hojasD = j.hojas; pintarLista(); })
    .catch(e => { cuerpo.innerHTML = ""; cuerpo.append(h("p", { class: "nota alerta" }, "No se pudo leer Drive: " + e.message)); });
  return panel;
}
async function traerHoja(x) {
  aviso("Trayendo la hoja de Drive…");
  try {
    const v = deDrive(await REPO.pedir({ accion: "hoja", id: x.id }));
    await cargarBytes(v.nombre, v.bytes, x.modificado, x.id, v);
  } catch (e) { aviso("No se pudo traer la hoja: " + e.message); }
}

// En «Hoy», las líneas sueltas son el texto del Coordinador (desde el 03-11-2026 «Hoy» es solo ese texto): se ven, no
// se pliegan como instrucciones. Solo el subtítulo fijo de la pestaña es instrucción (11-11-2026).
const SUBTITULO_HOY = /Aquí no se rellena nada/;
function pintarHoja(p) {
  const s = h("section", { class: "vista" });
  const esHoy = p.nombre === "Hoy";
  const resumen = esHoy ? p.notas.filter(n => !SUBTITULO_HOY.test(n)) : [];
  const instrucciones = p.notas.filter(n => !/^⚠/.test(n) && !resumen.includes(n));
  s.append(h("div", { class: "cabecera-hoja" }, h("h2", {}, p.titulo || p.nombre),
    p.notas.filter(n => /^⚠/.test(n) && !resumen.includes(n)).map(n => h("p", { class: "nota alerta" }, n)),
    instrucciones.length ? h("details", { class: "mas" }, h("summary", {}, "Cómo se rellena esta pestaña"), instrucciones.map(n => h("p", { class: "nota" }, n))) : null));
  if (resumen.length)
    s.append(h("div", { class: "panel" }, h("h3", {}, "Lo que toca hoy"),
      resumen.map((n, i) => h("p", { class: /^⚠|^Aviso:/.test(n) ? "nota alerta" : "" }, i === 0 ? h("strong", {}, n) : n))));
  if (esHoy) {
    const lista = h("ul", { class: "checklist" });
    for (const x of antesDeIrte()) lista.append(h("li", {}, h("span", { class: "marca " + (x.ok ? "ok" : "mal") }, x.ok ? "✓" : "!"),
      h("button", { type: "button", class: "enlace", onclick: () => { E.sec = x.hoja; pintar(); } }, x.texto)));
    s.append(h("div", { class: "panel" }, h("h3", {}, "Antes de irte"), lista));
  }
  for (const sec of p.secciones) s.append(pintarSeccion(p, sec));
  return s;
}

const PLEGABLES = new Set(["verde", "rojo", "gris", "azul"]);   // rótulos de grupo (no los de área)
function pintarSeccion(p, sec) {
  const wrap = h("div", { class: "seccion" });
  if (sec.titulo && !(p.nombre === "Hoy" && /ANTES DE IRTE/.test(sec.titulo) && !sec.entradas.some(e => e.tipo === "ficha" && e.campos.length)))
    wrap.append(...[h("h3", { class: "tit-seccion" }, sec.titulo), sec.nota ? h("p", { class: "nota" }, sec.nota) : null].filter(Boolean));   // append(null) pinta «null»
  if (!sec.conEntradas) { wrap.append(tabla(sec)); return wrap; }
  const clave = p.nombre + "|" + sec.titulo;
  const grupos = sec.grupos.filter(g => g.conDatos || true);
  let g = null;
  if (grupos.length) {
    g = E.grupo[clave] || grupos[0].id;
    wrap.append(h("div", { class: "seg", role: "tablist" }, grupos.map(x => h("button", { type: "button", role: "tab", "aria-selected": String(x.id === g), onclick: () => { E.grupo[clave] = x.id; pintar(); } }, x.texto))));
  }
  let bloque = null, cuerpo = wrap, plantillas = 0, contenedor = wrap, encima = "";
  for (const e of sec.entradas) {
    if (e.tipo === "rotulo") {
      bloque = null;
      if (PLEGABLES.has(e.color)) {   // los grupos de tareas salen plegados y se abren tocando el título (03-11-2026)
        const id = p.nombre + "|R|" + encima + "|" + e.texto.replace(/\s*\(.*$/, "");   // el mismo subgrupo sale en mis tareas y en heredadas
        const det = h("details", { class: "plegable", open: E.abiertos.has(id) }, h("summary", { class: "rotulo " + e.color }, e.texto));
        det.addEventListener("toggle", () => det.open ? E.abiertos.add(id) : E.abiertos.delete(id));
        contenedor = h("div", { class: "cuerpo" }); det.append(contenedor); wrap.append(det);
      } else {
        encima = e.color === "seccion" ? encima.split("»")[0] + "»" + e.texto : e.texto;   // área » sección
        contenedor = wrap; wrap.append(h("div", { class: "rotulo " + e.color }, e.texto));
      }
      cuerpo = contenedor; continue;
    }
    if (e.tipo === "nota") { cuerpo.append(h("p", { class: "nota" }, e.texto)); continue; }
    if (e.bloque !== null && e.bloque !== undefined && e.bloque !== (bloque && bloque.nombre)) {
      const id = p.nombre + "|" + e.bloque;
      const det = h("details", { class: "bloque", open: E.abiertos.has(id) }, h("summary", {}, e.bloque, h("span", { class: "cnt" }, "")));
      det.addEventListener("toggle", () => det.open ? E.abiertos.add(id) : E.abiertos.delete(id));
      bloque = { nombre: e.bloque, det, cuerpo: h("div", { class: "cuerpo" }), hechas: 0, total: 0 };
      det.append(bloque.cuerpo); contenedor.append(det); cuerpo = bloque.cuerpo;
    }
    if (e.si_ref && !fichaVisible(p, e)) continue;   // Verificaciones (12-11-2026): sale según el valor de otra casilla
    if (e.plantilla && !e.campos.some(f => val(p.nombre, f))) {
      if (plantillas++ > 0) continue;
      cuerpo.append(h("button", { type: "button", class: "btn anadir", onclick: () => { e.plantilla = false; pintar(); } }, "+ Añadir fila"));
      continue;
    }
    const tarjeta = fichaUI(p, sec, e, g);
    if (tarjeta) cuerpo.append(tarjeta);
    if (bloque) { const c = contestada(p.nombre, e, g || ""); if (c !== null) { bloque.total++; if (c) bloque.hechas++; } bloque.det.querySelector(".cnt").textContent = bloque.total ? `${bloque.hechas}/${bloque.total}` : ""; }
  }
  return wrap;
}

function tabla(sec) {
  const fs = sec.entradas.filter(e => e.tipo === "ficha");
  if (!fs.length) return h("div");
  const cols = [...new Set(fs.flatMap(f => f.info.map(i => i.etiqueta)))];
  const t = h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, ""), cols.map(c => h("th", {}, c)))),
    h("tbody", {}, fs.map(f => h("tr", {}, h("th", { scope: "row" }, f.id || f.titulo || ""), cols.map(c => { const i = f.info.find(x => x.etiqueta === c); return h("td", {}, i ? (i.enlace ? h("a", { href: i.enlace, target: "_blank", rel: "noopener" }, i.v) : i.v) : ""); })))));
  return h("div", { class: "tabla" }, t);
}

// Un campo con «si» (Novedades, 12-11-2026) solo se enseña cuando el campo que nombra tiene ese valor (p. ej. «¿Hay?» = Sí)
const visible = (p, it, f) => { if (!f.si) return true; const v = val(p.nombre, it.campos.find(x => x.etiqueta === f.si.campo) || {});
  return f.si.no_vacio ? !!v : v === f.si.valor; };
// El valor de una casilla de la pestaña por su ref (para las fichas con «si_ref»)
function valorRef(p, ref) {
  for (const s of p.secciones) for (const e of s.entradas) if (e.tipo === "ficha") { const f = e.campos.find(x => x.ref === ref); if (f) return val(p.nombre, f); }
  return "";
}
const fichaVisible = (p, e) => { const v = valorRef(p, e.si_ref.ref); return e.si_ref.no_vacio ? !!v : v === e.si_ref.valor; };
function fichaUI(p, sec, it, g) {
  const campos = it.campos.filter(f => (!g || !f.grupo || f.grupo === g) && visible(p, it, f));
  const info = it.info.filter(i => !g || !i.grupo || i.grupo === g);
  if (!campos.length && !info.length && !it.titulo) return null;
  const est = contestada(p.nombre, it, g || "");
  // dato de solo lectura dentro de un bloque: una línea, sin tarjeta
  if (!campos.length && it.bloque) return h("div", { class: "dato" }, h("span", { class: "k" }, it.titulo || ""), h("span", { class: "v" }, info.map(i => i.v).join(" · ")));
  const esTarea = /^CTL-TAR/.test(p.nombre) && it.id && /^T-[A-Z]{3}-\d{4}$/.test(it.id);
  if (esTarea && !campos.length) return historica(it);   // «Históricas» (11-11-2026): una línea con sus enlaces
  const card = h("article", { class: "ficha" + (esTarea ? " tarea" : "") + (est === true ? " est-ok" : est === false && it.obligatoria ? " est-mal" : est === false ? " est-pend" : "") });
  const cab = h("div", { class: "ficha-cab" });
  if (it.id) cab.append(h("span", { class: "id" }, it.id));
  if (it.sub) cab.append(h("strong", {}, it.sub));
  if (it.obligatoria) cab.append(h("span", { class: "pastilla mal" }, est ? "Retrasada · contestada" : "Retrasada"));
  if (cab.children.length) card.append(cab);
  if (it.titulo && !["Encargos", "Entrevistas"].includes(p.nombre)) card.append(h("p", { class: "ficha-titulo" }, it.titulo));   // en «Encargos», el título va en la cabecera plegable
  const datos = h("div", { class: "datos" });
  for (const i of info) {
    if (i.enlace) { datos.append(h("a", { class: "btn enlace-foto", href: i.enlace, target: "_blank", rel: "noopener" }, /^\p{Extended_Pictographic}/u.test(i.v || "") ? "" : "📷 ", i.v || i.etiqueta, " ↗")); continue; }   // los que ya traen su icono (📁), sin la cámara
    if (i.hoja) { const pp = E.modelo.find(x => x.nombre === i.hoja); const a = avance(pp); datos.append(h("button", { type: "button", class: "btn ir", onclick: () => { E.sec = i.hoja; pintar(); window.scrollTo({ top: 0 }); } }, `Abrir ${i.hoja.split(" · ").pop()}`, a.total ? ` · ${a.hechas}/${a.total}` : "")); continue; }
    const vence = /^Vence/.test(i.etiqueta);
    datos.append(h("span", { class: "dato-chip" + (vence && /hace/.test(i.v) ? " mal" : "") }, i.etiqueta ? h("span", { class: "k" }, i.etiqueta + ": ") : null, i.v));
  }
  if (esTarea) return fichaTarea(p, it, card, datos, campos, est);
  if (datos.children.length) card.append(datos);
  if (it.detalle) card.append(h("details", { class: "mas" }, h("summary", {}, it.detalle_titulo || "Ver detalle"), h("p", { class: "detalle" }, it.detalle)));
  if (it.id && /^T-[A-Z]{3}-\d{4}$/.test(it.id)) { const g = galeria(it.id); if (g) card.append(g); }
  const principales = [], secundarios = [];
  for (const f of campos) (OPC(f) && campos.length > 2 && !["Novedades", "Comprobaciones", "Verificaciones"].includes(p.nombre) ? secundarios : principales).push(f);   // en Novedades, todo a la vista al abrirse
  for (const f of principales) card.append(campoUI(p, it, f));
  if (secundarios.length) {
    const id = p.nombre + "|" + it.r + "|mas";
    const relleno = secundarios.filter(f => val(p.nombre, f) && val(p.nombre, f) !== f.v).length;
    const d = h("details", { class: "mas", open: E.abiertos.has(id) }, h("summary", {}, `Más campos (${secundarios.length})${relleno ? ` · ${relleno} rellenados` : ""}`), h("div", { class: "cuerpo" }, secundarios.map(f => campoUI(p, it, f))));
    d.addEventListener("toggle", () => d.open ? E.abiertos.add(id) : E.abiertos.delete(id));
    card.append(d);
  }
  if (est === false && it.obligatoria) {
    const comp = campos.find(f => f.etiqueta === "Comprobado");
    card.append(h("p", { class: "msg mal" }, comp && val(p.nombre, comp) ? "Falta el motivo del retraso." : "Retrasada: falta «Comprobado»."));
  }
  return p.nombre === "Encargos" ? plegableEncargo(p, it, card, campos) : p.nombre === "Entrevistas" ? plegableEntrevista(p, it, card) : card;
}
// Tarjeta de una tarea (Bernardo, 11-11-2026): a la izquierda, el código, la referencia, lo que se pidió y lo que se rellena;
// a la derecha (en el móvil, debajo), los datos en pequeño, las fotos (se amplían al tocarlas) y las carpetas. «Ver detalle»:
// el origen, quién y cuándo, el estado y el enlace a 6conecta.
function fichaTarea(p, it, card, datos, campos, est) {
  const principal = h("div", { class: "tarea-main" }), lado = h("aside", { class: "tarea-lado" });
  while (card.firstChild) principal.append(card.firstChild);
  const enlaces = [...datos.querySelectorAll("a.enlace-foto")], seis = enlaces.filter(a => /6conecta/i.test(a.textContent));
  const carpetas = enlaces.filter(a => !seis.includes(a));
  for (const a of enlaces) a.remove();
  if (datos.children.length) { datos.classList.add("datos-lado"); lado.append(datos); }
  const g = galeria(it.id);
  if (g) lado.append(g);
  if (carpetas.length) lado.append(h("div", { class: "carpetas" }, carpetas.map(a => { a.className = "carpeta"; a.textContent = (/evidencia/i.test(a.textContent) ? "📁 Evidencia del responsable" : "📁 Mis fotos") + " ↗"; return a; })));
  if (it.detalle || seis.length) principal.append(h("details", { class: "mas" }, h("summary", {}, "Ver detalle"),
    it.detalle ? h("p", { class: "detalle" }, it.detalle) : null, ...seis.map(a => { a.className = "btn enlace-foto"; return a; })));
  // Todo a la vista (Bernardo, 12-11-2026): Comprobado, Observaciones, Nueva fecha propuesta y Propuesta, sin «Más campos»
  const principales = it.nativa ? campos : [], secundarios = [];
  if (!it.nativa) for (const f of campos) (OPC(f) && campos.length > 2 ? secundarios : principales).push(f);
  for (const f of principales) principal.append(campoUI(p, it, f));
  if (secundarios.length) {
    const id = p.nombre + "|" + it.r + "|mas";
    const relleno = secundarios.filter(f => val(p.nombre, f) && val(p.nombre, f) !== f.v).length;
    const d = h("details", { class: "mas", open: E.abiertos.has(id) }, h("summary", {}, `Más campos (${secundarios.length})${relleno ? ` · ${relleno} rellenados` : ""}`), h("div", { class: "cuerpo" }, secundarios.map(f => campoUI(p, it, f))));
    d.addEventListener("toggle", () => d.open ? E.abiertos.add(id) : E.abiertos.delete(id));
    principal.append(d);
  }
  if (est === false && it.obligatoria) {
    const comp = campos.find(f => f.etiqueta === "Comprobado");
    const sinMotivo = it.campos.some(f => f.etiqueta === "Motivo del retraso") ? "Falta el motivo del retraso." : "Faltan las observaciones: por qué no se ha hecho.";
    principal.append(h("p", { class: "msg mal" }, comp && val(p.nombre, comp) ? sinMotivo : "Retrasada: falta «Comprobado»."));
  }
  card.append(principal);
  if (lado.children.length) card.append(lado);
  return card;
}
function historica(it) {
  const enl = it.info.filter(i => i.enlace).map(i => h("a", { class: "carpeta", href: i.enlace, target: "_blank", rel: "noopener" }, /6conecta/i.test(i.v) ? "🔗 6conecta ↗" : /evidencia/i.test(i.v) ? "📁 Evidencia ↗" : "📁 Fotos ↗"));
  return h("div", { class: "historica" }, h("span", { class: "id" }, it.id), h("span", { class: "h-tit" }, [it.sub, it.titulo].filter(Boolean).join(" — ")), h("span", { class: "h-enl" }, enl));
}
// «Encargos» (criterio del técnico, 11-11-2026): cada encargo se pliega y se despliega tocándolo; cerrado se ve el título,
// el origen y el estado. «Ya no aplica» lo tacha y lo deja plegado (se puede deshacer).
// «Entrevistas» (11-11-2026): el guion de cada responsable, plegable; cerrado, su nombre y cuántos temas tiene.
function plegableEntrevista(p, it, card) {
  const temas = it.info.filter(i => i.hoja).length;
  const quien = it.titulo || (it.info.find(i => /responsable/i.test(i.etiqueta || "")) || {}).v || "Responsable";
  const id = p.nombre + "|ent|" + it.r;
  const det = h("details", { class: "encargo", open: E.abiertos.has(id) },
    h("summary", {}, h("span", { class: "enc-tit" }, quien),
      h("span", { class: "pastilla " + (temas ? "pend" : "gris") }, temas ? `${temas} tema${temas > 1 ? "s" : ""}` : "Nada que tratar")),
    card);
  det.addEventListener("toggle", () => det.open ? E.abiertos.add(id) : E.abiertos.delete(id));
  return det;
}
function plegableEncargo(p, it, card, campos) {
  const fEstado = campos.find(f => f.etiqueta === "Estado");
  const estado = fEstado ? val(p.nombre, fEstado) : "";
  const origen = (it.info.find(i => i.etiqueta === "Origen") || {}).v || "";
  const id = p.nombre + "|enc|" + it.r;
  const fuera = estado === "Ya no aplica";
  const titulo = it.titulo || (campos.find(f => f.etiqueta === "Qué") && val(p.nombre, campos.find(f => f.etiqueta === "Qué"))) || "Encargo nuevo";
  const det = h("details", { class: "encargo" + (fuera ? " fuera" : ""), open: E.abiertos.has(id) && !fuera },
    h("summary", {}, h("span", { class: "enc-tit" }, titulo),
      origen ? h("span", { class: "enc-origen" }, origen.split(" · ")[0]) : null,
      h("span", { class: "pastilla " + (estado ? (fuera ? "gris" : "ok") : "pend") }, estado || "Sin contestar")),
    card);
  det.addEventListener("toggle", () => det.open ? E.abiertos.add(id) : E.abiertos.delete(id));
  return det;
}
/* ---------- fotos de las tareas (del índice del repositorio) ---------- */
// Miniaturas (12-11-2026): primero las que trae el propio .json (las baja el montaje: en la tablet drive.google.com/thumbnail
// no carga desde aquí); si no trae, el índice de Drive como antes.
const miniaturasDe = id => (E.hoja && E.hoja.miniaturas && E.hoja.miniaturas[id]) || null;
function galeria(id) {
  const propias = miniaturasDe(id), grupos = propias || REPO.fotosDe(id);
  if (!grupos.length) return null;
  const todas = grupos.flatMap(g => g.archivos.map(f => ({ ...f, tipo: g.tipo })));
  const cont = h("div", { class: "fotos" });
  for (const g of grupos) {
    cont.append(h("div", { class: "fotos-cab" }, h("span", {}, `${g.tipo} · ${g.archivos.length}`), g.carpeta ? h("a", { href: g.carpeta, target: "_blank", rel: "noopener" }, "Carpeta ↗") : null));
    const fila = h("div", { class: "fotos-fila" });
    for (const f of g.archivos) {
      const img = h("img", { src: f.src || REPO.miniatura(f.id, 400), alt: f.n, loading: "lazy", referrerpolicy: "no-referrer" });
      const b = h("button", { type: "button", class: "foto", title: f.n, onclick: () => verFoto(todas, todas.findIndex(x => x.id === f.id)) }, img);
      img.addEventListener("error", () => (window.caches ? caches.open("hoja-campo-fotos").then(c => c.delete(img.src)) : 0, b.replaceWith(h("a", { class: "foto sin", href: f.u || g.carpeta || "#", target: "_blank", rel: "noopener" }, "Foto ↗"))));
      fila.append(b);
    }
    cont.append(fila);
  }
  return cont;
}
function verFoto(lista, i) {
  const d = $("#visor"); d.innerHTML = "";
  const f = lista[i];
  const img = h("img", { src: /^local-/.test(f.id) ? f.src : REPO.miniatura(f.id, 1600), alt: f.n, referrerpolicy: "no-referrer" });   // las del repositorio solo traen la miniatura
  img.addEventListener("error", () => f.src && img.src !== f.src ? (img.src = f.src) : img.replaceWith(h("p", {}, "No se puede mostrar aquí (sin conexión o sin sesión de Google). Ábrela en Drive.")));   // sin la grande, la miniatura del .json
  d.append(h("div", { class: "visor-cab" }, h("span", {}, `${f.tipo} · ${i + 1} de ${lista.length}`), h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Cerrar")),
    img, h("div", { class: "acciones" },
      h("button", { type: "button", class: "btn", disabled: i === 0, onclick: () => verFoto(lista, i - 1) }, "‹ Anterior"),
      f.u ? h("a", { class: "btn", href: f.u, target: "_blank", rel: "noopener" }, "Abrir en Drive ↗") : null,
      h("button", { type: "button", class: "btn", disabled: i === lista.length - 1, onclick: () => verFoto(lista, i + 1) }, "Siguiente ›")));
  if (!d.open) d.showModal();
}
function precargarFotos() {  // con conexión, deja las miniaturas de las tareas de la hoja guardadas para verlas sin ella
  if (!navigator.onLine || !E.modelo) return;
  const ids = new Set(); for (const p of E.modelo) for (const { it } of fichas(p)) if (it.id && /^T-/.test(it.id)) ids.add(it.id);
  let n = 0;
  for (const id of ids) if (!miniaturasDe(id)) for (const g of REPO.fotosDe(id)) for (const f of g.archivos) if (n++ < 300) fetch(REPO.miniatura(f.id, 400), { mode: "no-cors", credentials: "include" }).catch(() => {});
}

const OPC = f => /^(Observaciones|Nota|Notas|Lo que dice el responsable|Nueva fecha propuesta|Otra medida|Otras medidas|Decisión|Tipo de evidencia|Evidencia vista|Foto o nota|Notas de la entrevista)/i.test(f.etiqueta);
const OBLIG = f => /^(Comprobado|Motivo del retraso|Estado|Resultado|¿Recibido hoy\?)$/.test(f.etiqueta) || (f.etiqueta === "Observaciones" && /\|Observaciones$/.test(f.ref || ""));

function campoUI(p, it, f) {
  const id = "f_" + slug(p.nombre + f.ref);
  const v = val(p.nombre, f);
  const etiqueta = f.etiqueta || (it.campos.length === 1 ? "" : "");
  const ayuda = f.ayuda ? h("details", { class: "ayuda" }, h("summary", { "aria-label": "Ayuda" }, "?"), h("p", {}, f.ayuda)) : null;
  const marca = it.obligatoria && OBLIG(f) ? h("span", { class: "req" }, "obligatorio") : null;
  const cambiar = nv => { poner(p.nombre, f, nv, 300); pintarSuave(); };
  if (f.opts && f.opts.length) {
    const sino = f.opts.length === 2 && f.opts.includes("Sí") && f.opts.includes("No");
    if (sino) {
      const inp = h("input", { type: "checkbox", id, role: "switch" }); inp.checked = v === "Sí";
      inp.addEventListener("change", () => cambiar(inp.checked ? "Sí" : "No"));
      return h("div", { class: "campo fila" }, h("label", { class: "interruptor", for: id }, inp, h("span", {}, etiqueta || "Sí")), ayuda);
    }
    if (f.opts.length > 8) {
      const sel = h("select", { id }, h("option", { value: "" }, "Elige…"), f.opts.map(o => h("option", { value: o, selected: v === o }, o)));
      if (v && !f.opts.includes(v)) sel.append(h("option", { value: v, selected: true }, v));
      sel.addEventListener("change", () => cambiar(sel.value));
      return h("div", { class: "campo" }, etiqueta ? h("label", { for: id }, etiqueta, marca) : null, sel, ayuda);
    }
    const fs = h("fieldset", { class: "campo" }, etiqueta ? h("legend", {}, etiqueta, marca) : null);
    const fila = h("div", { class: "chips" });
    for (const o of f.opts) fila.append(h("button", { type: "button", class: "chip " + (TONO[o] || ""), "aria-pressed": String(v === o), onclick: () => cambiar(v === o ? "" : o) }, o));
    if (v && !f.opts.includes(v)) fila.append(h("span", { class: "chip", "aria-pressed": "true" }, v));
    fs.append(fila); if (ayuda) fs.append(ayuda);
    return fs;
  }
  if (f.fecha) {
    const inp = h("input", { type: "date", id, value: v || "" });
    inp.addEventListener("change", () => cambiar(inp.value));
    return h("div", { class: "campo" }, etiqueta ? h("label", { for: id }, etiqueta) : null, inp, ayuda);
  }
  const ta = h("textarea", { id, rows: "1", placeholder: etiqueta ? "" : "Escribe aquí" }); ta.value = v || "";
  const crecer = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + 2 + "px"; };
  ta.addEventListener("input", () => { poner(p.nombre, f, ta.value); crecer(); });
  ta.addEventListener("change", () => { programarGuardado(300); pintarSuave(); });
  requestAnimationFrame(crecer);
  return h("div", { class: "campo" }, etiqueta ? h("label", { for: id }, etiqueta, marca) : null, ta, ayuda);
}
function pintarSuave() { const y = window.scrollY; const foco = document.activeElement && document.activeElement.id; pintar(); window.scrollTo({ top: y }); if (foco && document.getElementById(foco)) document.getElementById(foco).focus({ preventScroll: true }); }

window.E = E;  // repo.js lo mira para repintar al llegar el índice

/* ---------- arranque ---------- */
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); E.instalar = e; if (!E.modelo) pintar(); });
document.addEventListener("DOMContentLoaded", async () => {
  $("#cargar").addEventListener("change", e => { cargarArchivo(e.target.files[0]); e.target.value = ""; });
  $("#guardar").addEventListener("click", () => guardarEnDrive(true));
  window.addEventListener("online", () => guardarEnDrive(false));
  window.addEventListener("offline", () => estadoGuardado());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") guardarEnDrive(false); });
  $("#hojas").addEventListener("click", () => { E.vista = "inicio"; E.modelo = null; pintar(); });
  $("#cerrar").addEventListener("click", cerrarHoja);
  $("#tab-hoja").addEventListener("click", () => { if (E.vista === "repo" || E.vista === "correo") { E.vista = E.modelo ? "hoja" : "inicio"; pintar(); } });
  $("#tab-repo").addEventListener("click", () => { E.vista = "repo"; pintar(); });
  $("#tab-correo").addEventListener("click", () => { E.vista = "correo"; pintar(); });
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  await REPO.iniciar();
  try { if (await abrirLaDeHoy()) return; } catch (e) { console.error(e); }
  try { const ultima = await DB.get("ultima"); if (ultima && await DB.leer(ultima)) { await abrirHoja(ultima); return; } } catch (e) { console.error(e); }
  E.vista = "inicio"; pintar();
});
