import { initDb, pool } from '../db.js';

try {
  await initDb();
  console.log('Migración de esquema completada.');
} catch (error) {
  console.error('Error al ejecutar la migración de esquema:', error);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
