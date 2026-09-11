const PATTERNS=[
  ['dependency',/(npm ERR!|ERESOLVE|EAI_AGAIN|ENOTFOUND|404 Not Found|unable to resolve dependency)/i],
  ['syntax',/(SyntaxError|Unexpected token|Parsing error)/i],
  ['module',/(Cannot find module|ERR_MODULE_NOT_FOUND|Module not found)/i],
  ['type',/(TypeError|TS\d{4}|type .* is not assignable|Property .* does not exist)/i],
  ['test',/(AssertionError|\bfailed\b|\bfailing\b|test failed|not ok \d+)/i],
  ['lint',/(eslint|lint error|prettier|formatting)/i],
  ['build',/(build failed|compilation failed|webpack.*error|vite.*error)/i],
  ['timeout',/(timed out|timeout|SIGTERM)/i],
  ['resource',/(out of memory|ENOMEM|heap out of memory|ENOSPC)/i]
];

function clean(value,max=12000){return String(value||'').replace(/\u001b\[[0-9;]*m/g,'').slice(0,max)}

export function classifyFailure({step='',stderr='',stdout='',error=''}={}){
  const raw=clean([stderr,stdout,error].filter(Boolean).join('\n'));
  const matched=PATTERNS.find(([,pattern])=>pattern.test(raw));
  const category=matched?.[0]||(['install'].includes(step)?'dependency':['check'].includes(step)?'static-analysis':['test'].includes(step)?'test':['build'].includes(step)?'build':'execution');
  const lines=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const signals=lines.filter(line=>/(error|failed|failure|cannot|unexpected|assert|not found|timeout|warning)/i.test(line)).slice(0,8);
  return {category,step:step||null,summary:(signals[0]||lines[0]||'Execution failed').slice(0,500),signals,raw};
}
