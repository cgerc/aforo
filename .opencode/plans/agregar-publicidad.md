# Plan: Rollback del banner + sistema "Agregar publicidad" administrable con carrusel responsive

Estado: aprobado por el usuario en la conversación ("Sí, implementar"). Pendiente de que
el entorno permita edición (build mode) para tocar los archivos reales.

Decisiones del usuario (integradas):
- Clic en la publicidad dentro del carrusel -> llevar al mapa de la comuna (scroll al Leaflet `#mapa`).
- Dónde guardarla -> tabla NUEVA `publicidad` (Recomendado).
- Rotación/orden -> que aparezca PRIMERO la publicidad agregada recientemente (created_at desc; todas las activas rotan, la más reciente = primera diapositiva).

## Paso 1 - Rollback del banner decorativo en el carrusel (public/app.js)
- Eliminar la función `crearSlideBannerTalleres()` (aprox. L268, bloque de ~4166 chars, estilos #135650/#22B07D/#F1F6EF, CTA "Explorar talleres" / "Ver talleres cerca de ti").
- Eliminar `container.appendChild(crearSlideBannerTalleres());` (aprox. L338) dentro de `renderizarCarruselSuperior`.
- Restaurar en los slides de eventos: `idx === 0 ? 'opacity-100 z-10' : 'opacity-0 z-0'` (el primer evento real es la diapositiva activa).
- NO tocar `fetch('/api/eventos', { cache: 'no-store' ... })` en `cargarDatosInicio` (aprox. L654): ese fix de los 9 talleres se mantiene.
- Verificar con `node --check public/app.js`.

## Paso 2 - Migración idempotente (tabla publicidad)
Ejecutar UNA sola vez usando el Pool de `db.js`:
```sql
CREATE TABLE IF NOT EXISTS publicidad (
  id BIGSERIAL PRIMARY KEY,
  usuario_id BIGINT,
  titulo TEXT,
  imagen TEXT,          -- base64, igual que flyers de eventos
  enlace TEXT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## Paso 3 - Endpoints en server.js
- `GET /api/publicidad` -> público, solo `activo = true`, order `created_at desc` (reciente primero).
- `POST /api/publicidad` -> `requireAuth`; insert `{usuario_id: req.user.id, titulo, imagen, enlace}`.
- `DELETE /api/publicidad/:id` -> `requireAuth` + dueño; soft-delete (`activo = false`).
Reutilizar `requireAuth` de `./middleware/auth.js` y el pattern de `POST /api/eventos` (L248-320).

## Paso 4 - Carrusel web (public/app.js + index.html)
- `cargarDatosInicio`: además de `/api/eventos`, `fetch('/api/publicidad', { cache: 'no-store' })`.
- En `renderizarCarruselSuperior`: si hay publicidades activas, insertar sus slides ANTES de los eventos.
  - Slide = `<img class="absolute inset-0 w-full h-full object-cover" alt="Publicidad">` (mismas medidas responsive que los slides de eventos: carrusel-item absolute inset-0 w-full h-full + object-cover).
  - onClick -> `document.getElementById('mapa').scrollIntoView({ behavior: 'smooth' })` (mapa de la comuna).
  - Primera diapositiva = la más reciente (ya lo da order desc del API).

## Paso 5 - Portal de organizadores (public/dashboard.html)
- Nueva sección "📣 Agregar publicidad":
  - `<input type="file" accept="image/*">` con FileReader.readAsDataURL -> base64 (mismo patrón del flyer, ya presente en dashboard.html, p.ej. evento-profesional-archivo / convertirArchivoABase64).
  - Campo "Título" (opcional) + campo "Enlace" (opcional).
  - Botón "Publicar" -> `POST /api/publicidad` con `Authorization: Bearer <token>` (encabezadosSesion()).
- Bloque "Mis publicidades": miniaturas + botón "Desactivar" -> `DELETE /api/publicidad/:id`.

## Verificación final
- `node --check` de app.js y server.js.
- Probar GET /api/publicidad tras migración + recarga dura (Ctrl+Shift+R) para ver la imagen responsive en el carrusel.

## Notas de despliegue
- Requiere `git commit` + `push` para que Vercel despliegue server.js; migración SQL se corre 1 vez localmente.
- El texto del botón según el usuario: "Agregar publicidad" (exacto).
- Imágenes de publicidad: medidas responsive idénticas a los slides del carrusel (w-full h-full object-cover).
