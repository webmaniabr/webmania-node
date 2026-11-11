import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {NfeClient,MonitorClient} from './sdk.mjs';
const id='00000000-0000-4000-8000-000000000001',download='00000000-0000-4000-8000-000000000002';
const credentials={consumerKey:'synthetic-key',consumerSecret:'synthetic-secret',accessToken:'synthetic-access',accessTokenSecret:'synthetic-access-secret'};
const event={uuid:id,status:'future-state',future:false};
async function fixture(t,handler){const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));return `http://127.0.0.1:${server.address().port}`;}
function send(res,data){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}
test('API1 named query and event methods map method/path and retain additional JSON values',async t=>{
 const seen=[];const baseUrl=await fixture(t,async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;seen.push({method:req.method,url:req.url,body:raw?JSON.parse(raw):undefined});assert.equal(req.headers['x-consumer-key'],credentials.consumerKey);assert.equal(req.headers.authorization,undefined);send(res,req.url.includes('/inutilizar/')?{xml:'https://example.invalid/result.xml'}:req.url.includes('/cancelar/')&&!req.url.includes('conciliacao')&&!req.url.includes('evento-ibs')?{status:'cancelado'}:req.url.includes('/classe-imposto/')?[{referencia:'classe',msg:'deleted'}]:event);});
 const c=new NfeClient({credentials,baseUrl});
 await c.consultarDocumento({ID:'order &=1',ambiente:2});
 await c.consultarDocumentoPost({uuid:id});
 await c.emitirCartaCorrecao({uuid:id,correcao:'Correct the described customer field.',extra:{zero:0,enabled:false}});
 await c.manifestarDocumento({chave:'0'.repeat(44),ambiente:2,evento:'210240',justificativa:'Operation was not performed.'});
 await c.cancelarDocumento({uuid:id,motivo:'Cancellation requested by test.'});
 await c.inutilizarNumeracao({sequencia:'10-12',motivo:'Numbering test justification.',ambiente:2,serie:'1',modelo:'1'});
 await c.emitirConciliacao({uuid:id,pagamento:{forma_pagamento:'01',valor_pagamento:'9007199254740.99',data_pagamento:'2026-10-25'}});
 await c.cancelarConciliacao({uuid:id});await c.cancelarEventoIbsCbs({uuid:id});await c.excluirClassesFiscais({referencia:['classe']});
 assert.deepEqual(seen.map(x=>[x.method,new URL(x.url,'http://local').pathname]),[['GET','/api/1/nfe/consulta/'],['POST','/api/1/nfe/consulta/'],['POST','/api/1/nfe/cartacorrecao/'],['POST','/api/1/nfe/manifesta/'],['PUT','/api/1/nfe/cancelar/'],['PUT','/api/1/nfe/inutilizar/'],['POST','/api/1/nfe/conciliacao/'],['PUT','/api/1/nfe/conciliacao/cancelar/'],['PUT','/api/1/nfe/evento-ibs-cbs/cancelar/'],['DELETE','/api/1/nfe/classe-imposto/']]);
 assert.equal(new URL(seen[0].url,'http://local').searchParams.get('ID'),'order &=1');assert.equal(seen[0].body,undefined);assert.deepEqual(seen[2].body.extra,{zero:0,enabled:false});assert.equal(seen[6].body.pagamento.valor_pagamento,'9007199254740.99');
});
test('request schema checks identifiers and conditional payment/manifestation fields before network',async t=>{
 let calls=0;const baseUrl=await fixture(t,(_q,r)=>{calls++;send(r,event);});const c=new NfeClient({credentials,baseUrl});
 for(const promise of [c.consultarDocumento({}),c.emitirCartaCorrecao({uuid:id,correcao:'short'}),c.manifestarDocumento({chave:'0'.repeat(44),ambiente:2,evento:'210240'}),c.emitirConciliacao({uuid:id,pagamento:{forma_pagamento:'01',valor_pagamento:'1.00',data_pagamento:'2026-10-25',cnpj_transacional_pag:'0'.repeat(14)}})])await assert.rejects(promise,{kind:'validation'});
 assert.equal(calls,0);
});
test('mutating timeout is uncertain, preserves reference and does not resend',async t=>{
 let calls=0;const baseUrl=await fixture(t,(_q,r)=>{calls++;r.writeHead(200,{'Content-Type':'application/json'});r.write('{');});const c=new NfeClient({credentials,baseUrl,timeoutMs:75});
 await assert.rejects(c.cancelarDocumento({uuid:id,motivo:'Reason for cancellation request.'}),error=>error.kind==='timeout'&&error.outcome==='unknown'&&error.requestReference==='[REDACTED]'&&error.recovery===undefined);assert.equal(calls,1);
});
const city={nativo:false,im:false,certificado:false,login_senha:false,cadastro_prefeitura:false,domicilio_fiscal_municipio:false,multiplos_servicos:false};
test('six Monitor reads use only Bearer and validate response variants',async t=>{
 const seen=[];const baseUrl=await fixture(t,(req,res)=>{seen.push(req.url);assert.equal(req.headers.authorization,'Bearer synthetic-monitor');assert.equal(req.headers['x-consumer-key'],undefined);assert.equal(req.headers['x-token'],undefined);const path=new URL(req.url,'http://local').pathname;
 if(path==='/2/monitor/estatisticas/downloads')return send(res,{total_downloads:0,empresas:[]});
 if(path==='/2/monitor/municipios-nfse')return send(res,req.url.includes('codigo_ibge')?city:{data:[{...city,municipio:'São Paulo',uf:'SP',codigo_ibge:'3550308'}]});
 if(path.endsWith('/municipios-nfse/'+download))return send(res,{uuid:download,tipo_download:1,municipio:'São Paulo',uf:'SP',codigo_ibge:'3550308'});
 if(path.endsWith('/municipios-nfse'))return send(res,{data:[],meta:{current_page:1,last_page:1,per_page:10,total:0}});
 if(path.endsWith('/'+id))return send(res,{uuid:id,extra:false});
 send(res,{data:[{uuid:id}],meta:{current_page:1,last_page:1,per_page:10,total:1}});
 });const c=new MonitorClient({bearerToken:'synthetic-monitor',baseUrl});
 assert.equal((await c.listarEmpresas({page:1,per_page:10,pesquisa:'Example & Co'})).data[0].uuid,id);assert.equal((await c.consultarEmpresa(id)).extra,false);
 assert.equal((await c.listarMunicipiosEmpresa(id,{per_page:10,uf:'SP',codigo_ibge:'3550308'})).meta.total,0);assert.equal((await c.consultarMunicipioEmpresa(id,download)).uuid,download);
 assert.equal((await c.listarMunicipiosDisponiveis()).data.length,1);assert.deepEqual(await c.listarMunicipiosDisponiveis('0000000'),city);assert.equal((await c.estatisticasDownloads({ano:2026,mes:10})).total_downloads,0);assert.equal(seen.length,7);
 assert.equal(new URL(seen[0],'http://local').searchParams.get('pesquisa'),'Example & Co');
});
test('Monitor pagination terminates, enforces bounds and detects non-advancing metadata',async t=>{
 let stuck=false;const pages=[];const baseUrl=await fixture(t,(req,res)=>{const page=Number(new URL(req.url,'http://local').searchParams.get('page'));pages.push(page);send(res,{data:[{uuid:id,page}],meta:{current_page:stuck?1:page,last_page:2,per_page:10,total:2}});});const c=new MonitorClient({bearerToken:'synthetic-monitor',baseUrl});const items=[];for await(const company of c.iterarEmpresas({per_page:10}))items.push(company);assert.equal(items.length,2);assert.deepEqual(pages,[1,2]);
 await assert.rejects(async()=>{for await(const _ of c.iterarEmpresas({per_page:10}, {maxPages:1})){}},{kind:'response_limit'});stuck=true;await assert.rejects(async()=>{for await(const _ of c.iterarEmpresas({per_page:10})){}},{kind:'protocol'});
});
test('Monitor validates query and envelope, redacts bare bearer in structured errors',async t=>{
 let calls=0;const baseUrl=await fixture(t,(_req,res)=>{calls++;send(res,{error:'synthetic-monitor',message:'synthetic-monitor'});});const c=new MonitorClient({bearerToken:'synthetic-monitor',baseUrl});
 for(const p of[c.listarEmpresas({per_page:1}),c.consultarEmpresa('bad/uuid'),c.listarMunicipiosDisponiveis('123'),c.estatisticasDownloads({ano:2024})])await assert.rejects(p,{kind:'validation'});assert.equal(calls,0);
 await assert.rejects(c.listarEmpresas(),e=>e.kind==='api'&&!JSON.stringify(e).includes('synthetic-monitor'));
 const bad=await fixture(t,(_q,r)=>send(r,{data:[],meta:{current_page:0}}));await assert.rejects(new MonitorClient({bearerToken:'x',baseUrl:bad}).listarEmpresas(),{kind:'protocol'});
});

