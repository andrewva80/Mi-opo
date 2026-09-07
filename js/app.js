/**
 * app.js — orquesta la interfaz. La configuración (owner/repo/tokens) vive
 * en localStorage de este dispositivo; el temario y los archivos viven en
 * el repo de GitHub, así que se puede entrar desde varios dispositivos
 * sin perder nada (basta con repetir la configuración una vez en cada uno).
 */

const DIAS_AVISO = 10;     // a partir de aquí, "toca repasar"
const DIAS_URGENTE = 20;   // a partir de aquí, aviso "urgente"

const TIPOS_TEMA = {
  ivaspe: { label: "IVASPE", emoji: "🧯" },
  legislacion: { label: "Legislación", emoji: "⚖️" },
  geografia: { label: "Geografía", emoji: "🌍" },
  procedimientos: { label: "Procedimientos", emoji: "📋" },
  otro: { label: "Otro", emoji: "📌" },
};

function tiposParaBloque(bloque) {
  if (bloque === "comun") return ["ivaspe", "legislacion", "otro"];
  return ["geografia", "procedimientos", "otro"];
}

function emojiTema(tema) {
  return TIPOS_TEMA[tema.tipo]?.emoji || TIPOS_TEMA.otro.emoji;
}

let estado = {
  temario: { comun: [], alicante: [], valencia: [] },
  sha: null,
  oposicionActiva: "alicante",
  temaActivoId: null,
  categoriaActiva: "esquemas",
  historialChat: [],
};

// ---------- Arranque ----------

document.addEventListener("DOMContentLoaded", () => {
  const cfg = cargarConfig();
  if (cfg) {
    GitHubStorage.init(cfg.github);
    ClaudeAI.init(cfg.anthropicKey);
    mostrarApp();
  } else {
    mostrarSetup();
  }
  cablearEventosSetup();
  cablearEventosApp();
});

function cargarConfig() {
  const raw = localStorage.getItem("parteEstudio.config");
  return raw ? JSON.parse(raw) : null;
}

function guardarConfig(cfg) {
  localStorage.setItem("parteEstudio.config", JSON.stringify(cfg));
}

function mostrarSetup() {
  document.getElementById("setup-screen").classList.remove("hidden");
  document.getElementById("app").classList.add("hidden");
}

async function mostrarApp() {
  document.getElementById("setup-screen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  estado.oposicionActiva = localStorage.getItem("parteEstudio.oposicion") || "alicante";
  actualizarSwitchOposicion();
  await recargarIndice();
}

function cablearEventosSetup() {
  document.getElementById("save-config").addEventListener("click", async () => {
    const cfg = {
      github: {
        owner: val("gh-owner"),
        repo: val("gh-repo"),
        token: val("gh-token"),
      },
      anthropicKey: val("anthropic-key"),
    };
    if (!cfg.github.owner || !cfg.github.repo || !cfg.github.token) {
      alert("Rellena al menos el owner, el repo y el token de GitHub.");
      return;
    }
    GitHubStorage.init(cfg.github);
    const btn = document.getElementById("save-config");
    btn.textContent = "Comprobando conexión...";
    const ok = await GitHubStorage.testConnection().catch(() => false);
    if (!ok) {
      alert("No he podido conectar con ese repositorio. Revisa el owner, el nombre y el token.");
      btn.textContent = "Guardar y entrar";
      return;
    }
    ClaudeAI.init(cfg.anthropicKey);
    guardarConfig(cfg);
    mostrarApp();
  });
}

function val(id) {
  return document.getElementById(id).value.trim();
}

// ---------- Índice / temario ----------

async function recargarIndice() {
  setSyncStatus("sincronizando...");
  try {
    const { temario, sha } = await GitHubStorage.readIndex();
    estado.temario = temario;
    estado.sha = sha;
    setSyncStatus("sincronizado");
  } catch (e) {
    setSyncStatus("error de sincronización");
    console.error(e);
  }
  renderSidebar();
  renderAvisos();
}

async function guardarIndice(mensaje) {
  const res = await GitHubStorage.writeIndex(estado.temario, estado.sha, mensaje);
  estado.sha = res.content.sha;
}

function setSyncStatus(texto) {
  document.getElementById("sync-status").textContent = texto;
}

// ---------- Oposición activa ----------

function actualizarSwitchOposicion() {
  document.querySelectorAll(".switch-opt").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.oposicion === estado.oposicionActiva);
  });
  document.getElementById("label-especifico").textContent =
    estado.oposicionActiva === "alicante" ? "Geografía y procedimientos — Alicante" : "Geografía y procedimientos — Valencia";
}

