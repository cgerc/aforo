-- ============================================================
-- ViveTicket · Migración: entradas (un QR por ticket) + correo
-- Ejecutar en el SQL Editor de Supabase (Database > SQL Editor)
-- ============================================================

-- 1) Almacenar el correo/nombre del comprador en la orden
--    (correo obligatorio capturado al inicio del pago en checkout)
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS email_comprador TEXT;
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS nombre_comprador TEXT;

-- 2) Tabla de entradas: una fila por entrada/QR de la compra.
--    - cantidad > 1  ->  N filas (una por entrada, cada una con su QR único)
--    - status        ->  'PAGADA' (vigente) | 'USADA' (consumida)
--    - used_at       ->  fecha/hora en que se escaneó/consumió
CREATE TABLE IF NOT EXISTS entradas (
  id          BIGSERIAL PRIMARY KEY,
  ticket_uuid TEXT UNIQUE NOT NULL,            -- identificador único del ticket
  order_id    BIGINT,                          -- orden a la que pertenece
  taller_id   BIGINT,                          -- taller/evento vinculado
  token       TEXT UNIQUE NOT NULL,            -- JWT que codifica el QR
  status      TEXT NOT NULL DEFAULT 'PAGADA',
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3) Migraciones seguras si la tabla ya existiera parcialmente
ALTER TABLE entradas ADD COLUMN IF NOT EXISTS ticket_uuid TEXT;
ALTER TABLE entradas ADD COLUMN IF NOT EXISTS order_id BIGINT;
ALTER TABLE entradas ADD COLUMN IF NOT EXISTS taller_id BIGINT;
ALTER TABLE entradas ADD COLUMN IF NOT EXISTS token TEXT;
ALTER TABLE entradas ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PAGADA';
ALTER TABLE entradas ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;

-- 4) Índices para las consultas del validador y la página del ticket
CREATE INDEX IF NOT EXISTS idx_entradas_order ON entradas(order_id);
CREATE INDEX IF NOT EXISTS idx_entradas_uuid ON entradas(ticket_uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entradas_token ON entradas(token);

-- (Opcional) Tabla de auditoría de envíos de correo (se usa en DB local/pool)
CREATE TABLE IF NOT EXISTS envios_qr (
  id           BIGSERIAL PRIMARY KEY,
  order_id     BIGINT,
  qr_token     TEXT,
  qr_archivo   TEXT,
  email_to     TEXT,
  titulo_evento TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);