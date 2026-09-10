# Parte de Estudio — Oposición Bombero (Alicante / Valencia)

App de una sola página (sin build, sin servidor) para organizar tu temario por
temas → Esquemas/Resúmenes, Ejercicios y Exámenes, cambiar entre Alicante y
Valencia manteniendo el temario común (IVASPE + Legislación), y pedirle ayuda
a una IA (Gemini, de Google — gratis) para repasar tus fallos o generarte un
examen rápido.

Funciona desde el iPad sin instalar nada: es una web normal en Safari.

## Cómo guarda tus datos

No hay base de datos ni servidor propios. Todo se guarda **en tu propio
repositorio de GitHub**, usando la API de Contents:

- `data/index.json` → la lista de temas, en qué bloque están y cuándo los
  repasaste por última vez.
- `data/chat/<comun|alicante|valencia>/<temaId>.json` → el historial de la
  conversación con la IA en cada tema, para que se acuerde de lo hablado
  aunque cierres la app o cambies de dispositivo.
- `files/<comun|alicante|valencia>/<temaId>/<esquemas|ejercicios|examenes>/...`
  → los archivos que subas (fotos, PDF, documentos).

Así puedes entrar desde el iPad, el móvil o el portátil: solo necesitas
repetir la configuración inicial (mismo repo, mismo token) una vez en cada
dispositivo.

## 1. Crea el repositorio

1. En GitHub, crea un repositorio nuevo (puede ser privado), por ejemplo
   `parte-de-estudio`.
2. Sube estos archivos (`index.html`, `css/`, `js/`, este README) a la rama
   principal.

## 2. Activa GitHub Pages (para poder abrirlo como web)

1. En el repo: **Settings → Pages**.
2. En "Build and deployment", elige **Deploy from a branch**, rama `main`,
   carpeta `/ (root)`.
3. Guarda. En un par de minutos tendrás tu web en
   `https://<tu-usuario>.github.io/parte-de-estudio/`.

Nota: si el repo es privado, GitHub Pages con cuenta gratuita lo publica
igualmente en esa URL, pero la URL en sí no lleva contraseña — solo tú
sabrás la dirección. Si quieres protección real, necesitarías GitHub Pro/Team.

## 3. Crea el token de acceso personal (para subir archivos)

1. En GitHub: **Settings (de tu cuenta) → Developer settings → Personal
   access tokens → Fine-grained tokens → Generate new token**.
2. Dale un nombre, por ejemplo "parte-estudio-app".
3. En "Repository access", elige **Only select repositories** y marca el
   repo que creaste.
4. En "Permissions → Repository permissions", busca **Contents** y ponlo en
   **Read and write**.
5. Genera el token y cópialo (empieza por `github_pat_...`). Solo lo verás
   una vez.

Este token se queda guardado únicamente en el navegador de tu iPad
(`localStorage`), nunca se sube al repo ni pasa por ningún servidor de
terceros.

## 4. Consigue tu API key de Gemini (gratis, para la ayuda de la IA)

1. Entra en [aistudio.google.com](https://aistudio.google.com) con tu cuenta
   de Google → **Get API key** → **Create API key**.
2. Cópiala (empieza por `AIzaSy...`). No hace falta añadir tarjeta ni pagar
   nada — el nivel gratuito de Gemini permite de sobra el uso normal de
   repaso de esta app (miles de peticiones al día).
3. Si algún día ves un error de "límite alcanzado", solo tienes que esperar
   a que se reinicie la cuota (se renueva a medianoche, hora de EEUU) —
   nunca te van a cobrar nada mientras no actives la facturación tú mismo
   en la consola de Google.

**Importante:** como esta clave viaja desde el navegador directamente a
Google (para poder alojar la app gratis en GitHub Pages sin backend
propio), no compartas el enlace de tu web con nadie más mientras tengas la
clave puesta — es solo para tu uso personal, tal como está pensada la app.

## 5. Primer arranque

1. Abre tu URL de GitHub Pages en el iPad.
2. Rellena usuario/repo/token de GitHub y tu API key de Gemini.
3. Pulsa "Guardar y entrar". La app comprobará la conexión con el repo.
4. Elige Alicante o Valencia arriba, crea tu primer tema con "+ Nuevo tema"
   y empieza a subir material.

## Cómo funciona el repaso

- Cada tema guarda la fecha del último "Marcar como repasado hoy".
- Si pasan 10 días sin repasar un tema, aparece un aviso ámbar en el panel
  derecho; a partir de 20 días, se marca como urgente. Ajustable en
  `js/app.js` (constantes `DIAS_AVISO` y `DIAS_URGENTE`).
- "Generar examen rápido de repaso" manda tus esquemas (y exámenes previos
  si los hay) a la IA, que te devuelve un test de 8 preguntas con
  respuestas y explicación.
- El chat del panel derecho ve el material del tema abierto (esquemas y
  últimos ejercicios), así que puedes preguntarle dudas o pedirle que
  revise en qué sueles fallar.

## Límites que conviene conocer

- GitHub permite hasta 100 MB por archivo vía API (en la práctica, sube
  fotos y PDF normales sin problema).
- La API de Gemini admite hasta 100 MB por petición a la IA (chat, examen,
  resumen...), muy por encima de lo que necesitarás para apuntes normales.
  Si algún día juntas varios archivos muy pesados a la vez, la app avisa
  antes de intentarlo.
- Cada subida de archivo genera un commit en tu repo — es intencionado,
  así tienes historial completo de tu material.
- No hay límite de temas ni de bloques: si más adelante te presentas a otra
  oposición con temario propio, puedes duplicar la lógica de "alicante" /
  "valencia" añadiendo un tercer bloque en `data/index.json` y un botón más
  en el switch de `index.html`.
