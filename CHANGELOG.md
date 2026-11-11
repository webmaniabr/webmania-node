## 0.1.0-alpha.8

- README rewritten for integrators: requirements, installation, credentials from environment variables, homologation examples that issue, consult and cancel an NF-e and an NFS-e, and the method list per product. The technical details that were in the README moved unchanged to `docs/INTEGRATION.md`, `docs/TESTING.md`, `docs/CATALOG.md` and `examples/homologacao/README.md`. Documentation only.
- README: the SDK is presented as available from the public GitHub repository and installed from a clone (`git clone https://github.com/webmaniabr/webmania-node.git`); it is still not published to a package registry. Documentation only: code and contract are unchanged.
- Regenerated from the updated public contract: tax-class list totals (`tributos_federais`, `tributos_estaduais`) accept the empty string the API returns for unset values; tax-class `situacao_tributaria` is 2 digits for IPI, PIS and COFINS and 2 to 3 digits for ICMS; NFS-e `impostos.reducao` and `impostos.cp` accept a string or a number.
- The homologation example treats `reprovado` (the API 1.0 status of a refused NF-e) as terminal.
- The homologation example requires `WEBMANIA_LIVE_ALLOWED_HOSTS` (exit 77 before any credential or request when it is missing or empty) and fails the run when the consult after a cancellation does not show `cancelado`.
- An uncertain cancellation is recorded in the example ledger with status `unknown` (it was recorded as `aprovado`), like the other SDKs.
- The homologation example requires a writable `WEBMANIA_LIVE_LEDGER` in the `nfe`, `nfse` and `all` scopes (exit 77 with reason `ledger` before any request), so an unknown outcome is always recorded.
- The example tests that replace `npm` with a stand-in keep it in the checkout's ignored `node_modules/.cache`, so they also pass where the system temporary directory is mounted `noexec`.
- Generated from the current public contract (14 modules, 103 operations, 102 enabled), pinned by `contract_digest` and per-module SHA-256 instead of a commit; generated files are compared as UTF-8 bytes. Issuance body models follow the operation-derived `<OperationId>Payload` names.
- `baixarRelatorio` accepts CSV and XLSX labeled `text/xml`, identified by bytes (ZIP signature = XLSX, otherwise CSV kept byte-exact); XML, HTML and JSON bodies are refused. Declared report formats must match their bytes.
- New `baixarRelatorioV2` (`fiscalDownloadReportV2`) and `baixarUrlRelatorio` support for current report URLs on the trusted `reportsBaseUrl` origin, capability only, no redirects.
- `baixarEventoIbsCbsXml` reports "not available in this SDK release" without sending a request.
- New neutral homologation example (`examples/homologacao`, `npm run example:homologacao` builds only after the `WEBMANIA_LIVE=1` check) replacing the previous live script; an unknown cancellation outcome is recorded in the ledger, and the temporary build copy is removed on exit; `.env.example` stays in the Docker build context; the generator no longer takes an unused option.
- The installed-package receipt records counts derived from the corpus and the observed requests, after checking that each installed `contracts.lock.json` matches the repository lock.

## 0.1.0-alpha.7 — report quota correction

- Statically classify only report-capability downloads as possibly effectful and explicitly exclude capability recovery selectors.
- The previous alpha.6 privacy correction is retained. Known complete HTTP4xx and pre-dispatch handling are unchanged.

## 0.1.0-alpha.6

- Retain nonempty lexical Location value text, including valid symbol-only decoded Unicode, without changing diagnostic matching boundaries or inventing replacement text.

## 0.1.0-alpha.5

- Reject malformed native UTF-16 keys and string values in the actual request snapshot before URL encoding or dispatch, preserving once-only native JSON serialization.
- Keep diagnostic redaction total for malformed response/capability text without repairing or normalizing secrets.

## 0.1.0-alpha.4

- Fix original-text overlapping diagnostic masks and separate credential, numeric,
  structural and observed capability contexts; conservatively observe encoded,
  fragment and matrix assignments without fetching them.
- Refuse unsafe wire JSON numbers before rounding/export and inspect complete and
  incomplete trailers before exposing mutation recovery.
- Isolate OS DNS in a killable, reaped child per call; require matching TLS SAN and
  reject lexical base-origin repairs. Deadlines include synchronous encoding and
  decoding cooperatively; see README for the real-time limitation.
- Bound ZIP32 structure/inflation/CRC and XML attribute checks; add the typed Monitor
  import waiter, preserving terminal invalido/erro results.

