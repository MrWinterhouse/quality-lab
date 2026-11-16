/** Development-only PII helpers. */
export function maskSsn(value) {
  if (typeof value !== 'string' || value.length < 4) return '***-**-****';
  return `***-**-${value.slice(-4)}`;
}

const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;

/** Removes SSN-shaped strings before anything reaches a log or an event payload. */
export function redactSsn(value) {
  if (typeof value === 'string') return value.replace(SSN_PATTERN, '***-**-****');
  if (Array.isArray(value)) return value.map(redactSsn);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSsn(item)]));
  }
  return value;
}
