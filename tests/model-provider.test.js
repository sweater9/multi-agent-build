import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiProvider, createModelProviderFromEnvironment } from '../src/model-provider.js';

test('environment selects Groq first and NVIDIA NIM second', () => {
  const provider = createModelProviderFromEnvironment({ GROQ_API_KEY: 'g', NVIDIA_NIM_API_KEY: 'n' });
  assert.ok(provider);
  assert.equal(provider.providers.length, 2);
  assert.equal(provider.providers[0].name, 'groq');
  assert.equal(provider.providers[1].name, 'nvidia-nim');
});

test('environment accepts NVIDIA_API_KEY alias', () => {
  const provider = createModelProviderFromEnvironment({ NVIDIA_API_KEY: 'n' });
  assert.ok(provider);
  assert.equal(provider.providers.length, 1);
  assert.equal(provider.providers[0].name, 'nvidia-nim');
});

test('multi-provider falls back after primary failure', async () => {
  const calls = [];
  const provider = new MultiProvider({ providers: [
    { name: 'primary', async generate() { calls.push('primary'); throw new Error('down'); } },
    { name: 'fallback', async generate() { calls.push('fallback'); return { ok: true }; } }
  ] });
  const out = await provider.generate({});
  assert.deepEqual(calls, ['primary', 'fallback']);
  assert.deepEqual(out, { ok: true });
});
