/**
 * Loads `engine.js` through a fresh fetch, as a blob module.
 *
 * GitHub Pages serves the module with a long cache lifetime and its URL never changes, so a
 * browser that cached an older engine keeps running its rules against a newly fetched
 * knowledge base — the bug that let a stale boundary pattern refuse questions the new
 * entries answer. Requesting the source with `cache: 'reload'` and importing it from a blob
 * makes the code and the data a visitor runs in the same load, without a build stamp to
 * forget to bump.
 */
export async function loadEngine(path = 'chat/engine.js') {
  const response = await fetch(path, { cache: 'reload' });
  if (!response.ok) throw new Error(`engine.js returned ${response.status}`);
  const source = await response.text();
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    return await import(url);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
