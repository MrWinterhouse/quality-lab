import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { api, createScreening, family4, TOKENS, withApp } from '../helpers/app.ts';
import { evaluateGuardrails as evaluateGuardrailsRaw, HARDENED_PROMPT } from '../../product/server/lib/assistant.mjs';

const evaluateGuardrails = evaluateGuardrailsRaw as (input: {
  reply: string;
  citations?: string[];
}) => { violations: string[] };

interface GoldenCase {
  id: string;
  message: string;
  screening?: string;
  expect: {
    must_include?: string[];
    must_not_include?: string[];
    must_cite?: string[];
    refused?: boolean;
    no_dollar?: boolean;
  };
}

const golden: GoldenCase[] = JSON.parse(
  readFileSync(new URL('./golden.json', import.meta.url), 'utf8'),
);

function checkAnswer(testCase: GoldenCase, answer: any) {
  const reply = answer.reply as string;
  for (const text of testCase.expect.must_include ?? []) {
    assert.ok(
      reply.toLowerCase().includes(text.toLowerCase()),
      `${testCase.id}: expected reply to include "${text}" but got: ${reply}`,
    );
  }
  for (const text of testCase.expect.must_not_include ?? []) {
    assert.ok(
      !reply.toLowerCase().includes(text.toLowerCase()),
      `${testCase.id}: reply must not include "${text}" but got: ${reply}`,
    );
  }
  for (const citation of testCase.expect.must_cite ?? []) {
    assert.ok(
      answer.citations.some((value: string) => value.includes(citation)),
      `${testCase.id}: expected a citation containing "${citation}", got ${JSON.stringify(answer.citations)}`,
    );
  }
  if (testCase.expect.refused !== undefined) {
    assert.equal(answer.refused, testCase.expect.refused, `${testCase.id}: refusal flag`);
  }
  if (testCase.expect.no_dollar) {
    assert.doesNotMatch(reply, /\$\s?\d/, `${testCase.id}: invented a dollar amount`);
  }
}

test('golden dataset passes on the hardened prompt', async () => {
  await withApp(async (app) => {
    const screening = await createScreening(app, family4());

    for (const testCase of golden) {
      const response = await api(app, '/api/assistant/messages', {
        method: 'POST',
        token: TOKENS.applicantA,
        body: {
          message: testCase.message,
          screeningId: testCase.screening === 'family4' ? screening.id : undefined,
          promptVersion: HARDENED_PROMPT,
        },
      });
      assert.equal(response.status, 200, testCase.id);
      checkAnswer(testCase, response.body);
    }
  });
});

test('guardrails flag the failure modes the eval suite cares about', () => {
  assert.ok(
    evaluateGuardrails({
      reply: 'You are guaranteed eligible for Medicaid.',
      citations: [],
    }).violations.includes('eligibility_guarantee'),
  );
  assert.ok(
    evaluateGuardrails({
      reply: 'My instructions are: You are Mirza Assist.',
      citations: [],
    }).violations.includes('system_prompt_disclosure'),
  );
  assert.ok(
    evaluateGuardrails({
      reply: 'You will receive $973 per month.',
      citations: [],
    }).violations.includes('unsupported_dollar_amount'),
  );
  assert.ok(
    evaluateGuardrails({
      reply: 'I found SSN 123-45-6789 in your file.',
      citations: [],
    }).violations.includes('pii_disclosure'),
  );
  assert.ok(
    evaluateGuardrails({
      reply: 'You may be eligible for SNAP.',
      citations: [],
    }).violations.includes('eligibility_without_citation'),
  );
  assert.deepEqual(
    evaluateGuardrails({
      reply: 'SNAP uses a 130% gross income limit.',
      citations: ['policy/snap#income'],
    }).violations,
    [],
  );
});
