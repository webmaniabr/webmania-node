import { JsonTransport, WebmaniaError, credential } from './internal.js';
import type { TransportOptions, RequestOptions } from './internal.js';
import type { FiscalTransferResult, BinaryPolicy } from './files-types.js';
import { issuerFileRoutes } from './generated/issuer-file-routes.js';
export type { FiscalTransferResult, NonFileResult, RedirectFileResult } from './files-types.js';
export type IssuerFileAuthorization={type:'company_bearer'}|{type:'document_token';token:string}|{type:'public'};
export interface IssuerFilesClientOptions extends TransportOptions {
  trustedOrigins:readonly string[];
  issuerBearerToken?:string;
}
export interface IssuerFileRequestOptions extends RequestOptions {timeoutMs?:number;maxResponseBytes?:number}
export interface IssuerFileArguments {path:{identifier:string};authorization:IssuerFileAuthorization}
type Route=typeof issuerFileRoutes[number];
const roots=['NFe','nfeProc','procNFe','procEvento','evento','retEvento','procEventoNFe','CTe','cteProc','procCTe','CTeOS','cteOSProc','procCTeOS','procEventoCTe','evCancCTe','evCCeCTe','MDFe','mdfeProc','procMDFe','procEventoMDFe','NFCom','nfcomProc','procNFCom','procEventoNFCom','DCe','dceProc','procDCe','procEventoDCe','NFSe','Nfse','nfse','CompNfse','compNfse','ConsultarNfseResposta','ConsultarNfsePorRpsResposta'];
function origin(value:string):string{
  let u:URL;try{if(typeof value!=='string'||!/^https?:\/\/[^/?#\\\s]+\/?$/.test(value))throw new Error();u=new URL(value);}catch{throw new WebmaniaError('configuration','A fiscal file origin must be an absolute HTTPS origin.');}
  if((u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new WebmaniaError('configuration','Select an HTTPS fiscal file origin; HTTP loopback is test-only.');
  return u.origin;
}
/** API2 files require explicit origin trust and one selected authorization per call. */
export class IssuerFileService {
  #base:string;#trusted:Set<string>;#token:string|undefined;#options:TransportOptions;
  constructor(options:IssuerFilesClientOptions){
    if(!options||!Array.isArray(options.trustedOrigins)||!options.trustedOrigins.length)throw new WebmaniaError('configuration','trustedOrigins must explicitly list approved fiscal file origins.');
    this.#base=origin(options.baseUrl??'https://api.webmania.com.br');this.#trusted=new Set(options.trustedOrigins.map(origin));
    if(options.issuerBearerToken!==undefined&&!credential(options.issuerBearerToken))throw new WebmaniaError('configuration','issuerBearerToken must be a valid opaque company token.');
    this.#token=options.issuerBearerToken;
    this.#options={timeoutMs:options.timeoutMs??30000,maxResponseBytes:options.maxResponseBytes??32*1024*1024,...(options.ca===undefined?{}:{ca:options.ca})};
    new JsonTransport({...this.#options,baseUrl:this.#base},{},this.#base);
  }
  protected async file(operation:string,args:IssuerFileArguments,options:IssuerFileRequestOptions={}):Promise<FiscalTransferResult>{
    const route=issuerFileRoutes.find(r=>r.operationId===operation)!;
    if(!this.#trusted.has(this.#base))throw new WebmaniaError('configuration','The selected fiscal file origin was not explicitly trusted.');
    if(!args||!args.path||Object.keys(args.path).some(k=>k!=='identifier')||Object.keys(args).some(k=>!['path','authorization'].includes(k)))throw new WebmaniaError('validation','A named fiscal identifier and explicit authorization are required.');
    const id=args.path.identifier;
    const validUuid=typeof id==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
    if(!validUuid&&(route.uuidOnly||typeof id!=='string'||!/^\d{6}[A-Za-z0-9]{12}\d{26}$/.test(id)))throw new WebmaniaError('validation','The fiscal route requires its documented UUID or access key.');
    const auth=args.authorization,headers:Record<string,string>={},secrets:string[]=[];let authorization:BinaryPolicy['authorization'];
    if(auth?.type==='company_bearer'){
      if(!this.#token)throw new WebmaniaError('configuration','Configure the company issuerBearerToken to select company_bearer.');
      headers.Authorization='Bearer '+this.#token;authorization='company_bearer';
    }else if(auth?.type==='document_token'){
      if(route.companyOnly)throw new WebmaniaError('validation','This MDF-e file route requires company_bearer authorization.');
      if(!credential(auth.token))throw new WebmaniaError('validation','A document-scoped opaque link token is required.');
      authorization='document_token';secrets.push(auth.token);
    }else if(auth?.type==='public'){
      if(route.companyOnly)throw new WebmaniaError('validation','This MDF-e file route requires company_bearer authorization.');
      authorization='public';
    }else throw new WebmaniaError('validation','Choose company_bearer, document_token or public explicitly.');
    const query=auth.type==='document_token'?'?'+new URLSearchParams({token:auth.token}):'';
    const path=route.path.replace('{identifier}',encodeURIComponent(id))+query;
    const policy:BinaryPolicy={format:route.format,mediaTypes:route.mediaTypes,authorization,representations:true,redirect:route.redirect,pending:operation==='fileGetNfsePdf',xmlRoots:roots};
    return new JsonTransport({...this.#options,baseUrl:this.#base,...(options.timeoutMs===undefined?{}:{timeoutMs:options.timeoutMs}),...(options.maxResponseBytes===undefined?{}:{maxResponseBytes:options.maxResponseBytes})},headers,this.#base)
      .request('GET',path,undefined,options,true,undefined,policy,secrets,{secrets:[id],selectors:{identifier:id}}) as Promise<FiscalTransferResult>;
  }
}