function cablearEventosApp() {
  document.querySelectorAll(".switch-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      estado.oposicionActiva = btn.dataset.oposicion;
      localStorage.setItem("parteEstudio.oposicion", estado.oposicionActiva);
      estado.temaActivoId = null;
      actualizarSwitchOposicion();
      renderSidebar();
      mostrarVacio();
    });
  });

  document.getElementById("open-settings").addEventListener("click", () => {
    if (confirm("¿Borrar la configuración guardada en este dispositivo y volver a introducirla?")) {
      localStorage.removeItem("parteEstudio.config");
      location.reload();
    }
  });

  document.getElementById("add-tema").addEventListener("click", abrirModalNuevoTema);

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => cambiarTab(btn.dataset.tab));
  });

  ["esquemas", "ejercicios", "examenes"].forEach((cat) => {
    const zone = document.querySelector(`.dropzone[data-categoria="${cat}"]`);
    const input = document.getElementById(`file-${cat}`);
    zone.addEventListener("click", () => input.click());
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      manejarArchivos(cat, e.dataTransfer.files);
    });
    input.addEventListener("change", () => manejarArchivos(cat, input.files));
  });

  document.getElementById("btn-marcar-repasado").addEventListener("click", marcarRepasadoHoy);
  document.getElementById("btn-borrar-tema").addEventListener("click", borrarTemaActivo);
  document.getElementById("btn-generar-examen").addEventListener("click", generarExamen);

  document.getElementById("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    enviarMensajeChat();
  });
}

// ---------- Sidebar / temas ----------

function todosTemasBloque(bloque) {
  return estado.temario[bloque] || [];
}

function renderSidebar() {
  const listaComun = document.getElementById("lista-comun");
  const listaEspecifico = document.getElementById("lista-especifico");
  listaComun.innerHTML = "";
  listaEspecifico.innerHTML = "";

  todosTemasBloque("comun").forEach((tema) => listaComun.appendChild(renderTemaItem(tema, "comun")));
  todosTemasBloque(estado.oposicionActiva).forEach((tema) =>
    listaEspecifico.appendChild(renderTemaItem(tema, estado.oposicionActiva))
  );
}

function diasDesde(fechaIso) {
  if (!fechaIso) return Infinity;
  return Math.floor((Date.now() - new Date(fechaIso).getTime()) / 86400000);
}

function renderTemaItem(tema, bloque) {
  const li = document.createElement("li");
  li.className = "tema-item" + (tema.id === estado.temaActivoId ? " active" : "");
  const dias = diasDesde(tema.ultimaRevision);
  const flagClase = dias >= DIAS_URGENTE ? "overdue" : dias >= DIAS_AVISO ? "due" : "";
  li.innerHTML = `<span class="tema-flag ${flagClase}"></span><span style="flex:1">${emojiTema(tema)} ${escapeHtml(tema.nombre)}</span>`;
  li.addEventListener("click", () => abrirTema(tema.id, bloque));
  return li;
}

function buscarTema(id) {
  for (const bloque of ["comun", "alicante", "valencia"]) {
    const t = (estado.temario[bloque] || []).find((x) => x.id === id);
    if (t) return { tema: t, bloque };
  }
  return null;
}

