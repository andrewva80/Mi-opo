/**
 * gemini-ai.js
 * Llama a la API gratuita de Gemini (Google) desde el navegador con la
 * clave del propio usuario, sacada gratis en aistudio.google.com.
 * Mantiene la misma "forma" de funciones que antes tenía claude-ai.js
 * (chatSobreTema, generarExamenRepaso, generarResumen, revisarErrores,
 * compararTemas) para no tener que tocar el resto de la app.
 */

const GeminiAI = (() => {
  let apiKey = null;
  // Alias "sin versión" de Google: siempre apunta al modelo Flash estable
  // más reciente, así no se rompe cuando Google retira una versión concreta.
  const MODEL = "gemini-flash-latest";

  function init(key) {
    apiKey = key;
  }
  function isReady() {
    return !!apiKey;
  }

  async function callGemini(contents, systemText) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents,
        system_instruction: systemText ? { parts: [{ text: systemText }] } : undefined,
        generationConfig: { maxOutputTokens: 2000 },
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || `Error de la API de Gemini (${res.status})`);
    }
    const candidato = data.candidates?.[0];
    if (!candidato) {
      const razon = data.promptFeedback?.blockReason;
      throw new Error(razon ? `Gemini bloqueó la respuesta (motivo: ${razon})` : "Gemini no devolvió ninguna respuesta.");
    }
    return (candidato.content?.parts || [])
      .filter((p) => p.text)
      .map((p) => p.text)
      .join("\n");
  }

  // Convierte el historial de chat {role:"user"|"assistant", content} al
  // formato de Gemini, donde el turno del asistente se llama "model".
  function historialAGemini(historial) {
    return historial.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  }

  // Convierte los archivos ya descargados (base64) en "parts" que Gemini entiende
  function filesToBlocks(files) {
    return files.map((f) => {
      if (f.mediaType === "application/pdf" || f.mediaType.startsWith("image/")) {
        return { inline_data: { mime_type: f.mediaType, data: f.base64 } };
      }
      return { text: `[Archivo no previsualizable: ${f.nombre}]` };
    });
  }

  const SYSTEM_BASE = `Eres un preparador de oposiciones a bombero en España (Comunidad Valenciana).
Ayudas al opositor con su temario de IVASPE, legislación, geografía y procedimientos.
Sé claro, directo y pedagógico. Cuando corrijas ejercicios o exámenes, señala exactamente
qué falló y por qué, sin dar rodeos. Responde en español.`;

  async function chatSobreTema(pregunta, temaNombre, archivosContexto, historial) {
    const blocks = filesToBlocks(archivosContexto);
    const userParts = [...blocks, { text: `Tema: ${temaNombre}\n\nPregunta del opositor: ${pregunta}` }];
    const contents = [...historialAGemini(historial), { role: "user", parts: userParts }];
    return callGemini(contents, SYSTEM_BASE);
  }

  async function generarExamenRepaso(temaNombre, archivosEsquemas, archivosExamenesPrevios) {
    const blocks = [...filesToBlocks(archivosEsquemas), ...filesToBlocks(archivosExamenesPrevios)];
    const instruccion = `Basándote en el material adjunto del tema "${temaNombre}" (esquemas/resúmenes
y, si los hay, exámenes anteriores), genera un examen rápido de repaso de 8 preguntas tipo test
(4 opciones, una correcta). Al final incluye las respuestas correctas con una explicación breve
de una línea por pregunta. Numera las preguntas.`;
    const contents = [{ role: "user", parts: [...blocks, { text: instruccion }] }];
    return callGemini(contents, SYSTEM_BASE);
  }

  async function generarResumen(temaNombre, archivosEsquemas, archivosEjercicios) {
    const blocks = [...filesToBlocks(archivosEsquemas), ...filesToBlocks(archivosEjercicios)];
    const instruccion = `Basándote en el material adjunto del tema "${temaNombre}", genera un resumen/esquema mental
claro y bien organizado en formato Markdown (títulos con #, subtítulos, listas, **negrita** en los conceptos clave).
Debe servir como material de repaso rápido antes del examen: prioriza estructura y jerarquía de ideas sobre prosa larga.
No añadas comentarios fuera del propio resumen (nada de "aquí tienes tu resumen"), empieza directamente con el título.`;
    const contents = [{ role: "user", parts: [...blocks, { text: instruccion }] }];
    return callGemini(contents, SYSTEM_BASE);
  }

  async function revisarErrores(temaNombre, archivosEjerciciosCorregidos) {
    const blocks = filesToBlocks(archivosEjerciciosCorregidos);
    const instruccion = `Revisa estos ejercicios/exámenes ya hechos del tema "${temaNombre}".
Identifica patrones de error (no listes cada fallo suelto, agrúpalos por tipo de confusión),
y dame 3-5 puntos concretos en los que debería repasar antes del examen.`;
    const contents = [{ role: "user", parts: [...blocks, { text: instruccion }] }];
    return callGemini(contents, SYSTEM_BASE);
  }

  async function compararTemas(nombreA, archivosA, nombreB, archivosB) {
    const bloques = [
      { text: `--- Material del tema "${nombreA}" ---` },
      ...filesToBlocks(archivosA),
      { text: `--- Material del tema "${nombreB}" ---` },
      ...filesToBlocks(archivosB),
    ];
    const instruccion = `Compara el material de estos dos temas de oposición. En formato de lista, señala:
1. Qué conceptos, tablas o datos son prácticamente iguales entre ambos (para no estudiarlos dos veces por separado).
2. Qué diferencias clave hay (cifras, plazos, nombres, procedimientos) que se puedan confundir fácilmente en el examen.
3. Un aviso final con los 2-3 puntos donde más riesgo hay de mezclar datos de un tema con el otro.
Sé conciso y ve al grano.`;
    const contents = [{ role: "user", parts: [...bloques, { text: instruccion }] }];
    return callGemini(contents, SYSTEM_BASE);
  }

  return { init, isReady, chatSobreTema, generarExamenRepaso, generarResumen, revisarErrores, compararTemas };
})();
