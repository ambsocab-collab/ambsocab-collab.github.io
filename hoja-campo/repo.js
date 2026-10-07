/* Repositorio del sistema de PRL: el árbol de carpetas de Drive con un enlace a cada archivo. El índice (solo nombres y
   enlaces, sin el contenido de los archivos) lo genera el sistema desde Drive y se carga aquí; abrir un archivo pide
   conexión y la cuenta de Google con permiso, como en Drive. */
"use strict";
const REPO = (() => {
  let indice = null, filtro = "";
  const abiertos = new Set();
  const TIPOS = [[/pdf/, "PDF", "pdf"], [/word|document/, "Word", "doc"], [/sheet|excel/, "Excel", "xls"], [/presentation|powerpoint/, "PPT", "ppt"], [/image/, "Imagen", "img"], [/video/, "Vídeo", "img"]];
  const tipo = n => { const m = (n.m || "") + " " + n.n.toLowerCase(); for (const [re, t, c] of TIPOS) if (re.test(m) || new RegExp("\\." + c).test(n.n.toLowerCase())) return [t, c]; return ["Archivo", "otro"]; };
  const cuenta = n => n.h ? n.h.reduce((a, x) => a + (x.h ? cuenta(x) : 1), 0) : 1;
  const coincide = (n, q) => n.n.toLowerCase().includes(q) || (n.h || []).some(x => coincide(x, q));

  // fotos de las tareas: las carpetas «<T-id> · …» (hallazgo en la carpeta de la visita; «· evidencia», del responsable)
  let fotos = null;
  const idDrive = u => (/\/d\/([\w-]+)/.exec(u || "") || [])[1] || null;
  function indexarFotos() {
    fotos = new Map();
    const andar = (n, ruta) => {
      for (const x of n.h || []) {
        if (!x.h) continue;
        const m = /^(T-[A-Z]{3}-\d{4})\s*·\s*(.*)$/.exec(x.n);
        if (m) {
          const visita = (/Visitas\/(\d{4}-\d{4})/.exec(ruta) || [])[1];
          const tipoF = /·\s*evidencia\s*$/i.test(x.n) ? "Evidencia del responsable" : visita ? `Visita ${visita.slice(0, 2)}/${visita.slice(2, 4)}/${visita.slice(5)}` : "Hallazgo";
          const archivos = x.h.filter(f => !f.h && /image/.test(f.m || "")).map(f => ({ id: idDrive(f.u), u: f.u, n: f.n })).filter(f => f.id);
          if (archivos.length) { const l = fotos.get(m[1]) || []; l.push({ tipo: tipoF, carpeta: x.u, archivos }); fotos.set(m[1], l); }
        }
        andar(x, ruta + "/" + x.n);
      }
    };
    if (indice) andar(indice.raiz, "");
  }
  const fotosDe = id => { if (!fotos) indexarFotos(); return fotos.get(id) || []; };
  const miniatura = (id, ancho) => `https://drive.google.com/thumbnail?id=${id}&sz=w${ancho}`;
  /* actualización automática: la app pide el índice a la Apps Script de la cuenta del sistema (acción «indice», con la
     clave de solo lectura) al abrirse con conexión, como mucho cada 30 minutos */
  let conexion = null, estado = "", borrador = null, fallo = false;
  async function iniciar() {
    try { indice = await DB.get("repo"); conexion = await DB.get("conexion"); } catch (e) { indice = null; }
    fotos = null;
    actualizar(false);
    window.addEventListener("online", () => actualizar(false));
  }
  async function actualizar(forzar) {
    if (!conexion || !navigator.onLine) return false;
    if (!forzar && indice && indice.recibido && Date.now() - indice.recibido < 30 * 60e3) return false;
    estado = "Actualizando desde Drive…"; refrescar();
    try {
      const r = await fetch(conexion.url, { method: "POST", body: JSON.stringify({ accion: "indice", clave: conexion.clave, forzar: !!forzar }) });
      const j = await r.json();
      if (!j.ok || !j.raiz) throw new Error(j.error || "respuesta sin índice");
      j.recibido = Date.now(); indice = j; fotos = null; await DB.set("repo", j);
      estado = ""; refrescar(true); return true;
    } catch (e) { estado = "No se pudo actualizar desde Drive: " + e.message; refrescar(); return false; }
  }
  function refrescar(todo) {
    const el = document.querySelector("#estado-repo"); if (el) el.textContent = estado;
    if (todo && window.E && typeof window.pintarSuave === "function" && (E.vista === "repo" || E.modelo)) window.pintarSuave();
  }
  async function conectar(url, clave) {
    url = url.trim(); clave = clave.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec/.test(url)) { aviso("La dirección tiene que ser la de la aplicación web de Apps Script (https://script.google.com/macros/s/…/exec)."); return; }
    const antes = conexion; conexion = { url, clave }; borrador = { url, clave };
    if (await actualizar(true)) { await DB.set("conexion", conexion); borrador = null; aviso("Conectado: el repositorio y las fotos se actualizan solos."); }
    else { conexion = antes; fallo = true; aviso("No se pudo conectar. Revisa la dirección y la clave."); }
    pintar();
  }
  function panelConexion() {
    const v = borrador || conexion || {};
    const url = h("input", { type: "url", id: "con-url", placeholder: "https://script.google.com/macros/s/…/exec", value: v.url || "" });
    const clave = h("input", { type: "password", id: "con-clave", placeholder: "Clave de lectura", value: v.clave || "" });
    const abierto = !conexion || fallo; fallo = false;
    return h("details", { class: "panel conexion", open: abierto },
      h("summary", {}, conexion ? "Conectado con Drive · se actualiza solo" : "Conectar con Drive para que se actualice solo"),
      h("p", { class: "nota" }, "Pega la dirección de la aplicación web del sistema y la clave de lectura. Se guardan solo en este dispositivo."),
      h("label", { for: "con-url" }, "Dirección"), url, h("label", { for: "con-clave" }, "Clave de lectura"), clave,
      h("div", { class: "acciones" },
        conexion ? h("button", { type: "button", class: "btn", onclick: async () => { conexion = null; await DB.set("conexion", null); pintar(); } }, "Desconectar") : null,
        h("button", { type: "button", class: "btn primario", onclick: () => conectar(url.value, clave.value) }, conexion ? "Guardar y actualizar" : "Conectar")));
  }

  async function cargar(file) {
    try {
      const j = JSON.parse(await file.text());
      if (!j.raiz || !j.raiz.h) throw new Error("sin raíz");
      indice = j; fotos = null; await DB.set("repo", j); pintar(); aviso("Índice del repositorio cargado.");
    } catch (e) { aviso("Ese archivo no es el índice del repositorio (.json)."); }
  }
  function nodo(n, ruta, q) {
    if (q && !coincide(n, q)) return null;
    if (!n.h) {
      const [t, c] = tipo(n);
      return h("li", {}, h("a", { class: "archivo", href: n.u, target: "_blank", rel: "noopener" }, h("span", { class: "tipo " + c }, t), h("span", { class: "nombre" }, n.n), h("span", { class: "abre" }, "↗")));
    }
    const id = ruta + "/" + n.n;
    const d = h("details", { class: "carpeta", open: !!q || abiertos.has(id) },
      h("summary", {}, h("span", { class: "nombre" }, n.n), h("span", { class: "cnt" }, String(cuenta(n)))),
      h("ul", {}, n.h.map(x => nodo(x, id, q))));
    d.addEventListener("toggle", () => { if (!q) d.open ? abiertos.add(id) : abiertos.delete(id); });
    if (n.u) d.querySelector("summary").append(h("a", { class: "drive", href: n.u, target: "_blank", rel: "noopener", onclick: e => e.stopPropagation() }, "Drive ↗"));
    return h("li", {}, d);
  }
  async function pintar(main) {
    main = main || document.querySelector("#vista");
    if (!indice) { try { indice = await DB.get("repo"); } catch (e) { indice = null; } }
    main.innerHTML = "";
    const s = h("section", { class: "vista" });
    const cargarBtn = h("label", { class: "btn", for: "cargar-repo" }, indice ? "Actualizar índice" : "Cargar índice (.json)");
    if (!indice) {
      s.append(h("div", { class: "panel bienvenida" }, h("h2", {}, "Repositorio del sistema de PRL"),
        h("p", {}, "Aquí aparecen todas las carpetas del sistema en Drive. Al pulsar una carpeta se despliega su contenido, y cada archivo (PDF, Word, Excel…) se abre directamente."),
        h("p", {}, "Conéctala con Drive (abajo) y el índice llega solo y se mantiene al día. También puedes cargar a mano el archivo del índice."), cargarBtn),
        panelConexion(), h("p", { class: "nota", id: "estado-repo" }, estado));
      main.append(s); return;
    }
    const buscar = h("input", { type: "search", id: "buscar-repo", placeholder: "Buscar por nombre…", value: filtro, "aria-label": "Buscar en el repositorio" });
    buscar.addEventListener("input", () => { filtro = buscar.value; const l = s.querySelector(".arbol"); l.replaceWith(arbol()); });
    const arbol = () => { const q = filtro.trim().toLowerCase(); const ul = h("ul", { class: "arbol" }, indice.raiz.h.map(x => nodo(x, "", q))); if (q && !ul.children.length) ul.append(h("li", { class: "vacio" }, "Nada con ese nombre.")); return ul; };
    const cuando = new Date(indice.generado).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    s.append(h("div", { class: "repo-cab" }, h("div", {}, h("h2", {}, indice.raiz.n), h("p", { class: "nota" }, `${cuenta(indice.raiz)} archivos · al día a ${cuando}`), h("p", { class: "nota", id: "estado-repo" }, estado)),
        h("div", { class: "acciones" }, conexion ? h("button", { type: "button", class: "btn", onclick: () => actualizar(true) }, "Actualizar ahora") : null, cargarBtn)),
      panelConexion(), buscar, arbol());
    main.append(s);
  }
  document.addEventListener("DOMContentLoaded", () => document.querySelector("#cargar-repo").addEventListener("change", e => { cargar(e.target.files[0]); e.target.value = ""; }));
  async function pedir(cuerpo) {  // otra petición de solo lectura a la Apps Script (hojas de campo)
    if (!conexion) throw new Error("sin conexión con Drive");
    const r = await fetch(conexion.url, { method: "POST", body: JSON.stringify({ ...cuerpo, clave: conexion.clave }) });
    const j = await r.json(); if (!j.ok) throw new Error(j.error || "respuesta vacía"); return j;
  }
  return { pintar, iniciar, fotosDe, miniatura, hayIndice: () => !!indice, conectado: () => !!conexion, pedir };
})();
