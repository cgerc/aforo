-- ============================================================
-- ViveTicket · Guía de seguridad RLS (Supabase)
-- Tablas en uso: usuarios, eventos, registros_pendientes,
--                ordenes, entradas, envios_qr, publicidad
--
-- POR QUÉ ES SEGURO EN ESTA APP:
--   El frontend NO habla con Supabase directamente (no hay
--   supabase-js en public/). Todo pasa por server.js usando
--   SUPABASE_SERVICE_ROLE_KEY, que BYPASEA RLS siempre.
--   Por lo tanto, bloquear la anon key con RLS no rompe nada.
--
-- ORDEN RECOMENDADO: probar primero sobre 'publicidad'
-- (tabla no crítica), validar con §4, y luego el resto.
-- ============================================================

-- ============================================================
-- §1 DIAGNÓSTICO: tablas con RLS deshabilitado
-- ============================================================

SELECT tablename,
       rowsecurity AS rls_activado
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('usuarios','eventos','registros_pendientes','ordenes','entradas','envios_qr','publicidad')
ORDER BY rowsecurity ASC, tablename;

-- Vista alternativa (incluye columna "forzado"):
SELECT c.relname AS tabla,
       c.relrowsecurity      AS rls_activado,
       c.relforcerowsecurity AS rls_forzado
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relrowsecurity ASC, c.relname;

-- ============================================================
-- §2 ACTIVACIÓN DE RLS
-- ============================================================

ALTER TABLE public.usuarios             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eventos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registros_pendientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordenes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entradas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.envios_qr            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publicidad           ENABLE ROW LEVEL SECURITY;

-- Opcional: forzar RLS también para el dueño de la tabla.
-- NO afecta a service_role (sigue entrando).
ALTER TABLE public.eventos FORCE ROW LEVEL SECURITY;

-- ============================================================
-- §3 POLÍTICAS (DISEÑO)
-- ============================================================
-- RESUMEN:
--   * Solo backend (service_role) -> ENABLE RLS + NINGUNA política.
--   * Lectura pública con anon     -> política SELECT USING (true).
--   * Autenticado ve sus filas     -> USING/WITH CHECK auth.uid() = ...
--   * GRANT define si PUEDE ejecutar; la política define QUÉ filas ve.

-- Ejemplo: catálogo público (solo si el front consultara directo con anon):
-- CREATE POLICY "publicidad_lectura_publica" ON public.publicidad
--   FOR SELECT USING (true);

-- Ejemplo: acceso autenticado por dueño:
-- CREATE POLICY "registros_propietario" ON public.registros_pendientes
--   FOR ALL
--   USING (auth.uid() = user_id)
--   WITH CHECK (auth.uid() = user_id);

-- Para ESTA app (todo vía backend) NO crear políticas públicas:
-- con RLS activado y 0 políticas, anon/authenticated no pueden leer
-- ni una fila; service_role entra igual.

-- ============================================================
-- §4 VALIDACIÓN
-- ============================================================

-- 4.a Estado RLS por tabla:
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname='public'
  AND tablename IN ('eventos','ordenes','entradas','publicidad');

-- 4.b Políticas existentes (deben aparecer SOLO las creadas por ti):
SELECT schemaname, tablename, policyname, permissive, roles, cmd,
       qual, with_check
FROM pg_policies
WHERE schemaname='public';

-- 4.c Simula al cliente con anon key (NO debe leer nada sin política):
SET ROLE anon;
SELECT count(*) FROM public.eventos;   -- XERROR / 0 filas
SELECT count(*) FROM public.ordenes;   -- XERROR / 0 filas
SELECT * FROM public.entradas LIMIT 1; -- XERROR / 0 filas
RESET ROLE;

-- 4.d Simula al backend (service_role: DEBE seguir leyendo todo):
SET ROLE service_role;
SELECT count(*) FROM public.eventos;   -- VUROK
SELECT count(*) FROM public.ordenes;   -- VUROK
RESET ROLE;

-- ============================================================
-- CHECKLIST FINAL
--   1. rowsecurity = true en las tablas críticas.
--   2. pg_policies sin políticas (o solo las propias).
--   3. SET ROLE anon       -> bloqueado en las 7 tablas.
--   4. SET ROLE service_role -> lee todo normal.
--   5. En la app: /api/eventos, /api/publicidad y una compra
--      siguen respondiendo (backend usa service_role).
-- ============================================================

-- OPCIONAL: doble capa revocando privilegios al rol anon:
-- REVOKE ALL ON public.ordenes, public.entradas FROM anon;