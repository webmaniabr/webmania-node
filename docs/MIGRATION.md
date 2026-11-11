# Migração de alpha.0 para alpha.1

Os clientes `NfeClient`, `MonitorClient` e `FiscalFilesClient` e suas fachadas em português continuam disponíveis. A instalação permanece ESM (`type:module`) em Node 22/24, com um único pacote para JavaScript e TypeScript. Instale o tarball gerado deste repositório no projeto; não copie fontes nem instale o gerador de contratos.

`NfeClient` acrescenta os métodos com `operationId` do catálogo. API2 usa `IssuerClient({issuerBearerToken})`; gerencial B2B usa `ResellerClient({resellerCredentials})`. `MonitorClient({bearerToken})` continua restrito ao token Monitor. Os novos métodos JSON recebem um wrapper próprio `{path,query,body}` e opções `{signal}` separadas. Os componentes de corpo (`MonitorCreateCompanyRequest`, por exemplo) não são wrappers; use `MonitorCreateCompanyArguments` para o conjunto da operação.

O retorno continua sendo o objeto/array de domínio, com campos adicionais preservados. Não converta decimal ou chave textual para `Number`. A validação considera o snapshot serializado e recusa inteiros fora do intervalo seguro, profundidade acima de 64 níveis, mais de 100000 nós ou corpo acima de 16 MiB.

`WebmaniaError.requestReference` agora é somente diagnóstico redigido. Após `outcome:'unknown'`, o acesso deliberado `error.recovery?.reveal()` fornece uma cópia dos seletores seguros para consulta explícita. O objeto de recuperação é protegido em `JSON.stringify` e inspeção normal. Credenciais, valores de campos sensíveis e capabilities não são seletores. Não repita a mutação para testar se ela foi recebida.

A paginação aceita `page` inicial e limites `maxPages`, `maxItems`, `deadlineMs`, `startIndex` e `signal`. `per_page` fica constante; os metadados devem confirmá-lo. `coletarEmpresas`, `coletarMunicipiosEmpresa` e `coletarRelatorios` retornam itens e continuação `{page,index,per_page}`. O padrão é página 1 somente quando omitida.

Arquivos API1 conservam o retorno `FiscalFile` e os erros de proteção. Os arquivos API2 usam `IssuerFilesClient`, origem confiável explícita e uma escolha por chamada: `company_bearer`, `document_token` ou `public` (MDF-e exige Bearer). O retorno distingue arquivo, pendência, HTML, proteção e o redirecionamento documentado de PDF NFS-e. Leia a referência privada com `location.reveal()` somente para avaliar uma nova chamada separada; isso não aprova origem ou autenticação.

Esta migração descreve prévias sem publicação no registro e sem substituição de um pacote legado. Integração fiscal real, provedores e variantes têm aceite separado.

## alpha.1 para alpha.2

Os aliases GET em português de NF-e e Monitor passam pelo mesmo contexto de parâmetros e diagnóstico dos métodos de catálogo. Método, caminho, valores de consulta, autenticação e formato de retorno continuam os mesmos.

UUIDs no caminho de Location são protegidas mesmo dentro de nomes de arquivo ou junto de escapes malformados; query, userinfo e autoridade opacos continuam com comparação literal. Falha do parser antes da observação completa dos cabeçalhos omite `recovery`, mantendo `outcome:unknown` quando aplicável. Fechamento antes dos cabeçalhos e falhas de corpo posteriores conservam seletores seguros conforme o contexto observado.

Os iteradores verificam cancelamento e deadline a cada retomada da entrega dos itens em memória, antes de continuação e conclusão. Uma página vazia além de `last_page` termina sem continuação quando os metadados são coerentes; páginas não vazias além do fim ou metadados incompatíveis continuam sendo erro.

## alpha.2 para alpha.3

Os cabeçalhos Location de eventos HTTP informativos e de upgrade recusado agora contribuem para o mesmo contexto privado do pedido antes de qualquer continuação ou rejeição. Isso inclui a rejeição pelo limite de oito respostas informativas. Os protocolos aceitos, o bloqueio de upgrade, a ausência de follow/replay e os modos de autenticação continuam os mesmos. A observação não valida uma URL nem autoriza o destino; query, userinfo e autoridade opacos mantêm comparação literal.

## alpha.7 para alpha.8

Os modelos de corpo das emissões CT-e, DC-e, MDF-e, NFCom e NFS-e passam a usar o nome derivado da operação com sufixo `Payload` (por exemplo `EmitterIssueNfsePayload`); campos e validação não mudam. Atualize somente os `import type` que citavam os nomes anteriores.

`baixarRelatorio` aceita CSV e XLSX rotulados `text/xml`, identificados pelos bytes; `contentType` do resultado informa o formato detectado. Relatórios atuais usam `baixarRelatorioV2(uuid)` ou `baixarUrlRelatorio(url)` com a origem de `reportsBaseUrl` (padrão `https://api.webmania.com.br`) listada em `trustedOrigins`.
