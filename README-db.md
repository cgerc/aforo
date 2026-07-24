# Configuración de base de datos

El proyecto está preparado para usar PostgreSQL local o remoto.

## Opción 1: local
Por defecto usa:

DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/aforo

## Opción 2: Supabase remoto
Pega la URL que te entregue Supabase en:

DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres

Si usas Supabase, la app detecta automáticamente la conexión remota y habilita SSL.
