# Desenvolvimento

Como rodar cada parte, testar e gerar os binários.

## Preparando

```bash
pnpm install
pnpm seed        # gera media/catalog/ — sem isso o app abre vazio
```

O monorepo usa **pnpm workspaces** e um **workspace Cargo** na mesma raiz. Dois detalhes do
pnpm 11 que moram em `pnpm-workspace.yaml` (e são ignorados se ficarem no `.npmrc` ou no campo
`pnpm` do `package.json`):

```yaml
nodeLinker: hoisted     # o Metro do Expo não lida com o layout simbólico padrão
allowBuilds:
  esbuild: true         # sem isto o pnpm bloqueia o postinstall do esbuild e falha
```

## Scripts

| Comando | O que faz |
|---|---|
| `pnpm dev` | servidor + web + backoffice de uma vez (`--mobile` inclui o Expo) |
| `pnpm server` | só o servidor, com `--watch` |
| `pnpm web` / `pnpm admin` | só um dos fronts |
| `pnpm mobile` | Expo |
| `pnpm desktop` | compila o front e abre a janela Tauri |
| `pnpm seed` | sintetiza o catálogo de demonstração |
| `pnpm icons` | redesenha os ícones do app desktop |
| `pnpm build:web` | build de produção do web |
| `pnpm build:desktop` | front + binário desktop desta máquina |
| `pnpm desktop:windows` | cross-compila o `.exe` a partir de Linux/WSL |
| `pnpm typecheck` | `tsc --noEmit` em todos os pacotes |

## Testes ponta a ponta

```bash
node tools/e2e-offline.mjs  # biblioteca e playlists offline (não precisa de servidor)
node tools/e2e-import.mjs   # importador da web (sobe um servidor descartável sozinho)
```

Com o servidor no ar:

```bash
node tools/e2e-sync.mjs     # protocolo de sincronização, playlists, streaming com Range
node tools/e2e-admin.mjs    # API do backoffice
```

Use `NEBULA_API=http://host:porta` para apontar para outro servidor.

O teste do importador sobe um servidor próprio numa porta e num diretório temporários, com
`NEBULA_YTDLP` e `NEBULA_FFMPEG` apontando para executáveis de mentira. É por isso que ele não
precisa da internet nem das ferramentas instaladas — e é a mesma variável que o operador usa
para apontar para um binário fora do `PATH`.

O teste offline roda o `apps/web/src/offline/store.ts` de verdade contra um IndexedDB em
memória (`tools/idb-memory.mjs`), porque é ali que mora o comportamento sutil: o que acontece
com uma playlist quando o arquivo dela é apagado, se duplicatas sobrevivem, e se uma
biblioteca gravada na versão anterior do banco ainda abre.

O primeiro sobe **dois aparelhos simulados** e verifica o que o produto promete, não a
implementação: comandar de um e ouvir no outro, transferência preservando a posição, quem
manda no relógio, avanço automático no fim da faixa, aleatório reversível e queda do aparelho
ativo. É o teste que pega regressão de verdade nesse sistema.

## Servidor

Roda `.ts` direto com o type-stripping nativo do Node — sem build, sem `dist/`. A restrição é
escrever **sintaxe apagável** (`erasableSyntaxOnly` no `tsconfig`): nada de `enum`,
`namespace` ou parâmetros de construtor com modificador.

```
apps/server/src/
├── index.ts     rotas HTTP, upgrade do WebSocket, boot
├── hub.ts       o PlaybackState e a aplicação dos comandos
├── db.ts        node:sqlite — faixas, playlists
├── covers.ts    imagens de capa: gravação, descarte de órfãos
├── library.ts   sincroniza o catalog.json com o banco
├── stream.ts    streaming com Range (200/206/416)
├── admin.ts     operações do backoffice
└── config.ts    caminhos e variáveis de ambiente
```

## Web

React 19 + Vite. O player inteiro está em `useNebula.ts` (estado sincronizado) e
`offline/useOfflinePlayer.ts` (modo offline) — os dois expõem a **mesma** interface
`NebulaClient`, então os componentes não sabem qual está no ar.

