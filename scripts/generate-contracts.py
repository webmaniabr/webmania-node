#!/usr/bin/env python3
"""Generate the fixed fiscal catalog, models and executable per-operation policies.

Only local refs and the explicit JSON Schema subset below are supported. Empty
schemas intentionally become unknown; conditionals remain enforced by AJV.

The canonical contract is pinned by its contract_digest: the SHA-256 of the canonical JSON
of the sorted "module path -> SHA-256" map of the manifest modules.
"""
import argparse,hashlib,json,re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CONTRACT_DIGEST='371a499f74012bb6b41f23642869dee4954e8394dcba7642edc701aedb3dd59e'
SUPPORTED={'type','properties','required','additionalProperties','items','enum','$ref','description','title','default','examples','example','pattern','minLength','maxLength','minimum','maximum','maxItems','minItems','format','readOnly','writeOnly','deprecated','const','anyOf','oneOf','allOf','if','then','else','dependentRequired','minProperties','maxProperties','contentEncoding','contentMediaType','not','discriminator','multipleOf','exclusiveMinimum','exclusiveMaximum'}
def comment(s):
    text=s.get('description','').replace('*/','* /')
    notes=[]
    if s.get('writeOnly') or s.get('x-sensitive'):notes.append('Sensitive: expose only deliberately; never log.')
    for key in ['pattern','format','minimum','maximum','minLength','maxLength','minItems','maxItems']:
        if key in s:notes.append(key+': '+str(s[key]))
    return '/** '+(' '.join([text,*notes])).replace('\n',' ')+' */\n' if text or notes else ''
def typ(s,schemas,context=None):
    if s is True:return 'unknown'
    if s is False:return 'never'
    unsupported={k for k in s if k not in SUPPORTED and not k.startswith('x-')}
    if unsupported:raise ValueError('Unsupported keywords '+str(unsupported))
    context=s.get('properties',context or {})
    compositions=[]
    for k,sep in [('anyOf',' | '),('oneOf',' | '),('allOf',' & ')]:
        if k in s:compositions.append('('+sep.join(typ(v,schemas,context)for v in s[k])+')')
    if compositions:
        base={k:v for k,v in s.items()if k not in ['anyOf','oneOf','allOf']}
        if any(k in base for k in ['type','properties','required','$ref','enum','const']):compositions.insert(0,'('+typ(base,schemas,context)+')')
        return ' & '.join(compositions)
    if '$ref' in s:
        ref=s['$ref'];name=ref.removeprefix('#/components/schemas/')
        if not ref.startswith('#/components/schemas/') or name not in schemas:raise ValueError('Unresolved reference '+ref)
        return name
    if 'const'in s:return json.dumps(s['const'],ensure_ascii=False)
    if 'enum'in s:return ' | '.join(json.dumps(v,ensure_ascii=False)for v in s['enum'])
    kind=s.get('type')
    if isinstance(kind,list):return '('+' | '.join(typ(dict(s,type=k),schemas,context)for k in kind)+')'
    if kind=='integer':return 'number'
    if kind in ['string','number','boolean','null']:return kind
    if kind=='array':return 'Array<'+typ(s.get('items',{}),schemas)+'>'
    if kind=='object' or 'properties'in s or 'required'in s:
        required=s.get('required',[]);fields=s.get('properties',{k:context[k]for k in required if k in context})
        if set(required)-set(fields):raise ValueError('Required property lacks inherited schema')
        rows=[comment(v)+json.dumps(k)+(''if k in required else '?')+': '+typ(v,schemas)+';'for k,v in sorted(fields.items())]
        extra=s.get('additionalProperties',True)
        if extra is not False:rows.append('[key: string]: '+('unknown'if extra is True else typ(extra,schemas))+';')
        return ('{\n'+'\n'.join(rows)+'\n}') if rows else 'Record<string, never>'
    return 'unknown'
