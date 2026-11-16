const demoUser = new URLSearchParams(location.search).get('as') || 'applicant-a';

const el = (id) => document.getElementById(id);

const state = {
  config: null,
  screening: null,
  application: null,
};

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Demo-User': demoUser,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Request failed (${response.status})`);
    error.details = data?.error?.details;
    throw error;
  }
  return data;
}

function humanStatus(status) {
  return String(status).replaceAll('_', ' ').replaceAll('.', ' ');
}

function renderConfig(config) {
  state.config = config;
  el('brandName').textContent = config.brandName;
  document.documentElement.style.setProperty('--brand', config.brandColor);
  document.title = `${config.brandName} — Benefits screener`;
}

function buildMembers(size, monthlyIncome, frequency, youngChildren, pregnant) {
  const adults = size >= 2 ? 2 : 1;
  const members = [];

  for (let index = 0; index < adults; index += 1) {
    members.push({
      age: 34 - index,
      status: 'citizen',
      income:
        index === 0
          ? { amount: Number(monthlyIncome) || 0, frequency }
          : { amount: 0, frequency: 'monthly' },
    });
  }

  const children = Math.max(0, size - adults);
  for (let index = 0; index < children; index += 1) {
    members.push({
      age: index < youngChildren ? 3 + index : 9 + index,
      status: 'citizen',
    });
  }

  if (pregnant) members[0].pregnant = true;
  return members;
}

function renderResults(screening) {
  state.screening = screening;
  el('results').hidden = false;
  el('resultsSummary').textContent =
    `${screening.householdSize} people, $${screening.annualIncome.toLocaleString()} a year ` +
    `(${screening.fplPercent}% of the federal poverty level).`;

  const cards = el('resultCards');
  cards.replaceChildren();

  for (const result of screening.results) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.testid = `result-${result.programId}`;

    const title = document.createElement('h3');
    title.textContent = result.label;

    const status = document.createElement('p');
    status.className = `status ${result.status === 'likely_eligible' ? 'eligible' : 'ineligible'}`;
    status.textContent = humanStatus(result.status);

    const detail = document.createElement('p');
    detail.className = 'muted';
    detail.textContent = result.thresholdPct
      ? `${result.fplPercent}% of FPL against a ${result.thresholdPct}% limit`
      : 'More information needed';

    card.append(title, status, detail);
    cards.append(card);
  }

  el('startApplication').hidden = screening.results.length === 0;
}

function renderApplication(application) {
  state.application = application;
  el('application').hidden = false;
  el('applicationStatus').textContent = humanStatus(application.status);
  el('deadlineDate').textContent = application.deadlineDate;

  const timeline = el('timeline');
  timeline.replaceChildren();
  for (const event of application.timeline) {
    const item = document.createElement('li');
    item.textContent = `${humanStatus(event.type)} — ${new Date(event.at).toLocaleString()}`;
    timeline.append(item);
  }
}

el('screenForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = el('formError');
  errorBox.hidden = true;

  const householdSize = Number(el('householdSize').value) || 1;
  const body = {
    state: el('state').value,
    householdSize,
    incomeComplete: true,
    members: buildMembers(
      householdSize,
      el('monthlyIncome').value,
      el('frequency').value,
      Number(el('youngChildren').value) || 0,
      el('pregnant').checked,
    ),
  };

  try {
    const screening = await api('/api/screenings', { method: 'POST', body });
    renderResults(screening);
    el('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
});

el('startApplication').addEventListener('click', async () => {
  if (!state.screening) return;
  try {
    const application = await api('/api/applications', {
      method: 'POST',
      body: {
        screeningId: state.screening.id,
        applicant: {
          firstName: 'Avery',
          lastName: 'Applicant',
          email: 'avery@example.test',
          ssn: '123-45-6789',
        },
      },
    });
    renderApplication(application);
    el('application').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    el('formError').textContent = error.message;
    el('formError').hidden = false;
  }
});

el('documentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.application) return;

  const file = el('documentFile').files?.[0];
  if (!file) {
    el('documentMessage').textContent = 'Choose a file first.';
    return;
  }

  try {
    await api(`/api/applications/${state.application.id}/documents`, {
      method: 'POST',
      body: {
        type: el('documentType').value,
        fileName: file.name,
        sizeBytes: file.size,
      },
    });
    const refreshed = await api(`/api/applications/${state.application.id}`);
    renderApplication(refreshed);
    el('documentMessage').textContent =
      'Uploaded. A caseworker will review it.';
    el('documentFile').value = '';
  } catch (error) {
    el('documentMessage').textContent = error.message;
  }
});

function appendChat(text, { user = false, citations = [] } = {}) {
  const item = document.createElement('li');
  if (user) item.className = 'user';
  item.append(document.createTextNode(text));
  for (const citation of citations) {
    const link = document.createElement('span');
    link.className = 'citation';
    link.textContent = `Source: ${citation}`;
    item.append(link);
  }
  el('chatLog').append(item);
  el('chatLog').scrollTop = el('chatLog').scrollHeight;
}

el('chatToggle').addEventListener('click', () => {
  const panel = el('chatPanel');
  panel.hidden = !panel.hidden;
  el('chatToggle').setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) el('chatInput').focus();
});

el('chatClose').addEventListener('click', () => {
  el('chatPanel').hidden = true;
  el('chatToggle').setAttribute('aria-expanded', 'false');
  el('chatToggle').focus();
});

el('chatForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = el('chatInput');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  appendChat(message, { user: true });

  try {
    const answer = await api('/api/assistant/messages', {
      method: 'POST',
      body: {
        message,
        screeningId: state.screening?.id,
      },
    });
    appendChat(answer.reply, { citations: answer.citations });
  } catch (error) {
    appendChat(`Sorry, something went wrong: ${error.message}`);
  }
});

(async () => {
  try {
    renderConfig(await api('/api/config'));
  } catch {
    el('formError').textContent = 'Could not load this agency’s configuration.';
    el('formError').hidden = false;
  }
})();
