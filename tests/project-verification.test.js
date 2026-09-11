import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFailure } from '../src/execution-diagnostics.js';
import { summarizeExecution } from '../src/execution-policy.js';
import { buildVerificationReport } from '../src/project-verification.js';

test('classifies module failures for targeted repair',()=>{const failure=classifyFailure({step:'test',stderr:"Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/workspace/src/app.js'"});assert.equal(failure.category,'module');assert.equal(failure.step,'test');assert.match(failure.summary,/Cannot find module/)});

test('execution summary includes structured failure evidence',()=>{const summary=summarizeExecution({passed:false,steps:[{name:'install',status:'success',exit_code:0},{name:'test',status:'failed',exit_code:1,stderr:'AssertionError: expected 2 to equal 3'}]});assert.equal(summary.passed,false);assert.equal(summary.failed_step,'test');assert.equal(summary.failure.category,'test');assert.equal(summary.steps[1].exit_code,1)});

test('verification confirms observed test and build execution',()=>{const files=[{path:'package.json',content:JSON.stringify({scripts:{test:'node --test',build:'node build.js'}})},{path:'tests/app.test.js',content:'test()'}];const execution={passed:true,attempts:[{summary:{steps:[{name:'install',status:'success'},{name:'test',status:'success'},{name:'build',status:'success'}]}}]};const report=buildVerificationReport(files,execution);assert.equal(report.status,'passed');assert.equal(report.checks.test_executed,true);assert.equal(report.checks.build_executed,true);assert.equal(report.blocking_issues.length,0)});

test('verification warns when generated project has no tests',()=>{const files=[{path:'package.json',content:JSON.stringify({scripts:{build:'node build.js'}})}];const execution={passed:true,attempts:[{summary:{steps:[{name:'install',status:'success'},{name:'build',status:'success'}]}}]};const report=buildVerificationReport(files,execution);assert.equal(report.status,'passed');assert.ok(report.warnings.some(x=>/No automated project tests/.test(x)));assert.equal(report.checks.test_executed,false)});

test('verification fails when a declared test script was not executed',()=>{const files=[{path:'package.json',content:JSON.stringify({scripts:{test:'node --test'}})},{path:'app.test.js',content:'test()'}];const execution={passed:true,attempts:[{summary:{steps:[{name:'install',status:'success'}]}}]};const report=buildVerificationReport(files,execution);assert.equal(report.status,'failed');assert.ok(report.blocking_issues.some(x=>/test script exists/.test(x)))});
