/* Hoja de campo de El Tejar: la app. Guarda en el dispositivo (IndexedDB) cada hoja cargada y lo rellenado; exporta
   el mismo .xlsx con las respuestas escritas en sus casillas, para procesarlo como siempre (leer_hoja.py). */
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
function poner(hoja, f, v) {
  (E.hoja.edits[hoja] ||= {});
  if (v === f.v) delete E.hoja.edits[hoja][f.ref]; else E.hoja.edits[hoja][f.ref] = v;
  E.hoja.actualizada = Date.now();
  clearTimeout(guardarT);
  guardarT = setTimeout(async () => {
    try { await DB.guardar(E.hoja); $("#guardado").textContent = "Guardado " + new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }); }
    catch (e) { $("#guardado").textContent = "No se pudo guardar en el dispositivo"; }
  }, 250);
}

/* ---------- avance ---------- */
function contestada(hoja, it, g) {
  const ref = it.claves.get(g || ""); if (!ref) return null;
  const f = it.campos.find(x => x.ref === ref); const v = val(hoja, f);
  if (!v) return false;
  const comp = it.campos.find(x => x.etiqueta === "Comprobado" && (x.grupo || "") === (g || ""));
  const mot = it.campos.find(x => x.etiqueta === "Motivo del retraso" && (x.grupo || "") === (g || ""));
  if (it.obligatoria && comp && mot && val(hoja, comp) !== "Hecha y eficaz" && !val(hoja, mot)) return false;
  return true;
}
function fichas(p) { return p.secciones.flatMap(s => s.entradas.filter(e => e.tipo === "ficha").map(it => ({ s, it }))); }
function avance(p) {
  let hechas = 0, total = 0;
  for (const { s, it } of fichas(p)) {
    if (it.plantilla && !it.campos.some(f => val(p.nombre, f))) continue;
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
  try {
    const bytes = await file.arrayBuffer();
    const libro = await XL.read(bytes);
    if (!libro.sheets.some(s => s.name === "Hoy")) { aviso("Este Excel no es una hoja de campo: no tiene la pestaña «Hoy»."); return; }
    const hoy = libro.sheets.find(s => s.name === "Hoy");
    const titulo = (hoy.cells.get("A1") || {}).v || file.name;
    const id = file.name.replace(/\.xlsx$/i, "");
    const previa = await DB.leer(id);
    const hoja = { id, nombre: file.name, titulo, bytes, edits: {}, cargada: Date.now(), actualizada: Date.now() };
    if (previa && Object.keys(previa.edits || {}).length) {
      if (!await confirmar(`Ya tienes «${previa.titulo}» con datos rellenados en este dispositivo. ¿Sustituirla por el archivo nuevo? Lo rellenado aquí y no exportado se pierde.`, "Sustituir")) return;
    }
    await DB.guardar(hoja);
    await abrirHoja(id);
    aviso("Hoja cargada: " + titulo);
  } catch (e) { console.error(e); aviso("No se pudo leer el archivo. Tiene que ser la hoja de campo en .xlsx."); }
}
async function abrirHoja(id) {
  const hoja = await DB.leer(id); if (!hoja) return;
  E.hoja = hoja; E.libro = await XL.read(hoja.bytes); E.modelo = MODELO.libro(E.libro);
  marcarObligatorias();
  E.sec = E.modelo[0].nombre; E.vista = "hoja"; E.grupo = {};
  await DB.set("ultima", id);
  pintar();
}
function marcarObligatorias() {  // las tareas bajo el rótulo rojo (retrasadas) se contestan siempre
  for (const p of E.modelo) for (const s of p.secciones) { let rojo = false;
    for (const e of s.entradas) { if (e.tipo === "rotulo") rojo = e.color === "rojo"; else if (e.tipo === "ficha") e.obligatoria = rojo; } }
}

/* ---------- exportar ---------- */
async function generar() {
  const fechas = {};
  for (const p of E.modelo) for (const { it } of fichas(p)) for (const f of it.campos) if (f.fecha) (fechas[p.nombre] ||= new Set()).add(f.ref);
  const blob = await XL.write(E.hoja.bytes, E.hoja.edits, fechas);
  return new File([blob], E.hoja.nombre, { type: blob.type });
}
async function exportar() {
  try {
    const file = await generar();
    const url = URL.createObjectURL(file);
    const a = h("a", { href: url, download: file.name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    E.hoja.exportada = Date.now(); await DB.guardar(E.hoja);
    aviso(`Excel guardado en Descargas: ${file.name}. Súbelo a la carpeta de la visita en Drive.`);
  } catch (e) { console.error(e); aviso("No se pudo generar el Excel."); }
}
async function compartir() {
  try {
    const file = await generar();
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: E.hoja.titulo }); E.hoja.exportada = Date.now(); await DB.guardar(E.hoja); }
    else exportar();
  } catch (e) { if (e.name !== "AbortError") aviso("No se pudo compartir: " + e.message); }
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
  const hayHoja = E.vista === "hoja" && E.modelo;
  $("#acciones-hoja").hidden = !hayHoja;
  $("#titulo").textContent = hayHoja ? E.hoja.titulo : E.vista === "repo" ? "Repositorio del sistema de PRL" : "Hoja de campo";
  $("#guardado").textContent = hayHoja ? (E.hoja.exportada ? "Exportada " + new Date(E.hoja.exportada).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "Guardada en este dispositivo") : "";
  const nav = $("#nav"); nav.innerHTML = ""; nav.hidden = !hayHoja;
  document.querySelector(".app").classList.toggle("sin-nav", !hayHoja);
  const main = $("#vista"); main.innerHTML = "";
  if (E.vista === "repo") return REPO.pintar(main);
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
  s.append(h("div", { class: "panel bienvenida" },
    h("h2", {}, "Carga la hoja de campo de la visita"),
    h("p", {}, "En Drive, abre la hoja de campo de la visita y descárgala como Excel (Archivo → Descargar → Microsoft Excel). Después cárgala aquí. Todo lo que rellenes se queda en este dispositivo hasta que lo exportes."),
    h("label", { class: "btn primario grande", for: "cargar" }, "Cargar hoja de campo (.xlsx)")));
  const lista = h("div", { class: "lista-hojas" });
  s.append(h("h3", {}, "Hojas en este dispositivo"), lista);
  DB.lista().then(hs => {
    if (!hs.length) { lista.append(h("p", { class: "vacio" }, "Todavía no hay ninguna. La primera que cargues aparecerá aquí.")); return; }
    for (const x of hs.sort((a, b) => b.actualizada - a.actualizada)) {
      const n = Object.values(x.edits || {}).reduce((a, o) => a + Object.keys(o).length, 0);
      lista.append(h("div", { class: "fila-hoja" },
        h("button", { type: "button", class: "abrir", onclick: () => abrirHoja(x.id) }, h("strong", {}, x.titulo), h("span", {}, `${n} casillas rellenadas · ${x.exportada ? "exportada " + new Date(x.exportada).toLocaleDateString("es-ES") : "sin exportar"}`)),
        h("button", { type: "button", class: "btn", onclick: async () => { if (await confirmar(`¿Quitar «${x.titulo}» de este dispositivo?${x.exportada ? "" : " No se ha exportado: lo rellenado se pierde."}`, "Quitar")) { await DB.borrar(x.id); pintar(); } } }, "Quitar")));
    }
  });
  if (E.instalar) s.append(h("div", { class: "panel" }, h("p", {}, "Instala la app para abrirla desde su icono y usarla sin conexión."), h("button", { class: "btn primario", type: "button", onclick: async () => { E.instalar.prompt(); await E.instalar.userChoice; E.instalar = null; pintar(); } }, "Instalar la app")));
  main.append(s);
}

