import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runSandboxPreflight } from '../src/sandbox-preflight.js';

function spawnSequence(results){let i=0;return()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};queueMicrotask(()=>{const r=results[i++]||{code:0,stdout:''};if(r.stdout)child.stdout.emit('data',r.stdout);if(r.stderr)child.stderr.emit('data',r.stderr);child.emit('close',r.code??0,null)});return child}}

test('preflight rejects default bridge network',async()=>{await assert.rejects(()=>runSandboxPreflight({registryNetwork:'bridge'}),/dedicated isolated network/)});

test('preflight verifies engine and registry network',async()=>{const result=await runSandboxPreflight({registryNetwork:'sandbox-registry-egress',spawnImpl:spawnSequence([{code:0,stdout:'28.0.1'},{code:0,stdout:'[]'}])});assert.equal(result.ready,true);assert.equal(result.checks[0].id,'engine');assert.equal(result.checks[1].id,'registry-network')});

test('preflight fails when registry network is missing on host',async()=>{const result=await runSandboxPreflight({registryNetwork:'sandbox-registry-egress',spawnImpl:spawnSequence([{code:0,stdout:'28.0.1'},{code:1,stderr:'network not found'}])});assert.equal(result.ready,false);assert.equal(result.checks[1].passed,false)});

test('preflight can require digest pinned images',async()=>{const result=await runSandboxPreflight({registryNetwork:'sandbox-registry-egress',requirePinnedImages:true,spawnImpl:spawnSequence([{code:0,stdout:'28.0.1'},{code:0,stdout:'[]'}])});assert.equal(result.ready,false);assert.equal(result.checks.find(c=>c.id==='node-image-pinned').passed,false)});
