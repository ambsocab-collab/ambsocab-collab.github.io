/* De la hoja de campo a pantallas. No sabe de ningún centro: reconoce la hoja por cómo la monta crear_hoja.py
   (cabeceras verdes o grises, casillas de entrada en azul claro, rótulos de color, listas y notas) y la reparte en
   secciones, rótulos y fichas. Una pestaña nueva o un centro con otras áreas sale solo, sin tocar la app. */
"use strict";
const MODELO = (() => {
  const ROL = { "006B35": "H", "008C32": "H", "006D2A": "H", "D9D9D9": "h", "DDEBF7": "I", "F2F2F2": "g" };
  const rol = c => (c.fill ? ROL[c.fill] || "B" : "");
  const ID_RE = /^[A-Z]{1,4}(-[A-Z0-9]+){1,3}$/;
  const TITULO_RE = /^(Qué se pidió|Qué se comprueba|Qué se estableció|Qué se pregunta|Pregunta|Aviso|Qué|Control|Área — responsable|Equipo y dónde está|Quién lo pide)$/;
  const OCULTAS = /^(Grupo|Por defecto|clave|Bloque)$/i;
  const OPCIONAL = /^(Observaciones|Nota|Notas|Pedir por correo|Enviar|Enviar al responsable|José Carlos en copia|Foto o nota|Evidencia vista|Tipo de evidencia|Lo que dice el responsable|Nueva fecha propuesta|Otra medida que propone|Decisión|Notas de la entrevista)/i;
  const mayusculas = t => { const l = t.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "").slice(0, 8); return l.length >= 5 && l === l.toUpperCase(); };

  function hoja(sh, nombres) {
    const finMerge = new Map(sh.merges.map(m => [XL.refOf(m.a.r, m.a.c), m.b.c]));
    const filas = [];
    for (let r = 1; r <= sh.maxR; r++) {
      const cs = [];
      for (let c = 1; c <= sh.maxC; c++) {
        const cell = sh.cells.get(XL.refOf(r, c)); if (!cell) continue;
        cell.rol = rol(cell); cell.oculta = sh.hiddenCols.has(c);
        cell.opts = sh.options.get(cell.ref) || null; cell.ayuda = sh.comments.get(cell.ref) || "";
        if (cell.v === "" && cell.rol !== "I" && !cell.f) continue;
        cs.push(cell);
      }
      if (cs.length) filas.push({ r, cs });
    }
    const out = { nombre: sh.name, titulo: "", notas: [], secciones: [] };
    let sec = null;
    const nueva = (titulo, nota) => { sec = { titulo, nota: nota || "", cabeceras: [], grupos: [], entradas: [] }; out.secciones.push(sec); };
    for (const fila of filas) {
      const vis = fila.cs.filter(c => !c.oculta);
      if (!vis.length) continue;
      const llenas = vis.filter(c => c.v !== "" || c.f);
      const cab = vis.filter(c => c.rol === "H" || c.rol === "h");
      if (fila.r === 1 && llenas.length === 1 && !llenas[0].rol) { out.titulo = llenas[0].v; continue; }
      if (vis.some(c => c.rol === "I")) { if (!sec) nueva(""); sec.entradas.push({ tipo: "fila", r: fila.r, cs: fila.cs }); continue; }
      if (cab.length && cab.length === llenas.length) {
        const vals = new Set(cab.map(c => c.v).filter(Boolean));
        if (!vals.size) continue;
        if (vals.size === 1 && (/^▼/.test([...vals][0]) || cab.filter(c => c.v).length > 1)) { if (!sec) nueva(""); sec.entradas.push({ tipo: "rotulo", texto: [...vals][0].replace(/^▼\s*/, ""), color: "verde" }); continue; }
        if (!sec) nueva("");
        const hs = cab.filter(c => c.v).sort((a, b) => a.c - b.c);
        sec.cabeceras.push({ r: fila.r, hs: hs.map((h, i) => ({ c1: h.c, c2: finMerge.get(h.ref) || (hs[i + 1] ? hs[i + 1].c - 1 : sh.maxC), texto: h.v, ayuda: h.ayuda })) });
        continue;
      }
      if (llenas.length === 1 && llenas[0].rol === "B") {
        if (!sec) nueva("");
        const f = llenas[0].fill; const color = f === "B03A2E" ? "rojo" : f === "4E8F69" ? "verde" : f === "8A5A00" ? "ambar" : "area";
        sec.entradas.push({ tipo: "rotulo", texto: llenas[0].v, color, ayuda: llenas[0].ayuda }); continue;
      }
      if (llenas.length === 1 && !llenas[0].rol && llenas[0].c === 1 && !llenas[0].f) {
        const t = llenas[0].v;
        if (mayusculas(t)) { const m = /^([^:]+?):\s+(.*)$/s.exec(t); if (m && mayusculas(m[1]) && m[1] === m[1].toUpperCase()) nueva(m[1], m[2]); else nueva(t); }
        else if (!out.secciones.length || (sec && !sec.entradas.length && !sec.cabeceras.length)) out.notas.push(t);
        else sec.entradas.push({ tipo: "nota", texto: t });
        continue;
      }
      if (!sec) nueva("");
      sec.entradas.push({ tipo: "fila", r: fila.r, cs: fila.cs });
    }
    for (const s of out.secciones) {
      // grupos (p. ej. los casos de acogida): una cabecera ancha que tiene debajo, más abajo, dos o más cabeceras
      for (let i = 0; i < s.cabeceras.length; i++) for (const h of s.cabeceras[i].hs) {
        if (h.c2 <= h.c1) continue;
        const dentro = s.cabeceras.slice(i + 1).some(k => k.hs.filter(x => x.c1 >= h.c1 && x.c1 <= h.c2).length >= 2);
        if (dentro) s.grupos.push({ id: XL.colName(h.c1), texto: h.texto, c1: h.c1, c2: h.c2 });
      }
      s.entradas = s.entradas.map(e => e.tipo === "fila" ? ficha(e, s, nombres) : e).filter(Boolean);
      s.conEntradas = s.entradas.some(e => e.tipo === "ficha" && e.campos.length);
      for (const g of s.grupos) g.conDatos = s.entradas.some(e => e.tipo === "ficha" && e.info.some(x => x.grupo === g.id && x.v !== ""));  // un caso con datos del sistema; uno nuevo cuenta cuando se rellena
    }
    return out;
  }

  function etiqueta(s, r, c) {
    let best = null;
    for (const k of s.cabeceras) for (const h of k.hs) if (c >= h.c1 && c <= h.c2 && (!best || (k.r <= r && k.r >= best.r) || best.r > r)) best = { r: k.r, h };
    return best ? best.h : null;
  }
  const grupoDe = (s, c) => (s.grupos.find(g => c >= g.c1 && c <= g.c2) || {}).id || null;

  function ficha(e, s, nombres) {
    const it = { tipo: "ficha", r: e.r, id: null, titulo: null, sub: null, bloque: null, detalle: "", info: [], campos: [], sinCabecera: !s.cabeceras.length };
    const vis = e.cs.filter(c => !c.oculta);
    const lab = c => { const h = etiqueta(s, e.r, c.c); const g = grupoDe(s, c.c); const t = h ? h.texto : ""; return { texto: g && s.grupos.find(x => x.id === g).texto === t ? "" : t, ayuda: h ? h.ayuda : "", grupo: g }; };
    const ro = vis.filter(c => c.rol !== "I" && !c.f && c.v !== "");
    const conEnlace = vis.filter(c => c.rol !== "I" && c.link);
    const usados = new Set();
    for (const c of ro) { const l = lab(c); if (/^Bloque$/i.test(l.texto)) { it.bloque = c.v; usados.add(c); } }
    const primera = ro.filter(c => !usados.has(c))[0];
    if (primera && primera === vis.filter(c => !usados.has(c))[0] && ID_RE.test(primera.v) && primera.v.length <= 20) { it.id = primera.v; usados.add(primera); if (primera.ayuda) it.detalle = primera.ayuda; }
    const t = ro.find(c => !usados.has(c) && TITULO_RE.test(lab(c).texto) && !lab(c).grupo);
    const libre = ro.filter(c => !usados.has(c));
    const tit = t || (libre[0] && (libre[0].rol === "g" || !lab(libre[0]).texto || libre[0].c === vis.filter(c => !usados.has(c))[0].c) && !lab(libre[0]).grupo ? libre[0] : null);
    if (tit) { it.titulo = tit.v; usados.add(tit); if (tit.ayuda && !it.detalle) it.detalle = tit.ayuda; }
    const sub = ro.find(c => !usados.has(c) && /^Referencia/.test(lab(c).texto));
    if (sub) { it.sub = sub.v; usados.add(sub); if (sub.ayuda) it.detalle = sub.ayuda; }
    for (const c of [...ro, ...conEnlace.filter(c => !ro.includes(c))].sort((a, b) => a.c - b.c)) {
      if (usados.has(c)) continue; const l = lab(c);
      if (OCULTAS.test(l.texto)) continue;
      it.info.push({ etiqueta: l.texto, v: c.v, enlace: c.link || null, grupo: l.grupo, hoja: nombres.has(c.v) ? c.v : null, ayuda: c.ayuda });
    }
    for (const c of vis.filter(c => c.rol === "I")) {
      const l = lab(c);
      it.campos.push({ ref: c.ref, etiqueta: /^[A-Z]{2,4}-[A-Z]{2,4}-\d+/.test(l.texto) ? "" : l.texto, ayuda: c.ayuda || l.ayuda, opts: c.opts, fecha: c.date, v: c.date ? (c.iso || "") : c.v, grupo: l.grupo });
    }
    // fila a medias de la hoja sin título propio (la etiqueta va en la cabecera): la primera casilla con valor la nombra
    if (!it.titulo && !it.id && it.info.length === 1 && !it.info[0].grupo && it.campos.length) { it.titulo = it.info[0].v; it.info = []; }
    it.plantilla = !it.id && !it.titulo && !it.info.length && it.campos.every(f => f.v === "" || f.v === "No");
    if (!it.id && !it.titulo && !it.info.length && !it.campos.length) return null;
    // casilla que decide si la ficha está contestada: la primera vacía que no es opcional
    const claves = new Map();
    for (const f of it.campos) { const g = f.grupo || ""; if (!claves.has(g) && f.v === "" && !OPCIONAL.test(f.etiqueta)) claves.set(g, f.ref); }
    it.claves = claves;
    return it;
  }

  function libro(wb) {
    const nombres = new Set(wb.sheets.filter(s => !s.hidden).map(s => s.name));
    return wb.sheets.filter(s => !s.hidden).map(s => hoja(s, nombres));
  }
  return { libro };
})();