def pascal(s):return s[0].upper()+s[1:]
def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--contracts',type=Path,required=True,help='webmania-openapi Git checkout');ap.add_argument('--revision',default='HEAD',help='Git revision of the checkout to read (default HEAD)');ap.add_argument('--check',action='store_true');a=ap.parse_args()
    def source(name):return subprocess.check_output(['git','-C',str(a.contracts),'show',a.revision+':'+name])
    manifest=json.loads(source('contracts/manifest.json'))
    shas={name:hashlib.sha256(source(name)).hexdigest()for name in manifest['contracts']}
    digest=hashlib.sha256(json.dumps(dict(sorted(shas.items())),separators=(',',':'),ensure_ascii=False).encode('utf-8')).hexdigest()
    if digest!=CONTRACT_DIGEST:raise SystemExit('Canonical contract_digest '+digest+' differs from the pinned '+CONTRACT_DIGEST)
    schemas={};ops=[];inputs=[];api1routes=[];api2routes=[]
    modules={}
    for name in manifest['contracts']:
        raw=source(name);spec=json.loads(raw);sha=hashlib.sha256(raw).hexdigest();modules[name]=spec
        inputs.append({'contract':name.removeprefix('contracts/'),'sha256':sha,'schema_roots':'all'})
        for k,v in spec['components']['schemas'].items():
            if k in schemas and schemas[k]!=v:raise ValueError('Conflicting schema '+k)
            schemas[k]=v
        for path,item in spec['paths'].items():
            for method,op in item.items():
                if method not in ['get','post','put','delete']:continue
                operation={'operationId':op['operationId'],'method':method.upper(),'path':('/api'+path if name=='contracts/api1/fiscal.openapi.json' else path),'parameters':op.get('parameters',[]),'bodySchema':op.get('requestBody',{}).get('content',{}).get('application/json',{}).get('schema'),'responseSchema':next((r.get('content',{}).get('application/json',{}).get('schema')for code,r in op['responses'].items()if code.startswith('2')),None),'effect':op.get('x-operation-effects',{}).get('business_mutation',method!='get' and op['operationId']!='nfeQueryDocument'),'description':op.get('description',op.get('summary','')),'contract':name.removeprefix('contracts/'),'enabled':op.get('x-sdk-generation-enabled',True)}
                if name.endswith('/files.openapi.json') or name.endswith('/reports.openapi.json'):
                    media=[m for m in op['responses']['200']['content']if m!='application/json'];report=op['security']==[] or name.endswith('/reports.openapi.json')
                    kind='report'if report else 'xml'if any(m in media for m in ['application/xml','text/xml'])else 'pdf'if media==['application/pdf']else 'report'
                    route={'operationId':op['operationId'],'path':path,'format':kind,'mediaTypes':media,'enabled':operation['enabled'],'report':report}
                    if name.endswith('/reports.openapi.json'):route['current']=True
                    event=next((p for p in op['parameters']if p['name']=='event'),None)
                    if event:route['eventMaximum']=event['schema']['maximum']
                    api1routes.append(route)
                elif name.endswith('emitter-files.openapi.json'):
                    media=list(op['responses']['200']['content']);api2routes.append({'operationId':op['operationId'],'path':path,'format':'xml'if 'text/xml'in media else 'pdf','mediaTypes':[m for m in media if m not in ['application/json','text/html']],'companyOnly':len(op['security'])==1,'redirect': '302'in op['responses'],'uuidOnly':op['parameters'][0]['schema'].get('$ref','').endswith('FiscalFileUuid'),'effect':operation['effect']})
                else:
                    def success_schema(v):
                        if isinstance(v,dict):
                            if v.get('$ref','').split('/')[-1] in ['Api1Error','B2bError','MonitorError','EmitterError']:return None
                            if 'anyOf'in v:
                                choices=[c for item in v['anyOf'] if (c:=success_schema(item)) is not None]
                                return choices[0]if len(choices)==1 else {'anyOf':choices}
                        return v
                    operation['responseSchema']=success_schema(operation['responseSchema'])
                    ops.append(operation)
    out={}
    header='// Generated by scripts/generate-contracts.py; do not edit.\n// Contract digest: '+digest+'\n// Bounds and conditional rules are validated at runtime.\n'
    field_names=set()
    def fields(node):
        if isinstance(node,dict):
            field_names.update(node.get('properties',{}))
            for value in node.values():fields(value)
        elif isinstance(node,list):
            for value in node:fields(value)
    fields(schemas)
    out['field-names.ts']=header+'export const fieldNames: ReadonlySet<string> = new Set('+json.dumps(sorted(field_names))+');\n'
    out['all-models.ts']=header+'\n'.join(comment(s)+'export type '+k+' = '+typ(s,schemas)+';\n'for k,s in sorted(schemas.items()))
    for name,source in [('api1','contracts/api1/fiscal.openapi.json'),('monitor','contracts/api2/monitor-reads.openapi.json')]:
        selected=modules[source]['components']['schemas']
        if name=='monitor':
            for f in ['contracts/api2/monitor-documents.openapi.json','contracts/api2/monitor-management.openapi.json']:selected={**selected,**modules[f]['components']['schemas']}
        out[name+'-models.ts']=header+'export type { '+', '.join(sorted(selected))+' } from "./all-models.js";\n'
        out[name+'-schema.ts']=header+'export const '+name+'Schema: object = '+json.dumps({'components':{'schemas':selected}},ensure_ascii=False,indent=2)+';\n'
    out['nfe-models.ts']=header+'export type { NfeCertificateValidity, NfeSefazStatus } from "./all-models.js";\n'
    out['catalog.ts']=header+'import type { Operation } from "../contract-service.js";\nexport const catalogSchema: object = '+json.dumps({'components':{'schemas':schemas}},ensure_ascii=False,indent=2)+';\nexport const operations: readonly Operation[] = '+json.dumps(ops,ensure_ascii=False,indent=2)+';\n'
    wrappers=[header,'import type * as M from "./all-models.js";','import type { RequestOptions, JsonTransport } from "../internal.js";','import type { FiscalFile } from "../files-types.js";','import { ContractService } from "../contract-service.js";','import { operations } from "./catalog.js";']
    # Rewrite local named schema refs to an imported namespace; inline field names remain unchanged.
    def wrapper_type(s):
        result=typ(s,schemas)
        return re.sub(r'(?<![\w"\'])\b('+'|'.join(sorted(schemas,key=len,reverse=True))+r')\b(?![\w"\'])',r'M.\1',result)
    groups={k:[]for k in ['Nfe','Monitor','Issuer','Reseller']}
    for op in ops:
        arg={'type':'object','properties':{},'required':[],'additionalProperties':False}
        for location in ['path','query']:
            params=[p for p in op['parameters']if p['in']==location]
            if params:
                arg['properties'][location]={'type':'object','properties':{p['name']:p['schema']for p in params},'required':[p['name']for p in params if p.get('required')],'additionalProperties':False}
                if location=='path' or any(p.get('required')for p in params):arg['required'].append(location)
        if op['bodySchema']:
            arg['properties']['body']=op['bodySchema'];arg['required'].append('body')
        if op['operationId']=='nfeGetDocument':
            arg['properties']['query']={'$ref':'#/components/schemas/NfeLookupRequest'};arg['required'].append('query')
        if op['operationId']=='monitorGetDownloadStatistics':
            arg['properties']['query']['dependentRequired']={'ano':['mes'],'mes':['ano']}
        op['argumentsSchema']=arg
        group='Monitor'if op['operationId'].startswith('monitor')else 'Issuer'if op['operationId'].startswith('emitter')else 'Reseller'if op['operationId'].startswith('b2b')else 'Nfe'
        response='FiscalFile'if op['operationId']=='monitorDownloadReport'else wrapper_type(op['responseSchema']or {})
        name=pascal(op['operationId'])+'Arguments';result=pascal(op['operationId'])+'Result'
        wrappers+=[comment({'description':op['description']}),f'export type {name} = {wrapper_type(arg)};',f'export type {result} = {response};']
        default=' = {}'if not arg['required']else ''
        groups[group].append(f'  {op["operationId"]}(args: {name}{default}, options: RequestOptions = {{}}): Promise<{result}> {{ return this.invoke(operations.find(op => op.operationId === "{op["operationId"]}")!, args, options) as Promise<{result}>; }}')
    # argumentsSchema is a runtime validation policy, deliberately separate from public component names.
    out['catalog.ts']=header+'import type { Operation } from "../contract-service.js";\nexport const catalogSchema: object = '+json.dumps({'components':{'schemas':schemas}},ensure_ascii=False,indent=2)+';\nexport const operations: readonly Operation[] = '+json.dumps(ops,ensure_ascii=False,indent=2)+';\n'
    for group,methods in groups.items():wrappers+=[f'export class {group}Operations extends ContractService {{', '  constructor(transport: JsonTransport) { super(transport); }',*methods,'}']
    out['operations.ts']='\n'.join(wrappers)+'\n'
    out['file-routes.ts']=header+'export const fileRoutes: readonly { operationId:string; path:string; format:"pdf"|"xml"|"report"; mediaTypes:readonly string[]; enabled:boolean; report:boolean; current?:boolean; eventMaximum?:number }[] = '+json.dumps(api1routes,ensure_ascii=False,indent=2)+';\n'
    out['issuer-file-routes.ts']=header+'export const issuerFileRoutes = '+json.dumps(api2routes,ensure_ascii=False,indent=2)+' as const;\n'
    file_wrappers=[header,'import { IssuerFileService } from "../issuer-file-service.js";','import type { IssuerFileArguments, IssuerFileRequestOptions } from "../issuer-file-service.js";','import type { FiscalTransferResult } from "../files-types.js";','export class IssuerFileOperations extends IssuerFileService {']
    for route in api2routes:
        op=route['operationId']
        file_wrappers.append(f'  {op}(args:IssuerFileArguments,options:IssuerFileRequestOptions={{}}):Promise<FiscalTransferResult>{{return this.file("{op}",args,options);}}')
    file_wrappers.append('}')
    out['issuer-file-operations.ts']='\n'.join(file_wrappers)+'\n'
    target=ROOT/'src/generated'
    for name,body in out.items():
        f=target/name
        if a.check:
            if not f.exists()or f.read_bytes()!=body.encode('utf-8'):raise SystemExit('Generated output differs: '+name)
        else:f.write_bytes(body.encode('utf-8'))
    every=[op for spec in modules.values() for item in spec['paths'].values() for method,op in item.items() if method in ['get','post','put','delete']]
    lock={'schema_version':3,'scope':'current_pinned_fiscal_catalog_not_fiscal_acceptance','contract_digest':digest,'enabled_operations':sum(1 for op in every if op.get('x-sdk-generation-enabled',True)),'blocked_operations':sorted(op['operationId'] for op in every if op.get('x-sdk-generation-enabled',True) is False),'schema_components_summed':sum(len(s['components']['schemas'])for s in modules.values()),'unique_models':len(schemas),'inputs':inputs}
    body=json.dumps(lock,indent=2)+'\n';f=ROOT/'contracts.lock.json'
    if a.check:
        if f.read_bytes()!=body.encode('utf-8'):raise SystemExit('Contract lock differs')
    else:f.write_bytes(body.encode('utf-8'))
if __name__=='__main__':main()
