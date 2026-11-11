import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { NfeClient } from './sdk.mjs';

const id='00000000-0000-4000-8000-000000000001', key='0'.repeat(44);
const credentials={consumerKey:'synthetic-key',consumerSecret:'synthetic-secret',accessToken:'synthetic-access',accessTokenSecret:'synthetic-access-secret'};
const customer={cpf:'000.000.000-00',nome_completo:'Synthetic person',endereco:'Synthetic street',numero:'1',bairro:'Synthetic district',cidade:'Synthetic city',uf:'SP',cep:'01001-000'};
const product={nome:'Synthetic item',codigo:'0001',ncm:'0000.00.00',quantidade:'1.0000',unidade:'UN',subtotal:'0.10',total:'0.10',origem:0,impostos:{icms:{codigo_cfop:'5102',situacao_tributaria:'102'}}};
const order={presenca:1,modalidade_frete:9,pagamento:0,forma_pagamento:'01',valor_pagamento:'0.10'};
const issue={ID:'controlled-001',modelo:'1',operacao:1,natureza_operacao:'Synthetic sale',finalidade:1,ambiente:2,cliente:customer,produtos:[product],pedido:order};
const report={modelo:'nfe',relatorio:'xml',status:'emitidas',data_inicio:'2026-10-01',data_final:'2026-10-25'};
const document={uuid:id,status:'processando',future:{zero:0,nullable:null,enabled:false}};
async function fixture(t,handler){
 const received=[];const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;
 const request={method:req.method,url:req.url,body:raw?JSON.parse(raw):undefined,headers:req.headers};received.push(request);
 assert.equal(req.headers['x-consumer-key'],credentials.consumerKey);assert.equal(req.headers['x-consumer-secret'],credentials.consumerSecret);assert.equal(req.headers.authorization,undefined);assert.equal(req.headers['x-token'],undefined);await handler(request,res);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 return {client:new NfeClient({credentials,baseUrl:`http://127.0.0.1:${server.address().port}`,timeoutMs:1000}),received};
}
function send(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}

