/**
 * In-memory persistence for the lab. Restarting the server resets everything.
 */

export const TENANTS = Object.freeze({
  'agency-a': {
    id: 'agency-a',
    name: 'Northstar Benefits',
    brandColor: '#1f5f5b',
    enabledPrograms: ['medicaid', 'snap', 'wic', 'chip'],
    deadlineDays: 10,
    timezone: 'America/Los_Angeles',
    assistantPromptVersion: '2026-02-a',
    showEstimatedAmounts: false,
    vendorSecret: 'dev-agency-a-vendor-secret',
  },
  'agency-b': {
    id: 'agency-b',
    name: 'Riverbend Access',
    brandColor: '#7a3e1d',
    enabledPrograms: ['medicaid', 'chip'],
    deadlineDays: 30,
    timezone: 'America/New_York',
    assistantPromptVersion: '2026-03-b',
    showEstimatedAmounts: false,
    vendorSecret: 'dev-agency-b-vendor-secret',
  },
});

const USERS = Object.freeze({
  tok_applicant_a: { id: 'usr_applicant_a', role: 'applicant', tenantId: 'agency-a', name: 'Avery Applicant' },
  tok_applicant_b: { id: 'usr_applicant_b', role: 'applicant', tenantId: 'agency-b', name: 'Blake Applicant' },
  tok_caseworker_a: { id: 'usr_caseworker_a', role: 'caseworker', tenantId: 'agency-a', name: 'Casey Worker' },
  tok_caseworker_b: { id: 'usr_caseworker_b', role: 'caseworker', tenantId: 'agency-b', name: 'Jordan Worker' },
  tok_admin_a: { id: 'usr_admin_a', role: 'admin', tenantId: 'agency-a', name: 'Alex Admin' },
});

const DOCUMENT_TYPES = Object.freeze(['income_proof', 'id', 'residency']);

export function createStore() {
  let sequence = { screening: 0, application: 0, event: 0, document: 0 };
  let clockOverride = null;

  const screenings = new Map();
  const applications = new Map();

  function nextId(kind) {
    sequence[kind] += 1;
    const prefix = { screening: 'scr', application: 'app', event: 'evt', document: 'doc' }[kind];
    return `${prefix}_${String(sequence[kind]).padStart(5, '0')}`;
  }

  function now() {
    return clockOverride ? new Date(clockOverride) : new Date();
  }

  function addEvent(application, type, data = {}, actor = 'system') {
    const event = {
      id: nextId('event'),
      applicationId: application.id,
      type,
      at: now().toISOString(),
      actor,
      data,
    };
    application.timeline.push(event);
    return event;
  }

  return {
    tenants: TENANTS,
    users: USERS,
    documentTypes: DOCUMENT_TYPES,
    screenings,
    applications,

    now,
    setClock(iso) {
      clockOverride = iso ? new Date(iso).toISOString() : null;
    },

    reset() {
      sequence = { screening: 0, application: 0, event: 0, document: 0 };
      clockOverride = null;
      screenings.clear();
      applications.clear();
    },

    createScreening({ ownerId, tenantId, input, screening }) {
      const record = {
        id: nextId('screening'),
        ownerId,
        tenantId,
        state: input.state,
        householdSize: input.householdSize,
        input,
        fplAnnual: screening.fplAnnual,
        annualIncome: screening.annualIncome,
        fplPercent: screening.fplPercent,
        results: screening.results,
        createdAt: now().toISOString(),
      };
      screenings.set(record.id, record);
      return record;
    },

    createApplication({ screening, ownerId, tenantId, applicant, householdHash, deadline, deadlineDate }) {
      const application = {
        id: nextId('application'),
        screeningId: screening.id,
        ownerId,
        tenantId,
        status: 'submitted',
        applicant,
        householdHash,
        deadline,
        deadlineDate,
        vendor: { status: 'pending' },
        documents: [],
        timeline: [],
        createdAt: now().toISOString(),
        updatedAt: now().toISOString(),
      };
      applications.set(application.id, application);
      addEvent(application, 'application.submitted', { applicant }, 'applicant');
      return application;
    },

    addDocument(application, { type, fileName, sizeBytes }, actor) {
      const document = {
        id: nextId('document'),
        type,
        fileName,
        sizeBytes,
        uploadedAt: now().toISOString(),
      };
      application.documents.push(document);
      application.updatedAt = now().toISOString();
      if (application.status === 'submitted') application.status = 'documents_pending';
      addEvent(application, 'document.received', { document }, actor);
      return document;
    },

    addEvent,
  };
}
