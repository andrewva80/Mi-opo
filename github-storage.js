/**
 * github-storage.js
 * Usa el repo del propio usuario como base de datos + almacén de archivos,
 * a través de la API de Contents de GitHub. Funciona desde cualquier
 * navegador (iPad incluido) porque son simples peticiones fetch.
 *
 * Estructura dentro del repo:
 *   /data/index.json                              -> metadatos de temas
 *   /files/<oposicion>/<temaId>/<categoria>/<nombre-archivo>
 *
 * <oposicion> es "comun", "alicante" o "valencia".
 */

const GitHubStorage = (() => {
  let config = null; // { owner, repo, token }

  function init(cfg) {
    config = cfg;
  }

  function isReady() {
    return !!(config && config.owner && config.repo && config.token);
  }

  async function apiRequest(path, options = {}) {
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
        ...(options.headers || {}),
      },
    });
    return res;
  }

  // Convierte un File del navegador a base64 puro (sin el prefijo data:)
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Lee el index.json. Si no existe todavía, devuelve una estructura vacía.
  async function readIndex() {
    const res = await apiRequest("data/index.json");
    if (res.status === 404) {
      return { temario: { comun: [], alicante: [], valencia: [] }, sha: null };
    }
    if (!res.ok) throw new Error(`No se pudo leer el índice (${res.status})`);
    const data = await res.json();
    const content = JSON.parse(decodeURIComponent(escape(atob(data.content))));
    return { temario: content, sha: data.sha };
  }

  // Escribe el index.json completo (con commit)
  async function writeIndex(temario, sha, message) {
    const body = {
      message: message || "Actualiza índice de temario",
      content: btoa(unescape(encodeURIComponent(JSON.stringify(temario, null, 2)))),
    };
    if (sha) body.sha = sha;
    const res = await apiRequest("data/index.json", {
      method: "PUT",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`No se pudo guardar el índice: ${err.message || res.status}`);
    }
    return res.json();
  }

  // Sube un archivo binario/documento al repo
  async function uploadFile(oposicion, temaId, categoria, file) {
    const base64 = await fileToBase64(file);
    const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const path = `files/${oposicion}/${temaId}/${categoria}/${safeName}`;
    const res = await apiRequest(path, {
      method: "PUT",
      body: JSON.stringify({
        message: `Sube ${file.name} a ${temaId}/${categoria}`,
        content: base64,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`No se pudo subir ${file.name}: ${err.message || res.status}`);
    }
    const data = await res.json();
    return {
      nombre: file.name,
      path,
      sha: data.content.sha,
      url: data.content.download_url,
      tipo: file.type,
      subidoEl: new Date().toISOString(),
    };
  }

  // Borra un archivo del repo
  async function deleteFile(path, sha) {
    const res = await apiRequest(path, {
      method: "DELETE",
      body: JSON.stringify({ message: `Elimina ${path}`, sha }),
    });
    if (!res.ok) throw new Error(`No se pudo borrar el archivo (${res.status})`);
  }

  // Descarga el contenido bruto de un archivo (para mandarlo a Claude)
  async function fetchFileRaw(path) {
    const res = await apiRequest(path);
    if (!res.ok) throw new Error(`No se pudo leer ${path}`);
    const data = await res.json();
    return { base64: data.content.replace(/\n/g, ""), mediaType: guessMediaType(data.name) };
  }

  function guessMediaType(filename) {
    const ext = filename.split(".").pop().toLowerCase();
    const map = {
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
    };
    return map[ext] || "application/octet-stream";
  }

  async function testConnection() {
    const res = await apiRequest("");
    return res.ok || res.status === 404; // 404 = repo vacío, aún válido
  }

  return {
    init,
    isReady,
    readIndex,
    writeIndex,
    uploadFile,
    deleteFile,
    fetchFileRaw,
    testConnection,
  };
})();
