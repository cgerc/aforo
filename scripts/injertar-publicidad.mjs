import fs from 'fs';

const p = 'server.js';
let s = fs.readFileSync(p, 'utf8');

const ancla = '// MERCADO PAGO - CREAR PREFERENCIA';
const idxAncla = s.indexOf(ancla);
if (idxAncla < 0) {
  console.error('ANCLA no encontrada: ' + ancla);
  process.exit(1);
}

// Cortar el cierre del DELETE eventos (}[/\n /\n]) justo antes del ancla
const cabecera = s.slice(0, idxAncla);
// Quitar cualquier espacios/cierre colgante despues del ultimo '});'
const ultimoCierre = cabecera.lastIndexOf('});');
const base = cabecera.slice(0, ultimoCierre + 3);
const resto = s.slice(idxAncla);

const codigo = `
// ==================== PUBLICIDAD (carrusel de la portada) ====================
// GET publico: solo activas, la MAS RECIENTE primero (created_at desc)
app.get('/api/publicidad', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'Supabase no está configurado.' });
    }
    const { data, error } = await supabase
      .from('publicidad')
      .select('*')
      .eq('activo', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error leyendo publicidad desde Supabase:', error.message || error);
      return res.status(500).json({ error: 'No se pudieron cargar las publicidades', details: error.message || 'unknown' });
    }

    const lista = (data || []).map((pub) => ({
      id: pub.id,
      titulo: pub.titulo || '',
      imagen: pub.imagen || '',
      enlace: pub.enlace || null,
      created_at: pub.created_at || null
    }));
    res.json(lista);
  } catch (err) {
    console.error('Error interno al listar publicidades:', err.message || err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST: crear publicidad (solo organizador autenticado)
app.post('/api/publicidad', requireAuth, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'Supabase no está configurado.' });
    }
    const { titulo, imagen, enlace } = req.body || {};
    if (!titulo || !imagen) {
      return res.status(400).json({ error: 'Título e imagen son obligatorios.' });
    }

    const nuevo = {
      usuario_id: req.user.id,
      titulo: sanitizeText(titulo),
      imagen,
      enlace: enlace ? sanitizeText(enlace) : null
    };

    const { data, error } = await supabase
      .from('publicidad')
      .insert([nuevo])
      .select();

    if (error) {
      console.error('Error creando publicidad en Supabase:', error.message || error);
      return res.status(500).json({ error: 'No se pudo publicar la publicidad', details: error.message || 'unknown' });
    }

    res.status(201).json({ message: 'Publicidad publicada correctamente', publicidad: data[0] });
  } catch (err) {
    console.error('Error interno al crear publicidad:', err.message || err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE: desactivar publicidad (solo dueno)
app.delete('/api/publicidad/:id', requireAuth, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'Supabase no está configurado.' });
    }
    const { id } = req.params     const numId = Number(id);
    if (!numId) {
      return res.status(400).json({ error: 'ID de publicidad requerido.' });
    }

    const { data: existente, error: chkErr } = await supabase
      .from('publicidad')
      .select('id, usuario_id, activo')
      .eq('id', numId)
      .single();

    if (chkErr || !existente) {
      return res.status(404).json({ error: 'Publicidad no encontrada.' });
    }
    if (existente.usuario_id !== req.user.id) {
      return res.status(403).json({ error: 'No tienes permiso para desactivar esta publicidad.' });
    }

    const { error: updErr } = await supabase
      .from('publicidad')
      .update({ activo: false })
      .eq('id', numId);

    if (updErr) {
      console.error('Error desactivando publicidad:', updErr.message || updErr);
      return res.status(500).json({ error: 'No se pudo desactivar la publicidad', details: updErr.message || 'unknown' });
    }

    res.json({ ok: true, message: 'Publicidad desactivada.' });
  } catch (err) {
    console.error('Error interno al desactivar publicidad:', err.message || err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

${resto}
`;

fs.writeFileSync(p, cabecera) // no: construir completo
;
const total = base + '\n' + codigo;
fs.writeFileSync(p, total);
console.log('Inyectados endpoints de publicidad en server.js');
