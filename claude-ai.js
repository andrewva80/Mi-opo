/**
 * claude-ai.js
 * Llama directamente a la API de Anthropic desde el navegador con la
 * clave del propio usuario. Requiere el header especial que permite
 * peticiones desde el navegador (la clave nunca pasa por ningún servidor
 * intermedio, solo viaja de este iPad/navegador a Anthropic).
 */

const ClaudeAI = (() => {
  let apiKey = null;
  const MODEL = "claude-sonnet-4-6";

  function init(key) {
    apiKey = key;
  }

  function isReady() {
    return !!apiKey;
  }

  async function callClaude(messages, system) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system,
        messages,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Error de la API de Claude (${res.status})`);
    }
    const data = await res.json();
    return data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }

  // Convierte una lista de archivos (ya descargados como base64) en bloques
  // de contenido que la API entiende (document para PDF, image para fotos)
  function filesToBlocks(files) {
    return files.map((f) => {
      if (f.mediaType === "application/pdf") {
        return {
          type: "document",
          source: { type: "base64", media_type: f.mediaType, data: f.base64 },
        };
      }
      if (f.mediaType.startsWith("image/")) {
        return {
          type: "image",
          source: { type: "base64", media_type: f.mediaType, data: f.base64 },
        };
      }
      return { type: "text", text: `[Archivo no previsualizable: ${f.nombre}]` };
    });
  }

  const SYSTEM_BASE = `Eres un preparador de oposiciones a bombero en España (Comunidad Valenciana).
Ayudas al opositor con su temario de IVASPE, legislación, geografía y procedimientos.
Sé claro, directo y pedagógico. Cuando corrijas ejercicios o exámenes, señala exactamente
qué falló y por qué, sin dar rodeos. Responde en español.`;

  async function chatSobreTema(pregunta, temaNombre, archivosContexto, historial) {
    const blocks = filesToBlocks(archivosContexto);
    const userContent = [
      ...blocks,
      { type: "text", text: `Tema: ${temaNombre}\n\nPregunta del opositor: ${pregunta}` },
    ];
    const messages = [...historial, { role: "user", content: userContent }];
    return callClaude(messages, SYSTEM_BASE);
  }

  async function generarExamenRepaso(temaNombre, archivosEsquemas, archivosExamenesPrevios) {
    const blocks = [
      ...filesToBlocks(archivosEsquemas),
      ...filesToBlocks(archivosExamenesPrevios),
    ];
    const instruccion = `Basándote en el material adjunto del tema "${temaNombre}" (esquemas/resúmenes
y, si los hay, exámenes anteriores), genera un examen rápido de repaso de 8 preguntas tipo test
(4 opciones, una correcta). Al final incluye las respuestas correctas con una explicación breve
de una línea por pregunta. Numera las preguntas.`;
    const messages = [
      { role: "user", content: [...blocks, { type: "text", text: instruccion }] },
    ];
    return callClaude(messages, SYSTEM_BASE);
  }

  async function revisarErrores(temaNombre, archivosEjerciciosCorregidos) {
    const blocks = filesToBlocks(archivosEjerciciosCorregidos);
    const instruccion = `Revisa estos ejercicios/exámenes ya hechos del tema "${temaNombre}".
Identifica patrones de error (no listes cada fallo suelto, agrúpalos por tipo de confusión),
y dame 3-5 puntos concretos en los que debería repasar antes del examen.`;
    const messages = [
      { role: "user", content: [...blocks, { type: "text", text: instruccion }] },
    ];
    return callClaude(messages, SYSTEM_BASE);
  }

  return { init, isReady, chatSobreTema, generarExamenRepaso, revisarErrores };
})();
