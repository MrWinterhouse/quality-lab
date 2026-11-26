import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { computeDeadline } from './lib/deadline.mjs';
import { PROGRAM_RULES, US_STATES, MEDICAID_EXPANSION_STATES, fplAnnual, screenHousehold, validateHousehold } from './lib/policy.mjs';
import { createStore } from './lib/store.mjs';
import { VendorSimulator } from './lib/vendor.mjs';
import { respond, PROMPT_VERSIONS } from './lib/assistant.mjs';
import { buildReadiness } from './lib/readiness.mjs';
import { hashHousehold } from './lib/hash.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const WEB_ROOT = path.resolve(__dirname, '../web');
const MAX_BODY_BYTES = 100_000;
const DEMO_HEADER_ENABLED = process.env.NODE_ENV !== 'production';

// The retry policy the async case study quotes. Exported so the figure gate can drive the
// vendor simulator with the same numbers the worker uses instead of keeping a second copy.
export const VENDOR_RETRY = Object.freeze({ attempts: 3, delayMs: 10 });

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function httpError(status, code, message, details) {
  return new HttpError(status, code, message, details);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// DEFECT-07: the key changes with the attempt, so every retry looks like a new operation to
// the vendor. Exported because that defect is what the async case study documents.
export function attemptIdempotencyKey(applicationId, attempt) {
  return `${applicationId}:${attempt}`;
}

function safeEqualHex(expected, received) {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function serializeScreening(screening) {
  return {
    id: screening.id,
    state: screening.state,
    householdSize: screening.householdSize,
    annualIncome: screening.annualIncome,
    fplAnnual: screening.fplAnnual,
    fplPercent: screening.fplPercent,
    results: screening.results,
    createdAt: screening.createdAt,
  };
}

function serializeApplication(application) {
  return {
    id: application.id,
    screeningId: application.screeningId,
    tenantId: application.tenantId,
    status: application.status,
    applicant: { ...application.applicant },
    householdHash: application.householdHash,
    deadline: application.deadline,
    deadlineDate: application.deadlineDate,
    vendor: { ...application.vendor },
    documents: application.documents.map((document) => ({ ...document })),
    timeline: application.timeline.map((event) => ({ ...event })),
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
  };
}

function publicConfig(config) {
  return {
    tenantId: config.id,
    brandName: config.name,
    brandColor: config.brandColor,
    enabledPrograms: config.enabledPrograms,
    deadlineDays: config.deadlineDays,
    timezone: config.timezone,
    assistantPromptVersion: config.assistantPromptVersion,
    showEstimatedAmounts: config.showEstimatedAmounts,
  };
}

export async function createApp(options = {}) {
  const store = createStore();
  const vendor = new VendorSimulator();
  const testHooks = options.testHooks ?? process.env.ENABLE_TEST_HOOKS !== '0';

  // Tenant configuration is static, so it is loaded once and reused.
  let cachedTenantConfig = null;
  function tenantConfig(tenantId) {
    if (!cachedTenantConfig) cachedTenantConfig = store.tenants[tenantId];
    return cachedTenantConfig;
  }

  function authenticate(req) {
    const header = req.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return store.users[header.slice(7)] ?? null;
    }
    if (testHooks && DEMO_HEADER_ENABLED) {
      const demo = req.headers['x-demo-user'];
      if (typeof demo === 'string') {
        return store.users[`tok_${demo.replace(/-/g, '_')}`] ?? null;
      }
    }
    return null;
  }

  function requireRole(user, roles) {
    if (!roles.includes(user.role)) {
      throw httpError(403, 'forbidden', `Requires role: ${roles.join(', ')}`);
    }
  }

  function requireSameTenant(user, tenantId) {
    if (user.tenantId !== tenantId) throw httpError(403, 'forbidden_tenant');
  }

  function readApplication(rawId, user) {
    const application = store.applications.get(rawId);
    if (!application) throw httpError(404, 'application_not_found');
    if (user.role === 'applicant' && application.ownerId !== user.id) {
      throw httpError(403, 'forbidden');
    }
    if (user.role !== 'applicant') requireSameTenant(user, application.tenantId);
    return application;
  }

  async function verifyApplication(application) {
    for (let attempt = 1; attempt <= VENDOR_RETRY.attempts; attempt += 1) {
      try {
        const idempotencyKey = attemptIdempotencyKey(application.id, attempt);
        const result = await vendor.verify({
          applicationId: application.id,
          householdHash: application.householdHash,
          idempotencyKey,
        });
        application.vendor = { status: 'verified', verificationId: result.verificationId };
        application.updatedAt = store.now().toISOString();
        store.addEvent(application, 'vendor.verified', {
          verificationId: result.verificationId,
          duplicate: Boolean(result.duplicate),
        });
        return;
      } catch (error) {
        if (attempt === VENDOR_RETRY.attempts) {
          application.vendor = { status: 'failed', reason: error.message };
          application.updatedAt = store.now().toISOString();
          store.addEvent(application, 'vendor.failed', {
            reason: error.message,
            attempts: attempt,
          });
          return;
        }
        await delay(VENDOR_RETRY.delayMs);
      }
    }
  }

  function startVerification(application) {
    const timer = setTimeout(() => {
      void verifyApplication(application);
    }, 0);
    timer.unref?.();
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(httpError(413, 'payload_too_large'));
          req.resume();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  function parseJson(raw) {
    if (raw.length === 0) return {};
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      throw httpError(400, 'invalid_json', 'Request body is not valid JSON.');
    }
  }

  function sendJson(res, status, payload, extraHeaders = {}) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      ...extraHeaders,
    });
    res.end(body);
  }

  function sendError(res, error) {
    const status = error.status ?? 500;
    const payload =
      status >= 500
        ? { error: { code: 'internal_error', message: 'Unexpected server error.' } }
        : { error: { code: error.code ?? 'error', message: error.message, details: error.details } };
    sendJson(res, status, payload);
  }

  const STATIC_FILES = {
    '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
    '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
    '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
    '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  };

  async function serveStatic(res, pathname) {
    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    const entry = STATIC_FILES[pathname];
    if (!entry) throw httpError(404, 'not_found');
    const content = await readFile(path.join(WEB_ROOT, entry.file));
    res.writeHead(200, {
      'Content-Type': entry.type,
      'Content-Length': content.length,
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(content);
  }

  function route(method, pathname) {
    const routes = [
      ['GET', /^\/health$/, () => ({})],
      ['GET', /^\/api\/config$/, () => ({})],
      ['GET', /^\/api\/programs$/, () => ({})],
      ['POST', /^\/api\/screenings$/, () => ({})],
      ['GET', /^\/api\/screenings\/([^/]+)$/, (match) => ({ id: match[1] })],
      ['POST', /^\/api\/applications$/, () => ({})],
      ['GET', /^\/api\/applications\/([^/]+)$/, (match) => ({ id: match[1] })],
      ['POST', /^\/api\/applications\/([^/]+)\/documents$/, (match) => ({ id: match[1] })],
      ['POST', /^\/api\/applications\/([^/]+)\/review$/, (match) => ({ id: match[1] })],
      ['POST', /^\/api\/applications\/([^/]+)\/decision$/, (match) => ({ id: match[1] })],
      ['GET', /^\/api\/applications\/([^/]+)\/events$/, (match) => ({ id: match[1] })],
      ['POST', /^\/api\/webhooks\/vendor$/, () => ({})],
      ['POST', /^\/api\/assistant\/messages$/, () => ({})],
      ['GET', /^\/api\/admin\/readiness$/, () => ({})],
      ['POST', /^\/internal\/vendor\/config$/, () => ({})],
      ['GET', /^\/internal\/vendor\/state$/, () => ({})],
      ['POST', /^\/internal\/reset$/, () => ({})],
      ['POST', /^\/internal\/clock$/, () => ({})],
    ];

    for (const [routeMethod, pattern, extract] of routes) {
      const match = pathname.match(pattern);
      if (match && routeMethod === method) return { params: extract(match) };
    }
    return null;
  }

  async function handleApi(req, res, pathname, url) {
    const matched = route(req.method, pathname);
    if (!matched) throw httpError(404, 'not_found');

    const internal = pathname.startsWith('/internal/');
    if (internal && !testHooks) throw httpError(404, 'not_found');

    const raw = await readBody(req);
    const body = req.method === 'GET' ? {} : parseJson(raw);
    const publicRoute =
      pathname === '/health' ||
      pathname === '/api/webhooks/vendor' ||
      (testHooks && pathname.startsWith('/internal/'));
    const user = publicRoute ? null : authenticate(req);

    if (!user && !publicRoute) throw httpError(401, 'unauthenticated');
    const { id } = matched.params;

    if (pathname === '/health') {
      return sendJson(res, 200, { status: 'ok', service: 'benefits-api' });
    }

    if (pathname === '/api/webhooks/vendor') {
      const tenantId = req.headers['x-tenant'];
      const config = store.tenants[tenantId];
      if (!config) throw httpError(401, 'invalid_tenant');

      const timestamp = req.headers['x-timestamp'];
      const signature = req.headers['x-signature'];
      if (!timestamp || !signature) throw httpError(401, 'missing_signature');

      const expected = createHmac('sha256', config.vendorSecret)
        .update(`${timestamp}.${raw.toString('utf8')}`)
        .digest('hex');
      if (!safeEqualHex(expected, signature)) throw httpError(401, 'invalid_signature');

      const application = store.applications.get(body.applicationId);
      if (!application || application.tenantId !== tenantId) {
        throw httpError(404, 'application_not_found');
      }

      if (body.householdHash && body.householdHash !== application.householdHash) {
        application.vendor = { status: 'mismatch', verificationId: body.verificationId ?? null };
        application.updatedAt = store.now().toISOString();
        store.addEvent(application, 'vendor.data_mismatch', {
          expectedHash: application.householdHash,
          receivedHash: body.householdHash,
        });
        return sendJson(res, 202, { status: 'mismatch' });
      }

      application.vendor = { status: 'verified', verificationId: body.verificationId ?? application.vendor.verificationId };
      application.updatedAt = store.now().toISOString();
      store.addEvent(application, 'vendor.webhook_received', {
        verificationId: body.verificationId ?? null,
      });
      return sendJson(res, 200, { status: 'verified' });
    }

    if (internal) {
      if (pathname === '/internal/reset') {
        store.reset();
        vendor.reset();
        cachedTenantConfig = null;
        return sendJson(res, 200, { status: 'reset' });
      }
      if (pathname === '/internal/clock') {
        if (body.iso !== null && body.iso !== undefined && Number.isNaN(Date.parse(body.iso))) {
          throw httpError(400, 'invalid_clock');
        }
        store.setClock(body.iso ?? null);
        return sendJson(res, 200, { now: store.now().toISOString() });
      }
      if (pathname === '/internal/vendor/config') {
        vendor.configure(body);
        return sendJson(res, 200, {
          failuresRemaining: vendor.failuresRemaining,
          failAfterRecordRemaining: vendor.failAfterRecordRemaining,
          alwaysFail: vendor.alwaysFail,
        });
      }
      if (pathname === '/internal/vendor/state') {
        return sendJson(res, 200, { attempts: vendor.attempts, verifications: vendor.list() });
      }
    }

    if (pathname === '/api/config') {
      return sendJson(res, 200, publicConfig(tenantConfig(user.tenantId)));
    }

    if (pathname === '/api/programs') {
      const config = tenantConfig(user.tenantId);
      const state = url.searchParams.get('state');
      const householdSize = Number(url.searchParams.get('householdSize'));
      const programs = config.enabledPrograms.map((programId) => {
        const rule = PROGRAM_RULES[programId];
        const thresholdPct =
          programId === 'medicaid'
            ? MEDICAID_EXPANSION_STATES.includes(state)
              ? 138
              : 100
            : Math.round(rule.incomeLimitPct * 100);
        const entry = { id: programId, label: rule.label, thresholdPct };
        if (US_STATES.includes(state) && Number.isInteger(householdSize) && householdSize >= 1) {
          entry.incomeLimitAnnual = Math.round((fplAnnual(householdSize, state) * thresholdPct) / 100);
        }
        return entry;
      });
      return sendJson(res, 200, { tenantId: config.id, programs });
    }

    if (pathname === '/api/screenings' && req.method === 'POST') {
      requireRole(user, ['applicant']);
      const validation = validateHousehold(body);
      if (!validation.ok) {
        throw httpError(400, 'invalid_household', 'Household details are invalid.', validation.errors);
      }
      const screeningResult = screenHousehold(body);
      const config = tenantConfig(user.tenantId);
      const visibleResults = screeningResult.results.filter((result) =>
        config.enabledPrograms.includes(result.programId),
      );
      const screening = store.createScreening({
        ownerId: user.id,
        tenantId: user.tenantId,
        input: body,
        screening: { ...screeningResult, results: visibleResults },
      });
      return sendJson(res, 201, serializeScreening(screening));
    }

    if (pathname.startsWith('/api/screenings/')) {
      const screening = store.screenings.get(id);
      if (!screening) throw httpError(404, 'screening_not_found');
      return sendJson(res, 200, serializeScreening(screening));
    }

    if (req.method === 'GET' && /^\/api\/applications\/[^/]+$/.test(pathname)) {
      const application = readApplication(id, user);
      return sendJson(res, 200, serializeApplication(application));
    }

    if (pathname === '/api/applications' && req.method === 'POST') {
      requireRole(user, ['applicant']);
      const screening = store.screenings.get(body.screeningId);
      if (!screening) throw httpError(404, 'screening_not_found');
      if (screening.ownerId !== user.id) throw httpError(403, 'forbidden');

      const config = tenantConfig(user.tenantId);
      const submittedAt = store.now();
      const { deadline, deadlineDate } = computeDeadline(
        submittedAt,
        config.deadlineDays,
        config.timezone,
      );

      const application = store.createApplication({
        screening,
        ownerId: user.id,
        tenantId: user.tenantId,
        applicant: {
          firstName: String(body.applicant?.firstName ?? ''),
          lastName: String(body.applicant?.lastName ?? ''),
          email: String(body.applicant?.email ?? ''),
          ssn: body.applicant?.ssn ?? null,
        },
        householdHash: hashHousehold(screening.input),
        deadline,
        deadlineDate,
      });

      startVerification(application);
      return sendJson(res, 201, serializeApplication(application));
    }

    if (pathname.endsWith('/documents') && req.method === 'POST') {
      const application = readApplication(id, user);
      if (!store.documentTypes.includes(body.type)) {
        throw httpError(400, 'invalid_document_type', `One of: ${store.documentTypes.join(', ')}`);
      }
      if (typeof body.fileName !== 'string' || body.fileName.length === 0 || body.fileName.length > 200) {
        throw httpError(400, 'invalid_file_name');
      }
      if (!Number.isInteger(body.sizeBytes) || body.sizeBytes <= 0 || body.sizeBytes > 20_000_000) {
        throw httpError(400, 'invalid_file_size');
      }
      const document = store.addDocument(
        application,
        { type: body.type, fileName: body.fileName, sizeBytes: body.sizeBytes },
        user.role,
      );
      return sendJson(res, 201, { document, status: application.status });
    }

    if (pathname.endsWith('/review') && req.method === 'POST') {
      requireRole(user, ['caseworker']);
      const application = readApplication(id, user);
      if (!['submitted', 'documents_pending'].includes(application.status)) {
        throw httpError(409, 'invalid_state', `Cannot review from status ${application.status}`);
      }
      application.status = 'under_review';
      application.updatedAt = store.now().toISOString();
      store.addEvent(application, 'application.under_review', { note: body.note ?? null }, user.role);
      return sendJson(res, 200, serializeApplication(application));
    }

    if (pathname.endsWith('/decision') && req.method === 'POST') {
      requireRole(user, ['caseworker']);
      const application = readApplication(id, user);
      if (!['approved', 'denied'].includes(body.decision)) {
        throw httpError(400, 'invalid_decision', 'decision must be "approved" or "denied"');
      }
      if (application.status !== 'under_review') {
        throw httpError(409, 'invalid_state', `Cannot decide from status ${application.status}`);
      }

      application.status = body.decision;
      application.updatedAt = store.now().toISOString();
      store.addEvent(application, `application.${body.decision}`, { note: body.note ?? null }, user.role);
      return sendJson(res, 200, serializeApplication(application));
    }

    if (pathname.endsWith('/events') && req.method === 'GET') {
      const application = readApplication(id, user);
      return sendJson(res, 200, { events: application.timeline });
    }

    if (pathname === '/api/assistant/messages') {
      if (typeof body.message !== 'string' || body.message.trim().length === 0) {
        throw httpError(400, 'message_required');
      }
      if (body.message.length > 2000) throw httpError(400, 'message_too_long');

      const config = tenantConfig(user.tenantId);
      const promptVersion = body.promptVersion ?? config.assistantPromptVersion;
      if (!PROMPT_VERSIONS.includes(promptVersion)) {
        throw httpError(400, 'invalid_prompt_version');
      }

      let screening = null;
      if (body.screeningId) {
        screening = store.screenings.get(body.screeningId);
        if (!screening) throw httpError(404, 'screening_not_found');
        if (screening.ownerId !== user.id) throw httpError(403, 'forbidden');
      }

      const answer = respond({ message: body.message, screening, promptVersion });
      return sendJson(res, 200, { ...answer, configVersion: config.assistantPromptVersion });
    }

    if (pathname === '/api/admin/readiness') {
      requireRole(user, ['admin']);
      const readiness = await buildReadiness(PROJECT_ROOT);
      return sendJson(res, 200, readiness);
    }

    throw httpError(404, 'not_found');
  }

  const server = http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');

    (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = decodeURIComponent(url.pathname);

      if (pathname.startsWith('/api/') || pathname.startsWith('/internal/') || pathname === '/health') {
        await handleApi(req, res, pathname, url);
        return;
      }
      await serveStatic(res, pathname);
    })().catch((error) => {
      if (!res.headersSent) {
        sendError(res, error);
        return;
      }
      res.end();
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;

  return {
    server,
    url,
    store,
    vendor,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