# Changelog

## 0.1.0-alpha.0 — primeira prévia

- Consultas de certificado/SEFAZ na API1 por instância, com transporte TLS, erros redigidos e tipos gerados.
- Testes HTTP/TLS e instalação limpa JS/TS.
- Escopo: Emissor Fiscal e Monitor Fiscal.
- Demais recursos e certificação continuam pendentes.

- Tranche de consultas/eventos API 1 e seis consultas Monitor com validação JSON Schema e paginação limitada.

- Added the remaining API1 fiscal operations and typed NF-e/NFC-e model helpers, eleven IBS/CBS event variants, issuer configuration, tax classes and bounded report polling.
- Added explicit-origin, per-call authorization for thirteen enabled fiscal binary download variants; the IBS/CBS event-file authorization gate remains blocked.
- Preserved decimal text, response variants and uncertain mutation outcomes; added per-file size/deadline controls and protected-file checks.
- Upgraded pinned AJV to 8.20.0 and Node22 declarations to 22.20.5; clean installed JS/TS consumers exercise the expanded controlled surface.
- Redacted known secrets from serialized request bodies in all error diagnostics, including generic echoed fields, Portuguese sensitive names and uncertain request references.
- Accepted legal XML comments/processing instructions in the bounded prolog; PDF inspection now distinguishes structural encryption entries from harmless strings, comments and streams and reports inconclusive inspection explicitly.
- Regenerated Monitor municipality-code responses for documented string/integer wire representations without coercion.
- Added the proprietary Webmania license notice and packaged LICENSE; third-party components retain their own licenses and the package remains private.
- Rebound the API1 contract to preserve documented IPI digit-string codes and scalar/array payment CNPJ identifiers, with per-item validation and unchanged request bytes.
- Kept report download capability identifiers out of deadline errors while preserving successful report URLs.
- Redacted capabilities already observed during report polling from later API errors and correlation identifiers without changing error kind, HTTP status or uncertain outcomes.
- Redacted case-equivalent spellings of explicitly known UUID report capabilities; ordinary passwords and tokens retain literal matching.

## 0.1.0-alpha.1 — catálogo fiscal fixado

- Acrescenta as 61 superfícies restantes: revenda API1, ciclo Monitor, emissão/consulta API2 e arquivos API2. Expõe 101 operações habilitadas e conserva o bloqueio de `xmlevento`.
- Gera 353 modelos únicos documentados e wrappers de argumentos com nomes separados dos componentes do corpo, fixados no contrato público da época.
- Isola credenciais por serviço, snapshots de serialização, recuperação privada de seletores, contexto de capabilities em relatórios e metadados protegidos de Location. Mutações enviadas com 3xx mantêm incerteza; nenhum pedido tem replay automático.
- Paginação preserva `page` seguro e `per_page`, verifica metadados e oferece continuação por página/índice sob limites de itens, páginas e deadline.
- Amplia provas HTTP/TLS locais e consumidores instalados JavaScript/TypeScript. Cobertura de catálogo e exemplos sintéticos não substituem a validação fiscal completa.

## 0.1.0-alpha.2 — correções das revisões A/B do catálogo

- Protege UUIDs de Location embutidas em nomes de arquivo ou percentualmente codificadas junto de escapes inválidos, preservando o tratamento literal de query, userinfo e autoridade.
- Omite recuperação em falhas de parser que impedem observar todos os cabeçalhos; mantém recuperação segura em fechamento anterior a cabeçalhos e falha de corpo após observação completa.
- Unifica o contexto de diagnóstico dos aliases GET NF-e/Monitor com os métodos tipados de catálogo.
- Interrompe a entrega de itens paginados já recebidos após cancelamento/deadline e aceita páginas vazias coerentes além da última página.
- Conserva as 101 operações habilitadas, o bloqueio de xmlevento, os 353 modelos e o pin de contrato; acrescenta regressões para os cinco grupos confirmados.

## 0.1.0-alpha.3 — observação de Location nos eventos HTTP

- Compartilha a observação lexical de Location e o filtro de recuperação entre resposta final, cabeçalhos informativos e upgrade recusado, antes de continuar ou rejeitar por status/limite.
- Protege ecos posteriores de capabilities aprendidas em respostas informativas, mantendo o contexto privado por pedido e a comparação literal dos componentes opacos.
- Mantém a proibição de upgrade/follow/replay, o limite informativo, os escopos já corrigidos e o catálogo/modelos fixados. Acrescenta os controles decisivos do achado A-05.
