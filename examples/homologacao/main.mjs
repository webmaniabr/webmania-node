// Exemplo neutro de homologação (ambiente 2) com o SDK Node.
// Lê a configuração somente de variáveis WEBMANIA_*, imprime uma linha JSON mascarada por passo
// e nunca repete uma mutação. Sem WEBMANIA_LIVE=1 não faz nenhuma requisição (saída 77).
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import { FiscalFilesClient, IssuerClient, IssuerFilesClient, NfeClient, WebmaniaError } from '../../dist/index.js';

const env = process.env;
const BLOCKED = 77;
const POLL_ATTEMPTS = 24, POLL_INTERVAL_MS = 5000;
const TERMINAL_NFE = ['aprovado', 'reprovado', 'denegado', 'cancelado'];
const failed = [];

class Unknown extends Error {}
const ref = value => value === undefined || value === null || value === '' ? null : createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
function emit(step, operation, ok, extra = {}) {
  const line = { step, operation, ok, http_status: extra.status ?? null, outcome: extra.outcome ?? null, kind: extra.kind ?? null, ref: extra.ref ?? null, ...(extra.file ? { file: extra.file } : {}) };
  if (!ok) failed.push(step);
  console.log(JSON.stringify(line));
}
function ledger(model, identifier, status, operation) {
  if (!env.WEBMANIA_LIVE_LEDGER || !identifier) return;
  appendFileSync(env.WEBMANIA_LIVE_LEDGER, JSON.stringify({ model, identifier: String(identifier), status, operation }) + '\n');
}
function fileSummary(result) {
  if (result?.kind === 'redirect') return { redirect: true };
  const bytes = Buffer.from(result.bytes);
  const head = bytes.subarray(0, 8).toString('latin1');
  const format = head.startsWith('%PDF-') ? 'pdf' : head.startsWith('PK') ? 'zip' : /^[﻿\s]*</.test(bytes.subarray(0, 64).toString('utf8')) ? 'xml' : 'other';
  return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), format };
}
async function call(step, operation, fn, { reference = null, mutation = false, file = false } = {}) {
  try {
    const result = await fn();
    if (file && result?.kind !== 'file' && result?.kind !== 'redirect') {
      emit(step, operation, false, { status: result?.status, kind: result?.kind, ref: reference });
      return undefined;
    }
    emit(step, operation, true, { status: 200, ref: reference, ...(file ? { file: fileSummary(result) } : {}) });
    return result;
  } catch (error) {
    if (!(error instanceof WebmaniaError)) throw error;
    emit(step, operation, false, { status: error.status, outcome: error.outcome, kind: error.kind, ref: reference });
    if (mutation && error.outcome === 'unknown') throw new Unknown(step);
    return undefined;
  }
}
async function poll(step, operation, fetch, done, reference) {
  let result;
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    result = await call(step, operation, fetch, { reference });
    const value = Array.isArray(result) ? result[0] : result;
    if (value && done(String(value.status ?? ''))) return value;
    if (attempt < POLL_ATTEMPTS - 1) await pause(POLL_INTERVAL_MS);
  }
  return Array.isArray(result) ? result[0] : result;
}
async function issue(step, operation, fn, model, document) {
  try { return await call(step, operation, fn, { mutation: true, reference: ref(document.ID) }); }
  catch (error) { if (error instanceof Unknown) ledger(model, document.ID || 'unidentified', 'unknown', operation); throw error; }
}
function blocked(reason) { console.log(JSON.stringify(reason ? { result: 'blocked', reason } : { result: 'blocked' })); return BLOCKED; }
function payload(name) {
  if (!env[name]) return undefined;
  const value = JSON.parse(readFileSync(env[name], 'utf8'));
  return value && typeof value === 'object' && !Array.isArray(value) && value.ambiente === 2 ? value : undefined;
}
// This SDK takes origins: the API1 routes already carry their /api mount and file routes may use /api.
function split(url, allowed) {
  const u = new URL(url);
  const path = u.pathname.replace(/\/$/, '');
  return allowed.includes(path) ? { origin: u.origin, path } : undefined;
}

