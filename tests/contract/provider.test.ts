import test from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  createApplication,
  createScreening,
  family4,
  startApp,
  TOKENS,
  waitForApplication,
  type LabApp,
} from '../helpers/app.ts';
import { responseSchema, validateAgainst } from '../helpers/schema.ts';

let app: LabApp;
let screening: any;
let application: any;

test.before(async () => {
  app = await startApp();
  screening = await createScreening(app, family4());
  const created = await createApplication(app, screening.id);
  application = await waitForApplication(
    app,
    created.body.id,
    (candidate) => candidate.vendor.status === 'verified',
  );
  await api(app, `/api/applications/${application.id}/documents`, {
    method: 'POST',
    token: TOKENS.applicantA,
    body: { type: 'income_proof', fileName: 'paystub.pdf', sizeBytes: 1024 },
  });
});

test.after(async () => {
  await app.close();
});

function expectValid(path: string, method: string, status: number, body: unknown) {
  const schema = responseSchema(path, method, status);
  assert.ok(schema, `No schema for ${method.toUpperCase()} ${path} ${status}`);
  const errors = validateAgainst(body, schema, `${method.toUpperCase()} ${path}`);
  assert.deepEqual(errors, [], `${method.toUpperCase()} ${path} schema violations`);
}

test('provider: tenant config matches the published contract', async () => {
  const result = await api(app, '/api/config', { token: TOKENS.applicantA });
  assert.equal(result.status, 200);
  expectValid('/api/config', 'get', 200, result.body);
});

test('provider: program listing matches the published contract', async () => {
  const result = await api(app, '/api/programs?state=CA&householdSize=4', {
    token: TOKENS.applicantA,
  });
  assert.equal(result.status, 200);
  expectValid('/api/programs', 'get', 200, result.body);
  assert.ok(result.body.programs.length > 0);
});

test('provider: screening response matches the published contract', async () => {
  const result = await api(app, `/api/screenings/${screening.id}`, { token: TOKENS.applicantA });
  assert.equal(result.status, 200);
  expectValid('/api/screenings/{id}', 'get', 200, result.body);
});

test('provider: application response matches the published contract', async () => {
  const result = await api(app, `/api/applications/${application.id}`, { token: TOKENS.applicantA });
  assert.equal(result.status, 200);
  expectValid('/api/applications/{id}', 'get', 200, result.body);
});

test('provider: document receipt matches the published contract', async () => {
  const result = await api(app, `/api/applications/${application.id}/documents`, {
    method: 'POST',
    token: TOKENS.applicantA,
    body: { type: 'id', fileName: 'id.png', sizeBytes: 512 },
  });
  assert.equal(result.status, 201);
  expectValid('/api/applications/{id}/documents', 'post', 201, result.body);
});

test('provider: event timeline matches the published contract', async () => {
  const result = await api(app, `/api/applications/${application.id}/events`, {
    token: TOKENS.caseworkerA,
  });
  assert.equal(result.status, 200);
  expectValid('/api/applications/{id}/events', 'get', 200, result.body);
});

test('provider: assistant reply matches the published contract', async () => {
  const result = await api(app, '/api/assistant/messages', {
    method: 'POST',
    token: TOKENS.applicantA,
    body: { message: 'What documents do I need?', promptVersion: '2026-03-b' },
  });
  assert.equal(result.status, 200);
  expectValid('/api/assistant/messages', 'post', 200, result.body);
});

test('provider: readiness report matches the published contract', async () => {
  const result = await api(app, '/api/admin/readiness', { token: TOKENS.adminA });
  assert.equal(result.status, 200);
  expectValid('/api/admin/readiness', 'get', 200, result.body);
});

test('provider: errors use the documented envelope', async () => {
  const result = await api(app, '/api/screenings/scr_missing', { token: TOKENS.applicantA });
  assert.equal(result.status, 404);
  expectValid('/api/screenings/{id}', 'get', 404, result.body);
});
