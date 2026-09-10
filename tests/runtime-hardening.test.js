import test from 'node:test';
import assert from 'node:assert/strict';
import { SlidingWindowRateLimiter } from '../src/rate-limit.js';
import { HttpJsonProvider } from '../src/providers.js';
import { GitHubRestClient } from '../src/github-client.js';

test('rate limiter blocks requests beyond the configured window budget', () => {
  let now = 1000;
  const limiter = new SlidingWindowRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('a').allowed, false);
  now = 2001;
  assert.equal(limiter.check('a').allowed, true);
});

test('provider requires HTTPS by default', () => {
  assert.throws(() => new HttpJsonProvider({ endpoint: 'http://example.com' }), /must use HTTPS/);
});

test('provider host allowlist is enforced', () => {
  assert.throws(
    () => new HttpJsonProvider({ endpoint: 'https://example.com', allowedHosts: ['api.example.net'] }),
    /not allowlisted/
  );
});

test('provider rejects oversized JSON responses', async () => {
  const provider = new HttpJsonProvider({
    endpoint: 'https://example.com',
    maxResponseBytes: 1024,
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ output: { value: 'x'.repeat(2000) } })
    })
  });
  await assert.rejects(() => provider.generate({ agentRole: 'planner', input: {} }), /maximum size/);
});

test('GitHub client exposes getCiStatus expected by repository handlers', async () => {
  const client = new GitHubRestClient({
    token: 'test',
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify({ workflow_runs: [{ id: 1, workflow_id: 1, name: 'CI', status: 'completed', conclusion: 'success' }] })
    })
  });
  const status = await client.getCiStatus({ repository: 'owner/repo', ref: 'feature/test' });
  assert.equal(status.status, 'success');
  assert.equal(status.checks[0].id, 1);
});
