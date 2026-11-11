import { iteratePages, collectPages } from './pagination.js';
import type { PaginationOptions, PageCollection, PaginationContinuation } from './pagination.js';
export type { PaginationOptions, PageCollection, PaginationContinuation } from './pagination.js';
import type { MonitorImportStatus, MonitorReport, MonitorMunicipalityRegistration as Municipality } from './generated/all-models.js';
import { locationContext } from './diagnostics.js';
import { setTimeout as pause } from 'node:timers/promises';
import { VERSION, WebmaniaError, JsonTransport, object, credential, sanitized, WireSnapshot } from './internal.js';
import type { TransportOptions, RequestOptions } from './internal.js';
export { VERSION, WebmaniaError } from './internal.js';
export type { ErrorKind, TransportOptions, RequestOptions } from './internal.js';
export * from './files.js';
export * from './issuer-files.js';
export type * from './generated/all-models.js';
export type * from './generated/operations.js';
export { MutationReference, ProtectedLocation } from './diagnostics.js';
import { NfeOperations, MonitorOperations, IssuerOperations, ResellerOperations } from './generated/operations.js';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { api1Schema } from './generated/api1-schema.js';
import type { NfeLookupRequest, NfeDocument, NfeCorrectionRequest, NfeManifestationRequest, NfeCancelRequest, NfeCancelResult, NfeVoidRequest, NfeVoidResult, NfePaymentEventRequest, NfePaymentEventCancelRequest, NfeIbsCbsEventCancelRequest, NfeEventResult, TaxClassDeleteRequest, TaxClassDeleteItem, NfeIssueRequest, Nfe55IssueRequest, Nfce65IssueRequest, NfeIssueResult, NfeReturnRequest, NfeAdjustmentRequest, NfeComplementRequest, NfeIbsCbsEventRequest, FiscalTaxClassRequest, TaxClassCreatedResult, TaxClassListItem, TaxClassNoResults, NfseServiceTaxClass, NfcomCommunicationTaxClass, FiscalCompanyUpdateRequest, FiscalCompanyUpdateResult, FiscalReportRequest, FiscalReportResult } from './generated/api1-models.js';
export type * from './generated/api1-models.js';
import type { MonitorCompany, MonitorCompanyPage, MonitorMunicipalityRegistration, MonitorMunicipalityPage, MonitorAvailableMunicipality, MonitorAvailableMunicipalities, MonitorDownloadStatistics } from './generated/monitor-models.js';
export type * from './generated/monitor-models.js';

