import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { SoftwareBuilder } from '../src/software-builder.js';
import { ProjectWorkspaceStore } from '../src/project-workspace.js';

function fixture(){const calls=[];const provider={async generate({agentRole,input}){calls.push({agentRole,input});if(agentRole==='product_manager')return{objective:'Expense tracker',functional_requirements:['Add expense']};if(agentRole==='software_architect')return{stack:['Node','HTML'],components:['web']};if(agentRole==='software_engineer')return{summary:'Starter created',files:[{path:'package.json',content:'{"scripts":{"test":"node --test"}}'},{path:'src/app.js',content:'export const app=true;'}]};if(agentRole==='build_qa')return{approved:true,quality_score:91,blocking_issues:[]};throw new Error('unexpected role')}};return{calls,provider}}

test('builder creates a structured web app project without claiming execution',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mab-project-'));const{calls,provider}=fixture();const store=new ProjectWorkspaceStore({directory:dir});const builder=new SoftwareBuilder({provider,projectStore:store,clock:()=>new Date('2026-09-11T08:00:00Z')});const result=await builder.execute('Build an expense tracker',{targetType:'webapp',projectName:'Expense Tracker'});assert.equal(result.target_type,'webapp');assert.equal(result.status,'generated');assert.equal(result.files.length,2);assert.equal(result.capabilities.code_executed,false);assert.equal(result.capabilities.tests_executed,false);assert.deepEqual(calls.map(x=>x.agentRole),['product_manager','software_architect','software_engineer','build_qa']);const loaded=await store.load(result.project_id);assert.equal(loaded.files[1].content,'export const app=true;');await fs.rm(dir,{recursive:true,force:true})});

test('builder supports website and mobile targets plus improve mode',async()=>{const{provider}=fixture();const builder=new SoftwareBuilder({provider});const mobile=await builder.execute('Build mobile',{targetType:'mobile',mode:'improve',projectName:'Mobile'});assert.equal(mobile.target_type,'mobile');assert.equal(mobile.mode,'improve');const website=await builder.execute('Build site',{targetType:'website'});assert.equal(website.target_type,'website')});

test('project store rejects traversal paths',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mab-project-'));const store=new ProjectWorkspaceStore({directory:dir});await assert.rejects(()=>store.save({project_id:'12345678-abcd',files:[{path:'../secret',content:'x'}]}),/Invalid project file path/);await fs.rm(dir,{recursive:true,force:true})});
