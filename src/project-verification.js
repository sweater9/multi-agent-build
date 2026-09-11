function packageJson(files){const file=files.find(f=>f.path==='package.json');if(!file)return null;try{return JSON.parse(file.content)}catch{return null}}
function testFiles(files){return files.filter(f=>/(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/i.test(f.path)).map(f=>f.path)}

export function buildVerificationReport(files,execution){
  const pkg=packageJson(files)||{};const scripts=pkg.scripts&&typeof pkg.scripts==='object'?pkg.scripts:{};const steps=Array.isArray(execution?.attempts)?execution.attempts.at(-1)?.summary?.steps||[]:execution?.summary?.steps||[];
  const executedNames=new Set(steps.map(s=>s.name));const tests=testFiles(files);const checks={package_json:Boolean(Object.keys(pkg).length),test_files:tests.length,test_script:Boolean(scripts.test),check_script:Boolean(scripts.check),build_script:Boolean(scripts.build),test_executed:executedNames.has('test'),check_executed:executedNames.has('check'),build_executed:executedNames.has('build')};
  const blocking=[];const warnings=[];
  if(!execution) warnings.push('Project execution was not run.');
  else if(execution.passed===false) blocking.push('Project execution did not pass after bounded repair attempts.');
  if(checks.test_script&&!checks.test_executed&&execution) blocking.push('A test script exists but was not executed.');
  if(checks.test_files&&!checks.test_script) warnings.push('Test files exist but package.json has no test script.');
  if(!checks.test_files&&!checks.test_script) warnings.push('No automated project tests were detected.');
  if(checks.build_script&&!checks.build_executed&&execution) blocking.push('A build script exists but was not executed.');
  const status=blocking.length?'failed':execution?.passed===true?'passed':'unverified';
  return {status,checks,test_files:tests.slice(0,40),blocking_issues:blocking,warnings,verified_at:execution?new Date().toISOString():null};
}
