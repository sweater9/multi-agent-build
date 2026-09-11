import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionPlan } from '../src/execution-policy.js';
import { ControlledSandboxRunner } from '../src/sandbox-runner.js';
import { runBoundedRepair } from '../src/repair-loop.js';

test('execution plan installs without lifecycle scripts and disables network for code', () => {
  const files=[{path:'package.json',content:JSON.stringify({scripts:{test:'node --test',build:'node build.js'}})}];
  const plan=createExecutionPlan(files);
  assert.deepEqual(plan.steps.map(x=>x.name),['install','test','build']);
  assert.equal(plan.steps[0].network,'registry-only');
  assert.ok(plan.steps[0].command.includes('--ignore-scripts'));
  assert.equal(plan.steps[1].network,'off');
  assert.equal(plan.steps[2].network,'off');
});

test('static projects require no code execution', async () => {
  let called=false;const runner=new ControlledSandboxRunner({executor:{execute:async()=>{called=true;return{passed:true,steps:[]}}}});
  const result=await runner.run([{path:'index.html',content:'ok'}]);
  assert.equal(result.passed,true);assert.equal(called,false);
});

test('bounded repair observes failure, repairs, and reruns', async () => {
  let runs=0,repairs=0;const runner={run:async(files)=>{runs++;const good=files.some(f=>f.content==='fixed');return{passed:good,runtime:'node',summary:{passed:good,failed_step:good?null:'test',diagnostics:good?'':'Assertion failed',steps:[]}}}};
  const result=await runBoundedRepair({files:[{path:'app.js',content:'broken'}],runner,maxAttempts:2,projectId:'project-123',repair:async({diagnostics})=>{repairs++;assert.equal(diagnostics.failed_step,'test');return{files:[{path:'app.js',content:'fixed'}]}}});
  assert.equal(result.passed,true);assert.equal(runs,2);assert.equal(repairs,1);assert.equal(result.attempts.length,2);
});

test('repair loop stops at configured bound', async () => {
  let runs=0,repairs=0;const runner={run:async()=>{runs++;return{passed:false,runtime:'node',summary:{passed:false,failed_step:'build',diagnostics:'bad',steps:[]}}}};
  const result=await runBoundedRepair({files:[{path:'app.js',content:'broken'}],runner,maxAttempts:2,repair:async()=>{repairs++;return{files:[{path:'app.js',content:`broken-${repairs}`}]}}});
  assert.equal(result.passed,false);assert.equal(runs,3);assert.equal(repairs,2);
});
