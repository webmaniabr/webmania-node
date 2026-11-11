import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {NfeClient} from './sdk.mjs';

const credentials={consumerKey:'synthetic-key',consumerSecret:'synthetic-secret',accessToken:'synthetic-access',accessTokenSecret:'synthetic-access-secret'};
const id='00000000-0000-4000-8000-000000000001';
const cnpj='00000000000000',masked='00.000.000/0000-00';
function request(){return{
 ID:'wire-test-001',modelo:'1',operacao:1,natureza_operacao:'Controlled sale',finalidade:1,ambiente:2,
 cliente:{cpf:'000.000.000-00',nome_completo:'Synthetic person',endereco:'Synthetic street',numero:'1',bairro:'Synthetic district',cidade:'Synthetic city',uf:'SP',cep:'01001-000'},
 produtos:[{nome:'Synthetic item',codigo:'0001',ncm:'0000.00.00',quantidade:'1.0000',unidade:'UN',subtotal:'0.10',total:'0.10',origem:0,impostos:{icms:{codigo_cfop:'5102',situacao_tributaria:'102'},ipi:{situacao_tributaria:'99',codigo_enquadramento:'001',aliquota:'0.00'}}}],
 pedido:{presenca:1,modalidade_frete:9,total:'0.10',pagamento:[0,0],tipo_integracao:[2,2],forma_pagamento:['01','17'],valor_pagamento:['0.05','0.05'],cnpj_transacional_pag:[cnpj,masked],uf_estabelecimento_pag:['SP','SP'],cnpj_credenciadora:[cnpj,masked],cnpj_beneficiario:[cnpj,masked]},
};}
async function fixture(t){
 const bodies=[];const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);bodies.push(bytes);
  assert.equal(req.method,'POST');assert.equal(req.url,'/api/1/nfe/emissao/');assert.equal(Number(req.headers['content-length']),bytes.length);
  assert.equal(req.headers['x-consumer-key'],credentials.consumerKey);assert.equal(req.headers.authorization,undefined);
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({uuid:id,status:'processando'}));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 return{bodies,client:new NfeClient({credentials,baseUrl:'http://127.0.0.1:'+server.address().port})};
}

test('API1 documented IPI digit text and payment CNPJ arrays serialize without coercion or byte changes',async t=>{
 const{client,bodies}=await fixture(t);const payload=request(),expected=Buffer.from(JSON.stringify(payload));
 assert.equal((await client.emitirNfe(payload)).status,'processando');assert.deepEqual(bodies[0],expected);assert.deepEqual(payload,request());
 const wire=JSON.parse(bodies[0]);assert.equal(wire.produtos[0].impostos.ipi.codigo_enquadramento,'001');
 for(const field of ['cnpj_transacional_pag','cnpj_credenciadora','cnpj_beneficiario'])assert.deepEqual(wire.pedido[field],[cnpj,masked]);
 for(const code of [0,999,'0','999']){const scalar=request();scalar.produtos[0].impostos.ipi.codigo_enquadramento=code;for(const field of ['cnpj_transacional_pag','cnpj_credenciadora','cnpj_beneficiario'])scalar.pedido[field]=cnpj;await client.emitirNfe(scalar);assert.deepEqual(bodies.at(-1),Buffer.from(JSON.stringify(scalar)));}
 assert.equal(bodies.length,5);
});

test('API1 invalid IPI widths and numeric/malformed payment identifiers fail before I/O',async t=>{
 const{client,bodies}=await fixture(t);
 for(const code of ['', '1000','9.9','1e2',' 001 ',1000,-1,1.5,true,{},[]]){const payload=request();payload.produtos[0].impostos.ipi.codigo_enquadramento=code;await assert.rejects(client.emitirNfe(payload),{kind:'validation'});}
 for(const field of ['cnpj_transacional_pag','cnpj_credenciadora','cnpj_beneficiario'])for(const value of [0,[0],[],['0'.repeat(13)],['0'.repeat(15)],['00.000.000/0000-000'],[cnpj,0],['invalid'],null,{}]){const payload=request();payload.pedido[field]=value;await assert.rejects(client.emitirNfe(payload),{kind:'validation'});}
 assert.equal(bodies.length,0);
});
