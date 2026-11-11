# Testes e desenvolvimento

Como compilar e testar o SDK para Node.js a partir da fonte. O contrato fixado e a versão estão descritos em [INTEGRATION.md](INTEGRATION.md).

```sh
npm ci
npm run build   # gera dist/
npm test        # build + node --test test/*.test.mjs (fixtures locais, sem chamadas fiscais reais)
```

Os testes usam fixtures loopback e não acessam a API real.
