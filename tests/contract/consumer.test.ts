import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { api, TOKENS, withApp } from '../helpers/app.ts';

/**
 * A minimal consumer-contract check. In a larger org this is where a Pact
 * consumer test or a schema-registry compatibility check would live.
 */
const interactions = JSON.parse(
  readFileSync(new URL('../../quality/consumer-contract.json', import.meta.url), 'utf8'),
);

function matches(actual: unknown, expected: unknown, path = '$'): string[] {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if ('$type' in (expected as Record<string, unknown>)) {
      const type = (expected as Record<string, string>).$type;
      const actualType = Array.isArray(actual) ? 'array' : typeof actual;
      return actualType === type ? [] : [`${path}: expected ${type}, got ${actualType}`];
    }
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
      return [`${path}: expected object, got ${Array.isArray(actual) ? 'array' : typeof actual}`];
    }
    const errors: string[] = [];
    for (const [key, value] of Object.entries(expected as Record<string, unknown>)) {
      if (!(key in (actual as Record<string, unknown>))) {
        errors.push(`${path}.${key}: missing`);
      } else {
        errors.push(...matches((actual as Record<string, unknown>)[key], value, `${path}.${key}`));
      }
    }
    return errors;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path}: expected array`];
    if (actual.length !== expected.length) {
      return [`${path}: expected ${expected.length} items, got ${actual.length}`];
    }
    return expected.flatMap((item, index) => matches(actual[index], item, `${path}[${index}]`));
  }

  return actual === expected ? [] : [`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
}

test('web app consumer expectations are satisfied by the provider', async () => {
  await withApp(async (app) => {
    for (const interaction of interactions) {
      const result = await api(app, interaction.request.path, {
        method: interaction.request.method,
        token: TOKENS.applicantA,
        body: interaction.request.body,
      });

      assert.equal(
        result.status,
        interaction.response.status,
        `${interaction.description}: status`,
      );
      assert.deepEqual(
        matches(result.body, interaction.response.body),
        [],
        interaction.description,
      );
    }
  });
});
