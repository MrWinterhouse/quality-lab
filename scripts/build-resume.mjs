#!/usr/bin/env node
/**
 * Publishes the resume: copies `quality/resume-source.pdf` to `site/resume.pdf` byte for byte
 * and records the hashes it was published with.
 *
 * The resume is the one document John writes and formats outside the lab, so the build does not
 * regenerate it from the fixture — a recruiter should download the real file. The fixture,
 * `quality/resume.json`, still drives the front page's experience section and the assistant's
 * resume answers, and the figure gate ties the published PDF to it: edit a career fact without
 * republishing and the gate fails instead of leaving a download that describes a different
 * career than the page.
 *
 * Usage: npm run build:resume
 */
import { createHash } from 'node:crypto';
import { copyFile, readFile, writeFile } from 'node:fs/promises';

const fixturePath = 'quality/resume.json';
const sourcePath = 'quality/resume-source.pdf';
// Hash the LF form: a Windows checkout rewrites the fixture with CRLF, and the published
// resume must not look stale just because of line endings.
const fixtureText = (await readFile(fixturePath, 'utf8')).replace(/\r\n/g, '\n');
const resume = JSON.parse(fixtureText);
const output = resume.resumeFile;

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const source = await readFile(sourcePath).catch(() => null);
if (!source || source.subarray(0, 5).toString('latin1') !== '%PDF-') {
  console.error(
    `[resume] ${sourcePath} is missing or is not a PDF, so ${output} would not be a downloadable resume.`,
  );
  process.exit(1);
}

await copyFile(sourcePath, output);

// Read back what a visitor actually gets: the manifest below is what the gate trusts, so it has
// to describe the published file rather than the one it was copied from.
const published = await readFile(output);
if (!published.equals(source)) {
  console.error(`[resume] ${output} does not match ${sourcePath} after the copy.`);
  process.exit(1);
}

await writeFile(
  'quality/resume.pdf.json',
  `${JSON.stringify(
    {
      fixture: fixturePath,
      fixtureSha256: sha256(Buffer.from(fixtureText, 'utf8')),
      source: sourcePath,
      sourceSha256: sha256(published),
      pdf: output,
      pdfSha256: sha256(published),
      bytes: published.length,
      generatedBy: 'npm run build:resume',
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(`[resume] published ${output} from ${sourcePath} (${published.length} bytes)`);
