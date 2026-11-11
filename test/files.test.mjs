import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {FiscalFilesClient} from './sdk.mjs';
const id='00000000-0000-4000-8000-000000000001',credentials={consumerKey:'synthetic-key',consumerSecret:'synthetic-secret',accessToken:'synthetic-access',accessTokenSecret:'synthetic-access-secret'};
const pdf=readFileSync(new URL('./fixtures/synthetic-danfe.pdf',import.meta.url)),xml=readFileSync(new URL('./fixtures/synthetic-nfe.xml',import.meta.url)),zip=readFileSync(new URL('./fixtures/synthetic-report.zip',import.meta.url));
const company={type:'company'};
async function server(t,handler,tls){const calls=[];const s=tls?https.createServer(tls,(q,r)=>{calls.push(q.url);handler(q,r);}):http.createServer((q,r)=>{calls.push(q.url);handler(q,r);});await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{s.close(r);s.closeAllConnections();}));return{url:`${tls?'https':'http'}://127.0.0.1:${s.address().port}`,calls};}
function file(res,body,contentType,headers={}){res.writeHead(200,{'Content-Type':contentType,'Content-Length':body.length,...headers});res.end(body);}
function client(url,extra={}){return new FiscalFilesClient({baseUrl:url,trustedOrigins:[url],credentials,...extra});}

