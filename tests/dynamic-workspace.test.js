import test from 'node:test';
import assert from 'node:assert/strict';
import { DynamicPromptWorkspace } from '../src/dynamic-workspace.js';

test('dynamic workspace selects specialists in parallel then judges and QA reviews', async () => {
  const calls=[];
  const provider={async generate({agentRole,input}){calls.push({agentRole,input});if(agentRole==='dynamic_planner')return{objective:'Assess launch',approach:'Independent review',specialists:[{name:'Market Analyst',focus:'Assess demand'},{name:'Risk Analyst',focus:'Assess risks'}]};if(agentRole==='specialist')return{answer:`${input.specialist.name} view`,key_points:[],assumptions:[],risks:[]};if(agentRole==='judge')return{answer:'Synthesized answer',agreements:['A'],disagreements:[],confidence:84,limitations:[]};if(agentRole==='dynamic_qa')return{approved:true,answer:'Final reviewed answer',findings:[],quality_score:92};throw new Error('unexpected role')}};
  const workspace=new DynamicPromptWorkspace({provider});
  const result=await workspace.execute('Should this launch?');
  assert.equal(result.status,'completed');assert.equal(result.output,'Final reviewed answer');assert.equal(result.confidence,84);assert.equal(result.quality_score,92);assert.deepEqual(result.agent_team.map(x=>x.name),['Market Analyst','Risk Analyst']);assert.equal(calls.filter(x=>x.agentRole==='specialist').length,2);assert.equal(calls.at(-1).agentRole,'dynamic_qa');
});

test('dynamic workspace falls back to safe default specialists when planner team is malformed',async()=>{const provider={async generate({agentRole}){if(agentRole==='dynamic_planner')return{objective:'x',approach:'y',specialists:[]};if(agentRole==='specialist')return{answer:'view'};if(agentRole==='judge')return{answer:'candidate',confidence:70};return{approved:true,answer:'final',quality_score:80,findings:[]}}};const result=await new DynamicPromptWorkspace({provider}).execute('Analyze this');assert.equal(result.agent_team.length,2);assert.equal(result.status,'completed')});
