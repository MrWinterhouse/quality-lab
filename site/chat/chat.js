import { createAssistant } from './engine.js';

const log = document.getElementById('chat-log');
const form = document.getElementById('chat-form');
const input = document.getElementById('chat-input');
const clear = document.getElementById('chat-clear');

let assistant = null;

function addMessage(role, text, citations = []) {
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

  log.append(item);
  item.scrollIntoView({ block: 'nearest' });
  return item;
}

function ask(question) {
  const message = question.trim();
  if (!message || !assistant) return;
  addMessage('user', message);
  const response = assistant.ask(message);
  addMessage('assistant', response.reply, response.citations);
}

async function start() {
  try {
    const response = await fetch('chat/knowledge.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`knowledge base returned ${response.status}`);
    assistant = createAssistant(await response.json());
  } catch (error) {
    addMessage(
      'assistant',
      'The knowledge base did not load. If this page was opened as a file, serve the folder over HTTP instead (for example npx --yes serve site).',
    );
    console.error(error);
    return;
  }

  log.replaceChildren();
  addMessage(
    'assistant',
    'I answer from a closed knowledge base: the case studies, the test infrastructure and what the evidence does not cover. Nothing you type leaves this page.',
  );

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
