import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {NfeClient,MonitorClient,FiscalFilesClient} from './sdk.mjs';

const id='00000000-0000-4000-8000-000000000001';
const credentials={consumerKey:'synthetic-key',consumerSecret:'synthetic-secret',accessToken:'synthetic-access',accessTokenSecret:'synthetic-access-secret'};
async function fixture(t,handler){
 const requests=[];const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push(body?JSON.parse(body):undefined);handler(req,res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 return{baseUrl:'http://127.0.0.1:'+server.address().port,requests};
}
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}
function binary(res,bytes,type){res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length});res.end(bytes);}
function files(baseUrl){return new FiscalFilesClient({credentials,baseUrl,trustedOrigins:[baseUrl]});}

test('report UUID capabilities redact equivalent hex casing without changing paths or success bytes',async t=>{
 const upper='ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF',lower=upper.toLowerCase(),mixed='aBcDeFaB-cDeF-4aBc-8dEf-aBcDeFaBcDeF';
 let status=400,success=false;const paths=[];
 const{baseUrl,requests}=await fixture(t,(req,res)=>{
  paths.push(req.url);assert.equal(req.headers['x-consumer-key'],undefined);assert.equal(req.headers.authorization,undefined);
  if(success)return binary(res,readFileSync(new URL('./fixtures/synthetic-report.zip',import.meta.url)),'application/zip');
  res.setHeader('X-Request-ID',mixed);json(res,{error:'Unable to fetch '+lower,uuid:mixed,[lower]:'one',[mixed]:'two',business_code:'PENDING'},status);
 });
 const client=files(baseUrl);
 for(status of [200,400,500])for(const input of [upper,lower,mixed])await assert.rejects(client.baixarRelatorio(input),error=>{
  assert.equal(error.kind,status===200?'api':'http');assert.equal(error.status,status);assert.equal(error.correlationId,'[REDACTED]');
  assert.equal(error.response.uuid,'[REDACTED]');assert.equal(error.response.business_code,'PENDING');
  const serialized=JSON.stringify(error).toLowerCase();assert.ok(!serialized.includes(lower));
  assert.equal(error.response['[REDACTED]'],'one');assert.equal(error.response['[REDACTED]#1'],'two');
  assert.equal(paths.at(-1),'/relatorio/'+input+'/');return true;
 });
 success=true;const result=await client.baixarRelatorio(upper);assert.deepEqual(Buffer.from(result.bytes),readFileSync(new URL('./fixtures/synthetic-report.zip',import.meta.url)));
 assert.equal(paths.at(-1),'/relatorio/'+upper+'/');assert.equal(requests.length,10);
});

test('UUID-shaped ordinary body secrets retain literal matching',async t=>{
 const upper='ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF',lower=upper.toLowerCase();
 const{baseUrl}=await fixture(t,(_req,res)=>json(res,{error:'Rejected',exact:upper,different_case:lower},400));
 const client=new NfeClient({credentials,baseUrl});
 await assert.rejects(client.atualizarEmpresa({certificado:Buffer.from('synthetic').toString('base64'),certificado_senha:upper}),error=>{
  assert.equal(error.response.exact,'[REDACTED]');assert.equal(error.response.different_case,lower);return true;
 });
});

test('request-body secrets redact generic text, numeric values, keys, Portuguese names, correlation and uncertain references',async t=>{
 const password='canary-á-🎯+[x]$';const token='municipal-token-canary';const numeric=91234567890123;
 const certificate=Buffer.from('controlled certificate canary '.repeat(3000)).toString('base64');
 const body={ID:'prefix-'+password,certificado:certificate,certificado_senha:password,nfse_token:token,
  future:{senha:numeric,nested:{credenciais:[{segredo:'deep-canary'},{chave_privada:{'map-key-canary':'map-value-canary'}}]}}};
 const all=[password,token,String(numeric),certificate,'deep-canary','map-key-canary','map-value-canary'];let status=400;
 const{baseUrl,requests}=await fixture(t,(_req,res)=>{
  res.setHeader('X-Request-ID','request-'+token);
  json(res,{error:'invalid_setup',message:all.join(' | '),[password]:{numeric},generic_number:numeric,
   senha:'unknown-response-password',credenciais:'unknown-response-credentials',autorização:'unknown-response-authorization',business:{code:'SETUP_INVALID',retry:false}},status);
 });const client=new NfeClient({credentials,baseUrl});
 for(status of [400,200,500])await assert.rejects(client.atualizarEmpresa(body),error=>{
  const serialized=JSON.stringify(error);for(const secret of [...all,'unknown-response-password','unknown-response-credentials','unknown-response-authorization'])assert.ok(!serialized.includes(secret));
  assert.equal(error.response.error,'invalid_setup');assert.equal(error.response.business.code,'SETUP_INVALID');assert.equal(error.response.business.retry,false);
  assert.equal(error.response.generic_number,'[REDACTED]');assert.equal(error.response['[REDACTED]'].numeric,'[REDACTED]');
  assert.equal(error.correlationId,'request-[REDACTED]');assert.equal(error.kind,status===200?'api':'http');
  assert.equal(error.outcome,status===400?undefined:'unknown');assert.equal(error.requestReference,status===400?undefined:'[REDACTED]');return true;
 });assert.equal(requests.length,3);for(const request of requests)assert.deepEqual(request,body);
});

