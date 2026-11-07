import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarImagen, validarEnlace } from '../utils/validacion.js';

test('validarImagen: acepta http(s) y data:image base64', () => {
  assert.deepEqual(validarImagen('https://cdn.ejemplo.cl/foto.jpg'), {
    ok: true,
    value: 'https://cdn.ejemplo.cl/foto.jpg'
  });
  const data = 'data:image/png;base64,iVBORw0KGgo=';
  assert.deepEqual(validarImagen(data), { ok: true, value: data });
});

test('validarImagen: rechaza javascript, svg, credenciales y esquemas raros', () => {
  assert.equal(validarImagen('javascript:alert(1)').ok, false);
  assert.equal(validarImagen('data:image/svg+xml;base64,PHN2Zz4=').ok, false);
  assert.equal(validarImagen('https://user:pass@evil.cl/x.png').ok, false);
  assert.equal(validarImagen('ftp://evil.cl/x.png').ok, false);
  assert.equal(validarImagen('http://evil.cl/x.png').ok, false, 'http remoto no permitido');
  assert.equal(validarImagen('http://localhost:3000/x.png').ok, true, 'localhost sí');
});

test('validarImagen: vacío/null/undefined son válidos', () => {
  assert.deepEqual(validarImagen(undefined), { ok: true, value: undefined });
  assert.deepEqual(validarImagen(null), { ok: true, value: null });
  assert.deepEqual(validarImagen(''), { ok: true, value: null });
});

test('validarEnlace: solo http(s) y sin credenciales', () => {
  assert.deepEqual(validarEnlace('https://viveticket.cl'), {
    ok: true,
    value: 'https://viveticket.cl/'
  });
  assert.equal(validarEnlace('javascript:alert(1)').ok, false);
  assert.equal(validarEnlace('data:text/html,<script>alert(1)</script>').ok, false);
  assert.equal(validarEnlace('https://user:pass@evil.cl').ok, false);
});