function abrirTema(id, bloque) {
  estado.temaActivoId = id;
  estado.categoriaActiva = "esquemas";
  estado.historialChat = [];
  document.getElementById("chat-log").innerHTML =
    '<div class="chat-msg chat-assistant">Pregúntame sobre este tema: puedo revisar tus fallos, explicarte algo del esquema, o hacerte un examen corto.</div>';
  renderSidebar();
  mostrarTemaView();
}

function mostrarVacio() {
  document.getElementById("empty-state").classList.remove("hidden");
  document.getElementById("tema-view").classList.add("hidden");
}

function mostrarTemaView() {
  const { tema } = buscarTema(estado.temaActivoId);
  document.getElementById("empty-state").classList.add("hidden");
  document.getElementById("tema-view").classList.remove("hidden");
  document.getElementById("tema-titulo").textContent = `${emojiTema(tema)} ${tema.nombre}`;
  const dias = diasDesde(tema.ultimaRevision);
  document.getElementById("tema-ultima-revision").textContent =
    tema.ultimaRevision ? `repasado hace ${dias} día(s)` : "sin repasar todavía";
  cambiarTab(estado.categoriaActiva);
}

function cambiarTab(tab) {
  estado.categoriaActiva = tab;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  ["esquemas", "ejercicios", "examenes"].forEach((cat) => {
    document.getElementById(`panel-${cat}`).classList.toggle("hidden", cat !== tab);
  });
  renderFileList(tab);
}

function renderFileList(categoria) {
  const { tema } = buscarTema(estado.temaActivoId);
  const ul = document.getElementById(`files-${categoria}`);
  ul.innerHTML = "";
  (tema.archivos[categoria] || []).forEach((f) => {
    const li = document.createElement("li");
    li.className = "file-item";
    li.innerHTML = `<a href="${f.url}" target="_blank" rel="noopener">${escapeHtml(f.nombre)}</a>
      <button class="file-remove" title="Eliminar">✕</button>`;
    li.querySelector(".file-remove").addEventListener("click", () => borrarArchivo(categoria, f));
    ul.appendChild(li);
  });
}

// ---------- Crear / borrar temas ----------

function selectStyle() {
  return "width:100%;padding:10px;border-radius:6px;background:var(--ink-soft);color:var(--paper);border:1px solid var(--line-strong);";
}

function opcionesTipo(bloque) {
  return tiposParaBloque(bloque)
    .map((t) => `<option value="${t}">${TIPOS_TEMA[t].emoji} ${TIPOS_TEMA[t].label}</option>`)
    .join("");
}

function abrirModalNuevoTema() {
  const bloques = [
    { value: "comun", label: "Común (IVASPE / Legislación)" },
    { value: estado.oposicionActiva, label: `Específico de ${cap(estado.oposicionActiva)}` },
  ];
  abrirModal(`
    <h2 style="margin-bottom:14px;">Nuevo tema</h2>
    <label class="field"><span>Nombre del tema</span>
      <input type="text" id="nuevo-tema-nombre" placeholder="p. ej. Tema 4 — Ventilación en incendios">
    </label>
    <label class="field"><span>Bloque</span>
      <select id="nuevo-tema-bloque" style="${selectStyle()}">
        ${bloques.map((b) => `<option value="${b.value}">${b.label}</option>`).join("")}
      </select>
    </label>
    <label class="field"><span>Tipo (para el icono)</span>
      <select id="nuevo-tema-tipo" style="${selectStyle()}">
        ${opcionesTipo("comun")}
      </select>
    </label>
    <div style="display:flex; gap:10px; margin-top:16px;">
      <button class="btn btn-primary" id="confirmar-nuevo-tema">Crear tema</button>
      <button class="btn btn-ghost" id="cancelar-nuevo-tema">Cancelar</button>
    </div>
  `);
  const selectBloque = document.getElementById("nuevo-tema-bloque");
  const selectTipo = document.getElementById("nuevo-tema-tipo");
  selectBloque.addEventListener("change", () => {
    selectTipo.innerHTML = opcionesTipo(selectBloque.value);
  });

  document.getElementById("cancelar-nuevo-tema").addEventListener("click", cerrarModal);
  document.getElementById("confirmar-nuevo-tema").addEventListener("click", async () => {
    const nombre = val("nuevo-tema-nombre");
    const bloque = selectBloque.value;
    const tipo = selectTipo.value;
    if (!nombre) return;
    const tema = {
      id: "t_" + Date.now().toString(36),
      nombre,
      tipo,
      ultimaRevision: null,
      archivos: { esquemas: [], ejercicios: [], examenes: [] },
    };
    estado.temario[bloque] = estado.temario[bloque] || [];
    estado.temario[bloque].push(tema);
    cerrarModal();
    setSyncStatus("guardando...");
    await guardarIndice(`Crea tema "${nombre}"`);
    setSyncStatus("sincronizado");
    renderSidebar();
    abrirTema(tema.id, bloque);
  });
}

