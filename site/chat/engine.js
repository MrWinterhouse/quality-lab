/**
 * Deterministic hiring assistant for the portfolio.
 *
 * The page has no server, no API key and no model call, so this is a retrieval
 * assistant rather than an LLM: it selects one entry from a closed knowledge base and
 * returns that entry's curated answer with its citations. If nothing in the knowledge
 * base supports the question, it says so instead of guessing.
 *
 * The same file is imported by the browser (site/chat/chat.js) and by the eval runner
 * (scripts/chatbot-evals.mjs), so the tests exercise the code that ships.
 */

export const INJECTION_REFUSAL =
  "I can't share setup text, change roles or pretend to be a different assistant. I can answer questions about John's work, and every answer comes from this portfolio's published evidence.";

export const OUT_OF_SCOPE_REFUSAL =
  "I don't have anything published on that, so I would rather not guess. I answer questions about the benefits-eligibility lab, its defects, how they were tested, and what the evidence does not cover. For anything else, email Jwinterhouse3@gmail.com.";

export const EMPTY_REFUSAL =
  'Ask a question about the work — the case studies, the testing approach, or what is not verified yet.';

// Rule checks run before scoring: these questions must never be answered by a
// best-effort keyword match, even if one of the entries happens to share a word.
const INJECTION_PATTERN =
  /ignore (all )?(the )?(previous|prior|above) instructions|system prompt|reveal (your|the) (instructions|prompt|rules)|jailbreak|pretend (you are|to be)|act as (a|an) |forget (your|all) (rules|instructions)/i;

const COMPENSATION_PATTERN =
  /\b(salary|compensation|day rate|hourly rate|rate card|package|negotiat|pay expectation|pay expectations|expected pay|pay range|pay rate|pay band|pay offer)\b/i;

// normalize() drops "$", so a question that puts the figure in dollars — "Would you accept
// $120k?" — would otherwise slip past the compensation rule. Test the raw message too.
const MONEY_FIGURE_PATTERN = /\$\s?\d/;

// Facts the portfolio does not state. The assistant refuses rather than inventing a
// location, a years-of-experience figure or an availability date.
const UNPUBLISHED_PATTERN =
  /\b(where are you|where do you|based|location|located|remote|relocat|time ?zone|years of experience|how long have you|degree|education|university|visa|sponsorship|authorized to work|work authorization|right to work|work permit|green card|availability|start date|notice period|clearance|citizen|how soon|when (could|can|would) you (start|begin))\b/i;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'your', 'yours', 'are', 'was', 'were', 'what', 'which', 'who',
  'whom', 'how', 'why', 'when', 'where', 'can', 'could', 'would', 'should', 'does', 'did',
  'about', 'with', 'that', 'this', 'these', 'those', 'have', 'has', 'had', 'from', 'into',
  'tell', 'give', 'show', 'any', 'some', 'there', 'their', 'them', 'they', 'its', 'our',
  'not', 'but', 'all', 'one', 'two', 'get', 'got', 'make', 'made', 'also', 'just', 'more',
  'most', 'than', 'then', 'very', 'much', 'many', 'like', 'want', 'need', 'know', 'think',
]);

export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A keyword matches when it appears as a whole word, allowing a suffix so that
// "annualiz" covers annualized/annualization and "guardrail" covers guardrails.
function phraseMatches(text, phrase) {
  const pattern = new RegExp(`(^|[^a-z0-9])${escape(phrase)}[a-z]*([^a-z0-9]|$)`, 'i');
  return pattern.test(text);
}

export function scoreEntry(entry, normalizedMessage) {
  let score = 0;
  for (const keyword of entry.keywords ?? []) {
    if (phraseMatches(normalizedMessage, normalize(keyword))) {
      score += keyword.includes(' ') ? 4 : 2;
    }
  }
  return score;
}

export function createAssistant(entries) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const contactCitations = byId.get('contact')?.citations ?? [];

  function answerFrom(entry, { refused = false, score = 0 } = {}) {
    return {
      reply: entry.answer,
      citations: entry.citations ?? [],
      refused,
      topic: entry.id,
      score,
    };
  }

  function ask(message) {
    const normalized = normalize(message);

    if (!normalized) {
      return {
        reply: EMPTY_REFUSAL,
        citations: [],
        refused: true,
        topic: 'empty',
        score: 0,
      };
    }

    if (INJECTION_PATTERN.test(normalized)) {
      return {
        reply: INJECTION_REFUSAL,
        citations: [],
        refused: true,
        topic: 'injection',
        score: 0,
      };
    }

    const asksAboutPay =
      COMPENSATION_PATTERN.test(normalized) || MONEY_FIGURE_PATTERN.test(String(message ?? ''));
    const ruleTopic = asksAboutPay
      ? 'compensation'
      : UNPUBLISHED_PATTERN.test(normalized)
        ? 'boundary'
        : null;
    if (ruleTopic && byId.has(ruleTopic)) {
      return answerFrom(byId.get(ruleTopic), { refused: true });
    }

    const ranked = entries
      .map((entry, index) => ({ entry, index, score: scoreEntry(entry, normalized) }))
      .sort((left, right) => right.score - left.score || left.index - right.index);

    const best = ranked[0];
    if (!best || best.score < 2) {
      return {
        reply: OUT_OF_SCOPE_REFUSAL,
        citations: contactCitations,
        refused: true,
        topic: 'out-of-scope',
        score: 0,
      };
    }

    return answerFrom(best.entry, { score: best.score });
  }

  return { ask, ids: entries.map((entry) => entry.id) };
}
