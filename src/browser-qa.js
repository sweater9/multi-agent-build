const MAX_ISSUES=40;
function text(v,n=2000){return String(v??'').slice(0,n)}
export function createBrowserQaPlan(files,{targetType='webapp'}={}){
 if(targetType==='mobile')return{enabled:false,reason:'mobile-browser-qa-disabled'};
 let pkg=null;try{pkg=JSON.parse(files.find(f=>f.path==='package.json')?.content||'null')}catch{}
 const scripts=pkg?.scripts||{};const start=scripts.preview?'preview':scripts.start?'start':scripts.dev?'dev':null;
 if(!start)return{enabled:false,reason:'no-runnable-web-script'};
 return{enabled:true,start:{name:'serve',command:['npm','run',start,'--','--host','0.0.0.0'],network:'off'},checks:[
  {id:'page-load',kind:'navigation',path:'/'},{id:'console-errors',kind:'console'},{id:'runtime-errors',kind:'pageerror'},{id:'failed-requests',kind:'requestfailed'},{id:'basic-accessibility',kind:'accessibility'}
 ]};
}
export function normalizeBrowserQa(raw={}){
 const issues=(Array.isArray(raw.issues)?raw.issues:[]).slice(0,MAX_ISSUES).map(i=>({type:text(i.type,80),severity:['blocking','warning','info'].includes(i.severity)?i.severity:'warning',message:text(i.message),url:text(i.url,500),selector:text(i.selector,300)}));
 const blocking=issues.filter(i=>i.severity==='blocking');
 return{passed:Boolean(raw.passed)&&blocking.length===0,url:text(raw.url,500),title:text(raw.title,300),checks:Array.isArray(raw.checks)?raw.checks.slice(0,50):[],issues,blocking_count:blocking.length,screenshot_available:Boolean(raw.screenshot_available)};
}
export function browserRepairEvidence(qa){const n=normalizeBrowserQa(qa);return{category:'browser_qa',summary:n.passed?'Browser QA passed':`Browser QA found ${n.blocking_count} blocking issue(s)`,signals:n.issues.slice(0,12).map(i=>`${i.severity}: ${i.type}: ${i.message}`),raw:JSON.stringify(n).slice(0,12000)}}