test('all 13 enabled binary route variants preserve bytes, method, content type and explicit credential scope',async t=>{
 const seen=[];const f=await server(t,(req,res)=>{seen.push({url:req.url,headers:req.headers});assert.equal(req.method,'GET');assert.equal(req.headers['content-length'],undefined);assert.equal(req.headers.authorization,undefined);assert.equal(req.headers['x-token'],undefined);
 if(req.url.includes('/relatorio/')){assert.equal(req.headers['x-consumer-key'],undefined);return file(res,zip,'application/zip');}
 for(const [name,value]of Object.entries({'x-consumer-key':credentials.consumerKey,'x-consumer-secret':credentials.consumerSecret,'x-access-token':credentials.accessToken,'x-access-token-secret':credentials.accessTokenSecret}))assert.equal(req.headers[name],value);
 file(res,req.url.includes('/xml')?xml:pdf,req.url.includes('/xml')?'text/xml; charset=utf-8':'application/pdf',{'Content-Disposition':'attachment; filename="synthetic.xml"'});
 });const c=client(f.url);
 const cases=[['baixarDanfe',`/danfe/${id}/`],['baixarDanfeSimplificado',`/danfe/simples/${id}/`],['baixarDanfeEtiqueta',`/danfe/etiqueta/${id}/`],['baixarCartaCorrecaoPdf',`/dacce/${id}/`],['baixarCartaCorrecaoPdfSequencia',`/dacce/${id}/2/`,2],['baixarXml',`/xmlnfe/${id}/`],['baixarXmlCancelamento',`/xmlnfe/${id}/cancelamento`],['baixarCartaCorrecaoXml',`/xmlcce/${id}/`],['baixarCartaCorrecaoXmlSequencia',`/xmlcce/${id}/2/`,2],['baixarManifestacaoXml',`/xmlmde/${id}/`],['baixarConciliacaoXml',`/xmleconf/${id}/`],['baixarConciliacaoXmlSequencia',`/xmleconf/${id}/99/`,99]];
 for(const [method,path,event]of cases){const result=await c[method](id,...(event===undefined?[company]:[event,company]));assert.equal(seen.at(-1).url,path);assert.deepEqual(Buffer.from(result.bytes),path.includes('/xml')?xml:pdf);assert.equal(result.byteLength,result.bytes.byteLength);assert.equal(result.requestedAuthorization,'company');assert.equal(result.protection,path.includes('/xml')?'not_applicable':'not_detected');assert.equal(result.contentDisposition,'attachment; filename="synthetic.xml"');}
 const report=await c.baixarRelatorio(id);assert.deepEqual(Buffer.from(report.bytes),zip);assert.equal(report.requestedAuthorization,'report_capability');assert.equal(report.protection,'not_established');assert.equal(seen.length,13);
});
test('explicit token mode encodes once, never sends company headers and redacts independent token errors',async t=>{
 const token='synthetic+/=document-token';let bad=false;const f=await server(t,(req,res)=>{const u=new URL(req.url,'http://local');assert.equal(u.searchParams.get('token'),token);assert.equal(req.headers['x-consumer-key'],undefined);assert.equal(req.headers['x-access-token'],undefined);if(bad){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Unauthorized '+token,details:encodeURIComponent(token)}));}else file(res,xml,'application/xml');});
 const c=client(f.url);assert.equal((await c.baixarXml(id,{type:'document_token',token})).requestedAuthorization,'document_token');bad=true;
 await assert.rejects(c.baixarXml(id,{type:'document_token',token}),e=>e.kind==='http'&&e.status===403&&!JSON.stringify(e).includes(token)&&!JSON.stringify(e).includes(encodeURIComponent(token)));assert.equal(f.calls.length,2);
});
test('returned URLs require explicit trust, supported route and explicit authorization; no fallback',async t=>{
 const trap=await server(t,(_q,r)=>file(r,pdf,'application/pdf')),f=await server(t,(_q,r)=>file(r,xml,'application/xml'));const c=client(f.url);
 await assert.rejects(c.baixarUrlDocumento(trap.url+'/danfe/'+id+'/',company),{kind:'configuration'});assert.equal(trap.calls.length,0);
 for(const url of[f.url+'/arbitrary/'+id,f.url+'/xmlnfe/'+id+'/?unexpected=1',f.url+'/xmlnfe/'+id+'/?token=a&token=b',f.url+'/xmlnfe/'+id+'/#fragment',f.url+'/xmlnfe/'+encodeURIComponent('x'.repeat(35)+'/')+'/'])await assert.rejects(c.baixarUrlDocumento(url,company),{kind:'validation'});
 await assert.rejects(c.baixarXml(id),{kind:'validation'});await assert.rejects(c.baixarUrlDocumento(f.url+'/xmlnfe/'+id+'/?token=abc',company),{kind:'validation'});
 await assert.rejects(c.baixarUrlDocumento(f.url+'/xmlnfe/'+id+'/?token=abc',{type:'document_token',token:'other'}),{kind:'validation'});
 assert.equal(f.calls.length,0);assert.equal((await c.baixarUrlDocumento(f.url+'/api/xmlnfe/'+id+'/?token=abc',{type:'document_token',token:'abc'})).format,'xml');
});
test('redirects never forward headers or capability token, even to another trusted origin',async t=>{
 const trap=await server(t,(_q,r)=>file(r,pdf,'application/pdf'));const f=await server(t,(_q,r)=>{r.writeHead(302,{Location:trap.url+'/danfe/'+id+'/?token=redirect-capability'});r.end();});const c=client(f.url,{trustedOrigins:[f.url,trap.url]});
 await assert.rejects(c.baixarDanfe(id,company),{kind:'http',status:302});await assert.rejects(c.baixarDanfe(id,{type:'document_token',token:'original-capability'}),{kind:'http',status:302});assert.equal(trap.calls.length,0);assert.equal(f.calls.length,2);
});
test('document event authorization gate remains disabled before I/O',async t=>{
 const f=await server(t,(_q,r)=>file(r,xml,'application/xml'));const c=client(f.url);
 await assert.rejects(c.baixarEventoIbsCbsXml(id,company),{kind:'configuration'});await assert.rejects(c.baixarUrlDocumento(f.url+'/xmlevento/'+id+'/',company),{kind:'configuration'});assert.equal(f.calls.length,0);
});
test('protected archive fallback is never returned as XML; encrypted PDF markers are distinct errors',async t=>{
 let body=zip,type='application/zip';const f=await server(t,(_q,r)=>file(r,body,type));const c=client(f.url);
 await assert.rejects(c.baixarXml(id,company),{kind:'protected_file'});type='text/xml';await assert.rejects(c.baixarXml(id,company),{kind:'protected_file'});
 type='application/pdf';body=Buffer.from('%PDF-1.4\ntrailer<< /Encrypt 10 0 R >>\n%%EOF');await assert.rejects(c.baixarDanfe(id,company),{kind:'protected_file'});
 body=Buffer.from('%PDF-1.4\ntrailer<< /En#63rypt 10 0 R >>\n%%EOF');await assert.rejects(c.baixarDanfe(id,company),{kind:'protected_file'});
});
test('HTML, JSON-success, empty files, wrong types/magic and partial status are rejected',async t=>{
 let body=Buffer.from('<html>not a fiscal file</html>'),type='text/html',status=200;const f=await server(t,(_q,r)=>{r.writeHead(status,{'Content-Type':type,'Content-Length':body.length});r.end(body);});const c=client(f.url);
 await assert.rejects(c.baixarXml(id,company),{kind:'protocol'});type='text/xml';await assert.rejects(c.baixarXml(id,company),{kind:'protocol'});
 type='application/pdf';await assert.rejects(c.baixarDanfe(id,company),{kind:'protocol'});body=Buffer.alloc(0);await assert.rejects(c.baixarDanfe(id,company),{kind:'protocol'});
 type='application/json';body=Buffer.from('{"success":true}');await assert.rejects(c.baixarXml(id,company),{kind:'protocol'});
 type='application/pdf';body=pdf;status=206;await assert.rejects(c.baixarDanfe(id,company),{kind:'protocol',status:206});
});
test('JSON file errors remain typed at HTTP 200 and report capability UUIDs never enter errors',async t=>{
 const f=await server(t,(_q,r)=>{r.writeHead(200,{'Content-Type':'application/json'});r.end(JSON.stringify({error:'Unavailable report '+id,uuid:id,url:'https://files.example.invalid/relatorio/'+id+'/'}));});const c=client(f.url);
 await assert.rejects(c.baixarRelatorio(id),e=>e.kind==='api'&&!JSON.stringify(e).includes(id)&&e.response.uuid==='[REDACTED]');assert.equal(f.calls.length,1);
});
test('per-file limits cover Content-Length and chunked bodies; overrides allow larger reports',async t=>{
 let chunked=false;const f=await server(t,(_q,r)=>{r.writeHead(200,{'Content-Type':'application/pdf',...(chunked?{}:{'Content-Length':pdf.length})});r.end(pdf);});const c=client(f.url,{maxResponseBytes:32});
 await assert.rejects(c.baixarDanfe(id,company),{kind:'response_limit'});chunked=true;await assert.rejects(c.baixarDanfe(id,company),{kind:'response_limit'});assert.deepEqual(Buffer.from((await c.baixarDanfe(id,company,{maxResponseBytes:pdf.length})).bytes),pdf);
 await assert.rejects(c.baixarDanfe(id,company,{maxResponseBytes:0}),{kind:'configuration'});assert.equal(f.calls.length,3);
});
test('binary truncation, deadline and cancellation do not replay or expose authorization',async t=>{
 let mode='truncated';const f=await server(t,(_q,r)=>{r.writeHead(200,{'Content-Type':'application/pdf','Content-Length':'1000'});r.write('%PDF-1.4');if(mode==='truncated'){r.end();r.socket?.destroy();}});const c=client(f.url,{timeoutMs:75});
 await assert.rejects(c.baixarDanfe(id,company),e=>['network','timeout'].includes(e.kind));mode='stalled';await assert.rejects(c.baixarDanfe(id,company),{kind:'timeout'});
 const abort=new AbortController();abort.abort();await assert.rejects(c.baixarDanfe(id,company,{signal:abort.signal}),{kind:'cancelled'});assert.equal(f.calls.length,2);
 const during=new AbortController(),pending=c.baixarDanfe(id,{type:'document_token',token:'cancel-canary'},{signal:during.signal});setTimeout(()=>during.abort(),15);await assert.rejects(pending,e=>e.kind==='cancelled'&&!JSON.stringify(e).includes('cancel-canary'));assert.equal(f.calls.length,3);
});
test('XML download hint omits false and accepts UTF16 bytes without conversion',async t=>{
 const utf16=Buffer.from('\ufeff<?xml version="1.0" encoding="UTF-16"?><NFe/>','utf16le');const f=await server(t,(req,res)=>{const u=new URL(req.url,'http://local');file(res,utf16,'application/xml');});const c=client(f.url,{pathPrefix:'/api'});
 const plain=await c.baixarXml(id,company,{download:false});assert.deepEqual(Buffer.from(plain.bytes),utf16);assert.equal(f.calls[0],'/api/xmlnfe/'+id+'/');await c.baixarXml(id,company,{download:true});assert.equal(new URL(f.calls[1],'http://local').searchParams.get('download'),'1');
});
test('file TLS validates CA and hostname independently of the JSON clients',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'webmania-file-tls-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));writeFileSync(join(dir,'config'),'[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost\n');execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','1','-keyout',join(dir,'key'),'-out',join(dir,'cert'),'-config',join(dir,'config')],{stdio:'ignore'});const ca=readFileSync(join(dir,'cert'),'utf8');const f=await server(t,(_q,r)=>file(r,pdf,'application/pdf'),{key:readFileSync(join(dir,'key')),cert:ca});
 await assert.rejects(client(f.url).baixarDanfe(id,company),{kind:'network'});await assert.rejects(client(f.url,{ca}).baixarDanfe(id,company),{kind:'network'});const correct=f.url.replace('127.0.0.1','localhost');assert.equal((await client(correct,{ca}).baixarDanfe(id,company)).contentType,'application/pdf');
});
test('large PDF reports have independent per-file limits and bounded marker inspection',async t=>{
 const xref=pdf.indexOf(Buffer.from('xref\n'));assert.ok(xref>0);
 const comment=Buffer.from('%'+ '/a '.repeat(800000)+'\n');
 const prefix=Buffer.concat([pdf.subarray(0,xref),comment]);
 const tail=Buffer.from(pdf.subarray(xref).toString('ascii').replace(/startxref\n[0-9]+/,'startxref\n'+prefix.length));
 const large=Buffer.concat([prefix,tail]);assert.ok(large.length>2*1024*1024);
 const f=await server(t,(_q,r)=>file(r,large,'application/pdf'));const c=client(f.url);
 const result=await c.baixarRelatorio(id);assert.equal(result.byteLength,large.length);assert.deepEqual(Buffer.from(result.bytes),large);
 await assert.rejects(c.baixarRelatorio(id,{maxResponseBytes:2*1024*1024}),{kind:'response_limit'});
 assert.equal((await c.baixarRelatorio(id,{maxResponseBytes:large.length})).byteLength,large.length);
});
test('file client validates origin/configuration and cannot serialize credentials',()=>{
 for(const options of[{trustedOrigins:[]},{trustedOrigins:['http://example.invalid']},{trustedOrigins:['https://example.invalid/path']},{trustedOrigins:['https://example.invalid'],credentials:{consumerKey:'only'}},{trustedOrigins:['https://example.invalid'],timeoutMs:0}])assert.throws(()=>new FiscalFilesClient(options),{kind:'configuration'});
 assert.equal(JSON.stringify(new FiscalFilesClient({trustedOrigins:['https://nfe.webmania.com.br'],credentials})),'{}');
});
