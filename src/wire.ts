import { WebmaniaError } from './internal.js';
import { wellFormedText } from './unicode.js';
export class UnsafeJsonNumberError extends Error {}
/** Preserve JSON number semantics before the runtime can lose the wire token. */
export function parseResponseJson(text:string):unknown {
  function decimal(value:string):string {
    const match=/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value);
    if(!match)throw new Error('Invalid number.');
    let digits=(match[2]!+(match[3]??'')).replace(/^0+/,'');
    if(!digits)return '0';
    let power=Number(match[4]??0)-(match[3]?.length??0);
    if(!Number.isSafeInteger(power))throw new Error('Unsupported number exponent.');
    const trimmed=digits.replace(/0+$/,'');power+=digits.length-trimmed.length;digits=trimmed;
    return match[1]+digits+'e'+power;
  }
  return JSON.parse(text,(_key:string,value:unknown,context?:{source?:string})=>{
    if(typeof value==='number'&&(!Number.isFinite(value)||(Number.isInteger(value)&&!Number.isSafeInteger(value))||!context?.source||decimal(context.source)!==decimal(String(value))))
      throw new UnsafeJsonNumberError('JSON number cannot be represented safely; the provider must use a decimal string.');
    return value;
  });
}
/** Internal immutable snapshot: user serializers are invoked exactly once. */
export class WireSnapshot<T=unknown> {
  readonly payload:string;
  readonly value:T;
  private constructor(payload:string,value:T){this.payload=payload;this.value=value;}
  static create<T>(value:T,action='Request'):WireSnapshot<T>{
    let payload:string|undefined,data:T;
    try{payload=JSON.stringify(value,(key,item:unknown)=>{
      // Native JSON invokes toJSON/getters before this replacer. Validate only
      // keys and values that survive that single serialization, never prewalk
      // caller objects or invoke their converters a second time.
      if(item!==undefined&&typeof item!=='function'&&typeof item!=='symbol'&&!wellFormedText(key))throw new Error();
      if(typeof item==='string'&&!wellFormedText(item))throw new Error();
      if(typeof item==='number'&&(!Number.isFinite(item)||(Number.isInteger(item)&&!Number.isSafeInteger(item))))throw new Error();
      return item;
    });if(payload===undefined)throw new Error();data=JSON.parse(payload) as T;}
    catch{throw new WebmaniaError('validation',action+' must be JSON serializable with well-formed Unicode; use strings for precise decimals.');}
    if(Buffer.byteLength(payload)>16*1024*1024)throw new WebmaniaError('validation','Request exceeds the 16 MiB limit.');
    const pending=[{value:data,depth:0}];let nodes=0;
    while(pending.length){
      const{value:node,depth}=pending.pop()!;
      if(++nodes>100000||depth>64)throw new WebmaniaError('validation','Request exceeds the 100000 node or 64 level JSON limit.');
      // JSON unwraps boxed String objects after the replacer. Inspect only the
      // parsed, inert snapshot to cover that native conversion as well.
      if(typeof node==='string'&&!wellFormedText(node))throw new WebmaniaError('validation',action+' must contain well-formed Unicode.');
      if(node!==null&&typeof node==='object')for(const[key,child]of Object.entries(node)){
        if(!wellFormedText(key))throw new WebmaniaError('validation',action+' must contain well-formed Unicode.');
        pending.push({value:child,depth:depth+1});
      }
    }
    return new WireSnapshot(payload,data);
  }
}
