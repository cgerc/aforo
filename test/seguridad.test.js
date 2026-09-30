import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import { crearTokenOrden, calcularExpTicket, crearFirmaWebhookValida } from '../utils/seguridad.js';

const SECRET = 'secreto-de-prueba-fase-4';

function hmacHex(data) {
  return createHmac('sha256', SECRET).update(data).digest('hex');
}

test('orderAccessToken: HMAC determinista y distinto por orden', () => {
  const { orderAccessToken } = crearTokenOrden(SECRET);
  const a1 = orderAccessToken(1);
  const a2 = orderAccessToken(2);
  assert.equal(a1, orderAccessToken(1), 'debe ser determinista');
  assert.notEqual(a1, a2, 'distinto order_id debe dar token distinto');
  assert.match(a1, /^[0-9a-f]{64}$/, 'HMAC sha256 hex de 64 chars');
});

test('orderAccessOk: acepta token correcto, rechaza vacío y tampeado', () => {
  const { orderAccessToken, orderAccessOk } = crearTokenOrden(SECRET);
  const token = orderAccessToken(7);
  assert.equal(orderAccessOk(7, token), true);
  assert.equal(orderAccessOk(7, ''), false);
  assert.equal(orderAccessOk(7, null), false);
  const tampeado = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
  assert.equal(orderAccessOk(7, tampeado), false);
  assert.equal(orderAccessOk(8, token), false, 'token de otra orden');
});

test('orderConfirmToken: firmado, scope confirm y order_id correctos', () => {
  const { orderConfirmToken, orderConfirmTokenOk } = crearTokenOrden(SECRET);
  const t = orderConfirmToken(42);
  assert.equal(orderConfirmTokenOk(42, t), true);
  assert.equal(orderConfirmTokenOk(43, t), false, 'order_id distinto');
  assert.equal(orderConfirmTokenOk(42, 'basura'), false);
  assert.equal(orderConfirmTokenOk(42, ''), false);
});

test('orderConfirmToken: un at (HMAC) no pasa como t (firmado)', () => {
  const { orderAccessToken, orderConfirmTokenOk } = crearTokenOrden(SECRET);
  const at = orderAccessToken(42);
  assert.equal(orderConfirmTokenOk(42, at), false, 'HMAC no debe validar como t');
});

test('calcularExpTicket: fin de día del taller + 1 día, default 30 días', () => {
  const exp = calcularExpTicket('2026-10-01T15:00:00');
  const esperado = Math.floor(new Date('2026-10-02T23:59:59').getTime() / 1000);
  assert.equal(exp, esperado);

  const expDefault = calcularExpTicket(null);
  const limite = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  assert.ok(expDefault >= limite - 120 && expDefault <= limite + 120, 'default ~30 días');
});

test('firmaWebhookValida: valida firma correcta y rechaza tampeada/replay', () => {
  const win = crearFirmaWebhookValida(SECRET);

  const firma = (ts, id, requestId) => hmacHex(`id:${id};request-id:${requestId};ts:${ts};`);
  const req = (ts, id, overrides = {}) => ({
    get: (h) => {
      const headers = {
        'x-signature': `ts=${ts};v1=${overrides.v1 || firma(ts, id, overrides.requestId || 'req-1')}`,
        'x-request-id': overrides.requestId || 'req-1'
      };
      return headers[h] || '';
    },
    body: { data: { id } }
  });

  const ts = Math.floor(Date.now() / 1000);
  const id = 'pago-123';
  assert.equal(win(req(ts, id)), true, 'firma correcta');
  assert.equal(win(req(ts, id, { v1: 'abadf'.padEnd(64, '0') })), false, 'v1 tampeado');
  assert.equal(win(req(ts - 400, id)), false, 'ts antiguo (replay)');
});