async function nfeCycle(nfe, files, document) {
  const issued = await issue('nfe.issue', 'nfeIssueDocument', () => nfe.emitirNota(document), 'nfe', document);
  if (!issued?.uuid) return;
  const uuid = issued.uuid, reference = ref(uuid);
  ledger('nfe', uuid, String(issued.status ?? 'processando'), 'nfeIssueDocument');
  const current = await poll('nfe.consult', 'nfeGetDocument', () => nfe.consultarDocumento({ uuid }), s => TERMINAL_NFE.includes(s), reference);
  const status = String(current?.status ?? '');
  if (status !== 'aprovado') { ledger('nfe', uuid, status || 'unknown', 'nfeGetDocument'); return; }
  let cancelled;
  try {
    const auth = { type: 'company' };
    await call('nfe.query', 'nfeQueryDocument', () => nfe.consultarDocumentoPost({ uuid }), { reference });
    await call('nfe.danfe', 'nfeDownloadDanfe', () => files.baixarDanfe(uuid, auth), { reference, file: true });
    await call('nfe.danfe_simple', 'nfeDownloadSimpleDanfe', () => files.baixarDanfeSimplificado(uuid, auth), { reference, file: true });
    await call('nfe.xml', 'nfeDownloadXml', () => files.baixarXml(uuid, auth), { reference, file: true });
  } finally {
    // An approved document is always cancelled, even after a failed step above.
    try {
      cancelled = await call('nfe.cancel', 'nfeCancelDocument', () => nfe.cancelarDocumento({ uuid, motivo: 'Cancelamento de teste em homologacao.' }), { mutation: true, reference });
    } catch (error) {
      if (error instanceof Unknown) ledger('nfe', uuid, 'unknown', 'nfeCancelDocument');
      throw error;
    }
  }
  if (cancelled === undefined) { ledger('nfe', uuid, 'aprovado', 'nfeCancelDocument'); return; }
  const final = await poll('nfe.consult_cancelled', 'nfeGetDocument', () => nfe.consultarDocumento({ uuid }), s => s === 'cancelado', reference);
  const finalStatus = String(final?.status ?? 'unknown');
  ledger('nfe', uuid, finalStatus, 'nfeCancelDocument');
  // Only a consult that shows the cancellation counts as success.
  if (finalStatus !== 'cancelado') return emit('nfe.consult_cancelled', 'nfeGetDocument', false, { kind: 'not_cancelled', ref: reference });
  await call('nfe.cancellation_xml', 'nfeDownloadCancellationXml', () => files.baixarXmlCancelamento(uuid, { type: 'company' }), { reference, file: true });
}

function nfseIdentifier(result) {
  if (!result || typeof result !== 'object') return undefined;
  if (result.uuid) return result.uuid;
  return Array.isArray(result.info_nfse) && result.info_nfse[0]?.uuid ? result.info_nfse[0].uuid : undefined;
}
async function nfseCycle(issuer, files, document) {
  const issued = await issue('nfse.issue', 'emitterIssueNfse', () => issuer.emitterIssueNfse({ body: document }), 'nfse', document);
  const uuid = nfseIdentifier(issued);
  if (!uuid) return;
  const reference = ref(uuid);
  ledger('nfse', uuid, String(issued.status ?? 'processando'), 'emitterIssueNfse');
  const current = await poll('nfse.consult', 'emitterGetNfse', () => issuer.emitterGetNfse({ path: { identifier: uuid } }), s => !['', 'processando', 'pendente'].includes(s), reference);
  const status = String(current?.status ?? '');
  if (status !== 'aprovado') { ledger('nfse', uuid, status || 'unknown', 'emitterGetNfse'); return; }
  let cancelled;
  try {
    const args = { path: { identifier: uuid }, authorization: { type: 'company_bearer' } };
    await call('nfse.xml', 'fileGetNfseXml', () => files.fileGetNfseXml(args), { reference, file: true });
    for (const [step, operation, field, method] of [['nfse.pdf', 'fileGetNfsePdf', 'pdf_nfse', 'fileGetNfsePdf'], ['nfse.rps_pdf', 'fileGetNfseRpsPdf', 'pdf_rps', 'fileGetNfseRpsPdf']]) {
      if (current[field]) await call(step, operation, () => files[method](args), { reference, file: true });
      else emit(step, operation, true, { kind: 'not_offered', ref: reference });
    }
  } finally {
    try {
      cancelled = await call('nfse.cancel', 'emitterCancelNfse', () => issuer.emitterCancelNfse({ body: { uuid, motivo: '1', justificativa: 'Cancelamento de teste em homologacao.' } }), { mutation: true, reference });
    } catch (error) {
      if (error instanceof Unknown) ledger('nfse', uuid, 'unknown', 'emitterCancelNfse');
      throw error;
    }
  }
  if (cancelled === undefined) { ledger('nfse', uuid, 'aprovado', 'emitterCancelNfse'); return; }
  const final = await poll('nfse.consult_cancelled', 'emitterGetNfse', () => issuer.emitterGetNfse({ path: { identifier: uuid } }), s => s === 'cancelado', reference);
  const finalStatus = String(final?.status ?? 'unknown');
  ledger('nfse', uuid, finalStatus, 'emitterCancelNfse');
  if (finalStatus !== 'cancelado') emit('nfse.consult_cancelled', 'emitterGetNfse', false, { kind: 'not_cancelled', ref: reference });
}