test('protocol failures keep body-secret references redacted; successful credential responses remain usable',async t=>{
 const secret='private-reference-canary';let valid=false;
 const{baseUrl,requests}=await fixture(t,(_req,res)=>{if(valid)json(res,{success:'Updated',access_token:secret});else{res.writeHead(200,{'Content-Type':'application/json'});res.end('invalid JSON');}});
 const client=new NfeClient({credentials,baseUrl});const body={ID:secret,custom:{senha:secret}};
 await assert.rejects(client.atualizarEmpresa(body),e=>e.kind==='protocol'&&e.outcome==='unknown'&&e.requestReference==='[REDACTED]'&&!JSON.stringify(e).includes(secret));
 valid=true;assert.equal((await client.atualizarEmpresa(body)).access_token,secret);assert.equal(requests.length,2);
});

test('XML legal comments and processing instructions before the root preserve exact UTF8/UTF16 bytes',async t=>{
 let body;const{baseUrl}=await fixture(t,(_req,res)=>binary(res,body,'application/xml'));const client=files(baseUrl);
 const text='\ufeff<?xml version="1.0"?><!-- exporter -->\n<?review generated?> <!-- second --> <n:NFe xmlns:n="urn:synthetic"/>';
 const le=Buffer.from(text,'utf16le'),be=Buffer.from(le).swap16();
 for(body of [Buffer.from(text),le,be]){const result=await client.baixarXml(id,{type:'company'});assert.deepEqual(Buffer.from(result.bytes),body);assert.equal(result.protection,'not_applicable');}
 for(body of [Buffer.from('<!-- unfinished<NFe/>'),Buffer.from('<?review unfinished<NFe/>'),Buffer.from('<!DOCTYPE NFe SYSTEM "https://invalid.example/entity"><NFe/>')])await assert.rejects(client.baixarXml(id,{type:'company'}),{kind:'protocol'});
});

/** Valid xref offsets let independent PDF tools inspect the harmless samples. */
function pdf(metadata='',stream='',trailer='',indirectLength=false){
 const length=Buffer.byteLength(stream);const objects=['<< /Type /Catalog /Pages 2 0 R '+metadata+' >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>',`<< /Length ${indirectLength?'5 0 R':length} >>\nstream\n${stream}\nendstream`];
 if(indirectLength)objects.push(String(length));
 let text='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
 const offset=Buffer.byteLength(text);text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R ${trailer} >>\nstartxref\n${offset}\n%%EOF\n`;
 return Buffer.from(text);
}

test('PDF names inside literal/hex strings, comments, metadata dictionaries and streams are not encryption entries',async t=>{
 let body;const{baseUrl}=await fixture(t,(_req,res)=>binary(res,body,'application/pdf'));const client=files(baseUrl);
 const samples=[pdf('/ReviewText (/Encrypt)'),pdf('/ReviewText (nested (/Encrypt) escaped \\(text\\))'),pdf('/ReviewText <2f456e6372797074>'),pdf('/ReviewText /Encrypt'),pdf('/Custom << /Encrypt 8 0 R >>'),pdf('% /Encrypt 8 0 R\n'),pdf('','trailer << /Encrypt 8 0 R >>\nendstream\ntrailer << /Encrypt 8 0 R >>'),pdf('','','/Encrypt null')];
 for(body of samples){const result=await client.baixarDanfe(id,{type:'company'});assert.deepEqual(Buffer.from(result.bytes),body);assert.equal(result.protection,'not_detected');}
});

test('PDF trailer/XRef encryption entries including escaped names are rejected; unknown stream length is inconclusive',async t=>{
 let body;const{baseUrl}=await fixture(t,(_req,res)=>binary(res,body,'application/pdf'));const client=files(baseUrl);
 for(body of [pdf('','','/Encrypt 8 0 R'),pdf('','','/En#63rypt << /Filter /Standard >>'),Buffer.from('%PDF-1.5\n8 0 obj\n<< /Type /XRef /Encrypt 9 0 R /Length 0 >>\nstream\n\nendstream\nendobj')])await assert.rejects(client.baixarDanfe(id,{type:'company'}),{kind:'protected_file'});
 body=pdf('','/Encrypt trailer << /Encrypt 8 0 R >>','',true);const result=await client.baixarDanfe(id,{type:'company'});assert.equal(result.protection,'not_established');assert.deepEqual(Buffer.from(result.bytes),body);
});

test('Monitor city code accepts documented string or JSON integer without coercion and rejects other wire types',async t=>{
 let code;const{baseUrl}=await fixture(t,(_req,res)=>json(res,{data:[{uuid:id,endereco:{codigo_municipio:code}}],meta:{current_page:1,last_page:1,per_page:10,total:1}}));
 const monitor=new MonitorClient({baseUrl,bearerToken:'synthetic-monitor'});
 for(code of ['3550308',3550308]){const result=await monitor.listarEmpresas();assert.equal(result.data[0].endereco.codigo_municipio,code);assert.equal(typeof result.data[0].endereco.codigo_municipio,typeof code);}
 for(code of [3550308.5,true,{},null])await assert.rejects(monitor.listarEmpresas(),{kind:'protocol'});
});
