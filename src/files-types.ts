import type { ProtectedLocation } from './diagnostics.js';
/** Binary file returned without text/JSON conversion. */
export interface FiscalFile {
  kind: 'file';
  bytes: Uint8Array;
  contentType: string;
  byteLength: number;
  contentDisposition?: string;
  format: 'pdf' | 'xml' | 'report';
  /** The request selection, never proof of provider authorization. */
  requestedAuthorization: 'company' | 'document_token' | 'report_capability' | 'company_bearer' | 'public' | 'monitor';
  protection: 'not_detected' | 'not_applicable' | 'not_established';
}
export interface NonFileResult {
  kind: 'pending' | 'html' | 'protected_archive' | 'protected_pdf';
  status: number;
  contentType: string;
  /** Raw bytes remain sensitive. HTML is never executed and archives are never decrypted. */
  bytes: Uint8Array;
  byteLength: number;
  requestedAuthorization: FiscalFile['requestedAuthorization'];
  contentDisposition?: string;
}
export interface RedirectFileResult {
  kind: 'redirect';
  status: 302;
  location: ProtectedLocation;
  requestedAuthorization: FiscalFile['requestedAuthorization'];
}
export type FiscalTransferResult = FiscalFile | NonFileResult | RedirectFileResult;
export interface BinaryPolicy {
  format: FiscalFile['format'];
  mediaTypes: readonly string[];
  authorization: FiscalFile['requestedAuthorization'];
  /** API2 declares HTML, protected ZIP/PDF and pending representations separately. */
  representations?: boolean;
  redirect?: boolean;
  pending?: boolean;
  xmlRoots?: readonly string[];
  /** Fiscal report routes: 'legacy' also identifies CSV/XLSX labeled text/xml by their bytes. */
  reportRoute?: 'legacy' | 'current';
}
