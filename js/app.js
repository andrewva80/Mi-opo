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
  chatSha: null,
  filtroTemas: "",
  carpetasCerradas: new Set(), // guarda "bloque::nombreCarpeta"
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

  document.getElementById("open-comparar").addEventListener("click", abrirModalComparar);
  document.getElementById("open-progreso").addEventListener("click", abrirModalProgreso);

  document.getElementById("open-settings").addEventListener("click", () => {
    if (confirm("¿Borrar la configuración guardada en este dispositivo y volver a introducirla?")) {
      localStorage.removeItem("parteEstudio.config");
      location.reload();
    }
  });

  document.getElementById("add-tema").addEventListener("click", abrirModalNuevoTema);

  document.getElementById("buscador-temas").addEventListener("input", (e) => {
    estado.filtroTemas = e.target.value.trim().toLowerCase();
    renderSidebar();
  });

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
  document.getElementById("btn-generar-resumen").addEventListener("click", generarResumenTema);
  document.getElementById("btn-revisar-errores").addEventListener("click", revisarErroresTema);

  document.getElementById("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    enviarMensajeChat();
  });

  document.getElementById("btn-vaciar-chat").addEventListener("click", vaciarHistorialChat);
}

// ---------- Sidebar / temas ----------

function todosTemasBloque(bloque) {
  return estado.temario[bloque] || [];
}

function renderSidebar() {
  const listaComun = document.getElementById("lista-comun");
  const listaEspecifico = document.getElementById("lista-especifico");
  renderListaBloque(listaComun, "comun");
  renderListaBloque(listaEspecifico, estado.oposicionActiva);
  listaComun.closest(".block-group").classList.toggle("hidden", listaComun.children.length === 0);
  listaEspecifico.closest(".block-group").classList.toggle("hidden", listaEspecifico.children.length === 0);
}

// Agrupa los temas de un bloque por carpeta (los que no tienen carpeta van sueltos arriba)
function agruparPorCarpeta(temas) {
  const grupos = new Map(); // carpeta (o null) -> [temas]
  temas.forEach((t) => {
    const key = t.carpeta || null;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(t);
  });
  return grupos;
}

function renderListaBloque(ul, bloque) {
  ul.innerHTML = "";
  const temas = todosTemasBloque(bloque);
  const filtro = estado.filtroTemas;

  if (filtro) {
    const coincidencias = temas.filter((t) => t.nombre.toLowerCase().includes(filtro));
    if (coincidencias.length === 0) return; // no muestra nada de este bloque si no hay resultados
    coincidencias.forEach((tema) => ul.appendChild(renderTemaItem(tema, bloque)));
    return;
  }

  const grupos = agruparPorCarpeta(temas);

  // primero los temas sin carpeta
  (grupos.get(null) || []).forEach((tema) => ul.appendChild(renderTemaItem(tema, bloque)));

  // luego cada carpeta, como grupo plegable
  grupos.forEach((lista, carpeta) => {
    if (carpeta === null) return;
    const key = `${bloque}::${carpeta}`;
    const cerrada = estado.carpetasCerradas.has(key);

    const liFolder = document.createElement("li");
    liFolder.className = "folder-header";
    liFolder.innerHTML = `<span class="folder-arrow">${cerrada ? "▸" : "▾"}</span>
      <span style="flex:1">📁 ${escapeHtml(carpeta)}</span>
      <span class="folder-count">${lista.length}</span>`;
    liFolder.addEventListener("click", () => {
      if (cerrada) estado.carpetasCerradas.delete(key);
      else estado.carpetasCerradas.add(key);
      renderSidebar();
    });
    ul.appendChild(liFolder);

    if (!cerrada) {
      lista.forEach((tema) => ul.appendChild(renderTemaItem(tema, bloque, true)));
    }
  });
}

function diasDesde(fechaIso) {
  if (!fechaIso) return Infinity;
  return Math.floor((Date.now() - new Date(fechaIso).getTime()) / 86400000);
}

