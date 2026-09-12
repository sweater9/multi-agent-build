import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpSandboxExecutor } from '../src/sandbox-runner.js';
import { HttpBrowserQaExecutor } from '../src/browser-qa-runner.js';

function response(body,{ok=true,status=200}={}){return{ok,status,async text(){return JSON.stringify(body)}}}

test('sandbox health requires ok=true',async()=>{const executor=new HttpSandboxExecutor({endpoint:'https://sandbox.example',fetchImpl:async()=>response({ok:true,security:{read_only_root:true}})});const health=await executor.health();assert.equal(health.ok,true);assert.equal(health.security.read_only_root,true)});

test('browser health requires browser QA capability',async()=>{const executor=new HttpBrowserQaExecutor({endpoint:'https://sandbox.example',fetchImpl:async()=>response({ok:true,browser_qa:true})});const health=await executor.health();assert.equal(health.browser_qa,true)});

test('browser health rejects worker without browser QA',async()=>{const executor=new HttpBrowserQaExecutor({endpoint:'https://sandbox.example',fetchImpl:async()=>response({ok:true,browser_qa:false})});await assert.rejects(()=>executor.health(),/not ready/i)});
