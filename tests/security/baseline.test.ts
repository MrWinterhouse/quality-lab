import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createScreening, family4, household, TOKENS, withApp } from '../helpers/app.ts';

test('unauthenticated API requests are rejected', async () => {
  await withApp(async (app) => {
    const config = await api(app, '/api/config');
    assert.equal(config.status, 401);
    assert.equal(config.body.error.code, 'unauthenticated');

    const screening = await api(app, '/api/screenings', { method: 'POST', body: household() });
    assert.equal(screening.status, 401);
  });
});

test('role boundaries are enforced for admin reporting', async () => {
  await withApp(async (app) => {
    const result = await api(app, '/api/admin/readiness', { token: TOKENS.applicantA });
    assert.equal(result.status, 403);
  });
});

test('malformed JSON and oversized bodies fail safely', async () => {
  await withApp(async (app) => {
    const malformed = await api(app, '/api/screenings', {
      method: 'POST',
      token: TOKENS.applicantA,
      rawBody: '{"state": "CA",',
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error.code, 'invalid_json');

    const oversized = await api(app, '/api/screenings', {
      method: 'POST',
      token: TOKENS.applicantA,
      rawBody: JSON.stringify({ padding: 'a'.repeat(120_000) }),
    });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.body.error.code, 'payload_too_large');
  });
});

test('HTML responses carry baseline security headers', async () => {
  await withApp(async (app) => {
    const response = await fetch(`${app.url}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    const html = await response.text();
    assert.match(html, /<html lang="en">/);
  });
});

test('static file traversal is not possible', async () => {
  await withApp(async (app) => {
    const traversal = await fetch(`${app.url}/%2e%2e/package.json`);
    assert.equal(traversal.status, 404);

    const nested = await fetch(`${app.url}/%2e%2e%2fquality%2frisk-register.json`);
    assert.equal(nested.status, 404);
  });
});

test('unknown routes return a JSON error without stack traces', async () => {
  await withApp(async (app) => {
    const result = await api(app, '/api/does-not-exist', { token: TOKENS.applicantA });
    assert.equal(result.status, 404);
    assert.equal(result.body.error.code, 'not_found');
    assert.equal(result.body.error.stack, undefined);
  });
});

test('assistant input limits are enforced', async () => {
  await withApp(async (app) => {
    const empty = await api(app, '/api/assistant/messages', {
      method: 'POST',
      token: TOKENS.applicantA,
      body: { message: '   ' },
    });
    assert.equal(empty.status, 400);

    const tooLong = await api(app, '/api/assistant/messages', {
      method: 'POST',
      token: TOKENS.applicantA,
      body: { message: 'x'.repeat(2001) },
    });
    assert.equal(tooLong.status, 400);

    const badVersion = await api(app, '/api/assistant/messages', {
      method: 'POST',
      token: TOKENS.applicantA,
      body: { message: 'Tell me about SNAP', promptVersion: 'not-a-prompt' },
    });
    assert.equal(badVersion.status, 400);
  });
});

test('the assistant does not echo Social Security numbers', async () => {
  await withApp(async (app) => {
    const result = await api(app, '/api/assistant/messages', {
      method: 'POST',
      token: TOKENS.applicantA,
      body: { message: 'My SSN is 123-45-6789. What documents do I need?' },
    });
    assert.equal(result.status, 200);
    assert.ok(!result.body.reply.includes('123-45-6789'));
  });
});

test('screening detail is not readable without a valid token', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4());
    const result = await api(app, `/api/screenings/${screening.id}`);
    assert.equal(result.status, 401);
  });
});
