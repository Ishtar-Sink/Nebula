# Nebula

Player de música multiplataforma com catálogo próprio, playlists, modo offline e **controle
remoto entre aparelhos** — o comportamento do Spotify Connect: se está tocando no desktop, dá
para trocar faixa, volume ou playlist inteira pelo celular, e o som continua saindo no
desktop.

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────────┐
│   Web    │   │  Mobile  │   │ Desktop  │   │  Backoffice  │
│  React   │   │    RN    │   │  Tauri   │   │    React     │
└────┬─────┘   └────┬─────┘   └────┬─────┘   └──────┬───────┘
     └──────────────┴──────┬───────┴────────────────┘
                    WebSocket + REST
                           │
                  ┌────────┴────────┐
                  │  Servidor Node  │  estado de reprodução (fonte da verdade)
                  │  SQLite + áudio │  catálogo, playlists, streaming com Range
                  └─────────────────┘
```

Cada cliente também tem um **modo offline**: arquivos escolhidos do disco — e as playlists
feitas com eles — ficam guardados naquele aparelho, tocam sem servidor e nenhum outro aparelho
os enxerga.

## Começando

Pré-requisitos: **Node 22+**, **pnpm** e — só para o app desktop — **Rust**.

```bash
pnpm install
pnpm seed     # sintetiza o catálogo de demonstração (12 faixas originais)
pnpm dev      # servidor + web + backoffice
```

| Serviço | Endereço |
|---|---|
| Web player | http://localhost:5173 |
| Backoffice | http://localhost:5174 |
| API + WebSocket | http://localhost:4000 |

## Documentação

| Documento | Para quê |
|---|---|
| [docs/uso.md](docs/uso.md) | usar o player: playlists, modo offline, controle remoto, backoffice, atalhos |
| [docs/self-hosting.md](docs/self-hosting.md) | manter o servidor no ar: rede, variáveis, serviço, backup, segurança |
| [docs/arquitetura.md](docs/arquitetura.md) | como a coisa é montada e por quê |
| [docs/protocolo.md](docs/protocolo.md) | o contrato de sincronização, mensagem por mensagem |
| [docs/api.md](docs/api.md) | referência da API REST |
| [docs/desenvolvimento.md](docs/desenvolvimento.md) | rodar, testar e compilar cada parte |
| [docs/problemas.md](docs/problemas.md) | o que costuma dar errado, e o motivo |
| [docs/identidade-ecossistema.md](docs/identidade-ecossistema.md) | convenção de nomes e identidade visual do Ishtar Sink, ecossistema de que o Nebula é o primeiro produto |

## Estrutura

```
nebula/
├── apps/
│   ├── server/      Node 24 — HTTP + WebSocket, SQLite nativo (node:sqlite), streaming
│   ├── web/         React 19 + Vite — player completo (também é o front do desktop)
│   ├── admin/       React 19 + Vite — backoffice do catálogo
│   ├── mobile/      React Native (Expo SDK 57) — player completo
│   └── desktop/     Rust + Tauri — janela e configuração; a interface é a do web
├── packages/
│   ├── protocol/    tipos, protocolo de sincronização e motor do modo offline
│   ├── browser/     utilitários só de navegador (recorte e redução de imagens)
│   └── theme/       tokens de design (paleta roxa)
├── tools/           geração do catálogo, dev runner, builds, testes ponta a ponta
└── media/catalog/   áudio gerado + catalog.json (registro vivo do catálogo)
```

`pnpm` gerencia os pacotes JS; `cargo` gerencia o app desktop. Os dois workspaces convivem na
mesma raiz.

## Licença e conteúdo

O catálogo de demonstração é sintetizado por `tools/generate-catalog.mjs` a partir de
osciladores, ruído e envelopes — nada é sampleado, então o repositório não carrega material
licenciado de terceiros.
