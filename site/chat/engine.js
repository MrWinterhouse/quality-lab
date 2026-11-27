/**
 * Deterministic hiring assistant for the portfolio.
 *
 * The page has no server, no API key and no model call, so this is a retrieval
 * assistant rather than an LLM: it selects one entry from a closed knowledge base and
 * returns that entry's curated answer with its citations. A keyword matches when its words
 * appear in any order, so a phrasing the dataset never listed still reaches the answer, and
 * a question about the assistant itself gets a reply that lists what it covers. When nothing
 * published supports the question it still refuses rather than guessing, but it names the
 * closest published topics so the conversation has somewhere to go.
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

// Answered from the knowledge base's own scope, so the reply cannot drift into topics the
// portfolio does not publish. The page renders no test panel for it unless a golden case
// covers it, which is why the dataset has one.
export const HELP_REPLY =
  'I answer from a closed knowledge base, so every reply is sourced: the pitch and role fit, the resume (experience, employers, location, education, AI work), the case studies, how the work is tested (evals, the Python oracle, CI), what is still unverified, and how to reach John. Ask in your own words — when nothing fits, I name the closest topics instead of guessing.';

const HELP_CITATIONS = [
  { id: 'portfolio-index', label: 'Portfolio overview', href: './' },
  { id: 'release-report', label: 'Release readiness report', href: 'reports/quality-report.html' },
];

// Matched against the whole normalized message: "help me understand the tenant bug" is a
// question about the bug, not a request for the menu.
const HELP_PATTERN =
  /^(help|help me|what can you (answer|help)( me)?( with)?|what topics( can i ask about)?|what can i ask( about)?|how can you help( me)?|what should i ask|what do you know( about)?)$/;

// Rule checks run before scoring: these questions must never be answered by a
// best-effort keyword match, even if one of the entries happens to share a word.
const INJECTION_PATTERN =
  /ignore (all )?(the )?(previous|prior|above) instructions|system prompt|reveal (your|the) (instructions|prompt|rules)|jailbreak|pretend (you are|to be)|act as (a|an) |forget (your|all) (rules|instructions)/i;

const COMPENSATION_PATTERN =
  /\b(salary|compensation|day rate|hourly rate|rate card|package|negotiat|pay expectation|pay expectations|expected pay|pay range|pay rate|pay band|pay offer)\b/i;

// normalize() drops "$", so a question that puts the figure in dollars — "Would you accept
// $120k?" — would otherwise slip past the compensation rule. Test the raw message too.
const MONEY_FIGURE_PATTERN = /\$\s?\d/;

// Facts the portfolio does not state. Location, years of experience and education are now
// published on the resume section, so they are answered; availability, work authorization,
// relocation and time zone are still refused rather than inferred.
// Availability, work authorization and other facts the portfolio deliberately does not state.
// The pattern has to catch the question however it is phrased — "when could he start", "would
// he relocate" — because a question this rule misses falls through to keyword scoring, where
// a broad keyword can answer it with something unrelated. `relocat\w*` is deliberate: a bare
// `relocat` with a trailing word boundary never matches "relocate" or "relocation".
const UNPUBLISHED_PATTERN =
  /\b(remote|relocat\w*|time ?zone|visa|sponsorship|authorized to work|work authorization|right to work|work permit|green card|availability|start date|notice period|clearance|citizen|citizenship|how soon|when (could|can|would) (you|he|she|they|john) (start|begin)|interviewing (elsewhere|anywhere|somewhere else)|other (interviews|offers)|competing offers)\b/i;

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
  const tokens = normalizedMessage.split(' ').filter(Boolean);
  let score = 0;

  // A keyword made only of content words may appear in any order: "which probes fail on
  // purpose" should reach "defect probes" without the dataset listing that phrasing. A
  // keyword containing function words ("how is this tested") keeps its order, because those
  // words say nothing on their own and flexing them matches half the page.
  for (const keyword of entry.keywords ?? []) {
    const words = normalize(keyword).split(' ').filter(Boolean);
    if (words.length === 0) continue;
    const flexible = words.length > 1 && words.every((word) => !STOPWORDS.has(word));
    const matched = flexible
      ? words.every((word) => phraseMatches(normalizedMessage, word))
      : phraseMatches(normalizedMessage, normalize(keyword));
    if (matched) score += words.length > 1 ? 4 : 2;
  }

  // A title word the question already uses is a weak signal: enough to break a tie between
  // two keyword matches, never enough on its own to answer a question nothing else matched.
  const titleWords = new Set(
    normalize(entry.title ?? '')
      .split(' ')
      .filter((word) => word.length >= 5 && !STOPWORDS.has(word)),
  );
  if (tokens.some((token) => token.length >= 5 && titleWords.has(token))) score += 0.5;

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

    if (HELP_PATTERN.test(normalized)) {
      return {
        reply: HELP_REPLY,
        citations: HELP_CITATIONS,
        refused: false,
        topic: 'help',
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
      // A dead end is the rigidity people notice. The question still gets no invented answer,
      // but the entries it already echoes are named, so the next question can be a real one.
      const suggestions = ranked
        .filter((candidate) => candidate.score > 0)
        .slice(0, 2)
        .map((candidate) => `“${candidate.entry.title}”`);
      const lead = suggestions.length
        ? ` Closest published topics: ${suggestions.join(' and ')}.`
        : '';
      return {
        reply: `${OUT_OF_SCOPE_REFUSAL}${lead}`,
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