async function borrarTemaActivo() {
  const { tema, bloque } = buscarTema(estado.temaActivoId);
  if (!confirm(`¿Eliminar "${tema.nombre}" del índice? Los archivos seguirán en el repo, pero dejarán de estar organizados aquí.`)) return;
  estado.temario[bloque] = estado.temario[bloque].filter((t) => t.id !== tema.id);
  estado.temaActivoId = null;
  setSyncStatus("guardando...");
  await guardarIndice(`Elimina tema "${tema.nombre}"`);
  setSyncStatus("sincronizado");
  renderSidebar();
  mostrarVacio();
}

async function marcarRepasadoHoy() {
  const { tema } = buscarTema(estado.temaActivoId);
  tema.ultimaRevision = new Date().toISOString();
  setSyncStatus("guardando...");
  await guardarIndice(`Marca "${tema.nombre}" como repasado`);
  setSyncStatus("sincronizado");
  renderSidebar();
  mostrarTemaView();
  renderAvisos();
}

// ---------- Archivos ----------

async function manejarArchivos(categoria, fileList) {
  const { tema, bloque } = buscarTema(estado.temaActivoId);
  const zone = document.querySelector(`.dropzone[data-categoria="${categoria}"] p`);
  const textoOriginal = zone.textContent;
  for (const file of fileList) {
    zone.textContent = `Subiendo ${file.name}...`;
    try {
      const meta = await GitHubStorage.uploadFile(bloque, tema.id, categoria, file);
      tema.archivos[categoria].push(meta);
    } catch (e) {
      alert(e.message);
    }
  }
  zone.textContent = textoOriginal;
  setSyncStatus("guardando...");
  await guardarIndice(`Sube archivos a "${tema.nombre}" / ${categoria}`);
  setSyncStatus("sincronizado");
  renderFileList(categoria);
}

async function borrarArchivo(categoria, archivo) {
  if (!confirm(`¿Eliminar ${archivo.nombre}?`)) return;
  const { tema } = buscarTema(estado.temaActivoId);
  try {
    await GitHubStorage.deleteFile(archivo.path, archivo.sha);
  } catch (e) {
    alert(e.message);
    return;
  }
  tema.archivos[categoria] = tema.archivos[categoria].filter((f) => f.path !== archivo.path);
  setSyncStatus("guardando...");
  await guardarIndice(`Elimina archivo de "${tema.nombre}"`);
  setSyncStatus("sincronizado");
  renderFileList(categoria);
}

// ---------- Avisos de repaso ----------

function renderAvisos() {
  const cont = document.getElementById("avisos");
  cont.innerHTML = "";
  const pendientes = [];
  ["comun", "alicante", "valencia"].forEach((bloque) => {
    (estado.temario[bloque] || []).forEach((tema) => {
      const dias = diasDesde(tema.ultimaRevision);
      if (dias >= DIAS_AVISO) pendientes.push({ tema, dias, bloque });
    });
  });
  pendientes.sort((a, b) => b.dias - a.dias);
  pendientes.slice(0, 5).forEach((p) => {
    const div = document.createElement("div");
    div.className = "aviso";
    const texto = p.dias === Infinity ? "nunca repasado" : `sin repasar hace ${p.dias} días`;
    div.textContent = `${p.tema.nombre} — ${texto}`;
    cont.appendChild(div);
  });
}

