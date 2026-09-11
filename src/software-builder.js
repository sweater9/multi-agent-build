import crypto from 'node:crypto';

function text(v){if(typeof v==='string')return v;if(v?.answer)return String(v.answer);return JSON.stringify(v??'',null,2)}
function cleanType(v){const x=String(v||'webapp').toLowerCase();return['website','webapp','mobile'].includes(x)?x:'webapp'}
function cleanMode(v){return String(v||'build').toLowerCase()==='improve'?'improve':'build'}
function cleanFiles(value){const src=Array.isArray(value)?value:[],seen=new Set(),out=[];for(const item of src){const p=String(item?.path||'').replace(/\\/g,'/').replace(/^\/+/, '').slice(0,240);const c=String(item?.content||'');if(!p||p.includes('..')||seen.has(p)||Buffer.byteLength(c,'utf8')>200000)continue;seen.add(p);out.push({path:p,content:c});if(out.length>=120)break}return out}

export class SoftwareBuilder{
 constructor({provider,projectStore=null,clock=()=>new Date()}={}){if(!provider?.generate)throw new Error('provider is required');this.provider=provider;this.projectStore=projectStore;this.clock=clock}
 select(name='auto'){return typeof this.provider.select==='function'?this.provider.select(name):this.provider}
 async ask(role,input,provider='auto'){return this.select(provider).generate({agentRole:role,input})}
 async execute(goal,options={}){const request=String(goal||'').trim();if(!request)throw new Error('Build prompt is required');const mode=cleanMode(options.mode),targetType=cleanType(options.targetType),provider=String(options.provider||'auto').toLowerCase(),projectName=String(options.projectName||'Untitled Project').trim().slice(0,80),projectId=String(options.projectId||crypto.randomUUID()).toLowerCase(),createdAt=this.clock().toISOString();
 const product=await this.ask('product_manager',{goal:request,mode,target_type:targetType,project_name:projectName,instruction:'Convert the request into a concise software product specification. Return objective, users, functional_requirements, non_functional_requirements, assumptions, and acceptance_criteria.'},provider);
 const architecture=await this.ask('software_architect',{goal:request,mode,target_type:targetType,product_spec:product,instruction:'Design the smallest production-sensible architecture. Prefer simple maintained stacks. Return stack, components, data_model, api_surface, security_controls, test_strategy, deployment_target, and implementation_order.'},provider);
 const implementation=await this.ask('software_engineer',{goal:request,mode,target_type:targetType,product_spec:product,architecture,instruction:'Produce a complete runnable starter implementation as a files array. Each item must have path and content. Include package/config files, application code, README, tests where practical, and .env.example without secrets. Do not include binary files. Keep dependencies minimal.'},provider);
 const files=cleanFiles(implementation?.files);
 const review=await this.ask('build_qa',{goal:request,mode,target_type:targetType,product_spec:product,architecture,file_manifest:files.map(f=>({path:f.path,size:Buffer.byteLength(f.content,'utf8')})),instruction:'Review whether the generated project is internally consistent and likely runnable. Return approved, quality_score, blocking_issues, warnings, and next_checks. Do not claim tests were executed.'},provider);
 const project={project_id:projectId,project_name:projectName,mode,target_type:targetType,status:review?.approved===false?'needs_repair':'generated',execution_status:'not_executed',provider,goal:request,created_at:createdAt,updated_at:createdAt,product_spec:product,architecture,qa:review,files};
 if(this.projectStore?.save)await this.projectStore.save(project);
 return{...project,summary:text(implementation?.summary||`Generated ${files.length} project files.`),capabilities:{files_generated:true,server_workspace:Boolean(this.projectStore),code_executed:false,tests_executed:false,deployed:false},safety_note:'Generated code is stored but not executed in the API service. Isolated CI/sandbox execution is required before deployment.'}}
}
