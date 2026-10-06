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

  async function cargar(file) {
    try {
      const j = JSON.parse(await file.text());
      if (!j.raiz || !j.raiz.h) throw new Error("sin raíz");
      indice = j; await DB.set("repo", j); pintar(); aviso("Índice del repositorio cargado.");
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
        h("p", {}, "Falta cargar el índice: el sistema lo genera desde Drive (solo nombres y enlaces) y se carga una vez; cuando cambien las carpetas, se vuelve a cargar."), cargarBtn));
      main.append(s); return;
    }
    const buscar = h("input", { type: "search", id: "buscar-repo", placeholder: "Buscar por nombre…", value: filtro, "aria-label": "Buscar en el repositorio" });
    buscar.addEventListener("input", () => { filtro = buscar.value; const l = s.querySelector(".arbol"); l.replaceWith(arbol()); });
    const arbol = () => { const q = filtro.trim().toLowerCase(); const ul = h("ul", { class: "arbol" }, indice.raiz.h.map(x => nodo(x, "", q))); if (q && !ul.children.length) ul.append(h("li", { class: "vacio" }, "Nada con ese nombre.")); return ul; };
    s.append(h("div", { class: "repo-cab" }, h("div", {}, h("h2", {}, indice.raiz.n), h("p", { class: "nota" }, `${cuenta(indice.raiz)} archivos · índice del ${new Date(indice.generado).toLocaleDateString("es-ES")}`)), cargarBtn),
      buscar, arbol());
    main.append(s);
  }
  document.addEventListener("DOMContentLoaded", () => document.querySelector("#cargar-repo").addEventListener("change", e => { cargar(e.target.files[0]); e.target.value = ""; }));
  return { pintar };
})();
