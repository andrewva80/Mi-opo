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
  // Más rápido que el de arriba, pensado para tareas de organizar/estructurar
  // en vez de razonar en profundidad. Lo usamos solo donde tiene sentido
  // (mapas mentales), dejando el resto en el modelo normal ya probado.
  const MODEL_RAPIDO = "gemini-flash-lite-latest";

  function init(key) {
    apiKey = key;
  }
  function isReady() {
    return !!apiKey;
  }

  async function callGemini(contents, systemText, jsonMode = false, intentosRestantes = 3, modelo = MODEL) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;
    const generationConfig = {
      maxOutputTokens: 8192,
      // Sin esto, los modelos Gemini "piensan" por dentro antes de responder y ese
      // pensamiento resta del mismo límite de tokens que la respuesta final — con
      // límites normales, se puede comer casi todo el presupuesto y cortar la
      // respuesta real a las primeras frases. Lo desactivamos: aquí no hace falta
      // razonamiento complejo, solo organizar y redactar el material.
      thinkingConfig: { thinkingBudget: 0 },
    };
    if (jsonMode) generationConfig.responseMimeType = "application/json";
    const controlador = new AbortController();
    const limiteTiempo = setTimeout(() => controlador.abort(), 75000); // 75s como mucho por intento
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents,
          system_instruction: systemText ? { parts: [{ text: systemText }] } : undefined,
          generationConfig,
        }),
        signal: controlador.signal,
      });
    } catch (e) {
      const fueTimeout = e.name === "AbortError";
      // Fallo de red real (conexión cortada, "Load failed"...) o se ha quedado
      // colgada más de 75s sin responder. En ambos casos merece la pena reintentar.
      if (intentosRestantes > 1) {
        await new Promise((r) => setTimeout(r, 1200));
        return callGemini(contents, systemText, jsonMode, intentosRestantes - 1, modelo);
      }
      throw new Error(
        fueTimeout
          ? "Gemini ha tardado más de 75 segundos sin responder, varias veces seguidas. Con diapositivas muy pesadas puede pasar — prueba a desmarcar algún archivo, o inténtalo de nuevo en un rato."
          : "Fallo de conexión al mandar los archivos a Gemini. Si el tema tiene varios PDFs grandes, prueba a preguntar con menos material a la vez, o revisa tu wifi."
      );
    } finally {
      clearTimeout(limiteTiempo);
    }
    const data = await res.json();
    if (!res.ok) {
      // 429 = límite de peticiones alcanzado, 503 = servidores de Gemini saturados.
      // Ambos son temporales, así que merece la pena reintentar solo antes de rendirse.
      const esTemporal = res.status === 429 || res.status === 503;
      if (esTemporal && intentosRestantes > 1) {
        const espera = (4 - intentosRestantes) * 2000 + 1000; // 3s, 5s, 7s...
        await new Promise((r) => setTimeout(r, espera));
        return callGemini(contents, systemText, jsonMode, intentosRestantes - 1, modelo);
      }
      const mensaje = data?.error?.message || `Error de la API de Gemini (${res.status})`;
      throw new Error(
        esTemporal
          ? `${mensaje} Gemini está saturado ahora mismo; lo he reintentado varias veces sin suerte. Espera un minuto y vuelve a intentarlo.`
          : mensaje
      );
    }
    const candidato = data.candidates?.[0];
    if (!candidato) {
      const razon = data.promptFeedback?.blockReason;
      throw new Error(razon ? `Gemini bloqueó la respuesta (motivo: ${razon})` : "Gemini no devolvió ninguna respuesta.");
    }
    const texto = (candidato.content?.parts || [])
      .filter((p) => p.text)
      .map((p) => p.text)
      .join("\n");
    if (candidato.finishReason === "MAX_TOKENS") {
      return texto + "\n\n---\n*(Respuesta cortada por límite de longitud. Si falta algo importante, pídeselo de nuevo o divídelo en menos preguntas a la vez.)*";
    }
    return texto;
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
qué falló y por qué, sin dar rodeos. Responde en español.
IMPORTANTE: nunca uses notacion matematica en codigo ni formulas con simbolos especiales.
El texto se muestra tal cual, sin renderizar formulas, asi que escribe cifras y unidades en
texto normal y corriente: 40 por 30 centimetros, 110 grados C, 160 km por hora, etc.`;

  async function chatSobreTema(pregunta, temaNombre, archivosContexto, historial) {
    const blocks = filesToBlocks(archivosContexto);
    const userParts = [...blocks, { text: `Tema: ${temaNombre}\n\nPregunta del opositor: ${pregunta}` }];
    const contents = [...historialAGemini(historial), { role: "user", parts: userParts }];
    return callGemini(contents, SYSTEM_BASE);
  }

  async function generarExamenInteractivo(temaNombre, archivosEsquemas, archivosExamenesPrevios) {
    const blocks = [...filesToBlocks(archivosEsquemas), ...filesToBlocks(archivosExamenesPrevios)];
    const instruccion = `Basándote en el material adjunto del tema "${temaNombre}" (esquemas/resúmenes
y, si los hay, exámenes anteriores), genera un examen de repaso de exactamente 8 preguntas tipo test,
cada una con 4 opciones y una sola correcta.
Devuelve EXCLUSIVAMENTE un array JSON válido, sin texto antes ni después, con este formato exacto:
[{"pregunta": "texto de la pregunta", "opciones": ["opción A", "opción B", "opción C", "opción D"], "correcta": 0, "explicacion": "por qué es correcta, en una frase breve"}]
"correcta" es el índice (0 a 3) de la opción correcta dentro de "opciones".`;
    const contents = [{ role: "user", parts: [...blocks, { text: instruccion }] }];
    const texto = await callGemini(contents, SYSTEM_BASE, true);
    return parsearArrayJSON(texto, "No se pudo interpretar el examen generado. Prueba a generarlo de nuevo.");
  }

  async function generarFlashcards(temaNombre, archivosEsquemas) {
    const blocks = filesToBlocks(archivosEsquemas);
    const instruccion = `Basándote en el material adjunto del tema "${temaNombre}", genera exactamente 12 tarjetas de
