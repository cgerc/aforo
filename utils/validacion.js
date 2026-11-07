// Validación estricta de URLs/imágenes recibidas del cliente.
// Evita javascript:, data: con tipos peligrosos, credenciales embebidas y
// payloads gigantes que luego se interpolan en HTML.

const MAX_URL_LENGTH = 2048;
const MAX_IMAGE_DATA_LENGTH = 6 * 1024 * 1024;
const DATA_IMAGE_REGEX = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i;

function urlHttpSegura(valor) {
  if (typeof valor !== 'string') return null;
  const v = valor.trim();
  if (!v || v.length > MAX_URL_LENGTH) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (u.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/i.test(u.hostname)) return null;
    return u.toString();
  } catch (_) {
    return null;
  }
}

// Devuelve { ok, value } para distinguir "vacío permitido" de "inválido".
export function validarImagen(valor) {
  if (valor === undefined) return { ok: true, value: undefined };
  if (valor === null || valor === '') return { ok: true, value: null };
  if (typeof valor !== 'string') return { ok: false };
  const v = valor.trim();
  if (!v) return { ok: true, value: null };
  if (v.length > MAX_IMAGE_DATA_LENGTH) return { ok: false };

  if (/^data:/i.test(v)) {
    return DATA_IMAGE_REGEX.test(v) ? { ok: true, value: v } : { ok: false };
  }

  const url = urlHttpSegura(v);
  return url ? { ok: true, value: url } : { ok: false };
}

export function validarEnlace(valor) {
  if (valor === undefined || valor === null || valor === '') return { ok: true, value: null };
  if (typeof valor !== 'string') return { ok: false };
  const v = valor.trim();
  if (!v) return { ok: true, value: null };
  const url = urlHttpSegura(v);
  return url ? { ok: true, value: url } : { ok: false };
}

export { MAX_URL_LENGTH, MAX_IMAGE_DATA_LENGTH };
