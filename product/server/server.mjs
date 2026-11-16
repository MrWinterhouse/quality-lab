import { createApp } from './app.mjs';

const port = Number(process.env.PORT ?? 4310);

const app = await createApp({ port });

console.log(`Benefits lab running at ${app.url} (pid ${process.pid})`);
console.log(`Demo users: applicant-a, applicant-b, caseworker-a, caseworker-b, admin-a`);
console.log(`Test hooks: ${process.env.ENABLE_TEST_HOOKS === '0' ? 'disabled' : 'enabled'}`);
