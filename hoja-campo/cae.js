/* Pestaña «CAE» (16-11-2026; gp-cae): la comprobación de las empresas externas del día en el centro, pensada para usarla
   en planta con una mano. Una empresa por grupo plegable (abiertas las que tienen algo), y en cada trabajador:
   - lo que se le ve hacer, con un toque en un chip (o «No está»), y su veredicto se recalcula sin volver a QUIOO;
   - Permitir / Parar / Reanudar, con el motivo elegido de una lista o escrito;
   - Foto (la cámara del móvil; va a su tarea de CAE con lo que se ve);
   - Ha salido (con la hora de ahora).
   En cada empresa, «Preparar correo» con lo pendiente de pedirle (borrador en el Outlook del técnico, nunca se envía), y
   arriba «Alguien que no está en el cuaderno» (queda como consulta pendiente de QUIOO).
   Todo se guarda al momento en el dispositivo y va a Drive (acción «guardar_cae» de la Apps Script, clave de lectura);
   la siguiente sesión lo aplica (`ot.py cae_informe marcas`). Sin conexión, se ve igual y espera. La vista la deja
   `ot.py cae_informe vista --centro <C>`. */
"use strict";
const CAE = (() => {
  let vista = null, cola = [], estado = "", abiertas = {};
  const VISTO = ["En plataforma", "En altura", "Carretilla o pala", "Camión o grúa", "Espacio confinado", "Riesgo eléctrico", "Zona ATEX", "Soldadura o corte"];
  const ACTIVIDAD = { "En plataforma": "en plataforma elevadora", "En altura": "trabajando en altura", "Carretilla o pala": "con carretilla o pala",
    "Camión o grúa": "con camión o grúa", "Espacio confinado": "en espacio confinado", "Riesgo eléctrico": "con riesgo eléctrico",
    "Zona ATEX": "en zona ATEX", "Soldadura o corte": "soldadura o corte" };
  const MOTIVOS = {
    permitir: ["Documentación pendiente de validar: no se para", "Documentación compatible en otro centro", "Comprobado en planta: trabajo autorizado"],
    parar: ["No apto en QUIOO", "Trabajo no autorizado en su Autorización Trabajos", "Sin la formación para ese trabajo"],
    reanudar: ["Han subido la documentación", "Cambia a un trabajo autorizado"],
  };
  const DECISION = { permitir: "Permitido", parar: "Parado", reanudar: "Reanudado" };
  const VERBO = { permitir: "Permitir", parar: "Parar", reanudar: "Reanudar" };
  const ESTADO_P = { abierto: "por pedir", pedido: "borrador sin enviar", enviado: "enviado", resuelto: "resuelto", cerrado: "cerrado" };
  const hhmm = () => new Date().toTimeString().slice(0, 5);

  /* ---------- datos ---------- */
  async function cargar(forzar) {
    try { vista = vista || await DB.get("cae"); cola = await DB.get("cae-pendientes") || []; abiertas = await DB.get("cae-abiertas") || {}; } catch (e) { /* sin datos */ }
    if (!REPO.conectado()) { estado = "Sin conexión con Drive: lo que hagas se guarda aquí y se envía después."; return; }
    if (!forzar && vista && vista.recibido && Date.now() - vista.recibido < 5 * 60e3) return;
    try {
      await enviar();
      const j = await REPO.pedir({ accion: "cae" });
      if (j.vista) { vista = { ...j.vista, recibido: Date.now(), ya: (j.marcas || []).map(x => ({ ...x, enviada: true })) }; await DB.set("cae", vista); estado = ""; }
      else estado = "Todavía no hay CAE de hoy: sale al terminar el /cae del cuaderno.";
    } catch (e) { estado = "No se pudo traer la CAE (" + e.message + "): ves lo último guardado."; }
  }

  async function enviar() {
    const quedan = [];
    for (const m of cola) {
      try { await REPO.pedir({ accion: "guardar_cae", ...m }); if (vista) vista.ya = [...(vista.ya || []), { ...m, datos: undefined, enviada: true }]; }
      catch (e) { quedan.push(m); }
    }
    cola = quedan; await DB.set("cae-pendientes", cola);
    if (vista) await DB.set("cae", vista);
  }

  async function hacer(m, texto) {
    cola.push(m); await DB.set("cae-pendientes", cola);
    pintar();
    try { await enviar(); aviso(cola.length ? texto + " · se enviará al volver la conexión" : texto + " ✓"); }
    catch (e) { aviso(texto + " · pendiente de enviar"); }
    pintar();
  }

  /* Lo hecho sobre un trabajador (enviado o esperando), para enseñarlo enseguida */
  const hechos = (caso, t) => [...(vista && vista.ya || []), ...cola.map(x => ({ ...x, espera: true }))]
    .filter(x => x.caso === caso && (!t || x.trabajador === t));

  /* ---------- diálogos ---------- */
  function motivo(tipo, nombre) {
    return new Promise(ok => {
      const d = $("#dialogo"); d.innerHTML = "";
      const otro = h("input", { type: "text", placeholder: "Otro motivo (opcional)", class: "cae-input", "aria-label": "Otro motivo" });
      const elegir = t => { d.close(); ok(t); };
      d.append(h("h3", {}, VERBO[tipo] + " a " + nombre), h("p", { class: "nota" }, "Elige el motivo o escribe otro:"),
        h("div", { class: "cae-opciones" }, MOTIVOS[tipo].map(t => h("button", { type: "button", class: "btn opcion", onclick: () => elegir(t) }, t))),
        otro, h("div", { class: "acciones" },
          h("button", { type: "button", class: "btn", onclick: () => { d.close(); ok(null); } }, "Cancelar"),
          h("button", { type: "button", class: "btn " + (tipo === "parar" ? "peligro" : "primario"), onclick: () => elegir(otro.value.trim()) }, VERBO[tipo])));
      d.showModal();
    });
  }

  /* Confirmar el correo a la empresa; si no tenemos su dirección, se pide aquí (la de QUIOO, quien sube su documentación) */
  function pedirCorreo(emp) {
    return new Promise(ok => {
      const d = $("#dialogo"); d.innerHTML = "";
      const dir = h("input", { type: "email", placeholder: "correo@empresa.es", class: "cae-input", "aria-label": "Correo de la empresa", value: emp.correo_contrata || "" });
      const lista = (emp.seguimiento || []).filter(x => x.estado === "abierto");
      d.append(h("h3", {}, "Correo a " + emp.empresa),
        h("p", { class: "nota" }, "Se prepara un borrador en tu Outlook con esto (no se envía: lo envías tú):"),
        h("ul", {}, lista.map(x => h("li", {}, x.trabajador + ": " + x.texto))),
        ...(emp.correo_contrata ? [h("p", { class: "nota" }, "Para: " + emp.correo_contrata)]
          : [h("p", { class: "nota" }, "No tenemos su correo: escríbelo (en QUIOO, quien sube su documentación)."), dir]),
        h("div", { class: "acciones" },
          h("button", { type: "button", class: "btn", onclick: () => { d.close(); ok(null); } }, "Cancelar"),
          h("button", { type: "button", class: "btn primario", onclick: () => {
            const v = emp.correo_contrata || dir.value.trim();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { dir.focus(); aviso("Escribe un correo válido"); return; }
            d.close(); ok(emp.correo_contrata ? "" : v);
          } }, "Preparar borrador")));
      d.showModal(); if (!emp.correo_contrata) dir.focus();
    });
  }

  function alta() {
    return new Promise(ok => {
      const d = $("#dialogo"); d.innerHTML = "";
      const campo = (ph, lista) => h("input", { type: "text", placeholder: ph, class: "cae-input", "aria-label": ph, list: lista || null });
      const nombre = campo("Nombre y apellidos"), dni = campo("DNI (si lo ves)"), empresa = campo("Empresa", "cae-empresas"), act = campo("Qué está haciendo");
      const datalist = h("datalist", { id: "cae-empresas" }, (vista ? vista.empresas : []).map(e => h("option", { value: e.empresa })));
      d.append(h("h3", {}, "Alguien que no está en el cuaderno"), h("p", { class: "nota" }, "Se comprueba en QUIOO en la próxima sesión."),
        nombre, dni, empresa, datalist, act, h("div", { class: "acciones" },
          h("button", { type: "button", class: "btn", onclick: () => { d.close(); ok(null); } }, "Cancelar"),
          h("button", { type: "button", class: "btn primario", onclick: () => {
            if (!nombre.value.trim() && !dni.value.trim()) { nombre.focus(); return; }
            d.close(); ok({ nombre: nombre.value.trim(), dni: dni.value.trim(), empresa: empresa.value.trim(), actividad: act.value.trim() });
          } }, "Añadir")));
      d.showModal(); nombre.focus();
    });
  }

  /* Foto con la cámara, reducida en el móvil (lado mayor 1600 px) para que suba rápido con poca cobertura */
  function foto(emp, t) {
    const inp = h("input", { type: "file", accept: "image/*", capture: "environment", hidden: true });
    inp.addEventListener("change", async () => {
      const f = inp.files[0]; inp.remove(); if (!f) return;
      const img = await createImageBitmap(f);
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = h("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const datos = c.toDataURL("image/jpeg", 0.8).split(",")[1];
      const visto = hechos(emp.caso, t.nombre).filter(x => x.tipo === "marca" && x.actividad).pop();
      const texto = t.nombre + (visto ? " " + visto.actividad : "") + " en el momento de la comprobación";
      hacer({ tipo: "foto", caso: emp.caso, trabajador: t.nombre, texto, datos }, "Foto de " + t.nombre);
    });
    document.body.append(inp); inp.click();
  }

  /* ---------- pintar ---------- */
  const chipV = v => h("span", { class: "cae-v " + (v === "APTO" ? "ok" : v === "SIN CONSULTA" ? "gris" : "mal") }, v);

  function trabajador(emp, t) {
    const mios = hechos(emp.caso, t.nombre);
    const ultima = tipo => mios.filter(x => x.tipo === tipo || (!x.tipo && tipo === "marca")).pop();
    const dec = ultima("decision"), sal = ultima("salida"), marca = ultima("marca");
    const salida = sal ? sal.hora : t.salida;
    const acc = t.entrada ? "Entra " + t.entrada + (salida ? " · salió " + salida : " · dentro") : "";
    const problema = t.veredicto !== "APTO" || (t.no_conformidades || []).length;
    const tarjeta = h("div", { class: "cae-t" + (problema ? " cae-t-mal" : "") },
      h("div", { class: "cae-t-cab" }, h("div", {}, h("strong", {}, t.nombre), h("div", { class: "nota" }, acc)), chipV(t.veredicto)),
      h("div", { class: "nota" }, "Autorizado: " + ((t.autorizados || []).join(", ").toLowerCase() || "autorización sin leer")));
    for (const n of t.no_conformidades || []) tarjeta.append(h("p", { class: "aviso-nc" }, "⚠ " + n));
    const decTxt = dec ? DECISION[dec.decision] + (dec.texto ? ": " + dec.texto : "") + (dec.espera ? " (enviando…)" : "") : t.decision;
    if (decTxt) tarjeta.append(h("p", { class: "cae-hecho" }, "✔ " + decTxt));
    const fotos = mios.filter(x => x.tipo === "foto").length;
    if (fotos) tarjeta.append(h("p", { class: "nota" }, "📷 " + fotos + " foto(s)" + (mios.some(x => x.tipo === "foto" && x.espera) ? " (enviando…)" : "")));
    if (salida && !t.entrada) tarjeta.append(h("p", { class: "nota" }, "Salió a las " + salida));
    if (!salida) {
      // Qué se le ve hacer: un toque. El marcado queda resaltado.
      const actual = marca ? (marca.no_esta ? "No está" : Object.keys(ACTIVIDAD).find(k => ACTIVIDAD[k] === marca.actividad) || marca.actividad) : (t.actividad || "");
      tarjeta.append(h("div", { class: "nota cae-lbl" }, "Lo veo…" + (marca && marca.espera ? " (enviando…)" : "")),
        h("div", { class: "cae-chips" }, [...VISTO, "No está"].map(v => h("button", {
          type: "button", class: "cae-chip", "aria-pressed": String(actual === v || ACTIVIDAD[v] === actual),
          onclick: () => hacer(v === "No está" ? { tipo: "marca", caso: emp.caso, trabajador: t.nombre, no_esta: true }
            : { tipo: "marca", caso: emp.caso, trabajador: t.nombre, actividad: ACTIVIDAD[v] }, t.nombre + ": " + v.toLowerCase())
        }, v))));
    }
    const decidir = tipo => async () => { const m = await motivo(tipo, t.nombre); if (m !== null) hacer({ tipo: "decision", caso: emp.caso, trabajador: t.nombre, decision: tipo, texto: m }, DECISION[tipo] + ": " + t.nombre); };
    const parado = (dec && dec.decision === "parar") || /parad/i.test(t.decision || "");
    tarjeta.append(h("div", { class: "cae-acciones" },
      h("button", { type: "button", class: "btn", onclick: () => foto(emp, t) }, "📷 Foto"),
      parado ? h("button", { type: "button", class: "btn", onclick: decidir("reanudar") }, "▶ Reanudar")
        : problema ? [h("button", { type: "button", class: "btn peligro", onclick: decidir("parar") }, "⛔ Parar"),
          h("button", { type: "button", class: "btn", onclick: decidir("permitir") }, "✅ Permitir")] : null,
      !salida ? h("button", { type: "button", class: "btn", onclick: async () => {
        if (await confirmar(t.nombre + " ha salido a las " + hhmm() + "?", "Ha salido")) hacer({ tipo: "salida", caso: emp.caso, trabajador: t.nombre, hora: hhmm() }, t.nombre + " ha salido");
      } }, "🚪 Ha salido") : null));
    return tarjeta;
  }

  function empresa(emp) {
    const mal = emp.incidencias > 0 || !emp.en_regla;
    const abierta = emp.caso in abiertas ? abiertas[emp.caso] : mal;
    const correoPedido = hechos(emp.caso).some(x => x.tipo === "correo");
    const correo = correoPedido && !/enviado|borrador/.test(emp.correo || "") ? "correo pedido: se prepara en tu Outlook" : emp.correo;
    const resumen = [emp.trabajadores.length + " trabajador(es)", (emp.dentro || 0) + " dentro", mal ? emp.incidencias + " con incidencias" : "en regla"].join(" · ");
    const d = h("details", { class: "panel cae-emp" + (mal ? " cae-mal" : ""), "data-caso": emp.caso },
      h("summary", {}, h("div", { class: "cae-sum" }, h("strong", {}, emp.empresa), h("span", { class: "nota" }, resumen),
        correo ? h("span", { class: "nota cae-correo" }, "✉ " + correo) : null)));
    if (abierta) d.setAttribute("open", "");
    d.addEventListener("toggle", () => { abiertas[emp.caso] = d.open; DB.set("cae-abiertas", abiertas); });
    if (emp.seguimiento && emp.seguimiento.length) {
      d.append(h("div", { class: "cae-seg" }, h("p", { class: "nota" }, "Pedido a la empresa:"),
        h("ul", {}, emp.seguimiento.map(x => h("li", {}, h("span", { class: "chip " + (x.estado === "resuelto" || x.estado === "cerrado" ? "hecha" : "espera_si") },
          ESTADO_P[x.estado] || x.estado), " " + x.trabajador + ": " + x.texto + (x.enviado ? " (enviado " + x.enviado + ")" : x.pedido ? " (" + x.pedido + ")" : ""))))));
    }
    if (emp.por_pedir && !correoPedido) {
      d.append(h("div", { class: "cae-acciones" }, h("button", { type: "button", class: "btn primario", onclick: async () => {
        const para = await pedirCorreo(emp);
        if (para !== null) hacer({ tipo: "correo", caso: emp.caso, para }, "Correo a " + emp.empresa);
      } }, "✉ Preparar correo a la empresa")));
    }
    emp.trabajadores.forEach(t => d.append(trabajador(emp, t)));
    return d;
  }

  function plegarTodo(abrir) {
    document.querySelectorAll("details.cae-emp").forEach(d => { d.open = abrir; abiertas[d.dataset.caso] = abrir; });
    DB.set("cae-abiertas", abiertas);
  }

  async function pintar(main) {
    main = main || document.querySelector("#vista");
    if (!main || (typeof E !== "undefined" && E.vista !== "cae")) return;
    await cargar(false);
    const y = window.scrollY;
    main.innerHTML = "";
    const s = h("section", { class: "vista" });
    const cuando = vista && vista.generado ? new Date(vista.generado).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
    s.append(h("div", { class: "repo-cab" },
      h("div", {}, h("h2", {}, "CAE" + (vista ? " · " + vista.centro : "")), h("p", { class: "nota" }, vista ? "Al día a " + cuando : ""),
        estado ? h("p", { class: "nota" }, estado) : null, cola.length ? h("p", { class: "nota" }, "⏳ " + cola.length + " cosa(s) esperando conexión") : null),
      h("div", { class: "acciones" }, h("button", { type: "button", class: "btn", onclick: async () => { await cargar(true); pintar(); } }, "Actualizar"))));
    if (vista && vista.alertas && vista.alertas.length) {
      s.append(h("article", { class: "panel cae-alerta" }, h("h3", {}, "Ir a ver"),
        vista.alertas.map(a => h("p", {}, chipV(a.veredicto), " ", h("strong", {}, a.nombre),
          h("span", { class: "nota" }, " · " + a.empresa + (a.dentro ? " · dentro" : "")), h("br"),
          a.por_que, h("br"), h("span", { class: a.decision ? "cae-hecho" : "aviso-nc" }, a.decision ? "✔ " + a.decision : "Sin decisión todavía")))));
    }
    s.append(h("div", { class: "cae-acciones" },
      h("button", { type: "button", class: "btn", onclick: async () => {
        const a = await alta(); if (a) hacer({ tipo: "alta", centro: vista ? vista.centro : "", ...a }, "Añadido " + (a.nombre || a.dni));
      } }, "＋ Alguien que no está en el cuaderno"),
      vista && vista.empresas.length > 1 ? [h("button", { type: "button", class: "btn", onclick: () => plegarTodo(true) }, "Abrir todas"),
        h("button", { type: "button", class: "btn", onclick: () => plegarTodo(false) }, "Plegar todas")] : null));
    const altas = (vista && vista.ya || []).concat(cola).filter(x => x.tipo === "alta");
    if (altas.length) s.append(h("p", { class: "nota" }, "Pendientes de comprobar en QUIOO: " + altas.map(x => x.nombre || x.dni).join(", ")));
    if (!vista || !vista.empresas.length) s.append(h("p", { class: "nota" }, "Sin CAE de hoy."));
    else for (const emp of vista.empresas) s.append(empresa(emp));
    main.append(s);
    window.scrollTo({ top: y });
  }

  /* Aviso en la hoja de campo (16-11-2026): si hay CAE del día del mismo centro con algo que ir a ver, una franja arriba
     de cualquier pestaña de la hoja que lleva a la pestaña CAE. */
  async function franja(main, centro) {
    try { vista = vista || await DB.get("cae"); } catch (e) { return; }
    if (!vista || !vista.alertas || !vista.alertas.length) return;
    if (centro && vista.centro && !String(centro).toUpperCase().includes(vista.centro)) return;
    if (new Date(vista.dia + "T23:59") < new Date(Date.now() - 864e5)) return;
    main.prepend(h("button", { type: "button", class: "cae-franja", onclick: () => { E.vista = "cae"; window.pintar ? window.pintar() : document.querySelector("#tab-cae").click(); } },
      "⚠ CAE: " + vista.alertas.length + " por ver (" + vista.alertas.map(a => a.nombre.split(" ")[0]).join(", ") + ") · abrir"));
  }

  window.addEventListener("online", () => { if (cola.length) enviar(); });
  return { pintar, franja };
})();
