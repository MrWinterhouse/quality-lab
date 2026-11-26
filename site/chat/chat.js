import { loadEngine } from './load-engine.js';

const log = document.getElementById('chat-log');
const form = document.getElementById('chat-form');
const input = document.getElementById('chat-input');
const clear = document.getElementById('chat-clear');

let assistant = null;
let coverage = null;

// The published run's figures are stamped into the page from the same summary as the
// report, so the panel repeats those numbers instead of keeping its own copy of them.
function stamped(key, fallback) {
  const element = document.querySelector(`[data-figure="${key}"]`);
  const value = element?.textContent?.trim();
  return value || fallback;
}

// One panel per answer, built from site/chat/coverage.json: the cases in the golden
// dataset that assert this answer's topic, and what each of them asserts.
function renderTests(topic) {
  if (!coverage) return null;

  const cases = coverage.topics?.[topic];
  if (!Array.isArray(cases) || cases.length === 0) {
    // The gap is shown instead of hidden: an answer nothing asserts is exactly what this
    // portfolio is supposed to be honest about.
    const gap = document.createElement('p');
    gap.className = 'chat-tests chat-tests-empty';
    gap.textContent = 'No golden case asserts this answer yet — the gap is visible rather than hidden.';
    return gap;
  }

  const details = document.createElement('details');
  details.className = 'chat-tests';

  const summary = document.createElement('summary');
  summary.textContent = `How this answer is tested · ${cases.length} golden case${
    cases.length === 1 ? '' : 's'
  }`;

  const note = document.createElement('p');
  note.className = 'chat-tests-note';
  note.textContent =
    'npm run test:chatbot runs these cases against site/chat/engine.js, the file this page loads. Each case asserts:';

  const list = document.createElement('ul');
  list.className = 'chat-tests-list';

  for (const testCase of cases) {
    const item = document.createElement('li');
    item.className = 'chat-test';

    const question = document.createElement('p');
    question.className = 'chat-test-q';
    const id = document.createElement('code');
    id.textContent = testCase.id;
    question.append(id, `“${testCase.question}”`);

    const checks = document.createElement('p');
    checks.className = 'chat-test-checks';
    checks.textContent = (testCase.checks ?? []).join(' · ');

    item.append(question, checks);
    list.append(item);
  }

  const run = document.createElement('p');
  run.className = 'chat-tests-run';
  run.append(
    `Latest published run: ${stamped('chatbot.passed', '?')} of ${stamped(
      'chatbot.cases',
      String(coverage.total ?? cases.length),
    )} cases pass (${stamped('chatbot.failed', '?')} failing). `,
  );
  if (coverage.report) {
    const link = document.createElement('a');
    link.href = coverage.report;
    link.textContent = 'Per-case report →';
    run.append(link);
  }

  details.append(summary, note, list, run);
  return details;
}

function addMessage(role, text, citations = [], topic = null) {
  const item = document.createElement('li');
  item.className = `chat-msg chat-msg--${role}`;

  const who = document.createElement('span');
  who.className = 'chat-who';
  who.textContent = role === 'user' ? 'You' : 'Assistant';

  const body = document.createElement('p');
  body.className = 'chat-text';
  body.textContent = text;

  item.append(who, body);

  if (citations.length > 0) {
    const sources = document.createElement('p');
    sources.className = 'chat-sources';
    sources.append('From: ');
    citations.forEach((citation, index) => {
      if (index > 0) sources.append(' · ');
      const link = document.createElement('a');
      link.href = citation.href;
      link.textContent = citation.label;
      sources.append(link);
    });
    item.append(sources);
  }

  if (role === 'assistant') {
    const tests = renderTests(topic);
    if (tests) item.append(tests);
  }

  log.append(item);
  item.scrollIntoView({ block: 'nearest' });
  return item;
}

function ask(question) {
  const message = question.trim();
  if (!message || !assistant) return;
  addMessage('user', message);
  const response = assistant.ask(message);
  addMessage('assistant', response.reply, response.citations, response.topic);
}

async function start() {
  try {
    const [engine, response] = await Promise.all([
      loadEngine(),
      fetch('chat/knowledge.json', { cache: 'no-store' }),
    ]);
    if (!response.ok) throw new Error(`knowledge base returned ${response.status}`);
    assistant = engine.createAssistant(await response.json());
  } catch (error) {
    addMessage(
      'assistant',
      'The knowledge base did not load. If this page was opened as a file, serve the folder over HTTP instead (for example npx --yes serve site).',
    );
    console.error(error);
    return;
  }

  // Optional evidence: without it the answers still work, they just carry no test panel.
  const coverageResponse = await fetch('chat/coverage.json', { cache: 'no-store' }).catch(
    () => null,
  );
  if (coverageResponse?.ok) {
    coverage = await coverageResponse.json();
  } else {
    console.warn('Golden-case coverage did not load; answers render without their test panel.');
  }

  log.replaceChildren();
  addMessage(
    'assistant',
    'I answer from a closed knowledge base: the case studies, the test infrastructure and what the evidence does not cover. Nothing you type leaves this page. Each answer lists the golden cases that assert it.',
  );

  // The controls stay disabled until the knowledge base is loaded, so a click during
  // load is impossible rather than silently dropped.
  for (const control of document.querySelectorAll(
    '#chat-input, #chat-form button, .chat-suggestion, #chat-clear',
  )) {
    control.disabled = false;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    ask(input.value);
    input.value = '';
    input.focus();
  });

  clear.addEventListener('click', () => {
    log.replaceChildren();
    input.focus();
  });

  for (const button of document.querySelectorAll('.chat-suggestion')) {
    button.addEventListener('click', () => ask(button.textContent));
  }
}

start();
