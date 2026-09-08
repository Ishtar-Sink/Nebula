# Arquitetura

Por que o sistema tem esse formato, e o que cada decisão evita.

## O problema central

"Tocar no desktop e controlar pelo celular" parece exigir comunicação entre aparelhos, mas
não exige. O que ele exige é que **todos concordem sobre o que deveria estar tocando**.

A solução aqui: o servidor guarda **um** `PlaybackState`, e todo aparelho *reconcilia* seu
motor de áudio contra ele. Nada de peer-to-peer, nada de descoberta na rede, nada de
negociação — só um estado compartilhado e uma regra de quem produz som.

```
comando de qualquer aparelho ──► servidor ──► novo estado ──► broadcast
                                                                  │
                          ┌───────────────────────────────────────┤
                          ▼                                       ▼
                 aparelho ATIVO                          demais aparelhos
                 reconcilia o áudio                      só redesenham a tela
                 (carrega, busca, toca)
```

## As duas invariantes

**1. Só o `activeDeviceId` produz som.** Quem manda o comando não vira o ativo. É exatamente
isso que faz o celular controlar o desktop: o celular manda `next`, o servidor troca a faixa,
o desktop reconcilia e toca. O celular só redesenha.

**2. `rev` só sobe em mudanças que exigem ação.** O aparelho ativo reporta sua posição duas
vezes por segundo; essas mensagens atualizam `positionMs` no servidor mas **não** incrementam
`rev`. Sem essa regra, o eco do próprio relógio faria o aparelho ativo recarregar a faixa em
loop.

Transferir (`transfer`) troca o `activeDeviceId` mantendo a posição: o antigo silencia, o novo
carrega, busca a posição e continua. Se o ativo cai, o servidor pausa e zera o posto — o
próximo play assume.

## O modo offline, e por que ele é separado

Arquivos que o ouvinte escolhe do disco **não passam pelo servidor**. Isso é uma decisão de
produto, não uma limitação: são arquivos pessoais, e a promessa é que eles não saem do
aparelho.

A consequência é que eles não podem participar do estado compartilhado — o servidor não teria
como mandar outro aparelho tocar um arquivo que ele não tem. Então o modo offline é uma
**segunda sessão de reprodução**, local, com o mesmo formato de estado:

- `packages/protocol/src/offline.ts` tem um redutor puro que aplica os mesmos `Command`s sobre
  o mesmo `PlaybackState`. É o hub, sem o hub.
- Por reusar o formato do estado, toda a interface do player — transporte, timeline, fila,
  aleatório, repetição — funciona nos dois modos sem nenhum `if`.
- O app escolhe **um** dos dois clientes para alimentar a barra do player, então nunca há dois
  áudios ao mesmo tempo no mesmo aparelho.
- Trocar de modo é implícito: tocar algo do catálogo sai do offline; tocar um arquivo offline
  pausa o que o servidor mandava tocar **neste** aparelho, sem afetar os outros.

**Playlists offline** seguem a mesma lógica: apontam para arquivos que só este aparelho tem,
então uma cópia no servidor nunca poderia ser tocada em outro lugar. Ficam guardadas junto com
a biblioteca, e as duas coleções nunca se misturam — o menu de cada faixa oferece só as
playlists que podem guardá-la.

Onde tudo fica guardado:

| Cliente | Armazenamento |
|---|---|
| Web e desktop | IndexedDB (`nebula-offline`): metadados, áudio e playlists em stores separados |
| Mobile | diretório de documentos do app, com índice e playlists em AsyncStorage |

Metadados e áudio ficam **separados de propósito**. Listar a biblioteca acontece a cada
alteração; se os Blobs estivessem na mesma store, cada listagem puxaria todos os bytes de
áudio para a memória — em uma biblioteca real, gigabytes.

Em ambos os casos a biblioteca sobrevive a reiniciar o app: o ouvinte escolhe os arquivos uma
vez só.

## Capas

