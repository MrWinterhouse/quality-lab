#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { createApp } from '../product/server/app.mjs';

const TOKEN = 'tok_applicant_a';
const totalRequests = Number(process.env.LOAD_REQUESTS ?? 120);
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 8);
const thresholds = { p95Ms: 250, errorRate: 0.01 };

const app = await createApp({ testHooks: true });

const screeningBody = JSON.stringify({
  state: 'CA',
  householdSize: 4,
  incomeComplete: true,
  members: [
    { age: 35, status: 'citizen', income: { amount: 2000, frequency: 'monthly' } },
    { age: 33, status: 'citizen' },
    { age: 9, status: 'citizen' },
    { age: 3, status: 'citizen' },
  ],
});

const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

const latencies = [];
let errors = 0;
let completed = 0;
const startedAt = Date.now();

async function worker(workerIndex) {
  while (true) {
    const requestIndex = completed;
    if (requestIndex >= totalRequests) return;
    completed += 1;

    const useScreening = requestIndex % 2 === 0;
    const path = useScreening
      ? '/api/screenings'
      : '/api/programs?state=CA&householdSize=4';
    const begin = performance.now();
    try {
      const response = await fetch(`${app.url}${path}`, {
        method: useScreening ? 'POST' : 'GET',
        headers,
        body: useScreening ? screeningBody : undefined,
      });
      const body = await response.text();
      if (!response.ok || body.length === 0) errors += 1;
    } catch {
      errors += 1;
    } finally {
      latencies.push(performance.now() - begin);
    }

    if ((workerIndex + requestIndex) % 7 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
}

await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index)));

const durationMs = Date.now() - startedAt;
await app.close();

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Number(sorted[index].toFixed(1));
}

const report = {
  generatedAt: new Date().toISOString(),
  requests: totalRequests,
  concurrency,
  durationMs,
  throughputPerSecond: Number((totalRequests / (durationMs / 1000)).toFixed(1)),
  errorRate: Number((errors / totalRequests).toFixed(4)),
  latencyMs: {
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    max: Number(Math.max(...latencies).toFixed(1)),
  },
  thresholds,
  passed:
    percentile(latencies, 95) <= thresholds.p95Ms &&
    errors / totalRequests <= thresholds.errorRate,
};

await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/load.json', JSON.stringify(report, null, 2));

console.log('\nLoad smoke');
console.log(`  requests=${report.requests} concurrency=${report.concurrency}`);
console.log(`  p50=${report.latencyMs.p50}ms p95=${report.latencyMs.p95}ms p99=${report.latencyMs.p99}ms`);
console.log(`  errorRate=${(report.errorRate * 100).toFixed(2)}% throughput=${report.throughputPerSecond}/s`);
console.log(`  thresholds: p95<=${thresholds.p95Ms}ms, errorRate<=${thresholds.errorRate * 100}%`);
console.log(`  result: ${report.passed ? 'PASS' : 'FAIL'}`);

if (!report.passed) process.exit(1);