repaso activo (estilo Anki/Quizlet) para memorizar los datos y conceptos clave: cifras, plazos, definiciones,
nombres, procedimientos concretos. Cada tarjeta tiene una cara con una pregunta o pie muy corto, y otra cara
con la respuesta concisa (una frase o un dato, no un párrafo).
Devuelve EXCLUSIVAMENTE un array JSON válido, sin texto antes ni después, con este formato exacto:
[{"frente": "pregunta o pie corto", "dorso": "respuesta concisa"}]`;
    const contents = [{ role: "user", parts: [...blocks, { text: instruccion }] }];
    const texto = await callGemini(contents, SYSTEM_BASE, true);
    return parsearArrayJSON(texto, "No se pudieron interpretar las tarjetas generadas. Prueba a generarlas de nuevo.");
  }

  function parsearArrayJSON(texto, mensajeError) {
    let limpio = texto.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "");
    let datos;
    try {
      datos = JSON.parse(limpio);
    } catch {
      throw new Error(mensajeError);
    }
    if (!Array.isArray(datos) || datos.length === 0) {
      throw new Error(mensajeError);
    }
    return datos;
  }

  async function generarMapaMental(temaNombre, archivosEsquemas, archivosEjercicios) {
    const blocks = [...filesToBlocks(archivosEsquemas), ...filesToBlocks(archivosEjercicios)];
    const instruccion = `Basándote en el material adjunto del tema "${temaNombre}", genera la estructura de un MAPA MENTAL en formato Markdown, pensado para renderizarse como diagrama interactivo (no para leerse como texto corrido).

Reglas estrictas de formato:
- La primera línea es un único "# ${temaNombre}" como nodo raíz.
- Debajo, usa "##" para las ramas principales (los bloques grandes del tema) y "###", "####" para subramas, tantos niveles como haga falta para reflejar bien la jerarquía real del contenido.
- IMPORTANTE: cubre TODOS los apartados y subapartados del material (todas las letras a), b), c)... y todos los puntos numerados), sin saltarte ninguno aunque parezca menor. Puedes resumir cada uno en pocas palabras, pero no puedes omitirlo por completo — la estructura debe reflejar el articulado entero, no una selección de "lo más importante".
- Cada nodo debe ser una frase muy corta o un concepto (pocas palabras), NUNCA un párrafo. Si un dato necesita más detalle, ponlo como una lista con "-" colgando de ese nodo, con líneas también cortas.
- Usa **negrita** en cifras, plazos o términos clave dentro de cada nodo.
- No repitas el nombre del tema dentro de las ramas.
- No añadas explicaciones fuera de la propia estructura (nada de "aquí tienes tu mapa"), empieza directamente con la línea "#".`;
    const contents = [{ role: "user", parts: [...blocks, { text: instruccion }] }];
    return callGemini(contents, SYSTEM_BASE, false, 3, MODEL_RAPIDO);
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

  return { init, isReady, chatSobreTema, generarExamenInteractivo, generarMapaMental, generarFlashcards, revisarErrores, compararTemas };
})();
