# Parte de Estudio — Oposición Bombero (Alicante / Valencia)

App de una sola página (sin build, sin servidor) para organizar tu temario por
temas → Esquemas/Resúmenes, Ejercicios y Exámenes, cambiar entre Alicante y
Valencia manteniendo el temario común (IVASPE + Legislación), y pedirle ayuda
a Claude para repasar tus fallos o generarte un examen rápido.

Funciona desde el iPad sin instalar nada: es una web normal en Safari.

## Cómo guarda tus datos

No hay base de datos ni servidor propios. Todo se guarda **en tu propio
repositorio de GitHub**, usando la API de Contents:

- `data/index.json` → la lista de temas, en qué bloque están y cuándo los
  repasaste por última vez.
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

## 4. Consigue tu API key de Anthropic (para la ayuda de Claude)

1. Entra en [console.anthropic.com](https://console.anthropic.com) → API
   Keys → Create key.
2. Cópiala (empieza por `sk-ant-...`). El uso del chat y la generación de
   exámenes consume crédito de esa cuenta (es de pago, pero el gasto de un
   uso personal de repaso es bajo).

**Importante:** como esta clave viaja desde el navegador directamente a
Anthropic (para poder alojar la app gratis en GitHub Pages sin backend
propio), no compartas el enlace de tu web con nadie más mientras tengas la
clave puesta — es solo para tu uso personal, tal como está pensada la app.

## 5. Primer arranque

1. Abre tu URL de GitHub Pages en el iPad.
2. Rellena usuario/repo/token de GitHub y tu API key de Anthropic.
3. Pulsa "Guardar y entrar". La app comprobará la conexión con el repo.
4. Elige Alicante o Valencia arriba, crea tu primer tema con "+ Nuevo tema"
   y empieza a subir material.

## Cómo funciona el repaso

- Cada tema guarda la fecha del último "Marcar como repasado hoy".
- Si pasan 10 días sin repasar un tema, aparece un aviso ámbar en el panel
  derecho; a partir de 20 días, se marca como urgente. Ajustable en
  `js/app.js` (constantes `DIAS_AVISO` y `DIAS_URGENTE`).
- "Generar examen rápido de repaso" manda tus esquemas (y exámenes previos
  si los hay) a Claude, que te devuelve un test de 8 preguntas con
  respuestas y explicación.
- El chat del panel derecho ve el material del tema abierto (esquemas y
  últimos ejercicios), así que puedes preguntarle dudas o pedirle que
  revise en qué sueles fallar.

## Límites que conviene conocer

- GitHub permite hasta 100 MB por archivo vía API (en la práctica, sube
  fotos y PDF normales sin problema).
- Cada subida de archivo genera un commit en tu repo — es intencionado,
  así tienes historial completo de tu material.
- No hay límite de temas ni de bloques: si más adelante te presentas a otra
  oposición con temario propio, puedes duplicar la lógica de "alicante" /
  "valencia" añadiendo un tercer bloque en `data/index.json` y un botón más
  en el switch de `index.html`.
