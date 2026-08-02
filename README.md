# Escuela de Líderes — Comunidad Cristiana Agua Viva Surco

Versión con **base de datos compartida en tiempo real** (Supabase), lista para
desplegar con **GitHub + Vercel**. Todos los dispositivos (administrador,
monitores, alumnos) ven y editan los mismos datos al instante.

## Archivos del proyecto

```
index.html      → página principal (no tocar)
style.css       → estilos
app.js          → lógica de la app (no tocar salvo que sepas JS)
qrcode.js       → librería para generar códigos QR
jsQR.js         → librería para leer códigos QR con la cámara
config.js       → AQUÍ pegas tus credenciales de Supabase (único archivo a editar)
schema.sql      → script que crea las tablas en Supabase
```

---

## Paso 1 — Crear el proyecto en Supabase

1. Entra a https://supabase.com y crea una cuenta (puedes usar tu cuenta de GitHub).
2. Clic en **New project**. Elige un nombre (ej. `escuela-lideres-agua-viva`),
   una contraseña de base de datos (guárdala) y la región más cercana
   (ej. `South America (São Paulo)`).
3. Espera 1-2 minutos a que el proyecto termine de crearse.
4. En el menú lateral, ve a **SQL Editor** → **New query**.
5. Abre el archivo `schema.sql` de este proyecto, copia **todo** su contenido,
   pégalo en el editor y presiona **Run**. Esto crea las tablas, los permisos
   y los usuarios de prueba.
6. Ve a **Project Settings** (ícono de engranaje) → **API**.
   Copia dos valores:
   - **Project URL** (algo como `https://abcdefghij.supabase.co`)
   - **anon public** key (una clave larga que empieza con `eyJ...`)
7. Ve a **Project Settings** → **API** → sección **Realtime**, o simplemente
   confirma que el script ya activó la replicación (el `schema.sql` incluye
   las líneas `alter publication supabase_realtime add table ...`, así que
   no necesitas hacer nada extra).

## Paso 2 — Completar `config.js`

Abre `config.js` en este proyecto y reemplaza los valores de ejemplo:

```js
window.EDL_CONFIG = {
  SUPABASE_URL: "https://abcdefghij.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIs...tu-clave-completa"
};
```

Guarda el archivo. (Esta clave "anon" está diseñada para ser pública / vivir
en el navegador — no es una contraseña secreta de servidor).

## Paso 3 — Subir el proyecto a GitHub

Si no tienes Git configurado, instala Git y crea una cuenta en https://github.com.

Desde una terminal, dentro de la carpeta del proyecto:

```bash
git init
git add .
git commit -m "Escuela de Líderes - Agua Viva Surco"
```

Luego, en GitHub:
1. Crea un repositorio nuevo (botón **New**), por ejemplo `escuela-lideres-agua-viva`.
   No marques "Add a README" (ya tienes uno).
2. GitHub te mostrará comandos como estos — cópialos y ejecútalos en tu terminal:

```bash
git remote add origin https://github.com/TU-USUARIO/escuela-lideres-agua-viva.git
git branch -M main
git push -u origin main
```

*(Si prefieres no usar la terminal, también puedes arrastrar todos los
archivos de la carpeta directamente a la página de GitHub usando
"uploading an existing file" al crear el repositorio).*

## Paso 4 — Desplegar en Vercel

1. Entra a https://vercel.com y crea una cuenta (puedes usar "Continue with GitHub").
2. Clic en **Add New... → Project**.
3. Selecciona el repositorio `escuela-lideres-agua-viva` que acabas de subir.
4. Vercel detectará que es un sitio estático (sin framework) — no necesitas
   cambiar ninguna configuración de build. Clic en **Deploy**.
5. En 30-60 segundos tendrás una URL pública como
   `https://escuela-lideres-agua-viva.vercel.app` — compártela con tu equipo.

Cada vez que subas un cambio a GitHub (`git push`), Vercel vuelve a desplegar
automáticamente.

## Instalar como app en el celular

En Chrome (Android) o Safari (iPhone), abre la URL de Vercel y usa
**"Agregar a pantalla de inicio"**. Quedará como un ícono más, sin pasar por
las tiendas de aplicaciones.

---

## Usuarios de prueba (ya cargados por `schema.sql`)

| Rol         | Usuario (DNI) | Clave (celular) |
|-------------|---------------|------------------|
| Administrador | 10000001    | 900000001        |
| Monitor (Fundamentos de Liderazgo) | 20000001 | 988000001 |
| Monitor (Discipulado Avanzado)     | 20000002 | 988000002 |
| Alumno (Ana Torres)   | 30000001 | 977000001 |
| Alumno (Luis Quispe)  | 30000002 | 977000002 |

Puedes editarlos o eliminarlos desde la vista de Administrador una vez
dentro de la app.

---

## ⚠️ Nota importante sobre seguridad

Esta app **no usa un sistema de autenticación de sesiones reales**
(Supabase Auth); el ingreso por DNI/celular lo valida la propia app en el
navegador. Para que esto funcione, las reglas de acceso a la base de datos
(RLS) están abiertas: cualquiera que tenga la clave "anon" (visible en el
código del sitio, que es público de todas formas) podría, en teoría, leer o
modificar los datos directamente por la API de Supabase, sin pasar por la
pantalla de la app.

Para un grupo interno de iglesia esto suele ser un riesgo aceptable (es el
mismo nivel de exposición que ya tenía la versión anterior guardada solo en
el celular, solo que ahora los datos están en un solo lugar compartido). Si
más adelante quieres reforzarlo — por ejemplo, que un monitor **no pueda**
editar cursos que no le fueron asignados incluso manipulando la API
directamente — puedo ayudarte a añadir Supabase Auth con reglas de acceso
por fila (RLS) específicas por rol.

## ¿Qué gana esta versión frente a la anterior (solo local)?

- Todos los dispositivos ven los mismos cursos, alumnos y asistencia al instante.
- Un monitor puede escanear QR desde su celular y el administrador lo ve
  reflejado en su computadora sin recargar nada (gracias a Supabase Realtime).
- Los datos ya no dependen del navegador de un solo celular: viven en la
  nube y se puede hacer respaldo/exportación desde el panel de Supabase.
