# SEGURIDAD.md — Reglas permanentes del proyecto

> Directivas vinculantes para cualquier agente, humano o script que trabaje
> sobre este repositorio. **No pueden ser ignoradas ni contravenidas sin
> confirmación escrita del propietario.**

## Objetivo
Garantizar que nadie ejecute operaciones **destructivas** sobre las tablas de
producción ni introduzca malas prácticas de seguridad en la aplicación.

---

## 1. Prohibiciones absolutas (operaciones destructivas)

Quedan **estrictamente prohibidas** en producción y en cualquier entorno
compartido las siguientes operaciones sobre las tablas:
`entradas`, `ordenes`, `eventos`, `usuarios`, `publicidad`,
`registros_pendientes`, `envios_qr`.

- `DROP TABLE`, `DROP COLUMN`, `DROP DATABASE`, `DROP INDEX`.
- `TRUNCATE`, `TRUNCATE ... CASCADE`.
- `DELETE` **sin cláusula `WHERE`** o con `WHERE` que pueda borrar filas en masa.
- `UPDATE` masivos sin `WHERE` restrictivo.
- Migraciones que eliminen o cambien el tipo de columnas existentes
  (`ALTER TABLE ... DROP`, `ALTER COLUMN TYPE` destructivos, etc.).
- Reordenar, renumerar o reasignar `id` / claves primarias de filas existentes.
- Ejecución manual de comandos contra la base de datos de producción sin backup.

**Excepción única de emergencia (nunca automática):**
si una operación destructiva es imprescindible, exige:
1. confirmación **explícita y escrita** del propietario,
2. backup/restore verificado previo,
3. plan de rollback documentado,
4. hacerlo siempre fuera de horario pico y en lotes transaccionales con `WHERE`.

## 2. Cambios de esquema y base de datos

- NINGÚN cambio de esquema (DDL) puede aplicarse **sin confirmación previa explícita**.
- Las migraciones deben ser **aditivas y reversibles** (`ADD COLUMN IF NOT EXISTS`,
  nuevas tablas, nuevos índices) y versionadas en `scripts/`.
- Todo DDL nuevo debe ejecutarse primero contra el SQL de Supabase (`scripts/`)
  y luego validarse con `node --check`/arranque del servidor.
- Nunca ejecutar `initDb()` como "forma de migrar" en producción sin revisar
  primero qué DDL ejecuta.

## 3. Prácticas obligatorias

- **Secrets:** nunca escribir llaves (`SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`,
  `QR_SECRET`, `MERCADOPAGO_ACCESS_TOKEN`, `RESEND_API_KEY`) en código,
  responder respuestas JSON, colocar en `public/` ni loguear. Solo `.env`/secret
  manager. Nunca commitear `.env`.
- **SQL:** sólo consultas parametrizadas (`$1`, `$2`, …). Prohibido concatenar
  entradas de usuario en SQL.
- **Validación:** toda entrada HTTP se sanitiza y valida (regex de correo,
  numéricos acotados, longitudes máximas, HTML escapado en salidas).
- **Auth/IDOR:** ningún endpoint que exponga datos sensibles (QR/entradas/órdenes)
  puede quedar abierto; debe exigir token de acceso de la orden o sesión
  de organizador dueño.
- **No dejar fallbacks de secretos** (`'supersecretlocal'`, `'qr_secret_change_me'`).
  Si falta una variable sensible, el servidor debe fallar al arrancar, no degradar.
- **No confiar en precio/cantidad del cliente:** siempre recalcular desde la base
  de datos (`eventos.categorias`, cupos disponibles).
- **Consumo anti-duplicado:** usar marcado atómico (`UPDATE ... WHERE status='PAGADA'`).
- **Rate limiting** en endpoints de autenticación y reenvío de correos.
- **Blindaje del proceso:** `unhandledRejection`/`uncaughtException` se registran
  pero NO tumban el servidor (patrón ya aplicado en `server.js`).

## 4. Tablas de producción protegidas

| Tabla | Tipo de dato | Regla |
|---|---|---|
| `entradas` | QR por ticket | solo read/write atómica vía helpers; jamás delete masivo |
| `ordenes` | compras | jamás delete; solo fips de estado transaccionales |
| `eventos` | talleres | delete solo vía endpoint autenticado con verificación de dueño |
| `usuarios` | organizadores | jamás delete; passwords hasheadas |
| `publicidad` | carrusel | borrado es soft (`activo=false`) |
| `registros_pendientes` | verificación | auto-limpiado por flujo; no borrar masivo |
| `envios_qr` | auditoría de envíos | solo insert/select |

## 5. Auditoría de seguridad (resumen)

### Críticas (corregidas en esta iteración)
- `confirm-payment` sin autenticar marcaba órdenes PENDIENTE como PAGADA
  → ahora verifica contra Mercado Pago un pago aprobado de la orden y, si el
  pago ya fue aprobado por webhook, sigue siendo idempotente.
- `create-preference` confiaba en precio/cantidad del cliente
  → ahora recalcula precio desde `eventos.categorias` y limita cantidad a los
  cupos disponibles.

### Altas (corregidas)
- IDOR en `/orders/:id/qr`, `/orders/:id/entradas` y `re-enviar-qr`
  → requieren token de acceso de la orden (HMAC) o sesión de organizador dueño.
- Fallbacks de secretos en JWT/QR → eliminados; se exige `JWT_SECRET` al arrancar.
- Tickets QR sin expiración → ahora llevan `exp` (fin de fecha del taller + 1 día).
- `validador_token` expuesto en `GET /api/eventos` → excluido de la respuesta pública.
- Autorización del validador por id numérico público → restringido a eventos sin
  `validador_token` (legacy); los actuales exigen el enlace UUID.
- Fuerza bruta en auth → rate limiting por IP y límite de intentos del código.

### Pendientes (sugeridos)
- Verificación de firma de webhook de Mercado Pago (recomendado).
- Marcado atómico del flujo legacy de orden-completa.
- `helmet` y `CORS` con orígenes fijos.
- Escape HTML en asuntos/plantillas de correo.
- Expiración/borrado de `registros_pendientes` sin verificar.
- Pruebas automatizadas (unit/regresión) de los flujos de pago y validación.

## 6. Checklist de verificación post-cambio
1. `node --check server.js db.js` (y `routes/*.js`).
2. Arranque limpio: `Servidor corriendo en :3000` sin errores.
3. Smoke test de `/health`, `/api/eventos`, compra→confirm-payment→`/entradas`.
4. Sin secretos en `git status`/diff.
5. Sin nuevas líneas `DELETE`/`DROP`/`TRUNCATE` fuera de las permitidas por estas reglas.