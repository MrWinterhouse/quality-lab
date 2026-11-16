import { createHmac } from 'node:crypto';
import { createApp } from '../../product/server/app.mjs';
import { household } from '../fixtures/households.ts';

export { household, family4, member, income, singleAdult } from '../fixtures/households.ts';

export const TOKENS = {
  applicantA: 'tok_applicant_a',
  applicantB: 'tok_applicant_b',
  caseworkerA: 'tok_caseworker_a',
  caseworkerB: 'tok_caseworker_b',
  adminA: 'tok_admin_a',
} as const;

export const VENDOR_SECRETS = {
  'agency-a': 'dev-agency-a-vendor-secret',
  'agency-b': 'dev-agency-b-vendor-secret',
} as const;

export type LabApp = {
  url: string;
  store: any;
  vendor: any;
  close: () => Promise<void>;
};

export interface ApiResult<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export async function startApp(): Promise<LabApp> {
  return (await createApp({ testHooks: true })) as LabApp;
}

export async function withApp<T>(fn: (app: LabApp) => Promise<T>): Promise<T> {
  const app = await startApp();
  try {
    return await fn(app);
  } finally {
    await app.close();
  }
}

export async function api<T = any>(
  app: LabApp,
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
    rawBody?: string;
  } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  let body: BodyInit | undefined;
  if (options.rawBody !== undefined) {
    body = options.rawBody;
    headers['content-type'] ??= 'application/json';
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['content-type'] = 'application/json';
  }

  const response = await fetch(`${app.url}${path}`, {
    method: options.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
  });
  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

export async function createScreening(
  app: LabApp,
  body: Record<string, any> = household(),
  token: string = TOKENS.applicantA,
) {
  const result = await api(app, '/api/screenings', { method: 'POST', token, body });
  if (result.status !== 201) {
    throw new Error(`screening failed (${result.status}): ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

export async function createApplication(
  app: LabApp,
  screeningId: string,
  token: string = TOKENS.applicantA,
) {
  return api(app, '/api/applications', {
    method: 'POST',
    token,
    body: {
      screeningId,
      applicant: {
        firstName: 'Avery',
        lastName: 'Applicant',
        email: 'avery@example.test',
        ssn: '123-45-6789',
      },
    },
  });
}

export async function waitForApplication(
  app: LabApp,
  applicationId: string,
  predicate: (application: any) => boolean,
  { timeoutMs = 3000, intervalMs = 20 } = {},
): Promise<any> {
  const started = Date.now();
  let last: any = null;
  while (Date.now() - started < timeoutMs) {
    const result = await api(app, `/api/applications/${applicationId}`, { token: TOKENS.applicantA });
    if (result.status === 200) {
      last = result.body;
      if (predicate(last)) return last;
    }
    await sleep(intervalMs);
  }
  throw new Error(`waitForApplication timed out; last=${JSON.stringify(last)}`);
}

export async function configureVendor(
  app: LabApp,
  config: { failures?: number; failAfterRecord?: number; alwaysFail?: boolean },
) {
  return api(app, '/internal/vendor/config', { method: 'POST', body: config });
}

export async function vendorState(app: LabApp) {
  return (await api(app, '/internal/vendor/state')).body;
}

export async function setClock(app: LabApp, iso: string | null) {
  return api(app, '/internal/clock', { method: 'POST', body: { iso } });
}

export function signPayload(secret: string, timestamp: number, rawBody: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
