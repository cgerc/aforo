import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit, consumirBucket, resetBucket } from '../middleware/rateLimit.js';

function hacerReq(key) {
  return { ip: key };
}
function hacerRes() {
  const res = {};
  res.status = (code) => (res.statusCode = code, res);
  res.json = (body) => (res.body = body, res);
  return res;
}

test('rateLimit: permite hasta max y luego 429, y se resetea', async () => {
  resetBucket('rl:test');
  const mw = rateLimit({ windowMs: 50, max: 2, keyFn: (req) => 'rl:test' });

  let nextCount = 0;
  for (let i = 0; i < 2; i++) {
    const res = hacerRes();
    mw(hacerReq('1'), res, () => { nextCount++; });
    assert.equal(res.statusCode, undefined, `request ${i + 1} no debe rechazarse`);
  }
  const res3 = hacerRes();
  mw(hacerReq('1'), res3, () => {});
  assert.equal(res3.statusCode, 429, 'tercera petición debe dar 429');
  assert.equal(nextCount, 2, 'solo 2 pasaron al next');

  // Tras expirar la ventana, se permite de nuevo
  await new Promise((r) => setTimeout(r, 60));
  const res4 = hacerRes();
  mw(hacerReq('1'), res4, () => {});
  assert.equal(res4.statusCode, undefined, 'tras reset no debe rechazarse');
});

test('rateLimit: por IP distinta no comparten bucket', () => {
  resetBucket('rl:a');
  resetBucket('rl:b');
  const mw = rateLimit({ windowMs: 1000, max: 1, keyFn: (req) => req.ip });
  const resA1 = hacerRes();
  mw(hacerReq('rl:a'), resA1, () => {});
  assert.equal(resA1.statusCode, undefined);
  const resB1 = hacerRes();
  mw(hacerReq('rl:b'), resB1, () => {});
  assert.equal(resB1.statusCode, undefined, 'IP distinta no se ve afectada');
  const resA2 = hacerRes();
  mw(hacerReq('rl:a'), resA2, () => {});
  assert.equal(resA2.statusCode, 429, 'misma IP ya consumió su tope');
});

test('consumirBucket: respeta el limite y resetea', () => {
  resetBucket('cb:test');
  for (let i = 0; i < 3; i++) {
    assert.equal(consumirBucket('cb:test', { max: 3 }).ok, true, `intento ${i + 1}`);
  }
  const cuarto = consumirBucket('cb:test', { max: 3 });
  assert.equal(cuarto.ok, false, 'cuarto intento excede el límite');
  resetBucket('cb:test');
  assert.equal(consumirBucket('cb:test', { max: 3 }).ok, true, 'tras reset vuelve a permitir');
});