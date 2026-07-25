// Intentamos cargar las librerías necesarias
try {
  require('dotenv').config();
  const { createClient } = require('@supabase/supabase-js');

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log('❌ Error: No se encontraron las variables de entorno en el archivo .env');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  async function test() {
    const { error } = await supabase.from('test').select('*').limit(1);

    // Si responde el servidor (aunque no exista la tabla 'test'), las credenciales están OK
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
    console.log('⚠️ Faltan instalar paquetes. Ejecuta en tu terminal:');
    console.log('npm install @supabase/supabase-js dotenv');
  } else {
    console.error('Error:', err.message);
  }
}