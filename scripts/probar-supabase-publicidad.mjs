import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) { console.log('FALTAN SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const { data, error } = await sb.from('publicidad').select('id, titulo, activo').limit(3);
if (error) {
  const msg = (error.message || error).toString();
  console.log('REST publicidad -> ERROR');
  console.log('  msg:', msg.slice(0, 200));
  console.log('  code:', error.code || 'n/a');
  if (/schema cache|Could not find/i.test(msg)) {
    console.log('CAUSA: cache de esquema de Supabase REST. Recomendado: recargar la API REST (re-deploy Vercel o tocar cualquier tabla) y reintentar.');
  }
  process.exit(1);
}
console.log('REST publicidad -> OK');
console.log('  filas:', (data || []).length, JSON.stringify(data || []).slice(0, 140));