```
apps/web/src/
├── useNebula.ts          cliente sincronizado: websocket + reconciliação de áudio
├── offline/
│   ├── store.ts          biblioteca e playlists offline em IndexedDB
│   └── useOfflinePlayer.ts   mesmo formato de cliente, sem rede
├── identity.ts           endereço do servidor, id e nome do aparelho
├── tauri.ts              ponte opcional para o app desktop
├── useMediaSession.ts    teclas de mídia e a barrinha do sistema
├── components/           barra do player, listas, scrubber, menus, diálogos
└── views/                telas
```

O `Scrubber` usa **captura de ponteiro** em vez de `<input type="range">`: o `mouseup` de um
range não é entregue de forma confiável quando o cursor sai do elemento, e o resultado é uma
timeline que trava onde você clicou.

## Mobile

Expo SDK 57, React Native 0.86, `expo-audio` na API imperativa (`createAudioPlayer`). Espelha
a estrutura do web: `useNebula.ts` para o modo sincronizado e `offline/` para o local, com os
arquivos copiados para o diretório de documentos do app.

A tela de playlists é **uma só** para os dois casos: `LibraryScreen` recebe um `PlaylistRepo`
(`playlistRepo.ts`) que sabe onde aquelas playlists moram. O servidor e o modo offline
implementam a mesma interface, então a tela não conhece a diferença.

## Desktop

Tauri v2, com o front do web embutido. O Rust cuida só da janela e do `config.json`.

```bash
pnpm desktop            # roda daqui
pnpm build:desktop      # binário para esta máquina
```

**Atenção ao perfil de build.** O Tauri decide dev-vs-produção pela feature
`custom-protocol`, **não** pelo perfil do cargo. Por isso ela é `default` no
`apps/desktop/Cargo.toml`:

```toml
[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

Sem isso, um `cargo build --release` gera um binário que tenta carregar o servidor do Vite e
mostra "conexão recusada" em qualquer máquina que não seja a de desenvolvimento.

### Desktop para Windows

A partir de Linux/WSL:

```bash
sudo apt install mingw-w64                 # uma vez
rustup target add x86_64-pc-windows-gnu    # uma vez
pnpm desktop:windows
```

Sai em `dist/windows/` com **dois arquivos**: `Nebula.exe` e `WebView2Loader.dll`. Os dois
precisam ficar juntos — o alvo GNU importa o loader dinamicamente (o MSVC o linka
estaticamente). O Windows 10/11 já traz o runtime do WebView2.

O script confere se o bundle do front realmente ficou embutido no `.exe`, procurando o nome do
arquivo JS gerado dentro do binário. É o que impede de mandar para o usuário um build de
desenvolvimento por engano.

### Desktop para macOS

```bash
bash tools/install-macos.sh
```

Compila o front, gera o `.app`, assina ad-hoc e instala em `~/Applications`.

## Ferramentas

| Arquivo | Para quê |
|---|---|
| `tools/generate-catalog.mjs` | sintetiza o catálogo (osciladores, ruído, envelopes) |
| `tools/dev.mjs` | sobe os serviços juntos, com prefixo por serviço no log |
| `tools/build-windows.sh` | cross-compilação + verificação do build de produção |
| `tools/install-macos.sh` | build e instalação do `.app` |
| `tools/make-icon.mjs` / `make-ico.mjs` | PNG e ICO em Node puro (zlib + CRC32) |
| `tools/make-zip.mjs` | empacota a pasta do Windows sem depender do `zip` |
| `tools/e2e-sync.mjs` / `e2e-admin.mjs` | testes ponta a ponta contra o servidor |
| `tools/e2e-offline.mjs` + `idb-memory.mjs` | teste da biblioteca offline, sem servidor |
| `tools/e2e-import.mjs` | testa o importador com `yt-dlp`/`ffmpeg` falsos |

`NEBULA_SEED_LIMIT=2 pnpm seed` gera só duas faixas, para iterar rápido.

## Convenções

- **Comentários explicam o porquê**, não o quê. Se um trecho parece estranho, o comentário diz
  qual bug ele evita.
- **O protocolo é a fonte única.** Mudou o formato do estado ou dos comandos? Mexa em
  `packages/protocol` e deixe o `tsc` apontar o resto.
- **Nada de material licenciado no repositório.** O catálogo é sintetizado.
