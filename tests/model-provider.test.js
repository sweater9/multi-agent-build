import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiProvider, OpenAICompatibleProvider, createModelProviderFromEnvironment } from '../src/model-provider.js';

test('environment selects configured providers in stable fallback order', () => {
  const provider = createModelProviderFromEnvironment({
    GROQ_API_KEY: 'g',
    NVIDIA_NIM_API_KEY: 'n',
    ALIBABA_API_KEY: 'a',
    GEMINI_API_KEY: 'gm',
    APINEX_API_KEY: 'apx'
  });
  assert.ok(provider);
  assert.deepEqual(provider.names(), ['groq','nvidia-nim','alibaba','gemini','apinex']);
});

test('environment accepts provider key aliases', () => {
  const provider = createModelProviderFromEnvironment({ NVIDIA_API_KEY: 'n', DASHSCOPE_API_KEY: 'a', GOOGLE_API_KEY: 'g' });
  assert.ok(provider);
  assert.deepEqual(provider.names(), ['nvidia-nim','alibaba','gemini']);
});

test('provider defaults use verified OpenAI-compatible endpoints', () => {
  const provider = createModelProviderFromEnvironment({ ALIBABA_API_KEY: 'a', GEMINI_API_KEY: 'g', APINEX_API_KEY: 'p' });
  const [alibaba,gemini,apinex]=provider.providers;
  assert.equal(alibaba.endpoint,'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(gemini.endpoint,'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(apinex.endpoint,'https://api.apinex.bond/v1/chat/completions');
});

test('provider-specific model overrides are honored', () => {
  const provider=createModelProviderFromEnvironment({
    ALIBABA_API_KEY:'a',ALIBABA_MODEL:'qwen-custom',
    GEMINI_API_KEY:'g',GEMINI_MODEL:'gemini-custom',
    APINEX_API_KEY:'p',APINEX_MODEL:'model/custom'
  });
  assert.deepEqual(provider.providers.map(x=>x.model),['qwen-custom','gemini-custom','model/custom']);
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

test('aliases select new providers explicitly',()=>{
  const provider=new MultiProvider({providers:[
    {name:'alibaba',async generate(){return{}}},
    {name:'gemini',async generate(){return{}}},
    {name:'apinex',async generate(){return{}}}
  ]});
  assert.equal(provider.select('dashscope').name,'alibaba');
  assert.equal(provider.select('google').name,'gemini');
  assert.equal(provider.select('apinex.bond').name,'apinex');
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