function renderTemaItem(tema, bloque, indentado = false) {
  const li = document.createElement("li");
  li.className = "tema-item" + (tema.id === estado.temaActivoId ? " active" : "") + (indentado ? " indentado" : "");
  const dias = diasDesde(tema.ultimaRevision);
  const flagClase = dias >= DIAS_URGENTE ? "overdue" : dias >= DIAS_AVISO ? "due" : "";
  li.innerHTML = `<span class="tema-flag ${flagClase}"></span>
    <span class="tema-nombre">${emojiTema(tema)} ${escapeHtml(tema.nombre)}</span>
    <span class="tema-controles">
      <button class="item-btn" data-accion="subir" title="Subir">▲</button>
      <button class="item-btn" data-accion="bajar" title="Bajar">▼</button>
      <button class="item-btn" data-accion="editar" title="Editar">✎</button>
    </span>`;
  li.querySelector(".tema-nombre").addEventListener("click", () => abrirTema(tema.id, bloque));
  li.querySelector('[data-accion="subir"]').addEventListener("click", (e) => {
    e.stopPropagation();
    moverTema(bloque, tema.id, -1);
  });
  li.querySelector('[data-accion="bajar"]').addEventListener("click", (e) => {
    e.stopPropagation();
    moverTema(bloque, tema.id, 1);
  });
  li.querySelector('[data-accion="editar"]').addEventListener("click", (e) => {
    e.stopPropagation();
    abrirModalEditarTema(tema.id, bloque);
  });
  return li;
}

async function moverTema(bloque, temaId, direccion) {
  const arr = estado.temario[bloque];
  const tema = arr.find((t) => t.id === temaId);
  if (!tema) return;
  const carpeta = tema.carpeta || null;
  const grupo = arr.filter((t) => (t.carpeta || null) === carpeta);
  const posEnGrupo = grupo.findIndex((t) => t.id === temaId);
  const nuevaPos = posEnGrupo + direccion;
  if (nuevaPos < 0 || nuevaPos >= grupo.length) return; // ya está en el extremo
  const otro = grupo[nuevaPos];
  const i1 = arr.findIndex((t) => t.id === tema.id);
  const i2 = arr.findIndex((t) => t.id === otro.id);
  [arr[i1], arr[i2]] = [arr[i2], arr[i1]];
  renderSidebar();
  setSyncStatus("guardando...");
  await guardarIndice(`Reordena temas en "${bloque}"`);
  setSyncStatus("sincronizado");
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
  renderSidebar();
  mostrarTemaView();
  cargarHistorialChat(id, bloque);
}

async function cargarHistorialChat(temaId, bloque) {
  const log = document.getElementById("chat-log");
  log.innerHTML = '<div class="chat-msg chat-assistant">Cargando conversación anterior...</div>';
  const mensajeInicial = "Pregúntame sobre este tema: puedo revisar tus fallos, explicarte algo del esquema, o hacerte un examen corto.";
  try {
    const { data, sha } = await GitHubStorage.readJsonFile(`data/chat/${bloque}/${temaId}.json`);
    if (estado.temaActivoId !== temaId) return; // el usuario ya cambió de tema mientras cargaba
    estado.chatSha = sha;
    estado.historialChat = (data && data.historial) || [];
    log.innerHTML = "";
    if (estado.historialChat.length === 0) {
      agregarMensajeChat("assistant", mensajeInicial);
    } else {
      estado.historialChat.forEach((m) => agregarMensajeChat(m.role === "user" ? "user" : "assistant", m.content));
    }
  } catch (e) {
    console.error(e);
    estado.historialChat = [];
    estado.chatSha = null;
    log.innerHTML = `<div class="chat-msg chat-assistant">${mensajeInicial}</div>`;
  }
}

