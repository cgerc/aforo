import fs from 'fs';

console.log('=== VERIFICACION FINAL DEL PROYECTO ===');
console.log('');

// 1) server.js sintaxis
try {
  new (await import('node:module')).SourceTextModule; // no-op, placeholder
} catch {}
const { execSync } = await import('node:child_process');
try { execSync('node --check server.js', { stdio: 'inherit' }); console.log('server.js SINTAXIS: OK'); }
catch { console.log('server.js SINTAXIS: FALLO'); }

// 2) endpoints publicidad en server.js
const s = fs.readFileSync('server.js', 'utf8');
const checks = {
  "GET /api/publicidad": "app.get('/api/publicidad'",
  "POST /api/publicidad": "app.post('/api/publicidad'",
  "DELETE /api/publicidad/:id": "app.delete('/api/publicidad/:id'",
  "requireAuth importado": "import { requireAuth }"
};
for (const [k, pat] of Object.entries(checks)) {
  console.log((s.includes(pat) ? 'OK  ' : 'FALTA ') + k);
}

// 3) app.js: banner eliminado + primer evento activo
const a = fs.readFileSync('public/app.js', 'utf8');
console.log((a.includes('crearSlideBannerTalleres') ? 'FALTA: banner TODAVIA existe' : 'OK   banner eliminado de app.js'));
console.log((/idx === 0 \? 'opacity-100 z-10'/.test(a) ? 'OK   primer evento activo' : 'FALTA primer evento activo'));

// 4) dashboard: verifico que no exista aun la seccion publicidad (falta crear)
const d = fs.readFileSync('public/dashboard.html', 'utf8');
console.log((d.includes('agregar publicidad') ? 'OK   seccion publicidad YA existe' : 'PENDIENTE: no existe aun seccion en dashboard'));

// 5) count de lineas
console.log('');
console.log('server.js lineas:', s.split('\n').length);
