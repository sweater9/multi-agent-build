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

test('research mode runs provenance step and passes sources through the workflow',async()=>{
  const calls=[];
  const research={answer:'Current evidence [1]',sources:[{title:'Official source',url:'https://example.gov/rule'}],provider:'groq/compound'};
  const provider={
    async research({goal}){calls.push({agentRole:'research',goal});return research},
    async generate({agentRole,input}){calls.push({agentRole,input});if(agentRole==='dynamic_planner')return{objective:'Research task',approach:'Evidence first',specialists:[{name:'Research Analyst',focus:'Interpret evidence'},{name:'Critical Reviewer',focus:'Challenge conclusions'}]};if(agentRole==='specialist')return{answer:'Grounded view',key_points:[],assumptions:[],risks:[]};if(agentRole==='judge')return{answer:'Grounded synthesis [1]',agreements:[],disagreements:[],confidence:88,limitations:[]};return{approved:true,answer:'Final grounded answer [1]',findings:[],quality_score:94}}
  };
  const result=await new DynamicPromptWorkspace({provider}).execute('What changed?',{research:true});
  assert.equal(result.research_mode,true);assert.equal(result.sources.length,1);assert.equal(result.sources[0].url,'https://example.gov/rule');assert.equal(result.agents.researcher.name,'Web Researcher');assert.equal(calls[0].agentRole,'research');assert.ok(calls.find(x=>x.agentRole==='specialist').input.research);
});

test('one specialist failure does not fail the entire workflow',async()=>{
  let specialistCalls=0;
  const provider={async generate({agentRole,input}){
    if(agentRole==='dynamic_planner')return{objective:'x',approach:'y',specialists:[{name:'Analyst A',focus:'A'},{name:'Analyst B',focus:'B'}]};
    if(agentRole==='specialist'){specialistCalls+=1;if(input.specialist.name==='Analyst A')throw new Error('HTTP 429');return{answer:'surviving specialist'};}
    if(agentRole==='judge'){assert.equal(input.specialist_outputs.length,1);assert.equal(input.specialist_failures.length,1);return{answer:'candidate',confidence:72};}
    if(agentRole==='dynamic_qa')return{approved:true,answer:'final from surviving evidence',quality_score:86,findings:[]};
    throw new Error('unexpected role');
  }};
  const result=await new DynamicPromptWorkspace({provider}).execute('Analyze resiliently');
  assert.equal(specialistCalls,2);assert.equal(result.status,'completed');assert.equal(result.degraded,true);assert.equal(result.specialist_failures[0].error,'provider_rate_limited');assert.equal(result.output,'final from surviving evidence');
});