export interface NfeCredentials { consumerKey: string; consumerSecret: string; accessToken: string; accessTokenSecret: string }
export interface NfeClientOptions extends TransportOptions { credentials: NfeCredentials }
export type { NfeCertificateValidity as CertificateStatus, NfeSefazStatus as SefazStatus } from './generated/nfe-models.js';
import type { NfeCertificateValidity as CertificateStatus, NfeSefazStatus as SefazStatus } from './generated/nfe-models.js';
/** Named API1 fiscal operations using isolated literal credential headers and no automatic replay. */
export class NfeClient extends NfeOperations {
  #transport: JsonTransport;
  constructor(options: NfeClientOptions) {
    const c = options?.credentials;
    if (!c || !credential(c.consumerKey) || !credential(c.consumerSecret) || !credential(c.accessToken) || !credential(c.accessTokenSecret))
      throw new WebmaniaError('configuration', 'All four legacy company credentials are required.');
    const transport = new JsonTransport(options, {
      'X-Consumer-Key': c.consumerKey, 'X-Consumer-Secret': c.consumerSecret,
      'X-Access-Token': c.accessToken, 'X-Access-Token-Secret': c.accessTokenSecret,
    }, 'https://webmania.com.br');
    super(transport);this.#transport=transport;
  }
  async consultarCertificado(options: RequestOptions = {}): Promise<CertificateStatus> {
    const value = await this.#transport.get('/api/1/nfe/certificado/', options);
    if (!object(value) || typeof value.expiration !== 'number' || !Number.isSafeInteger(value.expiration) || value.expiration < 1)
      throw new WebmaniaError('protocol', 'The API returned an invalid certificate status.');
    return value as CertificateStatus;
  }
  async consultarSefaz(options: RequestOptions = {}): Promise<SefazStatus> {
    const value = await this.#transport.get('/api/1/nfe/sefaz/', options);
    if (!object(value) || (value.status !== 'online' && value.status !== 'offline'))
      throw new WebmaniaError('protocol', 'The API returned an invalid SEFAZ status.');
    return value as SefazStatus;
  }
  /** Standard NF-e/NFC-e issuance; preview/calculation responses are distinct from authorization. */
  async emitirNota(request: NfeIssueRequest, options: RequestOptions = {}): Promise<NfeIssueResult> {
    options=this.#transport.start(options);
    const snapshot=api1Request('NfeIssueRequest',request);
    return this.#transport.request('POST','/api/1/nfe/emissao/',snapshot,options,true,value=>api1Result<NfeIssueResult>('NfeIssueResult',value)) as Promise<NfeIssueResult>;
  }
  async emitirNfe(request: Nfe55IssueRequest, options: RequestOptions = {}): Promise<NfeIssueResult> {
    options=this.#transport.start(options);
    const snapshot=api1Request('Nfe55IssueRequest',request);
    return this.#transport.request('POST','/api/1/nfe/emissao/',snapshot,options,true,value=>api1Result<NfeIssueResult>('NfeIssueResult',value)) as Promise<NfeIssueResult>;
  }
  async emitirNfce(request: Nfce65IssueRequest, options: RequestOptions = {}): Promise<NfeIssueResult> {
    options=this.#transport.start(options);
    const snapshot=api1Request('Nfce65IssueRequest',request);
    return this.#transport.request('POST','/api/1/nfe/emissao/',snapshot,options,true,value=>api1Result<NfeIssueResult>('NfeIssueResult',value)) as Promise<NfeIssueResult>;
  }
  async emitirDevolucao(request: NfeReturnRequest, options: RequestOptions = {}): Promise<NfeDocument> {
    options=this.#transport.start(options);
    const snapshot=api1Request('NfeReturnRequest',request);
    if(Array.isArray(snapshot.value.quantidade)&&Array.isArray(snapshot.value.produtos)&&snapshot.value.quantidade.length!==snapshot.value.produtos.length)
      throw new WebmaniaError('validation','Return quantities must match the selected product positions in length and order.');
    return this.#transport.request('POST','/api/1/nfe/devolucao/',snapshot,options,true,value=>api1Result<NfeDocument>('NfeDocument',value)) as Promise<NfeDocument>;
  }
  async emitirAjuste(request: NfeAdjustmentRequest, options: RequestOptions = {}): Promise<NfeDocument> {
    options=this.#transport.start(options);
    const snapshot=api1Request('NfeAdjustmentRequest',request);
    return this.#transport.request('POST','/api/1/nfe/ajuste/',snapshot,options,true,value=>api1Result<NfeDocument>('NfeDocument',value)) as Promise<NfeDocument>;
  }
  async emitirComplementar(request: NfeComplementRequest, options: RequestOptions = {}): Promise<NfeDocument> {
    options=this.#transport.start(options);
    const snapshot=api1Request('NfeComplementRequest',request);
    return this.#transport.request('POST','/api/1/nfe/complementar/',snapshot,options,true,value=>api1Result<NfeDocument>('NfeDocument',value)) as Promise<NfeDocument>;
  }
  async registrarEventoIbsCbs(request: NfeIbsCbsEventRequest, options: RequestOptions = {}): Promise<NfeEventResult> {
    options=this.#transport.start(options);
    const snapshot=api1Request('NfeIbsCbsEventRequest',request);
    return this.#transport.request('POST','/api/1/nfe/evento-ibs-cbs/',snapshot,options,true,value=>api1Result<NfeEventResult>('NfeEventResult',value)) as Promise<NfeEventResult>;
  }
  async listarClassesFiscais(options: RequestOptions = {}): Promise<FiscalTaxClassList> {
    return api1TaxClasses(await this.#transport.get('/api/1/nfe/classe-imposto/',options));
  }
  /** Array input follows the provider's first-result response, never a fictional batch result. */
  async salvarClassesFiscais(request: FiscalTaxClassRequest, options: RequestOptions = {}): Promise<TaxClassCreatedResult> {
    options=this.#transport.start(options);
    const snapshot=api1Request('FiscalTaxClassRequest',request);
    return this.#transport.request('POST','/api/1/nfe/classe-imposto/',snapshot,options,true,value=>api1Result<TaxClassCreatedResult>('TaxClassCreatedResult',value)) as Promise<TaxClassCreatedResult>;
  }
  async atualizarEmpresa(request: FiscalCompanyUpdateRequest, options: RequestOptions = {}): Promise<FiscalCompanyUpdateResult> {
    options=this.#transport.start(options);
    const snapshot=api1Request('FiscalCompanyUpdateRequest',request);
    return this.#transport.request('POST','/api/1/nfe/empresa/',snapshot,options,true,value=>api1Result<FiscalCompanyUpdateResult>('FiscalCompanyUpdateResult',value)) as Promise<FiscalCompanyUpdateResult>;
  }
  async solicitarRelatorio(request: FiscalReportRequest, options: RequestOptions = {}): Promise<FiscalReportResult> {
    options=this.#transport.start(options);
    const snapshot=api1Request('FiscalReportRequest',request);
    return this.#transport.request('POST','/api/1/nfe/relatorios/',snapshot,options,true,value=>api1Result<FiscalReportResult>('FiscalReportResult',value)) as Promise<FiscalReportResult>;
  }
  /** Only identical fiscal report requests are polled; failures are never automatically retried. */
  async aguardarRelatorio(request: FiscalReportRequest, options: ReportWaitOptions = {}): Promise<FiscalReportResult> {
    if(!options||typeof options!=='object')throw new WebmaniaError('validation','Report wait options must be an object.');
    const maximum=options.maxAttempts===undefined?60:options.maxAttempts, interval=options.intervalMs===undefined?5000:options.intervalMs, duration=options.deadlineMs===undefined?300_000:options.deadlineMs;
    if(!Number.isInteger(maximum)||maximum<1||maximum>10000||!Number.isInteger(interval)||interval<5000||interval>300_000||!Number.isInteger(duration)||duration<1||duration>2_147_483_647)
      throw new WebmaniaError('validation','Report waiting requires bounded attempts/deadline and an interval of at least 5000 ms.');
    const snapshot=api1Request('FiscalReportRequest',request);

    const deadline=AbortSignal.timeout(duration), signal=options.signal ? AbortSignal.any([options.signal,deadline]) : deadline;
    let last: FiscalReportResult | undefined;
    const capabilities = new Set<string>(), uuidCapabilities = new Set<string>();
    try {
      for(let attempt=0;attempt<maximum;attempt++){
        last=await this.#transport.request('POST','/api/1/nfe/relatorios/',snapshot,{signal},true,value=>api1Result<FiscalReportResult>('FiscalReportResult',value),undefined,[],{secrets:[...capabilities],uuidCapabilities:[...uuidCapabilities],capabilityAccess:true}) as FiscalReportResult;
        if(typeof last.uuid==='string'&&last.uuid){capabilities.add(last.uuid);uuidCapabilities.add(last.uuid);}
        for(const[key,value]of Object.entries(last))if(typeof value==='string'&&/url|token/i.test(key)){capabilities.add(value);if(/url/i.test(key)){const seen=locationContext(value);for(const component of seen.secrets)capabilities.add(component);for(const cap of seen.uuidCapabilities){capabilities.add(cap);uuidCapabilities.add(cap);}}}
        if(last.status==='concluido'){
          if(typeof last.url!=='string'||last.url.length===0)throw new WebmaniaError('protocol','Completed report did not contain a download URL.');
          return last;
        }
        if(last.status!=='processando')throw new WebmaniaError('protocol','Report entered an unrecognized processing state.');
        if(attempt+1<maximum)await pause(interval,undefined,{signal});
      }
      throw new WebmaniaError('response_limit','Report polling exceeded maxAttempts.');
    } catch(error){
      // A report UUID grants download access; retain it only in successful results.
      if(deadline.aborted&&!options.signal?.aborted)throw new WebmaniaError('timeout','Report waiting exceeded its deadline.',undefined,undefined,undefined,{});
      if(options.signal?.aborted&&!(error instanceof WebmaniaError))throw new WebmaniaError('cancelled','Report waiting cancelled.');
      if(error instanceof WebmaniaError&&capabilities.size){
        const secrets=[...capabilities];
        throw new WebmaniaError(error.kind,String(sanitized(error.message,secrets,0,[...uuidCapabilities])),error.status,
          sanitized(error.response,secrets,0,[...uuidCapabilities]) as Record<string,unknown>|undefined,
          sanitized(error.correlationId,secrets,0,[...uuidCapabilities]) as string|undefined,
          error.outcome ? (error.requestReference===undefined ? {} : {reference:String(sanitized(error.requestReference,secrets,0,[...uuidCapabilities]))}) : undefined);
      }
      throw error;
    }
  }
  async consultarDocumento(request: NfeLookupRequest, options: RequestOptions = {}): Promise<NfeDocument | NfeDocument[]> {
    options=this.#transport.start(options);
    const snapshot=api1Request('NfeLookupRequest',request);
    return this.nfeGetDocument({query:snapshot.value},options);
  }
  async consultarDocumentoPost(request: NfeLookupRequest, options: RequestOptions = {}): Promise<NfeDocument | NfeDocument[]> {
    options=this.#transport.start(options);
    const snapshot=api1Request('NfeLookupRequest',request);
    return api1Documents(await this.#transport.request('POST','/api/1/nfe/consulta/',snapshot,options,false));
  }
  async emitirCartaCorrecao(request: NfeCorrectionRequest, options: RequestOptions = {}): Promise<NfeEventResult> {
    options=this.#transport.start(options);
    const snapshot=api1Request('NfeCorrectionRequest',request);
    return api1Result('NfeEventResult',await this.#transport.request('POST','/api/1/nfe/cartacorrecao/',snapshot,options,true,value=>api1Result('NfeEventResult',value)));
  }
  async manifestarDocumento(request: NfeManifestationRequest, options: RequestOptions = {}): Promise<NfeEventResult> {
    options=this.#transport.start(options);
    const snapshot=api1Request('NfeManifestationRequest',request);
    return api1Result('NfeEventResult',await this.#transport.request('POST','/api/1/nfe/manifesta/',snapshot,options,true,value=>api1Result('NfeEventResult',value)));
  }
  async cancelarDocumento(request: NfeCancelRequest, options: RequestOptions = {}): Promise<NfeCancelResult> {
    options=this.#transport.start(options);
    const snapshot=api1Request('NfeCancelRequest',request);
    return api1Result('NfeCancelResult',await this.#transport.request('PUT','/api/1/nfe/cancelar/',snapshot,options,true,value=>api1Result('NfeCancelResult',value)));
  }
  async inutilizarNumeracao(request: NfeVoidRequest, options: RequestOptions = {}): Promise<NfeVoidResult> {
    options=this.#transport.start(options);
    const snapshot=api1Request('NfeVoidRequest',request);
    return api1Result('NfeVoidResult',await this.#transport.request('PUT','/api/1/nfe/inutilizar/',snapshot,options,true,value=>api1Result('NfeVoidResult',value)));
  }
  async emitirConciliacao(request: NfePaymentEventRequest, options: RequestOptions = {}): Promise<NfeEventResult> {
    options=this.#transport.start(options);
    const snapshot=api1Request('NfePaymentEventRequest',request);
    return api1Result('NfeEventResult',await this.#transport.request('POST','/api/1/nfe/conciliacao/',snapshot,options,true,value=>api1Result('NfeEventResult',value)));
  }
  async cancelarConciliacao(request: NfePaymentEventCancelRequest, options: RequestOptions = {}): Promise<NfeEventResult> {
    options=this.#transport.start(options);
    const snapshot=api1Request('NfePaymentEventCancelRequest',request);
    return api1Result('NfeEventResult',await this.#transport.request('PUT','/api/1/nfe/conciliacao/cancelar/',snapshot,options,true,value=>api1Result('NfeEventResult',value)));
  }
  async cancelarEventoIbsCbs(request: NfeIbsCbsEventCancelRequest, options: RequestOptions = {}): Promise<NfeEventResult> {
    options=this.#transport.start(options);
    const snapshot=api1Request('NfeIbsCbsEventCancelRequest',request);
    return api1Result('NfeEventResult',await this.#transport.request('PUT','/api/1/nfe/evento-ibs-cbs/cancelar/',snapshot,options,true,value=>api1Result('NfeEventResult',value)));
  }
  async excluirClassesFiscais(request: TaxClassDeleteRequest, options: RequestOptions = {}): Promise<TaxClassDeleteItem[]> {
    options=this.#transport.start(options);
    const snapshot=api1Request('TaxClassDeleteRequest',request);
    const value=await this.#transport.request('DELETE','/api/1/nfe/classe-imposto/',snapshot,options,true,value=>{
      if(!Array.isArray(value))throw new WebmaniaError('protocol','Invalid tax-class deletion response.');
      return value.map(item=>api1Result('TaxClassDeleteItem',item));
    });
    if(!Array.isArray(value))throw new WebmaniaError('protocol','The API returned an invalid tax-class deletion response.');
    return value.map(item=>api1Result<TaxClassDeleteItem>('TaxClassDeleteItem',item));
  }
}

export type FiscalTaxClassList = Array<TaxClassListItem | NfseServiceTaxClass | NfcomCommunicationTaxClass> | TaxClassNoResults;
export interface ReportWaitOptions extends RequestOptions { maxAttempts?: number; intervalMs?: number; deadlineMs?: number }
let classListValidator: ReturnType<Ajv2020['compile']> | undefined;
function api1TaxClasses(value: unknown): FiscalTaxClassList {
  classListValidator ??= schemaValidator.compile({...api1Schema,anyOf:[{type:'array',items:{anyOf:['TaxClassListItem','NfseServiceTaxClass','NfcomCommunicationTaxClass'].map(name=>({$ref:'#/components/schemas/'+name}))}},{$ref:'#/components/schemas/TaxClassNoResults'}]});
  if(!classListValidator(value))throw new WebmaniaError('protocol','Invalid fiscal tax-class list response.');
  return value as FiscalTaxClassList;
}

const schemaValidator = new Ajv2020({ strict: false, allErrors: false });
const addFormats = addFormatsModule as unknown as (instance: Ajv2020) => void;
addFormats(schemaValidator);
const api1Validators = new Map<string, ReturnType<Ajv2020['compile']>>();
function api1Validate(name: string, value: unknown, kind: 'validation' | 'protocol'): void {
  let validate=api1Validators.get(name);
  if(!validate){validate=schemaValidator.compile({...api1Schema,$ref:'#/components/schemas/'+name});api1Validators.set(name,validate);}
  if(!validate(value))throw new WebmaniaError(kind,`Invalid ${name}; review required fields and conditional parameters.`);
}
function api1Documents(value:unknown):NfeDocument|NfeDocument[]{return Array.isArray(value)?value.map(item=>api1Result<NfeDocument>('NfeDocument',item)):api1Result<NfeDocument>('NfeDocument',value);}
function api1Request<T>(name:string,value:T):WireSnapshot<T>{const snapshot=WireSnapshot.create(value,name);api1Validate(name,snapshot.value,'validation');return snapshot;}
function api1Result<T>(name:string,value:unknown):T{api1Validate(name,value,'protocol');return value as T;}

export interface MonitorClientOptions extends TransportOptions { bearerToken: string }
export interface MonitorCompanyQuery { page?: number; per_page?: number; pesquisa?: string }
export interface MonitorMunicipalityQuery { page?: number; per_page?: number; municipio?: string; uf?: string; codigo_ibge?: string }
/** Monitor bearer capability is configured separately from emitter credentials. */
export class MonitorClient extends MonitorOperations {
  constructor(options: MonitorClientOptions) {
    if (!options || !credential(options.bearerToken)) throw new WebmaniaError('configuration', 'A non-empty Monitor bearerToken is required.');
    const transport = new JsonTransport(options, { Authorization: 'Bearer ' + options.bearerToken }, 'https://api.webmania.com.br');
    super(transport);
  }
  /** Poll the existing import only. Never submits or repeats an import mutation. */
  async aguardarImportacao(uuid:string,options:ReportWaitOptions={}):Promise<MonitorImportStatus>{
    if(!options||typeof options!=='object'||Array.isArray(options))throw new WebmaniaError('validation','Import wait options must be an object.');
    const maximum=options.maxAttempts===undefined?60:options.maxAttempts,interval=options.intervalMs===undefined?5000:options.intervalMs,duration=options.deadlineMs===undefined?300000:options.deadlineMs;
    if(!Number.isInteger(maximum)||maximum<1||maximum>10000||!Number.isInteger(interval)||interval<5000||interval>300000||!Number.isInteger(duration)||duration<1||duration>2147483647||(options.signal!==undefined&&!(options.signal instanceof AbortSignal)))
      throw new WebmaniaError('validation','Import waiting requires bounded attempts/deadline and an interval of at least 5000 ms.');
    const deadline=AbortSignal.timeout(duration),signal=options.signal?AbortSignal.any([deadline,options.signal]):deadline;
    try {
      for(let attempt=0;attempt<maximum;attempt++){
        const result=await this.monitorGetImportStatus({path:{uuid}},{signal});
        if(result.status==='concluido'||result.status==='invalido')return result;
        if(result.status!=='processando')throw new WebmaniaError('protocol','Import entered an unrecognized processing state.');
        if(attempt+1<maximum)await pause(interval,undefined,{signal});
      }
      throw new WebmaniaError('response_limit','Import polling exceeded maxAttempts.');
    }catch(error){
      if(options.signal?.aborted)throw new WebmaniaError('cancelled','Import waiting cancelled.');
      if(deadline.aborted)throw new WebmaniaError('timeout','Import waiting exceeded its deadline.');
      throw error;
    }
  }
  async listarEmpresas(query: MonitorCompanyQuery = {}, options: RequestOptions = {}): Promise<MonitorCompanyPage> {
    return this.monitorListCompanies({query},options);
  }
  async consultarEmpresa(company: string, options: RequestOptions = {}): Promise<MonitorCompany> {
    return this.monitorGetCompany({path:{company}},options);
  }
  async listarMunicipiosEmpresa(company: string, query: MonitorMunicipalityQuery = {}, options: RequestOptions = {}): Promise<MonitorMunicipalityPage> {
    return this.monitorListCompanyMunicipalities({path:{company},query},options);
  }
  async consultarMunicipioEmpresa(company: string, download: string, options: RequestOptions = {}): Promise<MonitorMunicipalityRegistration> {
    return this.monitorGetCompanyMunicipality({path:{company,download}},options);
  }
  async listarMunicipiosDisponiveis(codigoIbge?: string, options: RequestOptions = {}): Promise<MonitorAvailableMunicipalities | MonitorAvailableMunicipality> {
    return this.monitorListAvailableMunicipalities({query:codigoIbge===undefined?{}:{codigo_ibge:codigoIbge}},options);
  }
  async estatisticasDownloads(query: { ano?: number; mes?: number } = {}, options: RequestOptions = {}): Promise<MonitorDownloadStatistics> {
    return this.monitorGetDownloadStatistics({query},options);
  }
  iterarEmpresas(query: MonitorCompanyQuery = {}, options: PaginationOptions = {}): AsyncGenerator<MonitorCompany,PaginationContinuation|undefined> {
    return iteratePages((page,per_page,request)=>this.monitorListCompanies({query:{...query,page,per_page}},request),query,options);
  }
  coletarEmpresas(query: MonitorCompanyQuery = {}, options: PaginationOptions = {}): Promise<PageCollection<MonitorCompany>> {
    return collectPages(this.iterarEmpresas(query,options));
  }
  iterarMunicipiosEmpresa(company:string,query:MonitorMunicipalityQuery={},options:PaginationOptions={}):AsyncGenerator<Municipality,PaginationContinuation|undefined>{
    return iteratePages((page,per_page,request)=>this.monitorListCompanyMunicipalities({path:{company},query:{...query,page,per_page}},request),query,options);
  }
  coletarMunicipiosEmpresa(company:string,query:MonitorMunicipalityQuery={},options:PaginationOptions={}):Promise<PageCollection<Municipality>>{
    return collectPages(this.iterarMunicipiosEmpresa(company,query,options));
  }
  iterarRelatorios(query:{page?:number;per_page?:number;status?:string}={},options:PaginationOptions={}):AsyncGenerator<MonitorReport,PaginationContinuation|undefined>{
    return iteratePages((page,per_page,request)=>this.monitorListReports({query:{...query,page,per_page}},request),query,options);
  }
  coletarRelatorios(query:{page?:number;per_page?:number;status?:string}={},options:PaginationOptions={}):Promise<PageCollection<MonitorReport>>{
    return collectPages(this.iterarRelatorios(query,options));
  }
}

export interface IssuerClientOptions extends TransportOptions { issuerBearerToken:string }
/** API2 company issuer token, configured independently of Monitor and reseller modes. */
export class IssuerClient extends IssuerOperations {
  constructor(options:IssuerClientOptions){
    if(!options||!credential(options.issuerBearerToken))throw new WebmaniaError('configuration','A company issuerBearerToken is required for API2 emission.');
    super(new JsonTransport(options,{Authorization:'Bearer '+options.issuerBearerToken},'https://api.webmania.com.br'));
  }
}
export interface ResellerCredentials { consumerKey:string;consumerSecret:string;accessToken:string;accessTokenSecret:string }
export interface ResellerClientOptions extends TransportOptions { resellerCredentials:ResellerCredentials }
/** Application/reseller credentials are never substituted for company credentials. */
export class ResellerClient extends ResellerOperations {
  constructor(options:ResellerClientOptions){
    const c=options?.resellerCredentials;
    if(!c||!credential(c.consumerKey)||!credential(c.consumerSecret)||!credential(c.accessToken)||!credential(c.accessTokenSecret))throw new WebmaniaError('configuration','All four resellerCredentials are required for B2B.');
    super(new JsonTransport(options,{'X-Consumer-Key':c.consumerKey,'X-Consumer-Secret':c.consumerSecret,'X-Access-Token':c.accessToken,'X-Access-Token-Secret':c.accessTokenSecret},'https://webmania.com.br'));
  }
}