Uma capa de verdade é opcional; sem ela, o degradê determinístico continua valendo. Os dois
mundos guardam a imagem de formas diferentes, pelo mesmo motivo de sempre:

| | Onde fica | O que o cliente recebe |
|---|---|---|
| Playlist do servidor, álbum do catálogo | arquivo em `data/covers` | caminho `/cover/<arquivo>` |
| Playlist e faixa offline | junto da própria biblioteca local | data URL (web) ou URI local (mobile) |

Cada envio grava um **arquivo novo**, e o antigo é apagado quando nada mais aponta para ele.
Isso resolve o cache de graça: a URL muda junto com a imagem, então não existe capa velha
teimando na tela.

Um álbum é só um metadado repetido nas faixas, então sua capa é gravada em cada uma delas —
não há tabela de álbuns para pendurar a imagem.

## Escolhas do servidor

**Node 24 rodando `.ts` direto.** Sem passo de build, sem bundler, sem `dist/` a manter em
sincronia. O código é escrito em sintaxe apagável (`erasableSyntaxOnly`), que é o que o
type-stripping nativo aceita.

**`node:sqlite`.** Zero dependência nativa para compilar — o mesmo `pnpm install` funciona em
macOS, Linux e Windows sem toolchain de C. Playlists e o índice de faixas cabem folgado.

**Streaming com Range.** O `/stream/:id` implementa 200, 206 e 416, inclusive ranges de
sufixo. Não é refinamento: sem isso o Safari e a pilha de mídia dos celulares simplesmente não
tocam, e o seek não funciona em lugar nenhum.

**Heartbeat de 15s.** Conexões meio-abertas (notebook que fechou a tampa) não são detectadas
pelo TCP em tempo útil; sem o ping, um aparelho morto continuaria "ativo" e o som não voltaria
para ninguém.

## Escolhas dos clientes

**Um front para web e desktop.** O app desktop é uma janela Tauri em volta do build do web. O
Rust cuida da janela e do `config.json`; o player é o mesmo código. Uma interface só para
manter, e os dois nunca divergem.

**Reconciliação, não comandos imperativos.** Nenhum cliente recebe "toque agora". Ele recebe o
estado e decide o que fazer para ficar igual a ele. Reconexão, aba recarregada e aparelho que
acorda do sono caem no mesmo caminho de código que o uso normal.

**O relógio pertence ao aparelho ativo.** Ele reporta a posição real do áudio; os outros
extrapolam a partir do último relatório (`estimatePosition`). Sem esse dono único, um remoto
pausado arrastaria a posição para trás.

## Pacotes compartilhados

- **`@nebula/protocol`** — tipos, o formato do estado, os comandos, `estimatePosition`,
  `shuffleQueue` e o redutor do modo offline. É o contrato: o servidor e os três clientes
  importam daqui.
- **`@nebula/theme`** — a paleta e as funções de cor. `paletteFor(id)` é determinística, então
  a mesma faixa recebe a mesma capa em todos os aparelhos sem guardar imagem nenhuma. É o que
  aparece quando ninguém enviou uma imagem de verdade.
- **`@nebula/browser`** — utilitários que só existem no navegador, hoje o recorte e a redução
  de imagens. Fica num pacote porque o player e o backoffice precisam do mesmo comportamento.

## Fluxo de uma faixa, ponta a ponta

1. O ouvinte clica em uma faixa no celular.
2. O celular manda `{ t: 'command', cmd: { type: 'playContext', ... } }`.
3. O servidor valida os ids contra o catálogo, monta a fila, carrega a faixa, sobe `rev`.
4. Todo mundo recebe `{ t: 'state', state }`.
5. O aparelho ativo vê que `rev` mudou e que `trackId` não é o que ele tem carregado: aponta o
   `src` para `/stream/<id>`, busca a posição e toca.
6. Os demais só redesenham a barra.
7. O ativo passa a reportar `progress` duas vezes por segundo, sem subir `rev`.
8. No fim da faixa ele manda `trackEnded`; o servidor avança a fila e o ciclo recomeça.
