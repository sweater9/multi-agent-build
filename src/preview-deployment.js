const PROVIDERS=new Set(['github-pages','render','vercel','netlify']);
function clean(v,n=200){return String(v??'').trim().slice(0,n)}
export function previewEligibility(project={}){
 const reasons=[];if(project.target_type==='mobile')reasons.push('mobile-preview-not-supported');if(project.status!=='browser_verified')reasons.push('browser-verification-required');if(project.verification?.status==='failed')reasons.push('project-verification-failed');if(project.browser_qa&&project.browser_qa.passed!==true)reasons.push('browser-qa-not-passed');return{eligible:reasons.length===0,reasons};
}
export function createPreviewPlan(project={},options={}){
 const gate=previewEligibility(project),provider=PROVIDERS.has(options.provider)?options.provider:'github-pages';const repo=clean(options.repository,200),branch=clean(options.branch||`preview/${project.project_id||'project'}`,120);
 return{kind:'preview',provider,eligible:gate.eligible,reasons:gate.reasons,repository:repo||null,branch,requires_approval:true,requires_paid_approval:['render','vercel','netlify'].includes(provider),destructive:false,actions:gate.eligible?['create_or_update_preview_branch','run_ci','request_preview_deployment']:[],status:gate.eligible?'awaiting_approval':'blocked'};
}
export class PreviewDeploymentGate{
 constructor({deployer=null}={}){this.deployer=deployer}
 plan(project,options={}){return createPreviewPlan(project,options)}
 async deploy(project,{approval=false,paidApproval=false,...options}={}){const plan=this.plan(project,options);if(!plan.eligible)return{...plan,deployed:false};if(!approval)return{...plan,deployed:false,status:'awaiting_approval'};if(plan.requires_paid_approval&&!paidApproval)return{...plan,deployed:false,status:'awaiting_paid_approval'};if(!this.deployer?.deploy)return{...plan,deployed:false,status:'adapter_not_configured'};const result=await this.deployer.deploy({project,plan});return{...plan,...result,deployed:Boolean(result?.deployed),status:result?.deployed?'preview_live':'deployment_failed'} }
}
