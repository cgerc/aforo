try {
  require('dotenv').config();
  const { createClient } = require('@supabase/supabase-js');

  const envKeys = Object.keys(process.env);

  // Buscar URL en cualquiera de las convenciones habituales
  const url = process.env.SUPABASE_URL ||
              process.env.NEXT_PUBLIC_SUPABASE_URL ||
              process.env.VITE_SUPABASE_URL ||
              process.env.PUBLIC_SUPABASE_URL ||
              process.env.EXPO_PUBLIC_SUPABASE_URL;

  // Buscar Anon Key en cualquiera de las convenciones habituales
  const key = process.env.SUPABASE_ANON_KEY ||
              process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
              process.env.VITE_SUPABASE_ANON_KEY ||
              process.env.PUBLIC_SUPABASE_ANON_KEY ||
              process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.log('❌ No se encontró la URL o la Anon Key.');
    console.log('\n🔍 Nombres de variables detectados actualmente en tu .env:');
    const supabaseVars = envKeys.filter(k => k.toLowerCase().includes('supabase') || k.toLowerCase().includes('url') || k.toLowerCase().includes('key'));
    
    if (supabaseVars.length > 0) {
      console.log(supabaseVars.map(k => `  - ${k}`).join('\n'));
    } else {
      console.log('  (No se detectaron variables que contengan "SUPABASE", "URL" o "KEY")');
    }
    process.exit(1);
  }

  const supabase = createClient(url, key);

  async function test() {
    const { error } = await supabase.from('test').select('*').limit(1);
    if (!error || error.code === 'PGRST204' || error.message.includes('relation')) {
      console.log('✅ ¡CONEXIÓN EXITOSA! Las variables de entorno de Supabase son correctas.');
    } else if (error.code === 'PGRST301' || error.message.includes('JWT')) {
      console.log('❌ ERROR: La API KEY (Anon Key) es incorrecta.');
    } else {
      console.log('❌ Error de respuesta:', error.message);
    }
  }
  test();
} catch (err) {
  if (err.code === 'MODULE_NOT_FOUND') {
    console.log('⚠️ Faltan paquetes. Ejecuta: npm install @supabase/supabase-js dotenv');
  } else {
    console.error('Error:', err.message);
  }
}
