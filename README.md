<p align="center"><img src=".github/assets/webmania-logo.png" alt="Webmania" width="320"></p>

# Webmania SDK para Node.js

Através do emissor fiscal da Webmania®, você conta com a emissão e o arquivamento dos seus documentos fiscais, cálculo automático de impostos, geração do DANFE para impressão e envio automático de e-mails para os clientes. Com este SDK, o seu sistema em Node.js se integra à nossa REST API para emitir, consultar e cancelar NF-e, NFC-e, NFS-e, CT-e, MDF-e, NFCom e DC-e, baixar XML e PDF dos documentos e usar o Monitor Fiscal.

- Emissor de Nota Fiscal Webmania®: [Saiba mais](https://webmania.com.br/nota-fiscal-eletronica/)
- Documentação da REST API: [Visualizar](https://webmania.com.br/docs/)
- Índice da documentação para assistentes de IA: [llms.txt](https://webmania.com.br/docs/llms.txt)

## Requisitos

- Contrate um dos planos de Nota Fiscal Eletrônica da Webmania®: [Assine agora mesmo](https://webmania.com.br/nota-fiscal-eletronica/#plans-section).
- Node.js 22 ou superior. O pacote é um módulo ESM com tipos TypeScript.
- Credenciais de acesso da sua empresa, disponíveis no [Painel de Controle](https://webmania.com.br/painel/).

## Instalação

O SDK é distribuído pelo repositório [github.com/webmaniabr/webmania-node](https://github.com/webmaniabr/webmania-node) e ainda não está publicado no npm. Clone o repositório, gere o pacote e instale-o no projeto da sua aplicação:

```sh
git clone https://github.com/webmaniabr/webmania-node.git
cd webmania-node
npm ci
npm pack                 # gera webmaniabr-sdk-0.1.0-alpha.8.tgz
cd /caminho/da/aplicacao
npm install /caminho/webmania-node/webmaniabr-sdk-0.1.0-alpha.8.tgz
```

Depois disso, importe o SDK com `import { NfeClient } from '@webmaniabr/sdk'`.

## Credenciais

Cada serviço usa a sua própria credencial. Guarde-as em variáveis de ambiente (ou em um cofre de segredos) no servidor e nunca as escreva no código-fonte:

| Variável de ambiente | Uso |
|---|---|
| `WEBMANIA_CONSUMER_KEY`, `WEBMANIA_CONSUMER_SECRET`, `WEBMANIA_ACCESS_TOKEN`, `WEBMANIA_ACCESS_TOKEN_SECRET` | NF-e e NFC-e (`NfeClient`) e arquivos da NF-e (`FiscalFilesClient`) |
| `WEBMANIA_ISSUER_TOKEN` | NFS-e, CT-e, MDF-e, NFCom e DC-e (`IssuerClient`) e seus arquivos (`IssuerFilesClient`) |
| `WEBMANIA_MONITOR_TOKEN` | Monitor Fiscal (`MonitorClient`) |

```js
import { FiscalFilesClient, IssuerClient, NfeClient, WebmaniaError } from '@webmaniabr/sdk';
import { writeFileSync } from 'node:fs';

const credentials = {
  consumerKey: process.env.WEBMANIA_CONSUMER_KEY,
  consumerSecret: process.env.WEBMANIA_CONSUMER_SECRET,
  accessToken: process.env.WEBMANIA_ACCESS_TOKEN,
  accessTokenSecret: process.env.WEBMANIA_ACCESS_TOKEN_SECRET,
};
const nfe = new NfeClient({ credentials });                                                 // NF-e e NFC-e
const emissor = new IssuerClient({ issuerBearerToken: process.env.WEBMANIA_ISSUER_TOKEN }); // NFS-e, CT-e, MDF-e, NFCom e DC-e
```

Todos os métodos são assíncronos (`await`) e aceitam `{ signal }` como último argumento para cancelamento.

## Utilização

Os exemplos abaixo usam o ambiente de **homologação** (`ambiente` 2), em que os documentos não têm validade fiscal. Para emitir em produção, envie `ambiente` 1. Informe valores decimais como texto (`'44.90'`) para manter a precisão.

### Status do SEFAZ e certificado A1

```js
const sefaz = await nfe.consultarSefaz();
console.log(sefaz.status);                 // online ou offline

const certificado = await nfe.consultarCertificado();
console.log(certificado.expiration);       // dias até o vencimento do certificado A1
```

### Emitir NF-e

Para emitir uma NF-e, utilize o método `emitirNota`. O mesmo método emite NFC-e com `modelo: 2`.

```js
const nota = await nfe.emitirNota({
  operacao: 1,                       // 1 = saída
  natureza_operacao: 'Venda de produção do estabelecimento',
  modelo: 1,                         // 1 = NF-e, 2 = NFC-e
  finalidade: 1,                     // 1 = NF-e normal
  ambiente: 2,                       // 2 = homologação, 1 = produção
  cliente: {
    cpf: '000.000.000-00',
    nome_completo: 'Nome do Cliente',
    endereco: 'Av. Brg. Faria Lima',
    numero: '1000',
    bairro: 'Itaim Bibi',
    cidade: 'São Paulo',
    uf: 'SP',
    cep: '00000-000',
    email: 'nome@email.com',
  },
  produtos: [{
    nome: 'Nome do produto',
    codigo: 'nome-do-produto',
    ncm: '6109.10.00',
    quantidade: '1',
    unidade: 'UN',
    origem: 0,
    subtotal: '44.90',
    total: '44.90',
    classe_imposto: 'REF1000',       // classe de imposto cadastrada no Painel
  }],
  pedido: {
    presenca: 2,                     // operação não presencial, pela internet
    modalidade_frete: 9,             // sem frete
    pagamento: 0,                    // pagamento à vista
    forma_pagamento: '01',           // dinheiro
    total: '44.90',
  },
});

console.log(nota.uuid);      // identificador único da nota fiscal
console.log(nota.status);    // aprovado, reprovado, processamento, contingencia...
console.log(nota.nfe);       // número da NF-e
console.log(nota.serie);     // série
console.log(nota.chave);     // chave de acesso
console.log(nota.xml);       // URL do XML
console.log(nota.danfe);     // URL do DANFE (PDF)
console.log(nota.motivo);    // retorno do SEFAZ
```

Somente o status `aprovado` indica uma nota autorizada. Quando o retorno for `processamento`, consulte a nota alguns segundos depois.

### Consultar NF-e

```js
const consulta = await nfe.consultarDocumento({ uuid: nota.uuid });
console.log(consulta.status);
```

A consulta também aceita a chave de acesso (`chave`).

### Cancelar NF-e

```js
const cancelamento = await nfe.cancelarDocumento({
  uuid: nota.uuid,
  motivo: 'Cancelamento por erro no pedido.',   // mínimo de 15 caracteres
});
console.log(cancelamento.status);
```

### Baixar o DANFE e o XML

```js
const arquivos = new FiscalFilesClient({ credentials, trustedOrigins: ['https://nfe.webmania.com.br'] });

const danfe = await arquivos.baixarDanfe(nota.uuid, { type: 'company' });
writeFileSync('danfe.pdf', danfe.bytes);

const xml = await arquivos.baixarXml(nota.uuid, { type: 'company' });
writeFileSync('nfe.xml', xml.bytes);
```

### Emitir, consultar e cancelar NFS-e

A NFS-e é emitida a partir de um ou mais RPS com o método `emitterIssueNfse` do `IssuerClient`:

```js
const nfse = await emissor.emitterIssueNfse({
  body: {
    ambiente: 2,                     // 2 = homologação, 1 = produção
    rps: [{
      servico: {
        valor_servicos: '15.00',
        discriminacao: 'Prestação de serviço referente ao mês 10/2026',
        classe_imposto: 'REF000000', // classe de imposto cadastrada no Painel
      },
      tomador: { cpf: '000.000.000-00', nome_completo: 'Nome do tomador' },
    }],
  },
});
console.log(nfse.uuid, nfse.status);

const consultaNfse = await emissor.emitterGetNfse({ path: { identifier: nfse.uuid } });
console.log(consultaNfse.status, consultaNfse.numero, consultaNfse.pdf_nfse);

const canceladaNfse = await emissor.emitterCancelNfse({
  body: {
    uuid: nfse.uuid,
    motivo: '1',                                            // código do motivo (veja a documentação da NFS-e)
    justificativa: 'Serviço cancelado a pedido do tomador.', // mínimo de 15 caracteres
  },
});
console.log(canceladaNfse.status);
```

### Tratamento de erros

Toda falha gera uma `WebmaniaError`:

```js
try {
  await nfe.emitirNota(dadosDaNota);
} catch (erro) {
  if (!(erro instanceof WebmaniaError)) throw erro;
  console.error(erro.kind);      // validation (dados recusados antes do envio), api (recusa da API ou do SEFAZ), http, timeout...
  console.error(erro.status);    // status HTTP, quando houver
  console.error(erro.message);   // mensagem, com dados sensíveis mascarados
  if (erro.outcome === 'unknown') {
    // A requisição pode ter sido processada: consulte a nota antes de emitir de novo.
  }
}
```

O SDK não repete requisições automaticamente. Se uma emissão ou um cancelamento terminar com resultado desconhecido (`outcome === 'unknown'`), consulte o documento antes de tentar novamente, para não emitir em duplicidade.

## Métodos disponíveis

**NF-e e NFC-e** — `NfeClient`

- **nfeIssueDocument**: Emissão de NF-e ou NFC-e junto ao SEFAZ.
- **nfeGetDocument**: Consulta da nota fiscal pelo UUID, pela chave de acesso ou pelo ID do pedido.
- **nfeCancelDocument**: Cancelamento de NF-e ou NFC-e.
- **nfeCreateCorrection**: Carta de correção.
- **nfeVoidNumbering**: Inutilização de sequência de numeração.
- **nfeIssueReturn**: Emissão de NF-e de devolução.
- **nfeIssueComplement**: Emissão de NF-e complementar.
- **nfeIssueAdjustment**: Emissão de NF-e de ajuste.
- **nfeCreateManifestation**: Manifestação do destinatário.
- **nfeCreatePaymentEvent** / **nfeCancelPaymentEvent**: Evento de conciliação financeira (ECONF) e o seu cancelamento.
- **nfeCreateIbsCbsEvent** / **nfeCancelIbsCbsEvent**: Eventos de IBS/CBS e o seu cancelamento.
- **nfeListTaxClasses** / **nfeSaveTaxClasses** / **nfeDeleteTaxClasses**: Classes de imposto.
- **fiscalCreateOrPollReport**: Relatórios fiscais.
- **fiscalUpdateCompany**: Atualização dos dados da empresa emissora.
- **nfeGetSefazStatus**: Verifica se o SEFAZ está online ou offline.
- **nfeGetCertificateValidity**: Verifica quantos dias faltam para o certificado A1 expirar.

**NFS-e** — `IssuerClient`

- **emitterIssueNfse**: Emissão de NFS-e a partir de RPS.
- **emitterGetNfse**: Consulta da NFS-e.
- **emitterCancelNfse**: Cancelamento da NFS-e.
- **emitterReplaceNfse**: Substituição de NFS-e.
- **emitterManifestNfse**: Manifestação sobre NFS-e nacional.
- **emitterGetNfseProviderStatus**: Recursos do provedor de NFS-e do município da empresa.

**CT-e e CT-e OS** — `IssuerClient`

- **emitterIssueCte** / **emitterIssueSimplifiedCte**: Emissão de CT-e, CT-e OS e CT-e simplificado.
- **emitterGetCte**: Consulta do CT-e.
- **emitterCancelCte**: Cancelamento do CT-e.
- **emitterCorrectCte**: Carta de correção do CT-e.
- **emitterConfirmCteDelivery** / **emitterCancelCteDelivery**: Comprovante de entrega e o seu cancelamento.
- **emitterLinkCtePayment** / **emitterCancelCtePaymentLink** / **emitterGetCtePaymentEvents**: Eventos de pagamento do CT-e.

**MDF-e** — `IssuerClient`

- **emitterIssueMdfe**: Emissão do MDF-e.
- **emitterGetMdfe**: Consulta do MDF-e pela chave de acesso.
- **emitterCloseMdfe**: Encerramento do MDF-e.
- **emitterCancelMdfe**: Cancelamento do MDF-e.
- **emitterAddMdfeConductor**: Inclusão de condutor.

**NFCom e DC-e** — `IssuerClient`

- **emitterIssueNfcom** / **emitterGetNfcom** / **emitterCancelNfcom**: Emissão, consulta e cancelamento da NFCom.
- **emitterGetNfcomPaymentEvents**: Eventos de pagamento da NFCom.
- **emitterGetNfcomServiceStatus**: Disponibilidade do serviço da NFCom no SEFAZ.
- **emitterIssueDce** / **emitterGetDce** / **emitterCancelDce**: Emissão, consulta e cancelamento da DC-e.

**Arquivos (XML e PDF)** — `FiscalFilesClient` e `IssuerFilesClient`

- **nfeDownloadDanfe** / **nfeDownloadSimpleDanfe** / **nfeDownloadLabelDanfe**: DANFE completo, simplificado e etiqueta.
- **nfeDownloadXml** / **nfeDownloadCancellationXml**: XML da NF-e e do cancelamento.
- **nfeDownloadCorrectionPdf** / **nfeDownloadCorrectionXml**: PDF e XML da carta de correção.
- **fileGetNfseXml** / **fileGetNfsePdf** / **fileGetNfseRpsPdf**: XML e PDF da NFS-e e PDF do RPS.
- **fileGetCteXml** / **fileGetCtePdf** / **fileGetMdfeXml** / **fileGetMdfePdf** / **fileGetNfcomXml** / **fileGetNfcomPdf** / **fileGetDceXml** / **fileGetDcePdf**: XML e PDF de CT-e, MDF-e, NFCom e DC-e.

**Monitor Fiscal** — `MonitorClient`

- **monitorSearchDocuments** / **monitorGetDocument** / **monitorListDocumentEvents**: Busca e consulta de documentos recebidos e do histórico de eventos.
- **monitorManifestDocument**: Manifestação do destinatário.
- **monitorImportDocument** / **monitorGetImportStatus**: Importação por chave de acesso, XML ou ZIP.
- **monitorListCompanies** / **monitorCreateCompany** / **monitorUpdateCompany**: Empresas monitoradas.

**Gerencial B2B** — `ResellerClient`

- **b2bV1CreateCompanies** / **b2bV1ListCompanies** / **b2bV1GetProcessedRequests**: Cadastro de empresas, listagem e contagem de notas processadas por empresa.

Na NF-e, os métodos em português usados nos exemplos (`emitirNota`, `consultarDocumento`, `cancelarDocumento`, `consultarSefaz`, `consultarCertificado`, `baixarDanfe`, `baixarXml`) equivalem aos métodos acima. A lista completa, com módulo, rota e estado de cada operação, está em [docs/CATALOG.md](docs/CATALOG.md).

## Exemplo completo em homologação

A pasta [examples/homologacao](examples/homologacao) traz um programa que emite, consulta, baixa os arquivos e cancela uma NF-e e uma NFS-e em homologação, usando as credenciais das variáveis de ambiente. Por segurança, ele só envia requisições quando `WEBMANIA_LIVE=1` está definido e `WEBMANIA_LIVE_ALLOWED_HOSTS` lista os hosts da API. Para rodar só as consultas (status do SEFAZ, certificado e provedor de NFS-e):

```sh
WEBMANIA_LIVE=1 WEBMANIA_LIVE_SCOPE=readonly WEBMANIA_LIVE_ALLOWED_HOSTS=webmania.com.br,nfe.webmania.com.br,api.webmania.com.br npm run example:homologacao
```

As variáveis aceitas e o formato da saída estão em [examples/homologacao/README.md](examples/homologacao/README.md).

## Documentação

- Documentação da REST API: [NF-e / NFC-e](https://webmania.com.br/docs/rest-api-nfe/) · [NFS-e](https://webmania.com.br/docs/rest-api-nfse/) · [CT-e](https://webmania.com.br/docs/rest-api-cte/) · [MDF-e](https://webmania.com.br/docs/rest-api-mdfe/) · [NFCom](https://webmania.com.br/docs/rest-api-nfcom/) · [DC-e](https://webmania.com.br/docs/rest-api-dce/) · [Monitor Fiscal](https://webmania.com.br/docs/rest-api-monitor-fiscal/) · [Gerencial B2B](https://webmania.com.br/docs/rest-api-gerencial-b2b/)
- Contratos OpenAPI: [API 2.0](https://api.webmania.com.br/docs/openapi) e [NF-e](https://webmania.com.br/docs/rest-api-nfe/?format=openapi)
- Detalhes técnicos do SDK (URL base, arquivos, relatórios, limites): [docs/INTEGRATION.md](docs/INTEGRATION.md)
- Lista completa de métodos: [docs/CATALOG.md](docs/CATALOG.md)
- Migração de integrações anteriores: [docs/MIGRATION.md](docs/MIGRATION.md)
- Desenvolvimento e testes do SDK: [docs/TESTING.md](docs/TESTING.md)
- Histórico de versões: [CHANGELOG.md](CHANGELOG.md)

## Suporte

Qualquer dúvida entre em contato na nossa [Central de Ajuda](https://ajuda.webmania.com.br) ou acesse o [Painel de Controle](https://webmania.com.br/painel/) para conversar em tempo real no Chat ou Abrir um chamado.

## Licença

Licença proprietária Webmania®: veja [LICENSE](LICENSE) e os [Termos de Uso](https://webmania.com.br/termos-de-uso/). As dependências de terceiros mantêm as suas próprias licenças.