async function guardarHistorialChat() {
  const { bloque } = buscarTema(estado.temaActivoId) || {};
  if (!bloque) return;
  try {
    const res = await GitHubStorage.writeJsonFile(
      `data/chat/${bloque}/${estado.temaActivoId}.json`,
      { historial: estado.historialChat },
      estado.chatSha,
      "Actualiza historial de chat"
    );
    estado.chatSha = res.content.sha;
  } catch (e) {
    console.warn("No se pudo guardar el historial de chat:", e);
  }
}

async function vaciarHistorialChat() {
  if (!estado.temaActivoId) return;
  if (!confirm("¿Vaciar el historial de este chat? No se puede deshacer.")) return;
  estado.historialChat = [];
  await guardarHistorialChat();
  document.getElementById("chat-log").innerHTML =
    '<div class="chat-msg chat-assistant">Historial vaciado. Pregúntame lo que necesites sobre este tema.</div>';
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

function carpetasExistentes(bloque) {
  const set = new Set();
  todosTemasBloque(bloque).forEach((t) => { if (t.carpeta) set.add(t.carpeta); });
  return [...set];
}

function datalistCarpetas(bloque, id) {
  return `<datalist id="${id}">${carpetasExistentes(bloque)
    .map((c) => `<option value="${escapeHtml(c)}">`)
    .join("")}</datalist>`;
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
    <label class="field"><span>Carpeta (opcional, para agrupar varios temas)</span>
      <input type="text" id="nuevo-tema-carpeta" list="lista-carpetas-nuevo" placeholder="p. ej. Leyes">
      ${datalistCarpetas("comun", "lista-carpetas-nuevo")}
    </label>
    <div style="display:flex; gap:10px; margin-top:16px;">
      <button class="btn btn-primary" id="confirmar-nuevo-tema">Crear tema</button>
      <button class="btn btn-ghost" id="cancelar-nuevo-tema">Cancelar</button>
    </div>
  `);
  const selectBloque = document.getElementById("nuevo-tema-bloque");
  const selectTipo = document.getElementById("nuevo-tema-tipo");
  const inputCarpeta = document.getElementById("nuevo-tema-carpeta");
  selectBloque.addEventListener("change", () => {
    selectTipo.innerHTML = opcionesTipo(selectBloque.value);
    document.getElementById("lista-carpetas-nuevo").outerHTML = datalistCarpetas(selectBloque.value, "lista-carpetas-nuevo");
  });

  document.getElementById("cancelar-nuevo-tema").addEventListener("click", cerrarModal);
  document.getElementById("confirmar-nuevo-tema").addEventListener("click", async () => {
    const nombre = val("nuevo-tema-nombre");
    const bloque = selectBloque.value;
    const tipo = selectTipo.value;
    const carpeta = inputCarpeta.value.trim() || null;
    if (!nombre) return;
    const tema = {
      id: "t_" + Date.now().toString(36),
      nombre,
      tipo,
      carpeta,
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

function abrirModalEditarTema(temaId, bloque) {
  const tema = todosTemasBloque(bloque).find((t) => t.id === temaId);
  if (!tema) return;
  const bloquesDisponibles = [
    { value: "comun", label: "Común (IVASPE / Legislación)" },
    { value: "alicante", label: "Alicante (geografía / procedimientos)" },
    { value: "valencia", label: "Valencia (geografía / procedimientos)" },
  ];
  abrirModal(`
    <h2 style="margin-bottom:14px;">Editar tema</h2>
    <label class="field"><span>Nombre del tema</span>
      <input type="text" id="editar-tema-nombre" value="${escapeHtml(tema.nombre)}">
    </label>
    <label class="field"><span>Bloque</span>
      <select id="editar-tema-bloque" style="${selectStyle()}">
        ${bloquesDisponibles.map((b) => `<option value="${b.value}">${b.label}</option>`).join("")}
      </select>
    </label>
    <label class="field"><span>Tipo (para el icono)</span>
      <select id="editar-tema-tipo" style="${selectStyle()}">
        ${opcionesTipo(bloque)}
      </select>
    </label>
    <label class="field"><span>Carpeta (vacío = sin carpeta, suelto en el lateral)</span>
      <input type="text" id="editar-tema-carpeta" list="lista-carpetas-editar" value="${escapeHtml(tema.carpeta || "")}" placeholder="p. ej. Leyes">
      ${datalistCarpetas(bloque, "lista-carpetas-editar")}
    </label>
    <p id="aviso-cambio-bloque" class="hidden" style="color:var(--amber); font-size:0.78rem; margin-top:-4px; margin-bottom:14px;">
      Si cambias de bloque, los archivos ya subidos se quedan donde están (siguen funcionando), pero el tema
      pasará a aparecer bajo el otro bloque en el lateral.
    </p>
    <div style="display:flex; gap:10px; margin-top:16px;">
      <button class="btn btn-primary" id="confirmar-editar-tema">Guardar cambios</button>
      <button class="btn btn-ghost" id="cancelar-editar-tema">Cancelar</button>
    </div>
  `);
  const selectBloque = document.getElementById("editar-tema-bloque");
  const selectTipo = document.getElementById("editar-tema-tipo");
  selectBloque.value = bloque;
  selectTipo.value = tema.tipo || tiposParaBloque(bloque)[0];

  selectBloque.addEventListener("change", () => {
    selectTipo.innerHTML = opcionesTipo(selectBloque.value);
    document.getElementById("lista-carpetas-editar").outerHTML = datalistCarpetas(selectBloque.value, "lista-carpetas-editar");
    document.getElementById("aviso-cambio-bloque").classList.toggle("hidden", selectBloque.value === bloque);
  });

  document.getElementById("cancelar-editar-tema").addEventListener("click", cerrarModal);
  document.getElementById("confirmar-editar-tema").addEventListener("click", async () => {
    const nombre = val("editar-tema-nombre");
    if (!nombre) return;
    const nuevoBloque = selectBloque.value;
    tema.nombre = nombre;
    tema.tipo = document.getElementById("editar-tema-tipo").value;
    tema.carpeta = document.getElementById("editar-tema-carpeta").value.trim() || null;

    if (nuevoBloque !== bloque) {
      estado.temario[bloque] = estado.temario[bloque].filter((t) => t.id !== tema.id);
      estado.temario[nuevoBloque] = estado.temario[nuevoBloque] || [];
      estado.temario[nuevoBloque].push(tema);
    }

    cerrarModal();
    setSyncStatus("guardando...");
    await guardarIndice(`Edita tema "${nombre}"`);
    setSyncStatus("sincronizado");
    renderSidebar();
    if (estado.temaActivoId === temaId) mostrarTemaView();
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
      if (!base64) {
        console.warn(`${f.nombre} llegó vacío, se descarta`);
        continue;
      }
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

async function generarResumenTema() {
  if (!ClaudeAI.isReady()) { alert("Falta la API key de Anthropic en la configuración."); return; }
  const { tema, bloque } = buscarTema(estado.temaActivoId);
  const btn = document.getElementById("btn-generar-resumen");
  const textoOriginalBtn = btn.textContent;
  btn.textContent = "Generando resumen...";
  btn.disabled = true;
  try {
    const esquemas = await descargarArchivosParaIA(tema.archivos.esquemas);
    const ejercicios = await descargarArchivosParaIA(tema.archivos.ejercicios, 2);
    if (esquemas.length === 0 && ejercicios.length === 0) {
      alert("Sube al menos un esquema o ejercicio a este tema para poder generar el resumen.");
      return;
    }
    const texto = await ClaudeAI.generarResumen(tema.nombre, esquemas, ejercicios);
    abrirModal(`
      <h2 style="margin-bottom:14px;">Resumen — ${escapeHtml(tema.nombre)}</h2>
      <div style="white-space:pre-wrap; font-size:0.9rem; line-height:1.6; max-height:50vh; overflow-y:auto; margin-bottom:16px; background:var(--ink); border-radius:6px; padding:12px;">${escapeHtml(texto)}</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button class="btn btn-primary" id="guardar-resumen">Guardar como archivo en Esquemas</button>
        <button class="btn btn-ghost" id="cerrar-resumen">Cerrar sin guardar</button>
      </div>
    `);
    document.getElementById("cerrar-resumen").addEventListener("click", cerrarModal);
    document.getElementById("guardar-resumen").addEventListener("click", async (e) => {
      const btnGuardar = e.currentTarget;
      btnGuardar.textContent = "Guardando...";
      btnGuardar.disabled = true;
      try {
        const nombreArchivo = `Resumen - ${tema.nombre}.md`;
        const meta = await GitHubStorage.uploadTextFile(bloque, tema.id, "esquemas", nombreArchivo, texto);
        tema.archivos.esquemas.push(meta);
        setSyncStatus("guardando...");
        await guardarIndice(`Añade resumen generado a "${tema.nombre}"`);
        setSyncStatus("sincronizado");
        cerrarModal();
        if (estado.categoriaActiva === "esquemas") renderFileList("esquemas");
      } catch (err) {
        alert(err.message);
        btnGuardar.textContent = "Guardar como archivo en Esquemas";
        btnGuardar.disabled = false;
      }
    });
  } catch (e) {
    alert(e.message);
  } finally {
    btn.textContent = textoOriginalBtn;
    btn.disabled = false;
  }
}

async function revisarErroresTema() {
  if (!ClaudeAI.isReady()) { alert("Falta la API key de Anthropic en la configuración."); return; }
  const { tema } = buscarTema(estado.temaActivoId);
  const btn = document.getElementById("btn-revisar-errores");
  const textoOriginalBtn = btn.textContent;
  btn.textContent = "Revisando...";
  btn.disabled = true;
  try {
    const ejercicios = await descargarArchivosParaIA(tema.archivos.ejercicios, 6);
    const examenes = await descargarArchivosParaIA(tema.archivos.examenes, 3);
    const material = [...ejercicios, ...examenes];
    if (material.length === 0) {
      alert("Sube al menos un ejercicio o examen ya corregido a este tema para poder revisar tus errores.");
      return;
    }
    const texto = await ClaudeAI.revisarErrores(tema.nombre, material);
    abrirModal(`
      <h2 style="margin-bottom:14px;">En qué sueles fallar — ${escapeHtml(tema.nombre)}</h2>
      <div style="white-space:pre-wrap; font-size:0.9rem; line-height:1.6; max-height:50vh; overflow-y:auto; margin-bottom:16px; background:var(--ink); border-radius:6px; padding:12px;">${escapeHtml(texto)}</div>
      <button class="btn btn-ghost" id="cerrar-errores">Cerrar</button>
    `);
    document.getElementById("cerrar-errores").addEventListener("click", cerrarModal);
  } catch (e) {
    alert(e.message);
  } finally {
    btn.textContent = textoOriginalBtn;
    btn.disabled = false;
  }
}

function contarArchivos(tema) {
  return (
    (tema.archivos.esquemas?.length || 0) +
    (tema.archivos.ejercicios?.length || 0) +
    (tema.archivos.examenes?.length || 0)
  );
}

function abrirModalProgreso() {
  const bloques = ["comun", "alicante", "valencia"];
  const nombreBloque = {
    comun: "Común (IVASPE / Legislación)",
    alicante: "Alicante (geografía / procedimientos)",
    valencia: "Valencia (geografía / procedimientos)",
  };
  const pct = (n, total) => (total === 0 ? 0 : Math.round((n / total) * 100));

  let totalTemas = 0, totalRepasados = 0, totalPendientes = 0, totalArchivos = 0;
  const statsPorBloque = {};
  const atrasados = [];

  bloques.forEach((bloque) => {
    const temas = todosTemasBloque(bloque);
    let repasados = 0, pendientes = 0, archivos = 0;
    temas.forEach((tema) => {
      const dias = diasDesde(tema.ultimaRevision);
      if (tema.ultimaRevision) repasados++;
      if (dias >= DIAS_AVISO) {
        pendientes++;
        atrasados.push({ tema, dias, bloque });
      }
      archivos += contarArchivos(tema);
    });
    statsPorBloque[bloque] = { total: temas.length, repasados, pendientes, archivos };
    totalTemas += temas.length;
    totalRepasados += repasados;
    totalPendientes += pendientes;
    totalArchivos += archivos;
  });

  atrasados.sort((a, b) => b.dias - a.dias);

  const celda = (contenido, alinear = "left") =>
    `<td style="padding:7px 10px 7px 0; border-bottom:1px solid var(--line); text-align:${alinear};">${contenido}</td>`;

  const filasBloque = bloques
    .filter((b) => statsPorBloque[b].total > 0)
    .map((b) => {
      const s = statsPorBloque[b];
      return `<tr>
        ${celda(nombreBloque[b])}
        ${celda(s.total, "center")}
        ${celda(pct(s.repasados, s.total) + "%", "center")}
        ${celda(s.pendientes, "center")}
        ${celda(s.archivos, "center")}
      </tr>`;
    })
    .join("");

  const listaAtrasados =
    atrasados.length === 0
      ? '<p style="color:rgba(241,237,228,0.5); font-size:0.85rem;">Nada atrasado, vas al día 🎉</p>'
      : `<ul style="list-style:none; padding:0; margin:0; max-height:220px; overflow-y:auto;">
          ${atrasados
            .map(
              (a) => `<li style="display:flex; justify-content:space-between; gap:10px; font-size:0.85rem; padding:7px 0; border-bottom:1px solid var(--line);">
                <span>${emojiTema(a.tema)} ${escapeHtml(a.tema.nombre)}</span>
                <span style="flex-shrink:0; color:${a.dias >= DIAS_URGENTE ? "#d98071" : "var(--amber)"};">${a.dias === Infinity ? "nunca repasado" : a.dias + " días"}</span>
              </li>`
            )
            .join("")}
        </ul>`;

  abrirModal(`
    <h2 style="margin-bottom:6px;">📊 Progreso general</h2>
    <p style="color:rgba(241,237,228,0.55); font-size:0.8rem; margin-bottom:18px;">
      ${totalTemas} temas en total · ${pct(totalRepasados, totalTemas)}% repasados alguna vez · ${totalPendientes} pendientes · ${totalArchivos} archivos subidos
    </p>

    <table style="width:100%; border-collapse:collapse; font-size:0.85rem; margin-bottom:24px;">
      <thead>
        <tr style="text-align:left; color:rgba(241,237,228,0.5); font-size:0.72rem;">
          <th style="padding-bottom:8px; font-weight:500;">Bloque</th>
          <th style="padding-bottom:8px; font-weight:500; text-align:center;">Temas</th>
          <th style="padding-bottom:8px; font-weight:500; text-align:center;">% repasado</th>
          <th style="padding-bottom:8px; font-weight:500; text-align:center;">Atrasados</th>
          <th style="padding-bottom:8px; font-weight:500; text-align:center;">Archivos</th>
        </tr>
      </thead>
      <tbody>${filasBloque || `<tr>${celda("Todavía no hay temas creados.")}</tr>`}</tbody>
    </table>

    <h3 style="font-size:0.95rem; margin-bottom:10px;">Más atrasados</h3>
    ${listaAtrasados}

    <button class="btn btn-ghost" id="cerrar-progreso" style="margin-top:20px;">Cerrar</button>
  `);
  document.getElementById("cerrar-progreso").addEventListener("click", cerrarModal);
}

function opcionesTemasParaSelect() {
  const bloques = [
    { key: "comun", label: "Común" },
    { key: "alicante", label: "Alicante" },
    { key: "valencia", label: "Valencia" },
  ];
  return bloques
    .map((b) => {
      const temas = todosTemasBloque(b.key);
      if (temas.length === 0) return "";
      const opciones = temas
        .map((t) => `<option value="${b.key}::${t.id}">${emojiTema(t)} ${escapeHtml(t.nombre)}</option>`)
        .join("");
      return `<optgroup label="${b.label}">${opciones}</optgroup>`;
    })
    .join("");
}

function abrirModalComparar() {
  const opciones = opcionesTemasParaSelect();
  if (!opciones) {
    alert("Crea al menos dos temas antes de poder compararlos.");
    return;
  }
  abrirModal(`
    <h2 style="margin-bottom:14px;">🆚 Comparar dos temas</h2>
    <p style="color:rgba(241,237,228,0.55); font-size:0.82rem; margin-bottom:16px;">
      Útil cuando dos temas comparten tablas o datos parecidos (plazos, cifras...) y quieres ver
      claramente qué es igual y qué cambia entre ambos.
    </p>
    <label class="field"><span>Primer tema</span>
      <select id="comparar-tema-a" style="${selectStyle()}">${opciones}</select>
    </label>
    <label class="field"><span>Segundo tema</span>
      <select id="comparar-tema-b" style="${selectStyle()}">${opciones}</select>
    </label>
    <div style="display:flex; gap:10px; margin-top:16px;">
      <button class="btn btn-primary" id="confirmar-comparar">Comparar</button>
      <button class="btn btn-ghost" id="cancelar-comparar">Cancelar</button>
    </div>
  `);
  document.getElementById("cancelar-comparar").addEventListener("click", cerrarModal);
  document.getElementById("confirmar-comparar").addEventListener("click", ejecutarComparacion);
}

async function ejecutarComparacion() {
  if (!ClaudeAI.isReady()) { alert("Falta la API key de Anthropic en la configuración."); return; }
  const valA = document.getElementById("comparar-tema-a").value;
  const valB = document.getElementById("comparar-tema-b").value;
  if (valA === valB) { alert("Elige dos temas distintos."); return; }

  const [bloqueA, idA] = valA.split("::");
  const [bloqueB, idB] = valB.split("::");
  const temaA = todosTemasBloque(bloqueA).find((t) => t.id === idA);
  const temaB = todosTemasBloque(bloqueB).find((t) => t.id === idB);

  const btn = document.getElementById("confirmar-comparar");
  const textoOriginal = btn.textContent;
  btn.textContent = "Comparando...";
  btn.disabled = true;
  try {
    const archivosA = await descargarArchivosParaIA([...temaA.archivos.esquemas, ...temaA.archivos.ejercicios], 3);
    const archivosB = await descargarArchivosParaIA([...temaB.archivos.esquemas, ...temaB.archivos.ejercicios], 3);
    if (archivosA.length === 0 || archivosB.length === 0) {
      alert("Ambos temas necesitan al menos un archivo subido (esquema o ejercicio) para poder compararlos.");
      return;
    }
    const texto = await ClaudeAI.compararTemas(temaA.nombre, archivosA, temaB.nombre, archivosB);
    abrirModal(`
      <h2 style="margin-bottom:14px;">🆚 ${escapeHtml(temaA.nombre)} — vs — ${escapeHtml(temaB.nombre)}</h2>
      <div style="white-space:pre-wrap; font-size:0.9rem; line-height:1.6; max-height:55vh; overflow-y:auto; background:var(--ink); border-radius:6px; padding:12px; margin-bottom:16px;">${escapeHtml(texto)}</div>
      <button class="btn btn-ghost" id="cerrar-comparacion">Cerrar</button>
    `);
    document.getElementById("cerrar-comparacion").addEventListener("click", cerrarModal);
  } catch (e) {
    alert(e.message);
    btn.textContent = textoOriginal;
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
    await guardarHistorialChat();
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
