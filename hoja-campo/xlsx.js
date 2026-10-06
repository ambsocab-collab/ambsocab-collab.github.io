/* Lectura y escritura de la hoja de campo (.xlsx) sin perder nada de lo que lleva: formatos, listas, notas y fórmulas.
   Se lee el XML del libro tal cual y, al exportar, solo se tocan las casillas que se han rellenado en la app. */
"use strict";
const XL = (() => {
  const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const DATE_FMTS = new Set([14, 15, 16, 17, 22]);

  const colNum = s => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
  const colName = n => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const parseRef = ref => { const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref); return m ? { c: colNum(m[1]), r: +m[2] } : null; };
  const refOf = (r, c) => colName(c) + r;
  function* rangeRefs(range) {
    const [a, b] = range.split(":"); const p = parseRef(a), q = parseRef(b || a);
    if (!p || !q) return;
    for (let r = p.r; r <= q.r; r++) for (let c = p.c; c <= q.c; c++) yield { r, c };
  }
  const parse = txt => new DOMParser().parseFromString(txt, "application/xml");
  const kids = (el, name) => Array.from(el.getElementsByTagNameNS("*", name));
  const kid = (el, name) => el.getElementsByTagNameNS("*", name)[0] || null;
  const textOf = el => kids(el, "t").map(t => t.textContent).join("");
  const resolve = (base, target) => {
    if (target.startsWith("/")) return target.slice(1);
    const parts = base.split("/"); parts.pop();
    for (const seg of target.split("/")) { if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg); }
    return parts.join("/");
  };
  async function rels(zip, path) {
    const dir = path.split("/"); const file = dir.pop();
    const rp = [...dir, "_rels", file + ".rels"].join("/");
    const f = zip.file(rp); const out = {};
    if (!f) return out;
    for (const r of kids(parse(await f.async("string")), "Relationship"))
      out[r.getAttribute("Id")] = { target: r.getAttribute("TargetMode") === "External" ? r.getAttribute("Target") : resolve(path, r.getAttribute("Target")), type: r.getAttribute("Type") || "" };
    return out;
  }
  const serialToDate = n => new Date(Math.round((n - 25569) * 864e5));
  const pad = n => String(n).padStart(2, "0");
  const fmtDate = d => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  const isoDate = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const dateToSerial = iso => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d) / 864e5 + 25569; };

  async function read(bytes) {
    const zip = await JSZip.loadAsync(bytes);
    const wbPath = "xl/workbook.xml";
    const wbDoc = parse(await zip.file(wbPath).async("string"));
    const wbRels = await rels(zip, wbPath);
    let sst = [];
    const sstRel = Object.values(wbRels).find(r => r.type.endsWith("/sharedStrings"));
    if (sstRel && zip.file(sstRel.target)) sst = kids(parse(await zip.file(sstRel.target).async("string")), "si").map(si => kids(si, "t").filter(t => t.parentNode.localName !== "rPh").map(t => t.textContent).join(""));
    // estilos: relleno y formato de número de cada estilo de casilla
    const stRel = Object.values(wbRels).find(r => r.type.endsWith("/styles"));
    const xfs = [], fills = [], dateFmt = new Set();
    if (stRel && zip.file(stRel.target)) {
      const st = parse(await zip.file(stRel.target).async("string"));
      for (const nf of kids(st, "numFmt")) if (/[dy]/i.test((nf.getAttribute("formatCode") || "").replace(/\[[^\]]*\]|"[^"]*"/g, ""))) dateFmt.add(+nf.getAttribute("numFmtId"));
      const fillsEl = kid(st, "fills");
      if (fillsEl) for (const f of kids(fillsEl, "fill")) {
        const pf = kid(f, "patternFill"); const fg = pf && kid(pf, "fgColor");
        fills.push(pf && pf.getAttribute("patternType") === "solid" && fg && fg.getAttribute("rgb") ? fg.getAttribute("rgb").slice(-6).toUpperCase() : null);
      }
      const cx = kid(st, "cellXfs");
      if (cx) for (const x of Array.from(cx.children).filter(e => e.localName === "xf")) {
        const nf = +(x.getAttribute("numFmtId") || 0);
        xfs.push({ fill: fills[+(x.getAttribute("fillId") || 0)] || null, date: DATE_FMTS.has(nf) || dateFmt.has(nf) });
      }
    }
    const sheets = [];
    for (const s of kids(wbDoc, "sheet")) {
      const rid = s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || s.getAttribute("r:id");
      sheets.push({ name: s.getAttribute("name"), hidden: (s.getAttribute("state") || "visible") !== "visible", path: wbRels[rid].target });
    }
    for (const sh of sheets) {
      const doc = parse(await zip.file(sh.path).async("string"));
      const cells = new Map(); let maxR = 0, maxC = 0;
      for (const c of kids(doc, "c")) {
        const ref = c.getAttribute("r"); const p = parseRef(ref); if (!p) continue;
        const xf = xfs[+(c.getAttribute("s") || 0)] || { fill: null, date: false };
        const t = c.getAttribute("t"); const vEl = kid(c, "v"); const fEl = kid(c, "f");
        let v = vEl ? vEl.textContent : null, iso = null;
        if (t === "s") v = sst[+v] ?? "";
        else if (t === "inlineStr") { const is = kid(c, "is"); v = is ? textOf(is) : ""; }
        else if (t === "b") v = v === "1" ? "VERDADERO" : "FALSO";
        else if (v != null && t !== "str" && t !== "e" && xf.date && !isNaN(+v)) { const d = serialToDate(+v); iso = isoDate(d); v = fmtDate(d); }
        const cell = { ...p, ref, v: v ?? "", iso, fill: xf.fill, date: xf.date, f: fEl ? fEl.textContent : null };
        if (cell.f) { const m = /HYPERLINK\(\s*"([^"]+)"\s*(?:[,;]\s*"([^"]*)")?/i.exec(cell.f); if (m) { cell.link = m[1]; cell.v = cell.v || m[2] || "Abrir"; } }
        cells.set(ref, cell); maxR = Math.max(maxR, p.r); maxC = Math.max(maxC, p.c);
      }
      const hiddenCols = new Set();
      for (const col of kids(doc, "col")) if (col.getAttribute("hidden") === "1" || col.getAttribute("hidden") === "true")
        for (let i = +col.getAttribute("min"); i <= +col.getAttribute("max"); i++) hiddenCols.add(i);
      const merges = kids(doc, "mergeCell").map(m => { const [a, b] = m.getAttribute("ref").split(":"); return { a: parseRef(a), b: parseRef(b || a) }; });
      const dvs = [];
      for (const dv of kids(doc, "dataValidation")) {
        if ((dv.getAttribute("type") || "") !== "list") continue;
        const f1 = kid(dv, "formula1"); const xf = f1 && kid(f1, "f");
        const formula = (xf || f1 || {}).textContent || "";
        const sq = dv.getAttribute("sqref") || ((kid(dv, "sqref") || {}).textContent) || "";
        dvs.push({ formula, sqref: sq.trim().split(/\s+/) });
      }
      const srels = await rels(zip, sh.path);
      const comments = new Map();
      for (const r of Object.values(srels)) if (r.type.endsWith("/comments") && zip.file(r.target))
        for (const cm of kids(parse(await zip.file(r.target).async("string")), "comment")) comments.set(cm.getAttribute("ref"), textOf(cm).trim());
      for (const h of kids(doc, "hyperlink")) {
        const rid = h.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
        const url = rid && srels[rid] ? srels[rid].target : null;
        if (!url) continue;
        for (const p of rangeRefs(h.getAttribute("ref"))) { const c = cells.get(refOf(p.r, p.c)); if (c) c.link = url; }
      }
      Object.assign(sh, { cells, maxR, maxC, hiddenCols, merges, dvs, comments });
    }
    // listas: cada validación apunta a un rango (normalmente de la pestaña oculta LISTAS) o trae los valores escritos
    const byName = new Map(sheets.map(s => [s.name, s]));
    for (const sh of sheets) {
      sh.options = new Map();
      for (const dv of sh.dvs) {
        let opts = [];
        const m = /^'?(.+?)'?!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/.exec(dv.formula);
        if (m && byName.has(m[1])) {
          const src = byName.get(m[1]);
          for (const p of rangeRefs(`${m[2]}${m[3]}:${m[4]}${m[5]}`)) { const c = src.cells.get(refOf(p.r, p.c)); if (c && c.v !== "") opts.push(c.v); }
        } else if (/^".*"$/.test(dv.formula)) opts = dv.formula.slice(1, -1).split(",").map(s => s.trim()).filter(Boolean);
        else continue;
        for (const rg of dv.sqref) for (const p of rangeRefs(rg)) sh.options.set(refOf(p.r, p.c), opts);
      }
    }
    return { sheets };
  }

  /* Escribe las casillas cambiadas en el XML original. Las fórmulas pierden su valor guardado para que nadie lea un
     resultado viejo: Excel y Google las recalculan al abrir. */
  async function write(bytes, edits, dateRefs) {
    const zip = await JSZip.loadAsync(bytes);
    const wbPath = "xl/workbook.xml";
    const wbDoc = parse(await zip.file(wbPath).async("string"));
    const wbRels = await rels(zip, wbPath);
    const paths = new Map();
    for (const s of kids(wbDoc, "sheet")) {
      const rid = s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || s.getAttribute("r:id");
      paths.set(s.getAttribute("name"), wbRels[rid].target);
    }
    for (const [name, path] of paths) {
      const doc = parse(await zip.file(path).async("string"));
      let touched = false;
      for (const c of kids(doc, "c")) if (kid(c, "f")) { const v = kid(c, "v"); if (v) { c.removeChild(v); touched = true; } }
      const ed = edits[name] || {};
      const sheetData = kid(doc, "sheetData");
      for (const [ref, value] of Object.entries(ed)) {
        const p = parseRef(ref); if (!p) continue;
        let c = kids(doc, "c").find(x => x.getAttribute("r") === ref);
        if (!c) {
          let row = kids(sheetData, "row").find(x => +x.getAttribute("r") === p.r);
          if (!row) {
            row = doc.createElementNS(NS, "row"); row.setAttribute("r", p.r);
            const after = kids(sheetData, "row").find(x => +x.getAttribute("r") > p.r);
            sheetData.insertBefore(row, after || null);
          }
          c = doc.createElementNS(NS, "c"); c.setAttribute("r", ref);
          const next = Array.from(row.children).find(x => ((parseRef(x.getAttribute("r") || "") || { c: 0 }).c) > p.c);
          row.insertBefore(c, next || null);
        }
        for (const ch of Array.from(c.children)) if (ch.localName !== "f") c.removeChild(ch);
        c.removeAttribute("t");
        if (value === "" || value == null) { touched = true; continue; }
        if ((dateRefs[name] || new Set()).has(ref) && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
          const v = doc.createElementNS(NS, "v"); v.textContent = String(dateToSerial(value)); c.appendChild(v);
        } else {
          c.setAttribute("t", "inlineStr");
          const is = doc.createElementNS(NS, "is"); const t = doc.createElementNS(NS, "t");
          t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve"); t.textContent = String(value);
          is.appendChild(t); c.appendChild(is);
        }
        touched = true;
      }
      if (touched) zip.file(path, new XMLSerializer().serializeToString(doc));
    }
    let calc = kid(wbDoc, "calcPr");
    if (!calc) {
      calc = wbDoc.createElementNS(NS, "calcPr");
      const anchor = kid(wbDoc, "definedNames") || kid(wbDoc, "sheets");
      anchor.parentNode.insertBefore(calc, anchor.nextSibling);
    }
    calc.setAttribute("fullCalcOnLoad", "1");
    zip.file(wbPath, new XMLSerializer().serializeToString(wbDoc));
    return zip.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  return { read, write, refOf, colName, parseRef };
})();
