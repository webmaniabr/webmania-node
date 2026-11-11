import {readFile} from 'node:fs/promises';
import {MonitorClient,WebmaniaError} from '@webmaniabr/sdk';
const catalog=JSON.parse(await readFile(new URL('./monitor-payloads.json',import.meta.url),'utf8'));
const operation=process.argv[2]??'monitorListCompanies';
if(!Object.hasOwn(catalog.operations,operation))throw new Error('Selecione um dos métodos públicos no catálogo Monitor.');
if(!process.argv.includes('--execute'))console.log(JSON.stringify({operation,classification:catalog.classification,network_calls:0}));
else{
 if(!process.env.WEBMANIA_MONITOR_PAYLOAD_FILE)throw new Error('Configure WEBMANIA_MONITOR_PAYLOAD_FILE com argumentos autorizados para sua conta.');
 const args=JSON.parse(await readFile(process.env.WEBMANIA_MONITOR_PAYLOAD_FILE,'utf8'));
 const client=new MonitorClient({bearerToken:process.env.WEBMANIA_MONITOR_TOKEN});
 try{const result=await client[operation](args);console.log(JSON.stringify({uuid:result.uuid,status:result.status,kind:result.kind,items:Array.isArray(result.data)?result.data.length:undefined}));}
 catch(error){if(error instanceof WebmaniaError){console.error(JSON.stringify(error));process.exitCode=1;}else throw error;}
}