// ---------- IA: descarga de contexto ----------

async function descargarArchivosParaIA(archivos, limite = 4) {
  const seleccion = archivos.slice(-limite); // los más recientes
  const resultados = [];
  for (const f of seleccion) {
    try {
      const { base64, mediaType } = await GitHubStorage.fetchFileRaw(f.path);
      resultados.push({ nombre: f.nombre, base64, mediaType });
    } catch (e) {
      console.warn("No se pudo descargar", f.path, e);
    }
  }
  return resultados;
}

async function generarExamen() {
  if (!ClaudeAI.isReady()) { alert("Falta la API key de Anthropic en la configuración."); return; }
  const { tema } = buscarTema(estado.temaActivoId);
  const btn = document.getElementById("btn-generar-examen");
  btn.textContent = "Generando examen...";
  btn.disabled = true;
  try {
    const esquemas = await descargarArchivosParaIA(tema.archivos.esquemas);
    const examenesPrevios = await descargarArchivosParaIA(tema.archivos.examenes, 2);
    if (esquemas.length === 0 && examenesPrevios.length === 0) {
      alert("Sube al menos un esquema o examen a este tema para poder generar el repaso.");
      return;
    }
    const texto = await ClaudeAI.generarExamenRepaso(tema.nombre, esquemas, examenesPrevios);
    abrirModal(`<h2 style="margin-bottom:14px;">Examen de repaso — ${escapeHtml(tema.nombre)}</h2>
      <div style="white-space:pre-wrap; font-size:0.9rem; line-height:1.6;">${escapeHtml(texto)}</div>
      <button class="btn btn-ghost" id="cerrar-examen" style="margin-top:18px;">Cerrar</button>`);
    document.getElementById("cerrar-examen").addEventListener("click", cerrarModal);
  } catch (e) {
    alert(e.message);
  } finally {
    btn.textContent = "Generar examen rápido de repaso";
    btn.disabled = false;
  }
}

// ---------- Chat ----------

async function enviarMensajeChat() {
  if (!ClaudeAI.isReady()) { alert("Falta la API key de Anthropic en la configuración."); return; }
  const input = document.getElementById("chat-input");
  const pregunta = input.value.trim();
  if (!pregunta || !estado.temaActivoId) return;
  input.value = "";
  agregarMensajeChat("user", pregunta);

  const { tema } = buscarTema(estado.temaActivoId);
  const pensando = agregarMensajeChat("assistant", "Pensando...");
  try {
    const contexto = await descargarArchivosParaIA([
      ...tema.archivos.esquemas,
      ...tema.archivos.ejercicios.slice(-2),
    ]);
    const respuesta = await ClaudeAI.chatSobreTema(pregunta, tema.nombre, contexto, estado.historialChat);
    pensando.textContent = respuesta;
    estado.historialChat.push({ role: "user", content: pregunta });
    estado.historialChat.push({ role: "assistant", content: respuesta });
  } catch (e) {
    pensando.textContent = "Error: " + e.message;
  }
}

function agregarMensajeChat(rol, texto) {
  const log = document.getElementById("chat-log");
  const div = document.createElement("div");
  div.className = "chat-msg " + (rol === "user" ? "chat-user" : "chat-assistant");
  div.textContent = texto;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

// ---------- Modal genérico ----------

function abrirModal(html) {
  document.getElementById("modal-content").innerHTML = html;
  document.getElementById("modal-overlay").classList.remove("hidden");
}
function cerrarModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
}
document.getElementById("modal-overlay")?.addEventListener("click", (e) => {
  if (e.target.id === "modal-overlay") cerrarModal();
});

// ---------- Utilidades ----------

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
