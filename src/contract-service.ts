import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { JsonTransport, WebmaniaError, WireSnapshot, object } from './internal.js';
import type { RequestOptions, DiagnosticContext } from './internal.js';
import { catalogSchema } from './generated/catalog.js';
import type { BinaryPolicy } from './files-types.js';
export interface Operation {
  operationId:string;
  method:'GET'|'POST'|'PUT'|'DELETE';
  path:string;
  parameters:readonly {name:string;in:string;required?:boolean;schema:object;[key:string]:unknown}[];
  bodySchema:object|null;
  responseSchema:object|null;
  argumentsSchema:object;
  effect:unknown;
  description:string;
  contract:string;
  enabled:boolean;
}
const ajv=new Ajv2020({strict:false,allErrors:false,validateFormats:true});
(addFormatsModule as unknown as (a:Ajv2020)=>void)(ajv);
function decimalParts(value:string):{negative:boolean;digits:string;power:number}|undefined{
  const m=/^([+-]?)(\d*\.?\d+|\d+\.?)(?:[eE]([+-]?\d+))?$/.exec(value);if(!m)return undefined;
  const dot=m[2]!.indexOf('.'),fraction=dot<0?0:m[2]!.length-dot-1;
  const raw=m[2]!.replace('.','').replace(/^0+/,''),digits=raw.replace(/0+$/,'');
  return {negative:m[1]==='-'&&digits!=='',digits,power:Number(m[3]??0)-fraction+(raw.length-digits.length)};
}
function compareDecimal(a:string,b:string):number|undefined{
  const x=decimalParts(a),y=decimalParts(b);if(!x||!y)return undefined;
  if(x.negative!==y.negative)return x.negative?-1:1;
  let result=0;
  if(!x.digits||!y.digits)result=x.digits?1:y.digits?-1:0;
  else if(x.digits.length+x.power!==y.digits.length+y.power)result=x.digits.length+x.power<y.digits.length+y.power?-1:1;
  else {const length=Math.max(x.digits.length,y.digits.length),left=x.digits.padEnd(length,'0'),right=y.digits.padEnd(length,'0');result=left<right?-1:left>right?1:0;}
  return x.negative?-result:result;
}
for(const [keyword,direction]of [['x-sdk-numeric-minimum',1],['x-sdk-numeric-maximum',-1]]as const)ajv.addKeyword({keyword,schemaType:'string',validate:(bound:string,data:unknown)=>{if(typeof data!=='string')return true;const comparison=compareDecimal(data,bound);return comparison!==undefined&&(direction===1?comparison>=0:comparison<=0);},errors:false});
ajv.addSchema({...catalogSchema,$id:'urn:webmania:fiscal:catalog'});
const validators=new Map<string,ReturnType<Ajv2020['compile']>>();
function absoluteRefs(value:unknown):unknown {
  if(Array.isArray(value))return value.map(absoluteRefs);
  if(object(value))return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,key==='$ref'&&typeof child==='string'&&child.startsWith('#/')?'urn:webmania:fiscal:catalog'+child:absoluteRefs(child)]));
  return value;
}
export function validateContract(key:string,schema:object,value:unknown,kind:'validation'|'protocol'):void {
  let validator=validators.get(key);
  try{if(!validator){validator=ajv.compile(absoluteRefs(schema) as object);validators.set(key,validator);}}
  catch{throw new WebmaniaError('configuration','The pinned operation schema could not be initialized.');}
  if(!validator(value))throw new WebmaniaError(kind,`Invalid ${key}; review documented fields and conditional parameters.`);
}
/** Shared runtime for generated, fixed named operations. No arbitrary request entrypoint. */
export class ContractService {
  #transport:JsonTransport;
  constructor(transport:JsonTransport){this.#transport=transport;}
  protected async invoke(op:Operation,args:unknown,options:RequestOptions,context:DiagnosticContext={}):Promise<unknown>{
    options=this.#transport.start(options);
    if(!op.enabled)throw new WebmaniaError('configuration','This operation is blocked by the pinned contract.');
    const snapshot=WireSnapshot.create(args,op.operationId),data=snapshot.value;
    validateContract(op.operationId+'Arguments',op.argumentsSchema,data,'validation');
    if(!object(data))throw new WebmaniaError('validation','Operation arguments must be an object.');
    const pathParams=object(data.path)?data.path:{},query=object(data.query)?data.query:{};
    if(Object.values(pathParams).some(value=>value==='.'||value==='..'))throw new WebmaniaError('validation','Dot segments are not fiscal identifiers.');
    let path=op.path.replace(/\{([^}]+)\}/g,(_match,key:string)=>encodeURIComponent(String(pathParams[key])));
    const params=new URLSearchParams();
    for(const[key,value]of Object.entries(query))if(value!==undefined){
      if(typeof value==='number'&&!Number.isSafeInteger(value)&&Number.isInteger(value))throw new WebmaniaError('validation','Integer query values must be safe JavaScript integers.');
      if(!['string','number','boolean'].includes(typeof value))throw new WebmaniaError('validation','Query values must be scalar.');
      params.set(key,String(value));
    }
    if(params.size)path+='?'+params;
    const body=data.body===undefined?undefined:WireSnapshot.create(data.body);
    if(op.operationId==='nfeIssueReturn'&&object(data.body)&&Array.isArray(data.body.quantidade)&&Array.isArray(data.body.produtos)&&data.body.quantidade.length!==data.body.produtos.length)throw new WebmaniaError('validation','Return quantities must match the selected product positions in length and order.');
    let effect=op.effect!==false;
    if(op.effect==='only_when_relatorio_is_present')effect=object(data.body)&&Object.hasOwn(data.body,'relatorio');
    if(op.effect==='provider_status_refresh_when_atualizar_status_is_1')effect=String(query.atualizar_status)==='1';
    let binary:BinaryPolicy|undefined;
    if(op.operationId==='monitorDownloadReport')binary={format:'report',mediaTypes:['application/octet-stream'],authorization:'monitor'};
    const scoped:DiagnosticContext={...context,selectors:{...pathParams,...(context.selectors??{})},secrets:[...Object.values(pathParams).map(String),...Object.values(query).map(String),...(context.secrets??[])]};
    return this.#transport.request(op.method,path,body,options,effect,
      op.responseSchema?value=>{validateContract(op.operationId+'Result',op.responseSchema!,value,'protocol');return value;}:undefined,binary,[],scoped);
  }
}
