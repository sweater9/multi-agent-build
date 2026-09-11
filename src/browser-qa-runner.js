import { createBrowserQaPlan,normalizeBrowserQa } from './browser-qa.js';
export class BrowserQaRunner{
 constructor({executor,planner=createBrowserQaPlan}={}){if(!executor?.inspect)throw new Error('browser QA executor is required');this.executor=executor;this.planner=planner}
 async run(files,context={}){const plan=this.planner(files,{targetType:context.targetType});if(!plan.enabled)return{executed:false,passed:false,skipped:true,reason:plan.reason,issues:[]};const raw=await this.executor.inspect({files,plan,project_id:context.projectId,attempt:context.attempt??0});return{executed:true,skipped:false,...normalizeBrowserQa(raw),plan:{start:plan.start,checks:plan.checks}}}
}
export class HttpBrowserQaExecutor{
 constructor({endpoint,token='',fetchImpl=globalThis.fetch,timeoutMs=240000}={}){if(!/^https:\/\//.test(String(endpoint||'')))throw new Error('Browser QA endpoint must use HTTPS');this.endpoint=String(endpoint).replace(/\/$/,'');this.token=token;this.fetch=fetchImpl;this.timeoutMs=timeoutMs}
 async inspect(payload){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);try{const response=await this.fetch(`${this.endpoint}/v1/browser-qa`,{method:'POST',signal:controller.signal,headers:{'content-type':'application/json',...(this.token?{authorization:`Bearer ${this.token}`}:{})},body:JSON.stringify(payload)});const text=await response.text();let data;try{data=JSON.parse(text)}catch{throw new Error('Browser QA returned non-JSON output')}if(!response.ok)throw new Error(String(data?.message||`Browser QA failed with ${response.status}`).slice(0,1000));return data}finally{clearTimeout(timer)}}
}