function pintarHoja(p) {
  const s = h("section", { class: "vista" });
  s.append(h("div", { class: "cabecera-hoja" }, h("h2", {}, p.titulo || p.nombre),
    p.notas.filter(n => /^⚠/.test(n)).map(n => h("p", { class: "nota alerta" }, n)),
    p.notas.some(n => !/^⚠/.test(n)) ? h("details", { class: "mas" }, h("summary", {}, "Cómo se rellena esta pestaña"), p.notas.filter(n => !/^⚠/.test(n)).map(n => h("p", { class: "nota" }, n))) : null));
  if (p.nombre === "Hoy") {
    const lista = h("ul", { class: "checklist" });
    for (const x of antesDeIrte()) lista.append(h("li", {}, h("span", { class: "marca " + (x.ok ? "ok" : "mal") }, x.ok ? "✓" : "!"),
      h("button", { type: "button", class: "enlace", onclick: () => { E.sec = x.hoja; pintar(); } }, x.texto)));
    s.append(h("div", { class: "panel" }, h("h3", {}, "Antes de irte"), lista));
  }
  for (const sec of p.secciones) s.append(pintarSeccion(p, sec));
  return s;
}

function pintarSeccion(p, sec) {
  const wrap = h("div", { class: "seccion" });
  if (sec.titulo && !(p.nombre === "Hoy" && /ANTES DE IRTE/.test(sec.titulo) && !sec.entradas.some(e => e.tipo === "ficha" && e.campos.length)))
    wrap.append(h("h3", { class: "tit-seccion" }, sec.titulo), sec.nota ? h("p", { class: "nota" }, sec.nota) : null);
  if (!sec.conEntradas) { wrap.append(tabla(sec)); return wrap; }
  const clave = p.nombre + "|" + sec.titulo;
  const grupos = sec.grupos.filter(g => g.conDatos || true);
  let g = null;
  if (grupos.length) {
    g = E.grupo[clave] || grupos[0].id;
    wrap.append(h("div", { class: "seg", role: "tablist" }, grupos.map(x => h("button", { type: "button", role: "tab", "aria-selected": String(x.id === g), onclick: () => { E.grupo[clave] = x.id; pintar(); } }, x.texto))));
  }
  let bloque = null, cuerpo = wrap, plantillas = 0;
  for (const e of sec.entradas) {
    if (e.tipo === "rotulo") { bloque = null; cuerpo = wrap; wrap.append(h("div", { class: "rotulo " + e.color }, e.texto)); continue; }
    if (e.tipo === "nota") { cuerpo.append(h("p", { class: "nota" }, e.texto)); continue; }
    if (e.bloque !== null && e.bloque !== undefined && e.bloque !== (bloque && bloque.nombre)) {
      const id = p.nombre + "|" + e.bloque;
      const det = h("details", { class: "bloque", open: E.abiertos.has(id) }, h("summary", {}, e.bloque, h("span", { class: "cnt" }, "")));
      det.addEventListener("toggle", () => det.open ? E.abiertos.add(id) : E.abiertos.delete(id));
      bloque = { nombre: e.bloque, det, cuerpo: h("div", { class: "cuerpo" }), hechas: 0, total: 0 };
      det.append(bloque.cuerpo); wrap.append(det); cuerpo = bloque.cuerpo;
    }
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

function fichaUI(p, sec, it, g) {
  const campos = it.campos.filter(f => !g || !f.grupo || f.grupo === g);
  const info = it.info.filter(i => !g || !i.grupo || i.grupo === g);
  if (!campos.length && !info.length && !it.titulo) return null;
  const est = contestada(p.nombre, it, g || "");
  // dato de solo lectura dentro de un bloque: una línea, sin tarjeta
  if (!campos.length && it.bloque) return h("div", { class: "dato" }, h("span", { class: "k" }, it.titulo || ""), h("span", { class: "v" }, info.map(i => i.v).join(" · ")));
  const card = h("article", { class: "ficha" + (est === true ? " est-ok" : est === false && it.obligatoria ? " est-mal" : est === false ? " est-pend" : "") });
  const cab = h("div", { class: "ficha-cab" });
  if (it.id) cab.append(h("span", { class: "id" }, it.id));
  if (it.sub) cab.append(h("strong", {}, it.sub));
  if (it.obligatoria) cab.append(h("span", { class: "pastilla mal" }, est ? "Retrasada · contestada" : "Retrasada"));
  if (cab.children.length) card.append(cab);
  if (it.titulo) card.append(h("p", { class: "ficha-titulo" }, it.titulo));
  const datos = h("div", { class: "datos" });
  for (const i of info) {
    if (i.enlace) { datos.append(h("a", { class: "btn enlace-foto", href: i.enlace, target: "_blank", rel: "noopener" }, "📷 ", i.v || i.etiqueta, " ↗")); continue; }
    if (i.hoja) { const pp = E.modelo.find(x => x.nombre === i.hoja); const a = avance(pp); datos.append(h("button", { type: "button", class: "btn ir", onclick: () => { E.sec = i.hoja; pintar(); window.scrollTo({ top: 0 }); } }, `Abrir ${i.hoja.split(" · ").pop()}`, a.total ? ` · ${a.hechas}/${a.total}` : "")); continue; }
    const vence = /^Vence/.test(i.etiqueta);
    datos.append(h("span", { class: "dato-chip" + (vence && /hace/.test(i.v) ? " mal" : "") }, i.etiqueta ? h("span", { class: "k" }, i.etiqueta + ": ") : null, i.v));
  }
  if (datos.children.length) card.append(datos);
  if (it.detalle) card.append(h("details", { class: "mas" }, h("summary", {}, "Ver detalle"), h("p", { class: "detalle" }, it.detalle)));
  const principales = [], secundarios = [];
  for (const f of campos) (OPC(f) && campos.length > 2 ? secundarios : principales).push(f);
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
  return card;
}
const OPC = f => /^(Observaciones|Nota|Notas|Lo que dice el responsable|Nueva fecha propuesta|Otra medida que propone|Decisión|Tipo de evidencia|Evidencia vista|Foto o nota|Notas de la entrevista)/i.test(f.etiqueta);
const OBLIG = f => /^(Comprobado|Motivo del retraso|Estado|Resultado|¿Recibido hoy\?)$/.test(f.etiqueta);

function campoUI(p, it, f) {
  const id = "f_" + slug(p.nombre + f.ref);
  const v = val(p.nombre, f);
  const etiqueta = f.etiqueta || (it.campos.length === 1 ? "" : "");
  const ayuda = f.ayuda ? h("details", { class: "ayuda" }, h("summary", { "aria-label": "Ayuda" }, "?"), h("p", {}, f.ayuda)) : null;
  const marca = it.obligatoria && OBLIG(f) ? h("span", { class: "req" }, "obligatorio") : null;
  const cambiar = nv => { poner(p.nombre, f, nv); pintarSuave(); };
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
  ta.addEventListener("change", pintarSuave);
  requestAnimationFrame(crecer);
  return h("div", { class: "campo" }, etiqueta ? h("label", { for: id }, etiqueta) : null, ta, ayuda);
}
function pintarSuave() { const y = window.scrollY; const foco = document.activeElement && document.activeElement.id; pintar(); window.scrollTo({ top: y }); if (foco && document.getElementById(foco)) document.getElementById(foco).focus({ preventScroll: true }); }

/* ---------- arranque ---------- */
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); E.instalar = e; if (!E.modelo) pintar(); });
document.addEventListener("DOMContentLoaded", async () => {
  $("#cargar").addEventListener("change", e => { cargarArchivo(e.target.files[0]); e.target.value = ""; });
  $("#exportar").addEventListener("click", exportar);
  $("#compartir").addEventListener("click", compartir);
  $("#hojas").addEventListener("click", () => { E.vista = "inicio"; E.modelo = null; pintar(); });
  $("#tab-hoja").addEventListener("click", () => { if (E.vista === "repo") { E.vista = E.modelo ? "hoja" : "inicio"; pintar(); } });
  $("#tab-repo").addEventListener("click", () => { E.vista = "repo"; pintar(); });
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  try { const ultima = await DB.get("ultima"); if (ultima && await DB.leer(ultima)) { await abrirHoja(ultima); return; } } catch (e) { console.error(e); }
  E.vista = "inicio"; pintar();
});