async function main() {
  if (env.WEBMANIA_LIVE !== '1') return blocked();
  const api1 = env.WEBMANIA_API1_BASE_URL || 'https://webmania.com.br/api';
  const filesBase = env.WEBMANIA_FILES_BASE_URL || 'https://nfe.webmania.com.br';
  const api2 = env.WEBMANIA_API2_BASE_URL || 'https://api.webmania.com.br';
  const scope = env.WEBMANIA_LIVE_SCOPE || 'readonly';
  if (!['readonly', 'nfe', 'nfse', 'all'].includes(scope)) return blocked('scope');
  // The allow list is required: without it no origin is trusted (fail closed, before any credential).
  const allowed = new Set((env.WEBMANIA_LIVE_ALLOWED_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean));
  if (!allowed.size) return blocked('allowed_hosts');
  let a1, fb, a2;
  try { a1 = split(api1, ['/api']); fb = split(filesBase, ['', '/api']); a2 = split(api2, ['']); } catch { return blocked('base_url'); }
  if (!a1 || !fb || !a2) return blocked('base_url');
  if ([api1, filesBase, api2].some(u => !allowed.has(new URL(u).hostname.toLowerCase()))) return blocked('origin_not_allowed');
  const names = ['WEBMANIA_CONSUMER_KEY', 'WEBMANIA_CONSUMER_SECRET', 'WEBMANIA_ACCESS_TOKEN', 'WEBMANIA_ACCESS_TOKEN_SECRET', 'WEBMANIA_ISSUER_TOKEN'];
  if (names.some(n => !env[n])) return blocked('credentials');
  const nfeDocument = ['nfe', 'all'].includes(scope) ? payload('WEBMANIA_LIVE_NFE_PAYLOAD') : undefined;
  const nfseDocument = ['nfse', 'all'].includes(scope) ? payload('WEBMANIA_LIVE_NFSE_PAYLOAD') : undefined;
  if ((['nfe', 'all'].includes(scope) && !nfeDocument) || (['nfse', 'all'].includes(scope) && !nfseDocument)) return blocked('payload');
  if (nfeDocument || nfseDocument) {
    // An unknown outcome is recorded only in the ledger: it must be writable before any mutation.
    if (!env.WEBMANIA_LIVE_LEDGER) return blocked('ledger');
    try { appendFileSync(env.WEBMANIA_LIVE_LEDGER, '', { mode: 0o600 }); } catch { return blocked('ledger'); }
  }
  const credentials = { consumerKey: env.WEBMANIA_CONSUMER_KEY, consumerSecret: env.WEBMANIA_CONSUMER_SECRET, accessToken: env.WEBMANIA_ACCESS_TOKEN, accessTokenSecret: env.WEBMANIA_ACCESS_TOKEN_SECRET };
  const token = env.WEBMANIA_ISSUER_TOKEN;
  try {
    const nfe = new NfeClient({ credentials, baseUrl: a1.origin });
    const issuer = new IssuerClient({ issuerBearerToken: token, baseUrl: a2.origin });
    const files = new FiscalFilesClient({ credentials, baseUrl: fb.origin, pathPrefix: fb.path, trustedOrigins: [fb.origin] });
    const issuerFiles = new IssuerFilesClient({ issuerBearerToken: token, baseUrl: a2.origin, trustedOrigins: [a2.origin] });
    await call('readonly.sefaz', 'nfeGetSefazStatus', () => nfe.consultarSefaz());
    await call('readonly.certificate', 'nfeGetCertificateValidity', () => nfe.consultarCertificado());
    await call('readonly.tax_classes', 'nfeListTaxClasses', () => nfe.listarClassesFiscais());
    await call('readonly.nfse_provider', 'emitterGetNfseProviderStatus', () => issuer.emitterGetNfseProviderStatus());
    if (nfeDocument) await nfeCycle(nfe, files, nfeDocument);
    if (nfseDocument) await nfseCycle(issuer, issuerFiles, nfseDocument);
  } catch (error) {
    if (error instanceof Unknown) return 1;
    if (error instanceof WebmaniaError) { emit('configuration', null, false, { kind: error.kind }); return 1; }
    throw error;
  }
  return failed.length ? 1 : 0;
}

process.exitCode = await main();
