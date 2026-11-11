import {readFile} from 'node:fs/promises';
import {NfeClient,IssuerClient,WebmaniaError} from '@webmaniabr/sdk';
const catalog=JSON.parse(await readFile(new URL('./model-payloads.json',import.meta.url),'utf8'));
const model=process.argv[2]??'nfe',example=catalog.models[model];
if(!example)throw new Error('Selecione nfe, nfce, nfse, cte, cte_os, mdfe, nfcom ou dce.');
if(String(example.body.ambiente)!=='2')throw new Error('O exemplo exige homologação.');
if(!process.argv.includes('--execute')){
 console.log(JSON.stringify({model,operation:example.operation,environment:2,classification:catalog.classification,network_calls:0}));
}else{
 const client=example.client==='Nfe'?new NfeClient({credentials:{consumerKey:process.env.WEBMANIA_CONSUMER_KEY,consumerSecret:process.env.WEBMANIA_CONSUMER_SECRET,accessToken:process.env.WEBMANIA_ACCESS_TOKEN,accessTokenSecret:process.env.WEBMANIA_ACCESS_TOKEN_SECRET}}):new IssuerClient({issuerBearerToken:process.env.WEBMANIA_ISSUER_TOKEN});
 try{const result=await client[example.operation](example.client==='Nfe'?example.body:{body:example.body});console.log(JSON.stringify({status:result.status,uuid:result.uuid,chave:result.chave}));}
 catch(error){if(error instanceof WebmaniaError){console.error(JSON.stringify(error));process.exitCode=1;}else throw error;}
}
