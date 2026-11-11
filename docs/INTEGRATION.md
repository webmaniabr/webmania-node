# Detalhes técnicos de integração

Este documento reúne os detalhes técnicos do SDK para Node.js que complementam o [README](../README.md): autenticação, URL base, limites de transporte, arquivos, relatórios e o tratamento do resultado fiscal. O texto é o mesmo que estava no README até esta versão.

## Escopo e disponibilidade

**Disponível no GitHub (versão alpha.8), com instalação a partir do clone; ainda sem publicação no npm. Os testes usam fixtures locais; não são certificação de API real.**

Integração de **Emissor Fiscal e Monitor Fiscal** em aplicações de servidor. O Emissor abrange NF-e/NFC-e na API1 e NFS-e, CT-e/CT-e OS, MDF-e, NFCom e DC-e na API2, com arquivos, eventos e as três operações gerenciais B2B públicas da API1. O Monitor mantém apenas as famílias de documentos e capacidades do seu contrato documentado.

Disponível no repositório público [github.com/webmaniabr/webmania-node](https://github.com/webmaniabr/webmania-node), com instalação a partir do clone (veja a seção Instalação). Ainda não há publicação em registro de pacotes; os nomes e versões abaixo identificam os pacotes gerados a partir desta fonte. Regras do provedor, aceitação fiscal real e plataformas adicionais permanecem com limitações explícitas.

## Visão geral para desenvolvedores

| Item | Detalhe |
|---|---|
| Status | Disponível no GitHub: versão `0.1.0-alpha.8` (`package.json` com `"private": true`), instalada a partir do clone do repositório; ainda sem publicação no npm |
| Runtime | Node.js >= 22, módulo ESM com tipos TypeScript |
| Clientes | `NfeClient` (NF-e/NFC-e API 1.0), `IssuerClient` (emissor API 2.0), `IssuerFilesClient` e `FiscalFilesClient` (arquivos), `MonitorClient` (Monitor Fiscal), `ResellerClient` (operações gerenciais B2B da API 1.0, com credenciais de revenda) |
| Cobertura | 102 operações habilitadas de 103 do contrato fixado; lista completa em [docs/CATALOG.md](CATALOG.md) |
| Erros | `WebmaniaError`, com `kind` (`configuration`, `validation`, `http`, `api`, `protocol`, `network`, `timeout`, `cancelled`, `response_limit`, `protected_file`) e `status` |
| Contrato | OpenAPI de [webmania-openapi](https://github.com/webmaniabr/webmania-openapi) fixado em [contracts.lock.json](../contracts.lock.json) pelo `contract_digest` e pelo SHA-256 de cada módulo |

### Autenticação

- **NF-e/NFC-e (API 1.0)** — `NfeClient` envia os quatro cabeçalhos `X-Consumer-Key`, `X-Consumer-Secret`, `X-Access-Token` e `X-Access-Token-Secret`, a partir de `credentials: {consumerKey, consumerSecret, accessToken, accessTokenSecret}`. `ResellerClient` usa os mesmos quatro cabeçalhos com `resellerCredentials`, que nunca substituem as credenciais da empresa.
- **API 2.0** — `IssuerClient` (`issuerBearerToken`) e `MonitorClient` (`bearerToken`) enviam `Authorization: Bearer <token>`. O token do emissor e o do Monitor são credenciais distintas.

Os nomes de variáveis de ambiente usados nos exemplos estão em [.env.example](../.env.example) (`WEBMANIA_CONSUMER_KEY`, `WEBMANIA_CONSUMER_SECRET`, `WEBMANIA_ACCESS_TOKEN`, `WEBMANIA_ACCESS_TOKEN_SECRET`, `WEBMANIA_ISSUER_TOKEN`, `WEBMANIA_MONITOR_TOKEN`). Mantenha esses valores apenas no servidor.

## Requisitos

**Versão alpha.8.** ESM/TypeScript para Node.js 22+. Ainda não há publicação no npm; os testes cobrem Node.js 22 em Linux arm64 com fixtures loopback.

## Instalação

Clone o repositório público, gere o pacote com `npm pack` a partir do clone e instale o tarball no projeto da aplicação:

```sh
git clone https://github.com/webmaniabr/webmania-node.git
cd webmania-node
npm ci
npm pack                 # compila dist/ e gera webmaniabr-sdk-0.1.0-alpha.8.tgz
cd /caminho/da/aplicacao
npm install /caminho/webmania-node/webmaniabr-sdk-0.1.0-alpha.8.tgz
```

O manifesto usa `@webmaniabr/sdk`, com publicação desabilitada (`"private": true`); o pacote ainda não está no npm. Artefatos anteriores não substituem esta versão.

## Primeira consulta

Configure somente a credencial do serviço escolhido, por instância, a partir de ambiente privado ou cofre de segredos. O exemplo não emite nem cancela documentos. Execute consultas apenas com conta e ambiente autorizados; uma origem de fixture controlada deve ser configurada explicitamente pela API do cliente. O trecho usa o pacote instalado a partir do clone (veja a seção Instalação).

```js
import {NfeClient,WebmaniaError} from '@webmaniabr/sdk';
const credentials={
  consumerKey:process.env.WEBMANIA_CONSUMER_KEY,
  consumerSecret:process.env.WEBMANIA_CONSUMER_SECRET,
  accessToken:process.env.WEBMANIA_ACCESS_TOKEN,
  accessTokenSecret:process.env.WEBMANIA_ACCESS_TOKEN_SECRET,
};
const client=new NfeClient({credentials});
try{
  const certificate=await client.consultarCertificado(); // expiration: dias restantes >=1
  const sefaz=await client.consultarSefaz(); // status: online|offline
  console.log(sefaz.status);
}catch(error){
  if(error instanceof WebmaniaError) console.error(error.kind,error.status);
  else throw error;
}
```

A construção do cliente não comprova habilitação da conta. Respostas de sucesso e conversões explícitas para JSON podem conter dados fiscais, credenciais novas ou URLs privadas. Exponha apenas os campos necessários à aplicação.

## Ambiente e URL base

Cada cliente aceita `baseUrl` explícito, que precisa ser uma **origem** HTTPS (HTTP somente em loopback para testes) sem caminho, usuário, query ou fragmento; o padrão é a origem pública do serviço. As rotas da API1 já incluem o prefixo `/api`, e `FiscalFilesClient` aceita `pathPrefix: '/api'` para o alias de arquivos em `webmania.com.br`. Os clientes de arquivo exigem `trustedOrigins` com as origens escolhidas. As variáveis abaixo são usadas pelo exemplo de homologação; a SDK não lê ambiente por conta própria.

| Serviço | Cliente | Variável do exemplo | Padrão |
|---|---|---|---|
| API1 (NF-e/NFC-e) | `NfeClient` | `WEBMANIA_API1_BASE_URL` | `https://webmania.com.br/api` (origem + `/api`) |
| Arquivos API1 | `FiscalFilesClient` | `WEBMANIA_FILES_BASE_URL` | `https://nfe.webmania.com.br` |
| API2 (emissor, arquivos, relatórios atuais, Monitor) | `IssuerClient`, `IssuerFilesClient`, `MonitorClient`, `FiscalFilesClient` (`reportsBaseUrl`) | `WEBMANIA_API2_BASE_URL` | `https://api.webmania.com.br` |

```js
const client=new NfeClient({credentials,baseUrl:new URL(process.env.WEBMANIA_API1_BASE_URL??'https://webmania.com.br/api').origin});
```

## Integração e limites

O transporte verifica TLS e hostname, não segue redirecionamentos e não repete requisições. O timeout absoluto padrão é 30 segundos, e o limite de resposta é 2 MiB. Configure `timeoutMs`/`maxResponseBytes`, ou `{signal}` por chamada para cancelamento. `baseUrl` aceita outra origem HTTPS autorizada ou HTTP loopback para testes; `ca` configura uma CA explícita mantendo validação de hostname.

Campos JSON adicionais aceitos continuam acessíveis, sem coerção ou remoção. Use strings para valores decimais exatos e identificadores com zeros iniciais. Números inteiros fora do intervalo seguro JavaScript e números não finitos são recusados antes da rede; `undefined` continua omissão, enquanto `null`, `false` e zero seguem o schema. O snapshot é finito, limitado a 16 MiB, 100000 nós e 64 níveis. Um serializer personalizado é avaliado uma vez e o resultado também é validado. Todas as chaves e strings do snapshot de requisição efetivamente serializado, incluindo path, query, body e extensões, devem ter UTF-16 bem formado: substitutos isolados são recusados com `WebmaniaError` de validação antes da rede, sem normalização ou substituição. Um `toJSON` válido pode substituir dados do objeto original que não entram no snapshot. Unicode válido, inclusive U+FFFD literal e pares de substitutos, é preservado. A resposta JSON pode preservar substitutos escapados; diagnósticos continuam seguros nesses casos.

`coletarEmpresas`, `coletarMunicipiosEmpresa` e `coletarRelatorios` retornam `{items,continuation}`. Os iteradores correspondentes aceitam os mesmos limites. `page` preserva qualquer inteiro positivo seguro, inclusive acima de Int32; o padrão é 1 somente quando omitido. `per_page` fica constante, entre 10 e 200. `maxItems` pode parar dentro de uma página e retorna `{page,index,per_page}`; para retomar, use `query.page` e `options.startIndex`. Metadados de página e `per_page` incompatíveis são erro. Uma página vazia além da última página encerra normalmente quando `last_page`, `total` e o tamanho de página são coerentes. Cancelamento e deadline também interrompem a entrega dos itens já recebidos, inclusive antes de devolver continuação ou conclusão. Os padrões são 100 páginas, 10000 itens e deadline de 300000 ms, com cancelamento por `signal`.

O download de relatório por capability consome uma quota limitada ou registra o acesso; mesmo sendo GET, uma falha após possível envio requer conciliação antes de repetir. A referência privada não é oferecida como seletor comum de recuperação.

`baixarRelatorio` atende relatórios legados (`/relatorio/{uuid}/`). CSV e XLSX desse download podem chegar rotulados `text/xml`: a SDK identifica o formato pelos bytes (assinatura ZIP = XLSX; qualquer outro corpo é CSV devolvido byte a byte, sem decodificação) e informa o formato detectado em `contentType`. XML, HTML ou JSON nesse download é recusado com `protocol`; nenhuma outra operação de arquivo ganha essa tolerância. Relatórios atuais (`fiscalDownloadReportV2`) usam `baixarRelatorioV2(uuid)` ou `baixarUrlRelatorio(url)` com a `url` devolvida por `solicitarRelatorio`/`aguardarRelatorio`; a origem `reportsBaseUrl` precisa estar em `trustedOrigins`, a rota precisa ser `/relatorios/{uuid}` e nenhuma credencial é enviada (a URL é a capability). Um JSON com `error`, mesmo em HTTP 200, é falha.

Os outros modos explícitos são `{type:'document_token',token}` e `{type:'public'}`; MDF-e aceita apenas `company_bearer`. Não há fallback. Os resultados API2 distinguem `file`, `pending`, `html`, `protected_archive`, `protected_pdf` e `redirect`. HTML não é executado, ZIP/PDF protegido não é convertido em arquivo pronto, e o único 302 documentado é metadata protegida de PDF NFS-e. `location.reveal()` mantém a referência relativa ou absoluta original; não confia na origem, não busca o destino e não encaminha credenciais. Location ausente, duplicado ou inválido gera erro. A observação para diagnóstico encontra UUIDs embutidas em nomes de arquivo e decodifica trechos percentuais válidos mesmo junto de escapes malformados; isso não torna o URI válido. Todo Location observado, inclusive em respostas informativas e em upgrade recusado, contribui para redigir erros antes de continuar ou rejeitar o evento, inclusive por excesso de respostas informativas e com autoridade malformada; somente UUIDs no caminho recebem equivalência de caixa. Tokens opacos, query, userinfo e autoridade mantêm comparação literal.

## Credenciais e resultado fiscal

Credenciais da empresa API1, revenda API1, Bearer do emissor API2 e Bearer Monitor pertencem a escopos diferentes. Arquivos exigem a modalidade de acesso documentada. Uma falha não autoriza trocar automaticamente o modo ou a credencial. Mantenha segredos no servidor.

O catálogo contém 102 operações habilitadas. `nfeDownloadIbsCbsEventXml` (`baixarEventoIbsCbsXml`) não está disponível nesta versão do SDK: a chamada falha com `configuration` e nenhuma requisição é enviada. Condições fiscais, municipais, de cadastro e de provedor continuam sujeitas ao contrato e ao serviço. Validação local, cálculo ou prévia não comprovam autorização fiscal.

Não há retry automático de operação nem seguimento automático de redirects. Depois de possível envio de uma operação com efeito, uma falha pode indicar resultado desconhecido. Preserve o seletor original com segurança, consulte a tentativa anterior e decida explicitamente como prosseguir. Uma referência protegida exige acesso deliberado e pode estar ausente; não é uma chave de idempotência.

## Arquivos e processamento

Verifique tipo de resultado, status e representação antes de consumir bytes. JSON pendente, HTML e redirect não comprovam PDF pronto. Proteção de PDF/ZIP é distinta da autorização de download; não há descriptografia automática nem confirmação de autenticidade fiscal. O reconhecimento de formatos cobre somente o perfil documentado desta implementação. Uma Location revelada continua privada e exige decisão explícita de origem e autenticação para outra transferência.

Paginação e espera são optativas e limitadas quando disponíveis. Um estado futuro ou desconhecido não significa conclusão. Não repita emissão, cancelamento ou importação inicial como se fossem consultas de processamento.

## Documentação para assistentes e contratos

Índices em Markdown para assistentes: [documentação Webmania](https://webmania.com.br/docs/llms.txt) e [API 2.0](https://api.webmania.com.br/llms.txt). Contratos OpenAPI: [API 2.0](https://api.webmania.com.br/docs/openapi) e [NF-e](https://webmania.com.br/docs/rest-api-nfe/?format=openapi).

No catálogo de SDKs, `node` aparece como disponível no repositório público, com instalação pelo clone; plataforma Node.js >= 22. Estar listado nesses índices não amplia a cobertura documentada deste SDK.
