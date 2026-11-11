import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {FiscalFilesClient} from './sdk.mjs';
// FILE-07 and POLL-04: legacy reports labeled text/xml are classified by bytes; current report URLs stay on
// an explicitly trusted origin and the /relatorios/ route.
const id='00000000-0000-4000-8000-000000000123';
const zip=readFileSync(new URL('./fixtures/synthetic-report.zip',import.meta.url)),xml=readFileSync(new URL('./fixtures/synthetic-nfe.xml',import.meta.url));
const csv=Buffer.from('numero;destinatario;valor\r\n1;Jo\xe3o;10.00\r\n','latin1');
const XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
async function server(t,handler){const calls=[];const s=http.createServer((q,r)=>{calls.push({url:q.url,headers:q.headers});handler(q,r);});await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{s.close(r);s.closeAllConnections();}));return{url:`http://127.0.0.1:${s.address().port}`,calls};}
function file(res,body,type){res.writeHead(200,{'Content-Type':type,'Content-Length':body.length});res.end(body);}

test('legacy report CSV labeled text/xml is returned byte-exact and XLSX is identified by the ZIP signature',async t=>{
  let body=csv;const f=await server(t,(_q,r)=>file(r,body,'text/xml'));const c=new FiscalFilesClient({baseUrl:f.url,trustedOrigins:[f.url]});
  const report=await c.baixarRelatorio(id);assert.deepEqual(Buffer.from(report.bytes),csv);assert.equal(report.contentType,'text/csv');assert.equal(report.format,'report');
  body=zip;const book=await c.baixarRelatorio(id);assert.deepEqual(Buffer.from(book.bytes),zip);assert.equal(book.contentType,XLSX);
  assert.equal(f.calls.length,2);
});
test('legacy report refuses XML, HTML and JSON bodies labeled text/xml; other file routes gain no tolerance',async t=>{
  let body;const f=await server(t,(_q,r)=>file(r,body,'text/xml'));
  const c=new FiscalFilesClient({baseUrl:f.url,trustedOrigins:[f.url],credentials:{consumerKey:'k',consumerSecret:'s',accessToken:'a',accessTokenSecret:'t'}});
  for(const value of [xml,Buffer.from('<!doctype html><html></html>'),Buffer.from('  {"error":"x"}'),Buffer.from('﻿<html/>','utf16le')]){
    body=value;await assert.rejects(c.baixarRelatorio(id),e=>e.kind==='protocol'&&e.outcome==='unknown');
  }
  body=csv;await assert.rejects(c.baixarXml(id,{type:'company'}),{kind:'protocol'});
  assert.equal(f.calls.length,5);
});
test('current report downloads use the reports origin and capability only, and refuse foreign URLs before any request',async t=>{
  const f=await server(t,(_q,r)=>file(r,csv,'text/csv'));
  const c=new FiscalFilesClient({baseUrl:'https://nfe.example.invalid',reportsBaseUrl:f.url,trustedOrigins:['https://nfe.example.invalid',f.url],credentials:{consumerKey:'k',consumerSecret:'s',accessToken:'a',accessTokenSecret:'t'}});
  assert.deepEqual(Buffer.from((await c.baixarRelatorioV2(id)).bytes),csv);
  assert.deepEqual(Buffer.from((await c.baixarUrlRelatorio(f.url+'/relatorios/'+id)).bytes),csv);
  assert.deepEqual(f.calls.map(x=>x.url),['/relatorios/'+id,'/relatorios/'+id]);
  for(const call of f.calls)assert.ok(!Object.keys(call.headers).some(k=>k==='authorization'||k.startsWith('x-consumer')||k.startsWith('x-access')));
  const port=f.url.split(':').at(-1);
  for(const url of [`http://localhost:${port}/relatorios/${id}`,`http://u:p@127.0.0.1:${port}/relatorios/${id}`,`${f.url}/api/relatorios/${id}`,`${f.url}/outro/relatorios/${id}`,`${f.url}/relatorios/${id}#f`,`${f.url}/relatorios/${id}?token=x`])
    await assert.rejects(c.baixarUrlRelatorio(url),e=>['validation','configuration'].includes(e.kind));
  assert.equal(f.calls.length,2);
});
test('current report formats must match their bytes and a JSON error at HTTP 200 is a failure',async t=>{
  let body,type;const f=await server(t,(_q,r)=>file(r,body,type));const c=new FiscalFilesClient({baseUrl:f.url,reportsBaseUrl:f.url,trustedOrigins:[f.url]});
  for(const [value,media,ok] of [[zip,XLSX,true],[Buffer.from('<html><body>r</body></html>'),'text/html',true],[Buffer.from('<relatorio/>'),'application/xml',true],[Buffer.from('not a zip'),'application/zip',false],[Buffer.from('%PDX'),'application/pdf',false],[Buffer.from('<x/>'),'text/csv',false]]){
    body=value;type=media;
    if(ok){const result=await c.baixarRelatorioV2(id);assert.equal(result.contentType,media);assert.deepEqual(Buffer.from(result.bytes),value);}
    else await assert.rejects(c.baixarRelatorioV2(id),{kind:'protocol'});
  }
  body=Buffer.from(JSON.stringify({error:'processando'}));type='application/json';await assert.rejects(c.baixarRelatorioV2(id),e=>e.kind==='api'&&e.status===200);
  assert.equal(f.calls.length,7);
});
