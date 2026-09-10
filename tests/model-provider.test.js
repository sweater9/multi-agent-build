import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiProvider, OpenAICompatibleProvider, createModelProviderFromEnvironment } from '../src/model-provider.js';

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

test('explicit provider selection disables fallback', async () => {
  const calls=[];
  const provider=new MultiProvider({providers:[
    {name:'groq',async generate(){calls.push('groq');return{answer:'g'}}},
    {name:'nvidia-nim',async generate(){calls.push('nvidia');return{answer:'n'}}}
  ]});
  const selected=provider.select('nvidia-nim');
  const out=await selected.generate({});
  assert.equal(out.answer,'n');
  assert.deepEqual(calls,['nvidia']);
});

test('auto selection preserves fallback router',()=>{
  const provider=new MultiProvider({providers:[{name:'groq',async generate(){return{}}}]});
  assert.equal(provider.select('auto'),provider);
  assert.deepEqual(provider.names(),['groq']);
});

test('unknown provider selection fails clearly',()=>{
  const provider=new MultiProvider({providers:[{name:'groq',async generate(){return{}}}]});
  assert.throws(()=>provider.select('missing'),/not configured/);
});

test('multi-provider uses the first provider that supports research', async () => {
  const calls=[];
  const provider=new MultiProvider({providers:[
    {name:'plain',async generate(){return{};}},
    {name:'researcher',async generate(){return{};},async research(){calls.push('researcher');return{answer:'evidence',sources:[]}}}
  ]});
  const out=await provider.research({goal:'latest'});
  assert.equal(out.answer,'evidence');
  assert.deepEqual(calls,['researcher']);
});

test('dynamic roles use bounded token budgets below provider maximum',()=>{
  const provider=new OpenAICompatibleProvider({endpoint:'https://example.com/v1/chat/completions',apiKey:'x',model:'test',maxTokens:4000});
  assert.equal(provider.tokenBudget('dynamic_planner'),650);
  assert.equal(provider.tokenBudget('specialist'),900);
  assert.equal(provider.tokenBudget('judge'),1400);
  assert.equal(provider.tokenBudget('dynamic_qa'),900);
});
