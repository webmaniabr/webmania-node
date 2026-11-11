import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { NfeClient, WebmaniaError } from './sdk.mjs';
const credentials = {consumerKey:'synthetic-key',consumerSecret:'synthetic-secret',accessToken:'synthetic-access',accessTokenSecret:'synthetic-access-secret'};
const good={expiration:25,future:{zero:0,enabled:false,nullable:null,text:'São Paulo'}};
function json(res,body=good,status=200){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));}
async function server(t,handler,tls){const srv=tls?https.createServer(tls,handler):http.createServer(handler);await new Promise(r=>srv.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{srv.close(r);srv.closeAllConnections();}));return `${tls?'https':'http'}://127.0.0.1:${srv.address().port}`;}
function client(url,options={}){return new NfeClient({credentials,baseUrl:url,...options});}
test('API1 literal headers, exact GET without body and additional fields',async t=>{
 const paths=[];const url=await server(t,(req,res)=>{paths.push(req.url);assert.equal(req.method,'GET');assert.equal(req.headers['x-consumer-key'],credentials.consumerKey);assert.equal(req.headers['x-consumer-secret'],credentials.consumerSecret);assert.equal(req.headers['x-access-token'],credentials.accessToken);assert.equal(req.headers['x-access-token-secret'],credentials.accessTokenSecret);assert.equal(req.headers['x-token'],undefined);assert.equal(req.headers.authorization,undefined);assert.equal(req.headers['content-length'],undefined);json(res,req.url.includes('certificado')?good:{status:'offline',future:false});});
 const c=client(url);assert.deepEqual(await c.consultarCertificado(),good);assert.deepEqual(await c.consultarSefaz(),{status:'offline',future:false});assert.deepEqual(paths,['/api/1/nfe/certificado/','/api/1/nfe/sefaz/']);
});
test('instances copy credentials and remain isolated',async t=>{
 const seen=[];const url=await server(t,(req,res)=>{seen.push(req.headers['x-consumer-key']);json(res);});const a={...credentials,consumerKey:'tenant-a'},b={...credentials,consumerKey:'tenant-b'};const ca=client(url,{credentials:a}),cb=client(url,{credentials:b});a.consumerKey='changed';await Promise.all([ca.consultarCertificado(),cb.consultarCertificado()]);assert.deepEqual(seen.sort(),['tenant-a','tenant-b']);assert.equal(JSON.stringify(ca),'{}');
});
test('validates configuration without reflecting credentials',()=>{
 for(const options of [{credentials:{}},{credentials:{...credentials,accessToken:'secret\nvalue'}},{baseUrl:'http://example.com'},{baseUrl:'https://user:secret@example.com'},{baseUrl:'https://example.com/path'},{timeoutMs:0},{timeoutMs:Infinity},{maxResponseBytes:0}])assert.throws(()=>new NfeClient({credentials,...options}),{kind:'configuration'});
});
for(const status of [301,401,402,403,404,422,429,500,503])test(`HTTP${status} is typed and has no automatic retry`,async t=>{
 let calls=0;const url=await server(t,(_req,res)=>{calls++;res.setHeader('Retry-After','0');json(res,{error:'test_error',message:'Please review credentials'},status);});await assert.rejects(client(url).consultarCertificado(),e=>e instanceof WebmaniaError&&e.kind==='http'&&e.status===status&&e.response.error==='test_error');assert.equal(calls,1);
});
test('safe structured original error and correlation with string and numeric credential redaction',async t=>{
 const secret='1234567890';const url=await server(t,(_req,res)=>{res.setHeader('X-Request-ID','synthetic-correlation');json(res,{error:'expired_certificate',message:`Renew certificate; ${secret}`,token:'hidden',nested:{[secret]:Number(secret),business:25},cpf:'hidden'},401);});
 await assert.rejects(client(url,{credentials:{...credentials,consumerKey:secret}}).consultarCertificado(),e=>{assert.equal(e.correlationId,'synthetic-correlation');assert.equal(e.response.error,'expired_certificate');assert.equal(e.response.message,'Renew certificate; [REDACTED]');assert.equal(e.response.nested.business,25);assert.equal(e.response.nested['[REDACTED]'],'[REDACTED]');assert.ok(!JSON.stringify(e).includes(secret));assert.ok(!JSON.stringify(e).includes('hidden'));return true;});
});
for(const marker of ['',false,null,'application_failure'])test(`present error ${JSON.stringify(marker)} never becomes success`,async t=>{const url=await server(t,(_req,res)=>json(res,{expiration:25,error:marker}));await assert.rejects(client(url).consultarCertificado(),{kind:'api',status:200});});
test('does not follow cross-origin redirect or forward credentials',async t=>{let calls=0;const other=await server(t,(_req,res)=>{calls++;json(res);});const url=await server(t,(_req,res)=>{res.writeHead(302,{Location:other});res.end();});await assert.rejects(client(url).consultarCertificado(),{kind:'http',status:302});assert.equal(calls,0);});
for(const[label,handler]of[['HTML',(_q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});r.end('<html>error</html>');}],['malformedJSON',(_q,r)=>{r.writeHead(200,{'Content-Type':'application/json'});r.end('{');}],['invalidschema',(_q,r)=>json(r,{expiration:0})]])test(`rejects ${label}`,async t=>{const url=await server(t,handler);await assert.rejects(client(url).consultarCertificado(),{kind:'protocol'});});
test('limits response bytes on success and failure',async t=>{let status=200;const url=await server(t,(_q,r)=>json(r,{...good,padding:'x'.repeat(200)},status));for(status of [200,401])await assert.rejects(client(url,{maxResponseBytes:80}).consultarCertificado(),{kind:'response_limit'});});
test('absolute deadline includes stalled response body without resending',async t=>{let calls=0;const url=await server(t,(_q,r)=>{calls++;r.writeHead(200,{'Content-Type':'application/json'});r.write('{');});await assert.rejects(client(url,{timeoutMs:75}).consultarCertificado(),{kind:'timeout'});assert.equal(calls,1);});
test('rejects truncated body',async t=>{const url=await server(t,(_q,r)=>{r.writeHead(200,{'Content-Type':'application/json','Content-Length':'999'});r.end('{');});await assert.rejects(client(url).consultarCertificado(),{kind:'network'});});
test('cancels before dispatch and while response is pending',async t=>{let calls=0;const url=await server(t,(_q,r)=>{calls++;r.writeHead(200,{'Content-Type':'application/json'});r.write('{');});const a=new AbortController();a.abort();await assert.rejects(client(url).consultarCertificado({signal:a.signal}),{kind:'cancelled'});assert.equal(calls,0);const b=new AbortController(),result=client(url).consultarCertificado({signal:b.signal});setTimeout(()=>b.abort(),50);await assert.rejects(result,{kind:'cancelled'});assert.equal(calls,1);});
test('TLS validates trusted CA and hostname',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'webmania-tls-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));writeFileSync(join(dir,'config'),'[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost\n');execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','1','-keyout',join(dir,'key'),'-out',join(dir,'cert'),'-config',join(dir,'config')],{stdio:'ignore'});const ca=readFileSync(join(dir,'cert'),'utf8');const url=await server(t,(_q,r)=>json(r),{key:readFileSync(join(dir,'key')),cert:ca});await assert.rejects(client(url).consultarCertificado(),{kind:'network'});await assert.rejects(client(url,{ca}).consultarCertificado(),{kind:'network'});assert.deepEqual(await client(url.replace('127.0.0.1','localhost'),{ca}).consultarCertificado(),good);
});
