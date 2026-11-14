/* Pestaña «Correo» (14-11-2026): los correos leídos al encender el PC, ya convertidos en entradas del sistema
   (gp-entradas). Por día, una ficha por correo: quién y de qué va, a qué contesta, qué se ha puesto en marcha, lo hablado,
   las formas de responder y el borrador. Lo que espera el sí del técnico se decide aquí con un toque: la decisión va a
   Drive (acción «guardar_correo» de la Apps Script, con la clave de lectura) y la aplica la siguiente sesión. Sin
   conexión, la vista guardada se sigue viendo y las decisiones esperan en el dispositivo. */
"use strict";
const CORREO = (() => {
  let vista = null, decididas = [], estado = "";
  const ESTADO = { en_marcha: "En marcha", espera_si: "Espera tu sí", pendiente_datos: "Faltan datos", hecha: "Hecho", descartada: "Descartado" };
  const dia = d => { const t = new Date(d + "T12:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }); return t[0].toUpperCase() + t.slice(1); };
  const hora = t => t ? new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "";

  async function cargar(forzar) {
    try { vista = vista || await DB.get("correo"); decididas = await DB.get("correo-pendientes") || []; } catch (e) { /* sin datos guardados */ }
    if (!REPO.conectado()) { estado = "Sin conexión con Drive: conéctala en «Repositorio PRL»."; return; }
    if (!forzar && vista && vista.recibido && Date.now() - vista.recibido < 5 * 60e3) return;
    try {
      await enviarPendientes();
      const j = await REPO.pedir({ accion: "correo" });
      if (j.vista) { vista = { ...j.vista, recibido: Date.now(), ya: j.decisiones || [] }; await DB.set("correo", vista); estado = ""; }
      else estado = "Todavía no hay correo leído: llega al abrir Claude Code en el PC del trabajo.";
    } catch (e) { estado = "No se pudo traer el correo (" + e.message + "): se ve lo último guardado."; }
  }

  async function enviarPendientes() {
    const quedan = [];
    for (const d of decididas) {
      try {
        await REPO.pedir({ accion: "guardar_correo", ...d });
        if (vista) vista.ya = [...(vista.ya || []).filter(x => !(x.entrada === d.entrada && String(x.hecho || "") === String(d.hecho || ""))), d];
      } catch (e) { quedan.push(d); }
    }
    decididas = quedan; await DB.set("correo-pendientes", decididas);
    if (vista) await DB.set("correo", vista);
  }

  async function decidir(d, texto) {
    decididas = decididas.filter(x => !(x.entrada === d.entrada && String(x.hecho || "") === String(d.hecho || "")));
    decididas.push(d); await DB.set("correo-pendientes", decididas);
    try { await enviarPendientes(); aviso(decididas.length ? texto + " (se enviará al volver la conexión)" : texto + ": lo aplica la próxima sesión."); }
    catch (e) { aviso(texto + " (pendiente de enviar)"); }
    pintar();
  }

  const decision = (entrada, hecho) => [...(vista && vista.ya || []), ...decididas].filter(x => x.entrada === entrada && String(x.hecho || "") === String(hecho || "")).pop();

  function ficha(e) {
    const cab = h("div", { class: "correo-cab" },
      h("div", {}, h("strong", {}, e.asunto || "(sin asunto)"), h("p", { class: "nota" }, [e.de, e.centro, hora(e.recibido)].filter(Boolean).join(" · "))),
      h("span", { class: "chip " + e.estado }, ESTADO[e.estado] || e.estado));
    const partes = [cab];
    if (e.responde_a_nuestro) partes.push(h("p", { class: "nota" }, "Contesta a nuestro correo «" + (e.responde_a_nuestro.asunto || "") + "» (" + (e.responde_a_nuestro.ids || []).join(", ") + ")"));
    if (e.resumen) partes.push(h("p", {}, e.resumen));
    const lista = h("ul", { class: "hechos" });
    for (const x of e.hechos) {
      const li = h("li", {}, h("span", { class: "chip " + x.estado }, ESTADO[x.estado] || x.estado), " ",
        h("span", {}, x.disparador.replace(/_/g, " ") + (x.nota ? " · " + x.nota : "") + (x.faltan && x.faltan.length ? " · falta: " + x.faltan.join(", ") : "")));
      if (x.estado === "espera_si") {
        const ya = decision(e.id, x.n);
        li.append(ya ? h("span", { class: "nota" }, " — decidido: " + (ya.decision === "si" ? "sí" : "no"))
          : h("span", { class: "botones" },
            h("button", { type: "button", class: "btn primario", onclick: () => decidir({ entrada: e.id, hecho: x.n, decision: "si" }, "Sí a " + (x.lote ? "la " + x.lote : e.id)) }, "Sí"),
            h("button", { type: "button", class: "btn", onclick: () => decidir({ entrada: e.id, hecho: x.n, decision: "no" }, "No a " + (x.lote ? "la " + x.lote : e.id)) }, "No")));
      }
      lista.append(li);
    }
    partes.push(lista);
    if (e.conversacion) partes.push(h("details", { class: "mas" }, h("summary", {}, "Lo hablado"), h("p", {}, e.conversacion)));
    if (e.opciones && e.opciones.length) {
      const ya = decision(e.id, null);
      const elegida = ya ? Number(String(ya.decision).split(":")[1]) : e.respuesta_elegida;
      partes.push(h("div", { class: "opciones" }, h("p", { class: "nota" }, "Cómo responder:"),
        e.opciones.map((o, i) => h("button", { type: "button", class: "btn opcion", "aria-pressed": String(elegida === i + 1),
          onclick: () => decidir({ entrada: e.id, decision: "opcion:" + (i + 1) }, "Respuesta elegida") }, (i + 1) + ". " + o))));
    }
    if (e.borrador) partes.push(h("p", { class: "nota" }, "Borrador: " + (typeof e.borrador === "string" ? e.borrador : (e.borrador.asunto || "") + (e.borrador.estado ? " · " + e.borrador.estado : ""))));
    return h("article", { class: "panel correo-ficha" }, partes);
  }

  async function pintar(main) {
    main = main || document.querySelector("#vista");
    if (!main || (typeof E !== "undefined" && E.vista !== "correo")) return;
    await cargar(false);
    main.innerHTML = "";
    const s = h("section", { class: "vista" });
    const cuando = vista && vista.generado ? new Date(vista.generado).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
    const pendientesSi = vista ? vista.lote.filter(x => !decision(x.entrada, x.hecho)).length : 0;
    s.append(h("div", { class: "repo-cab" },
      h("div", {}, h("h2", {}, "Correo"), h("p", { class: "nota" }, vista ? `Al día a ${cuando}` + (pendientesSi ? ` · ${pendientesSi} esperan tu sí` : "") : ""),
        estado ? h("p", { class: "nota" }, estado) : null, decididas.length ? h("p", { class: "nota" }, `${decididas.length} decisión(es) sin enviar`) : null),
      h("div", { class: "acciones" }, h("button", { type: "button", class: "btn", onclick: async () => { await cargar(true); pintar(); } }, "Actualizar"))));
    if (!vista || !vista.dias.length) s.append(h("p", { class: "nota" }, "Sin correo de los últimos 14 días."));
    else for (const d of vista.dias) s.append(h("h3", { class: "correo-dia" }, dia(d.dia)), ...d.entradas.map(ficha));
    main.append(s);
  }
  window.addEventListener("online", () => { if (decididas.length) enviarPendientes(); });
  return { pintar };
})();