test('remaining API1 operations use exact method/path and real structured fields',async t=>{
 const {client,received}=await fixture(t,(req,res)=>{
  if(req.url==='/api/1/nfe/classe-imposto/')return send(res,req.method==='GET'?[{referencia:'REF1',descricao:'Controlled',type:'nfe',icms:[]}]:{referencia:'REF1',descricao:req.body.descricao,data:'2026-10-25'});
  if(req.url==='/api/1/nfe/empresa/')return send(res,{success:'Updated',future:false});
  if(req.url==='/api/1/nfe/relatorios/')return send(res,{uuid:id,status:'processando',total:0,processado:0});
  send(res,document);
 });
 await client.emitirNota(issue);await client.emitirNfe(issue);await client.emitirNfce({...issue,modelo:2,cliente:undefined});
 await client.emitirDevolucao({uuid:id,natureza_operacao:'Synthetic return',ambiente:2,codigo_cfop:'5202',produtos:[1],quantidade:['0.2500']});
 await client.emitirAjuste({operacao:1,natureza_operacao:'Synthetic adjustment',codigo_cfop:'5949',ambiente:2,cliente:customer,valor_icms:'0.00'});
 await client.emitirComplementar({uuid:id,operacao:1,natureza_operacao:'Synthetic complement',ambiente:2,cliente:customer,impostos:{ibs_cbs:{situacao_tributaria:'000',classificacao_tributaria:'000001',base_calculo:0}}});
 await client.registrarEventoIbsCbs({chave:key,ambiente:2,cod_evento:'112110'});
 assert.equal((await client.listarClassesFiscais())[0].referencia,'REF1');
 await client.salvarClassesFiscais({descricao:'Synthetic tax class',tipo:'nfcom',codigo_classificacao:'100101',icms:{situacao_tributaria:'40'},pis:{situacao_tributaria:'06'},cofins:{situacao_tributaria:'06'}});
 await client.atualizarEmpresa({cnae:null,informacoes_fisco:'Controlled update',certificado:'Zml4dHVyZQ==',certificado_senha:'synthetic-certificate-password'});
 await client.solicitarRelatorio(report);
 assert.deepEqual(received.map(r=>[r.method,r.url]),[['POST','/api/1/nfe/emissao/'],['POST','/api/1/nfe/emissao/'],['POST','/api/1/nfe/emissao/'],['POST','/api/1/nfe/devolucao/'],['POST','/api/1/nfe/ajuste/'],['POST','/api/1/nfe/complementar/'],['POST','/api/1/nfe/evento-ibs-cbs/'],['GET','/api/1/nfe/classe-imposto/'],['POST','/api/1/nfe/classe-imposto/'],['POST','/api/1/nfe/empresa/'],['POST','/api/1/nfe/relatorios/']]);
 assert.equal(received[0].body.produtos[0].quantidade,'1.0000');assert.equal(received[0].body.cliente.cep,'01001-000');assert.deepEqual(received[3].body.quantidade,['0.2500']);assert.equal(received[5].body.impostos.ibs_cbs.base_calculo,0);assert.equal(received[7].body,undefined);assert.equal(received[9].body.cnae,null);
});
test('preview, calculation and processing are distinct response envelopes; success URLs remain usable',async t=>{
 const capability='https://nfe.webmania.com.br/danfe/'+id+'/?token=synthetic-preview-token';
 const {client}=await fixture(t,(req,res)=>send(res,req.body.previa_danfe?{danfe:capability}:req.body.calculo_impostos?{impostos:{icms:'9007199254740999.99'},aliquotas:{icms:[0,'1.2500']},pedido:{total:'9007199254740999.99'}}:document));
 const preview=await client.emitirNota({...issue,previa_danfe:true});assert.equal(preview.danfe,capability);assert.equal(preview.status,undefined);
 const calculation=await client.emitirNota({...issue,calculo_impostos:true});assert.equal(calculation.pedido.total,'9007199254740999.99');assert.equal(calculation.uuid,undefined);
 assert.equal((await client.emitirNota(issue)).status,'processando');
});
test('nested required fields and exclusive/paired/conditional groups fail before I/O',async t=>{
 const {client,received}=await fixture(t,(_req,res)=>send(res,document));
 const noCustomer={...issue};delete noCustomer.cliente;
 const invalid=[client.emitirNfe(noCustomer),client.emitirNota({...issue,produtos:[{}]}),client.emitirNota({...issue,finalidade:5}),client.emitirNota({...issue,produtos:[{...product,impostos:{icms:{codigo_cfop:'5102',situacao_tributaria:'101'}}}]}),client.emitirNota({...issue,agropecuario:{defensivos:[],guia_transito:{}}}),client.emitirDevolucao({uuid:id,natureza_operacao:'Synthetic return',ambiente:2,codigo_cfop:'5202',classe_imposto:'REF1'}),client.emitirDevolucao({uuid:id,natureza_operacao:'Synthetic return',ambiente:2,codigo_cfop:'5202',produtos:[1,2],quantidade:['1.00']}),client.atualizarEmpresa({certificado:'Zml4dHVyZQ=='}),client.solicitarRelatorio({modelo:'nfe',relatorio:'dacte',numero_inicio:'1',numero_final:'5'}),client.salvarClassesFiscais({tipo:'nfcom',descricao:'Synthetic',codigo_classificacao:'100101',icms:{situacao_tributaria:'20'},pis:{situacao_tributaria:'06'},cofins:{situacao_tributaria:'06'}})];
 for(const result of invalid)await assert.rejects(result,{kind:'validation'});assert.equal(received.length,0);
});
const eventDetails={
 '112110':{},'112120':{itens:[{item:1,valor_ibs:'0.00',valor_cbs:0,controle_estoque:{quantidade:'1.2500',unidade:'UN'}}]},
 '112130':{itens:[{item:1,valor_ibs:0,valor_cbs:'0.00',controle_estoque:{quantidade_perecimento:'1.0000',unidade_perecimento:'UN',valor_ibs_estorno:'0.00',valor_cbs_estorno:0}}]},
 '112140':{itens:[{item:1,valor_ibs:0,valor_cbs:'0.00',controle_estoque:{quantidade_nao_fornecida:'1.0000',unidade_nao_fornecida:'UN'}}]},
 '112150':{data_previsao_entrega:'2026-11-01'},
 '211110':{itens:[{item:1,base_calculo:0,credito_presumido:{classificacao:'01',aliquota_ibs:0,aliquota_cbs:'0.0000',valor_ibs:'0.00',valor_cbs:0}}]},
 '211124':{itens:[{item:1,valor_ibs:0,valor_cbs:'0.00',controle_estoque:{quantidade_perecimento:'1.0000',unidade_perecimento:'UN'}}]},
 '211128':{indicador_aceitacao:0},
 '211130':{itens:[{item:1,valor_ibs:0,valor_cbs:'0.00',controle_estoque:{quantidade_imobilizada:'1.0000',unidade_imobilizada:'UN'}}]},
 '211140':{itens:[{item:1,valor_ibs:0,valor_cbs:'0.00',controle_estoque:{quantidade_combustivel:'1.0000',unidade_combustivel:'UN'}}]},
 '211150':{itens:[{item:1,valor_credito_ibs:0,valor_credito_cbs:'0.00'}]}
};
for(const [code,details] of Object.entries(eventDetails))test(`IBS/CBS variant ${code} serializes its specific nested groups`,async t=>{
 const {client,received}=await fixture(t,(req,res)=>send(res,{uuid:id,status:'aprovado',cod_evento:req.body.cod_evento,xml:'https://nfe.webmania.com.br/xmlevento/'+id+'/'}));
 const request={chave:key,ambiente:'2',cod_evento:code,...details,additional_future:false};assert.equal((await client.registrarEventoIbsCbs(request)).cod_evento,code);assert.deepEqual(received[0].body,request);
 if(code!=='112110'){await assert.rejects(client.registrarEventoIbsCbs({chave:key,ambiente:2,cod_evento:code}),{kind:'validation'});assert.equal(received.length,1);}
});
test('IBS legacy wrapper retains exact amounts and rejects unknown event codes',async t=>{
 const {client,received}=await fixture(t,(_req,res)=>send(res,document));
 await client.registrarEventoIbsCbs({chave:key,ambiente:2,cod_evento:'211150',informacoes_evento:{itens:[{item:1,valor_credito_ibs:'9007199254740.99',valor_credito_cbs:0}]}});
 assert.equal(received[0].body.informacoes_evento.itens[0].valor_credito_ibs,'9007199254740.99');await assert.rejects(client.registrarEventoIbsCbs({chave:key,ambiente:2,cod_evento:'999999'}),{kind:'validation'});
});
test('tax-class listing supports empty-message and provider arrays; batch save returns the provider first result',async t=>{
 let empty=true;const {client}=await fixture(t,(req,res)=>send(res,req.method==='GET'?(empty?{msg:'No tax classes'}:[{referencia:'REF1',tipo:'nfse',descricao:'Synthetic',ibs_cbs:{situacao_tributaria:'000',classificacao_tributaria:'000001'}}]):{referencia:'REF1',descricao:'First processed class'}));
 assert.equal((await client.listarClassesFiscais()).msg,'No tax classes');empty=false;assert.equal((await client.listarClassesFiscais())[0].tipo,'nfse');
 const result=await client.salvarClassesFiscais(['First class','Second class'].map(descricao=>({descricao,tipo:'nfcom',codigo_classificacao:'100101',icms:{situacao_tributaria:'40'},pis:{situacao_tributaria:'06'},cofins:{situacao_tributaria:'06'}})));assert.equal(Array.isArray(result),false);assert.equal(result.referencia,'REF1');
});
test('accepted issuance with invalid response, ambiguous application error or HTTP5xx stays uncertain without replay',async t=>{
 let mode=0;const {client,received}=await fixture(t,(_req,res)=>mode===0?send(res,{unrecognized:true}):mode===1?send(res,{error:'Upstream unavailable; document remains processing'}):send(res,{error:'Internal failure'},500));
 for(mode of [0,1,2])await assert.rejects(client.emitirNota(issue),e=>e.outcome==='unknown'&&e.requestReference==='[REDACTED]'&&e.recovery.reveal().ID===issue.ID&&['protocol','api','http'].includes(e.kind));assert.equal(received.length,3);
});
test('bounded report waiting polls the identical request and preserves the completed capability URL',async t=>{
 const url='https://nfe.webmania.com.br/relatorio/'+id+'/';const {client,received}=await fixture(t,(_req,res)=>send(res,received.length===1?{uuid:id,status:'processando'}:{uuid:id,status:'concluido',url}));
 const input={...report};const pending=client.aguardarRelatorio(input,{maxAttempts:2,intervalMs:5000,deadlineMs:10000});input.relatorio='danfe';
 const complete=await pending;assert.equal(complete.url,url);assert.equal(received.length,2);assert.deepEqual(received[0].body,received[1].body);assert.equal(received[0].body.relatorio,'xml');
});
test('report waiting respects deadline, attempts, cancellation and never retries API errors',async t=>{
 const {client,received}=await fixture(t,(_req,res)=>send(res,{uuid:id,status:'processando'}));
 await assert.rejects(client.aguardarRelatorio(report,{maxAttempts:1}),{kind:'response_limit'});
 await assert.rejects(client.aguardarRelatorio(report,{deadlineMs:500}),error=>{
  assert.equal(error.kind,'timeout');assert.equal(error.outcome,'unknown');
  assert.equal(error.requestReference,undefined);assert.ok(!JSON.stringify(error).includes(id));return true;
 });
 assert.equal(received.length,2);
 const controller=new AbortController();const pending=client.aguardarRelatorio(report,{signal:controller.signal});setTimeout(()=>controller.abort(),30);await assert.rejects(pending,{kind:'cancelled'});
 const before=received.length;await assert.rejects(client.aguardarRelatorio(report,{intervalMs:1}),{kind:'validation'});assert.equal(received.length,before);
 const bad=await fixture(t,(_req,res)=>send(res,{error:'Rate limit'},429));await assert.rejects(bad.client.aguardarRelatorio(report),{kind:'http',status:429});assert.equal(bad.received.length,1);
});
for(const status of [200,400,500])test(`report polling redacts a known download capability from subsequent HTTP${status} errors`,async t=>{
 const capability='ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF',echo=capability.toLowerCase();
 const {client,received}=await fixture(t,(_req,res)=>{
  if(received.length===1)return send(res,{uuid:capability,status:'processando'});
  res.setHeader('X-Request-ID',echo);return send(res,{error:'Report failed for '+echo,uuid:echo},status);
 });
 await assert.rejects(client.aguardarRelatorio(report,{maxAttempts:2,intervalMs:5000,deadlineMs:10000}),error=>{
  assert.equal(error.kind,status===200?'api':'http');assert.equal(error.status,status);
  assert.equal(error.outcome,status===400?undefined:'unknown');
  assert.equal(error.correlationId,'[REDACTED]');assert.equal(error.response.uuid,'[REDACTED]');
  assert.ok(!JSON.stringify(error).toLowerCase().includes(echo));assert.ok(!error.message.toLowerCase().includes(echo));return true;
 });
 assert.equal(received.length,2);
});