test('lookup retains documented list response for GET and POST',async t=>{
 const baseUrl=await fixture(t,(_q,r)=>send(r,[event,{...event,uuid:download}]));const c=new NfeClient({credentials,baseUrl});
 assert.equal((await c.consultarDocumento({ID:'two'})).length,2);assert.equal((await c.consultarDocumentoPost({ID:'two'})).length,2);
});
test('mutating JSON with invalid schema preserves uncertain outcome and reference',async t=>{
 const baseUrl=await fixture(t,(_q,r)=>send(r,{unrecognized:true}));const c=new NfeClient({credentials,baseUrl});
 await assert.rejects(c.cancelarDocumento({uuid:id,motivo:'Cancellation test justification.'}),error=>error.kind==='protocol'&&error.outcome==='unknown'&&error.requestReference==='[REDACTED]'&&error.recovery.reveal().uuid===id);
});
test('statistics year/month pair and endpoint-specific query fields fail before dispatch',async t=>{
 let calls=0;const baseUrl=await fixture(t,(_q,r)=>{calls++;send(r,{});});const c=new MonitorClient({bearerToken:'synthetic-monitor',baseUrl});
 for(const promise of[c.estatisticasDownloads({ano:2026}),c.estatisticasDownloads({mes:10}),c.listarEmpresas({codigo_ibge:'3550308'}),c.listarMunicipiosEmpresa(id,{pesquisa:'test'})])await assert.rejects(promise,{kind:'validation'});assert.equal(calls,0);
});
test('redaction escapes regex metacharacters, numeric fragments, and preserves colliding-key detail',async t=>{
 const special='a+b[1]';const baseUrl=await fixture(t,(_q,r)=>{r.writeHead(401,{'Content-Type':'application/json'});r.end(JSON.stringify({error:special,'prefix1234suffix':1,'prefix5678suffix':2,number:912345,business:6789}));});
 const c=new NfeClient({baseUrl,credentials:{consumerKey:'1234',consumerSecret:'5678',accessToken:special,accessTokenSecret:'synthetic-last'}});
 await assert.rejects(c.consultarCertificado(),e=>{assert.equal(e.response.error,'[REDACTED]');assert.equal(e.response.number,'[REDACTED]');assert.equal(e.response.business,6789);assert.equal(e.response['prefix[REDACTED]suffix'],1);assert.equal(e.response['prefix[REDACTED]suffix#1'],2);return true;});
});


test('errors never expose document capability URLs or their independent token values',async t=>{
 const nonce='unconfigured-capability-canary';const baseUrl=await fixture(t,(_q,r)=>{r.writeHead(400,{'Content-Type':'application/json'});r.end(JSON.stringify({error:'download_failure',xml:`https://files.example.invalid/document?token=${nonce}`,message:`Could not read https://files.example.invalid/report/${nonce}`}));});
 await assert.rejects(new NfeClient({baseUrl,credentials}).consultarCertificado(),e=>{assert.equal(e.response.xml,'[REDACTED_URL]');assert.equal(e.response.message,'Could not read [REDACTED_URL]');assert.ok(!JSON.stringify(e).includes(nonce));return true;});
});
