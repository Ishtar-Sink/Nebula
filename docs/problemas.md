# Problemas conhecidos

O que costuma dar errado, o sintoma exato e a causa. Vários destes foram bugs reais deste
repositório — ficam registrados porque a causa nunca é a que parece.

## Instalação

**`pnpm install` falha com o esbuild bloqueado.**
O pnpm 11 lê `allowBuilds` no `pnpm-workspace.yaml`; o mesmo ajuste no `.npmrc` ou no campo
`pnpm` do `package.json` é **ignorado silenciosamente** e a instalação sai com erro.

**O Metro do Expo não encontra um módulo.**
Precisa de `nodeLinker: hoisted` no `pnpm-workspace.yaml`. O bundler resolve módulos andando
pelos diretórios `node_modules`, e o layout simbólico padrão do pnpm não atende.

## Servidor

**`EADDRINUSE` na porta 4000.**
Já existe um servidor rodando. `ss -lptn 'sport = :4000'` mostra o dono. Para subir um segundo
em paralelo, use `NEBULA_PORT=4100`.

**O app abre vazio.**
Falta rodar `pnpm seed`. O log do servidor avisa: `catálogo vazio`.

**Uma faixa some depois de reiniciar.**
O `media/catalog/catalog.json` é o registro vivo. Copiar um arquivo de áudio para a pasta não
basta — o servidor sincroniza o banco **a partir do manifesto**, e o backoffice é quem o
escreve.

## Reprodução

**A timeline anda mas não sai som em nenhum aparelho.**
Nenhum aparelho é o ativo, ou o ativo está numa aba em segundo plano com o áudio suspenso.
Abra o seletor de dispositivos e transfira para o aparelho onde você está.

**`crypto.randomUUID is not a function`.**
API de contexto seguro, ausente em `http://` num IP de rede local. O cliente já cai para
`getRandomValues`; se aparecer em algum lugar novo, use o `randomId()` de `identity.ts` em vez
da API direta.

**O navegador bloqueou o áudio automático.**
Só há som depois de uma interação. O app mostra um aviso clicável; um clique em qualquer lugar
libera. No desktop isso é contornado com
`--autoplay-policy=no-user-gesture-required` no WebView2 — sem isso, transferir a reprodução
do celular para o desktop ficaria em silêncio até alguém clicar na janela.

**A faixa termina e o play não reinicia.**
Comportamento antigo. Hoje `play` numa faixa parada no próprio fim volta ao zero
(`rewindIfFinished`). Se voltar a acontecer, suspeite de um relatório de progresso obsoleto
brigando com o `isPlaying` do servidor.

**A timeline trava onde eu cliquei.**
Foi um bug real, com três causas somadas: o `mouseup` de um `<input type=range>` não chega de
forma confiável; sem um "segurar otimista" a barra voltava durante a ida e volta ao servidor;
e o relatório de progresso obsoleto desfazia o seek do lado do servidor. A correção está em
`components/Scrubber.tsx` (captura de ponteiro) e no `seek`/tick de `useNebula.ts`.

**A faixa nova começa com a timeline no meio.**
O relógio do áudio ainda respondia pela faixa anterior. O tick só confia no relógio quando o
elemento realmente carregou a faixa atual (`loadedTrackRef === state.trackId`).

**As teclas de mídia só fazem play/pause.**
Era assim antes: o navegador liga play/pause ao elemento de áudio sozinho, mas próxima e
anterior exigem um handler explícito (`useMediaSession.ts`). Se voltar a acontecer, confira se
o aparelho é mesmo o ativo — só ele registra os controles, para dois não brigarem pela mesma
tecla.

**A imagem que enviei não aparece / continua a antiga.**
Não é cache: cada envio gera um arquivo com nome novo. Recarregue a página; se persistir,
confirme que o servidor é o mesmo em que a imagem foi enviada (a engrenagem mostra o endereço).

## Modo offline

**Minhas músicas offline sumiram.**
No navegador, limpar os dados do site apaga a biblioteca — ela mora no IndexedDB daquela
origem, por aparelho e por navegador. Em janela anônima ela nunca persiste.

**Não aparecem no outro aparelho.**
É o desenho: os arquivos não saem do aparelho. Para tocar em todos, adicione ao catálogo pelo
backoffice.

**Não consigo adicionar uma faixa offline a uma playlist do servidor.**
Também é o desenho — mas existem **playlists offline** para isso, na barra lateral (web e
desktop) ou na aba *Offline* (mobile). Elas ficam no aparelho e nunca sincronizam. Uma playlist
do servidor não pode guardar um arquivo que o servidor não tem.

**Apaguei um arquivo e a playlist offline encolheu.**
Esperado: uma playlist não pode apontar para um arquivo que não existe mais. A playlist em si
continua lá.

**O título ou o artista da música está errado.**
Eles são adivinhados pelo nome do arquivo. O diálogo de conferência aparece antes de guardar,
justamente para corrigir; depois disso, use **Editar informações** no menu de contexto (botão
direito, ou o ⋯ da linha).

**Não consigo apagar uma faixa do catálogo pelo app.**
De propósito: ela é do servidor e some para todo mundo. Isso é feito no backoffice. O menu de
contexto só oferece remoção para arquivos deste aparelho.

**A duração aparece como 0:00.**
O decodificador do aparelho não soube dizer o tamanho do arquivo. A faixa ainda toca; só a
barra fica sem escala.

## Desktop

**A janela mostra "conexão recusada" / `ERR_CONNECTION_REFUSED`.**
O binário é um build de desenvolvimento: ele está tentando carregar o servidor do Vite. O
Tauri escolhe dev-vs-produção pela feature `custom-protocol`, **não** pelo perfil do cargo.
Confirme o bloco `[features]` em `apps/desktop/Cargo.toml`. O `tools/build-windows.sh` já
verifica isso antes de empacotar.

**O `.exe` não abre no Windows.**
Falta o `WebView2Loader.dll` ao lado dele. O alvo GNU importa o loader dinamicamente; os dois
arquivos precisam ficar na mesma pasta.

**O app não acha o servidor.**
Engrenagem no topo → endereço. Fica em `%APPDATA%\nebula\config.json` (Windows) ou
`~/.config/nebula/config.json`. A janela recarrega ao salvar.

## Mobile

**O celular não conecta.**
O Expo entrega o endereço do Metro, que nem sempre é o do servidor. Ajuste na engrenagem da
aba *Offline*. Confirme também que o servidor escuta em `0.0.0.0` (padrão) e que o firewall da
máquina permite a porta 4000.

**O áudio para quando bloqueio a tela.**
Deveria continuar: o app pede `shouldPlayInBackground`. Em runtimes antigos essa chamada falha
e o áudio vira só-primeiro-plano.

## Rede

**O seek não funciona atrás de um proxy.**
O proxy está bufferizando e engolindo as requisições Range. Use `proxy_buffering off` e
encaminhe o upgrade do WebSocket — veja [self-hosting.md](self-hosting.md#atrás-de-um-proxy-reverso).

**Um aparelho aparece online mas não responde.**
Conexão meio-aberta; o heartbeat de 15 s a derruba em até um ciclo. Se o aparelho era o ativo,
o servidor pausa e libera o posto.
