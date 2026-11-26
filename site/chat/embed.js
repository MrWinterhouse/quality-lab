/**
 * The compact hiring assistant in the front page's hero.
 *
 * It imports the same engine and knowledge base as the full chat page, so an answer here is
 * the answer the golden dataset tests: same retrieval, same citations, same refusals. This
 * file only renders — every sentence it shows comes from knowledge.json and coverage.json.
 */
import { createAssistant } from './engine.js';

const form = document.getElementById('hero-chat-form');
const input = document.getElementById('hero-chat-input');
const log = document.getElementById('hero-chat-log');
const chips = [...document.querySelectorAll('.hero-chat-chips .chat-suggestion')];

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

let assistant = null;
let coverage = null;

function render(question, answer) {
  log.replaceChildren();
  log.append(el('p', 'hero-chat-q', `“${question}”`), el('p', 'hero-chat-a', answer.reply));

  if (answer.citations?.length) {
    const sources = el('p', 'hero-chat-src', 'From: ');
    answer.citations.forEach((citation, index) => {
      if (index > 0) sources.append(' · ');
      const link = el('a', null, citation.label);
      link.href = citation.href;
      sources.append(link);
    });
    log.append(sources);
  }

  const cases = coverage?.topics?.[answer.topic];
  if (Array.isArray(cases) && cases.length > 0) {
    const tests = el(
      'p',
      'hero-chat-tests',
      `${cases.length} golden case${cases.length === 1 ? '' : 's'} assert this answer · `,
    );
    const link = el('a', null, 'see them');
    link.href = 'chat.html';
    tests.append(link);
    log.append(tests);
  }
}

function ask(question) {
  const message = question.trim();
  if (!assistant || !message) return;
  render(message, assistant.ask(message));
  input.value = '';
  input.focus();
}

async function start() {
  try {
    const response = await fetch('chat/knowledge.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`knowledge base returned ${response.status}`);
    assistant = createAssistant(await response.json());
    coverage = await fetch('chat/coverage.json', { cache: 'no-store' })
      .then((value) => (value.ok ? value.json() : null))
      .catch(() => null);
  } catch (error) {
    console.error(error);
    log.replaceChildren(
      el('p', 'hero-chat-a', 'The assistant did not load.'),
      el('p', 'hero-chat-foot', 'Serve the folder over HTTP, or open the full chat page.'),
    );
    return;
  }

  for (const control of [input, form.querySelector('button'), ...chips]) control.disabled = false;
  log.replaceChildren(
    el('p', 'hero-chat-a', 'Ask about the case studies, the release decision, or what is still unverified.'),
  );
}

if (form && input && log) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    ask(input.value);
  });

  for (const chip of chips) chip.addEventListener('click', () => ask(chip.textContent));

  start();
}
