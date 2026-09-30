// Helpers de seguridad puros (testeables sin arrancar el servidor).
// Los secretos se pasan como parámetro para poder usarlos en tests.

import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// --- Token de acceso por orden (HMAC determinista, sin cambios de esquema) ---
export function crearTokenOrden(qrSecret) {
  function orderAccessToken(orderId) {
    return crypto.createHmac('sha256', qrSecret).update(String(orderId)).digest('hex');
  }
  function orderAccessOk(orderId, provided) {
    if (!provided) return false;
    const expected = orderAccessToken(orderId);
    const a = Buffer.from(String(provided));
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  // [SEGURIDAD] A5: token temporal firmado para el back_url de MP.
  function orderConfirmToken(orderId) {
    return jwt.sign({ order_id: orderId, scope: 'confirm' }, qrSecret, { expiresIn: '12h' });
  }
  function orderConfirmTokenOk(orderId, provided) {
    if (!provided) return false;
    try {
      const decoded = jwt.verify(String(provided), qrSecret);
      return !!decoded && decoded.scope === 'confirm' && String(decoded.order_id) === String(orderId);
    } catch (_) {
      return false;
    }
  }
  return { orderAccessToken, orderAccessOk, orderConfirmToken, orderConfirmTokenOk };
}

// --- Expiración de los QRs de entrada: fin del día del taller + 1 día ---
export function calcularExpTicket(fechaTaller) {
  let base = null;
  if (fechaTaller) {
    const d = new Date(String(fechaTaller).slice(0, 10) + 'T23:59:59');
    if (!isNaN(d.getTime())) base = d;
  }
  if (!base) base = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  else base.setDate(base.getDate() + 1);
  return Math.floor(base.getTime() / 1000);
}

// --- Firma del webhook de Mercado Pago (X-Signature + anti-replay) ---
export function crearFirmaWebhookValida(mpWebhookSecret) {
  return function firmaWebhookValida(req) {
    const firma = String(req.get('x-signature') || '');
    const requestId = String(req.get('x-request-id') || '');
    const tsMatch = firma.match(/(?:^|;)ts=([^;]+)/);
    const v1Match = firma.match(/(?:^|;)v1=([^;]+)/);
    if (!tsMatch || !v1Match || !requestId) return false;
    // [SEGURIDAD] Anti-replay: el ts firmado no puede ser antiguo ni futuro (±5 min).
    const tsNum = Number(tsMatch[1]);
    if (!Number.isFinite(tsNum)) return false;
    const desviacionSec = Math.abs(Date.now() / 1000 - tsNum);
    if (desviacionSec > 5 * 60) return false;
    let dataId = '';
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      dataId = req.body?.data?.id ?? req.body?.id ?? '';
    } else {
      try {
        const parseado = JSON.parse(req.body.toString());
        dataId = parseado?.data?.id ?? parseado?.id ?? '';
      } catch (e) {
        dataId = req.query?.id || '';
      }
    }
    const firmaString = `id:${dataId};request-id:${requestId};ts:${tsMatch[1]};`;
    const esperada = crypto.createHmac('sha256', mpWebhookSecret).update(firmaString).digest('hex');
    const a = Buffer.from(String(v1Match[1]));
    const b = Buffer.from(esperada);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
}