# Uso

Guia do dia a dia: o que cada cliente faz e como as duas bibliotecas — a do servidor e a
deste aparelho — se relacionam.

## As duas bibliotecas

O Nebula tem dois lugares de onde a música pode vir, e eles são deliberadamente separados:

| | Catálogo | Modo offline |
|---|---|---|
| Onde o áudio fica | no servidor | **só neste aparelho** |
| Quem enxerga | todos os aparelhos conectados | ninguém além deste |
| Precisa de rede | sim | não |
| Playlists | no servidor, iguais em todo lugar | **só neste aparelho**, nunca sincronizam |
| Controle remoto | sim | não — toca aqui e só aqui |

As duas nunca se misturam: uma playlist do servidor não aceita um arquivo que só existe aqui,
e uma playlist offline não aceita uma faixa do catálogo. Cada menu de faixa oferece apenas as
playlists que podem realmente guardá-la.

A troca entre os dois é automática: tocar algo do catálogo sai do modo offline, e tocar um
arquivo offline pausa o que o servidor mandava tocar **neste** aparelho. Os outros aparelhos
seguem tocando normalmente — a biblioteca offline nunca fez parte daquela sessão.

## Web player

`http://localhost:5173`, ou o IP da máquina na rede local (`http://192.168.x.x:5173`) para
abrir do celular ou de outro computador. O front descobre a API sozinho pelo host da página.

- **Início** — álbuns e playlists, com um clique para tocar
- **Buscar** — filtra o catálogo por título, artista ou álbum
- **Modo offline** — a biblioteca deste navegador (veja abaixo)
- **Fila** — a fila atual, na ordem real; dá para pular e remover

Atalhos:

| Tecla | Ação |
|---|---|
| `Espaço` | tocar / pausar |
| `Shift` + `→` | próxima faixa |
| `Shift` + `←` | faixa anterior |

As teclas de mídia do teclado e os botões do fone também funcionam — tocar/pausar, próxima,
anterior e o avanço pela barrinha do sistema operacional. Quem responde é o aparelho que está
produzindo som; os outros ignoram, para dois aparelhos não brigarem pelo mesmo comando.

### Menu de contexto

**Clique com o botão direito** em qualquer faixa (ou use o **⋯** da linha) para abrir o menu.
Ele mostra só o que faz sentido ali:

| Ação | Quando aparece |
|---|---|
| Tocar · Adicionar à fila | sempre |
| Tirar da fila | aberto a partir da Fila |
| Ir para o álbum | faixas do catálogo |
| Adicionar à playlist | lista só as playlists que podem receber aquela faixa |
| Remover desta playlist | aberto dentro de uma playlist |
| Editar informações | só arquivos deste aparelho |
| Remover deste aparelho | só arquivos deste aparelho, com confirmação |

Faixas do catálogo **não** têm remoção por aqui: elas pertencem ao servidor, e removê-las é
trabalho do backoffice.

No mobile, o **⋯** da linha (ou um toque longo) abre a mesma folha de ações.

**Playlists também têm menu**: clique com o botão direito em uma playlist da barra lateral
para tocar, tocar aleatório, renomear, trocar a imagem ou excluir.

### Imagens

Playlists e álbuns podem ter uma capa de verdade no lugar do degradê gerado:

- **Playlist** — pelo menu de contexto, ou pelo botão que aparece sobre a capa na página dela.
- **Faixa local** — em *Editar informações*, no menu de contexto.
- **Álbum do catálogo** — no backoffice, no card do álbum. Vale para todas as faixas dele.

A imagem é recortada em quadrado e reduzida antes de guardar, então uma foto de celular não
vira um arquivo de vários megabytes. Capas de playlists e faixas offline ficam no aparelho;
capas do catálogo ficam no servidor e aparecem em todos.

## Modo offline

Escolha arquivos do disco em **Modo offline → Adicionar arquivos**. Antes de guardar, abre um
diálogo de conferência: título, artista, álbum e capa de cada arquivo, com um atalho para
aplicar o mesmo artista e álbum a todos — útil ao arrastar um disco inteiro. Nada é guardado
enquanto você não confirmar.

Depois disso ficam no próprio aparelho (IndexedDB no navegador e no desktop, o diretório do
app no celular) e continuam lá na próxima vez que você abrir o Nebula — não é preciso escolher
de novo.

O que sobe para o servidor: **nada**. Nem o áudio, nem o nome, nem a duração. É por isso que
essas faixas não aparecem em outros aparelhos e não podem ser adicionadas a playlists — uma
playlist é do ouvinte e vale em todos os aparelhos, e o servidor não teria como tocar um
arquivo que não tem.

Título e artista vêm do nome do arquivo: `Artista - Título.mp3` é reconhecido; qualquer outro
nome vira o título. A duração é lida pelo próprio decodificador do aparelho.

O palpite erra bastante — por isso o diálogo de conferência. Depois de guardada, dá para
corrigir a qualquer momento em **Editar informações**, no menu de contexto da faixa: título,
artista, álbum e capa. Como tudo aqui, a correção fica só neste aparelho.

Formatos: os que a plataforma tocar — na prática mp3, m4a, aac, wav, flac, ogg e opus.

**Esvaziar** apaga as faixas guardadas deste aparelho. No navegador, limpar os dados do site
tem o mesmo efeito.

### Playlists offline

Feitas com esses mesmos arquivos, e guardadas do mesmo jeito: no aparelho, nunca no servidor.

- **No web e no desktop**, ficam na barra lateral, em *Playlists offline*, separadas das do
  servidor. O **+** cria uma nova.
- **No mobile**, na aba *Offline*, alternando entre *Faixas* e *Playlists*.
- Apagar um arquivo da biblioteca o tira de todas as playlists offline; a playlist continua
  existindo. Excluir uma playlist não apaga arquivo nenhum.
- A mesma faixa pode aparecer duas vezes, como nas playlists do servidor.

## Controle remoto entre aparelhos

Todo aparelho conectado é, ao mesmo tempo, um player e um controle remoto. Exatamente um
deles produz som — o *ativo*.

- O ícone de dispositivos (no player, à direita) lista quem está online e transfere a
  reprodução, mantendo a posição da faixa.
- Comandar de um aparelho **não** o torna o ativo: é isso que faz "mexer no celular e o som
  continuar no desktop" funcionar.
- Se o aparelho ativo cai, o servidor pausa e libera o posto; o próximo play assume.

## Playlists

Criar, renomear, excluir, adicionar/remover faixas e reordenar. Vivem no servidor, então são
as mesmas em todos os aparelhos. São do ouvinte: o backoffice não mexe nelas.

Remover uma faixa do catálogo pelo backoffice a tira também das playlists que a usavam — sem
apagar as playlists.

## Mobile

```bash
pnpm dev --mobile        # ou: pnpm --filter @nebula/mobile start
```

Abra com o **Expo Go** e escaneie o QR code. As abas são *Início*, *Buscar*, *Biblioteca* e
*Offline*. O áudio continua tocando com a tela bloqueada.

O app descobre o servidor pelo endereço do Metro; para apontar para outra máquina, use a
engrenagem na aba *Offline* (a configuração do servidor não afeta o modo offline, que
funciona mesmo sem servidor nenhum).

## Desktop

O app desktop é uma janela Tauri em volta do **mesmo front do web**: o Rust cuida da janela e
do arquivo de configuração, e todo o player é o código que já roda no navegador.

```bash
pnpm desktop           # compila o front e abre a janela
```

No Windows, basta `Nebula.exe` e `WebView2Loader.dll` na mesma pasta — veja
[desenvolvimento.md](desenvolvimento.md#desktop-para-windows) para gerar os dois.

## Backoffice

Em `http://localhost:5174`. Gerencia **só o catálogo**:

- inserir faixas (arrastar e soltar, várias de uma vez) — abre um diálogo de conferência antes
  de publicar, com artista/álbum aplicáveis em lote e a imagem do álbum
- definir ou trocar a imagem de um álbum inteiro
- corrigir título, artista e álbum na própria tabela
- renomear um álbum inteiro de uma vez
- ouvir uma prévia antes de publicar
- remover faixas — mostrando antes em quantas playlists de ouvintes ela está

Para exigir autenticação, defina `NEBULA_ADMIN_TOKEN` no servidor; o backoffice pede o token
e o guarda no navegador.

### Importar da web

A segunda aba do backoffice recebe um endereço, converte o áudio para mp3 e publica no
catálogo. O provedor é reconhecido pela própria URL — YouTube, Internet Archive, Free Music
Archive, Bandcamp, SoundCloud, e um genérico que tenta qualquer outro site.

1. cole o endereço e clique em **Analisar**
2. se for uma playlist, marque as faixas que interessam — começa tudo marcado, **menos o que
   já está no catálogo**, que aparece esmaecido com a etiqueta *no catálogo*
   (playlist longa tem um campo de busca em cima da lista; filtrar não desmarca nada)
3. preencha artista, álbum e **licença** — aplicados a todas de uma vez
4. **Baixar as selecionadas**; o progresso aparece por faixa e dá para cancelar no meio

A licença e o endereço de origem ficam gravados com a faixa. Preencha: é o que permite provar
depois de onde veio cada coisa.

> A ferramenta baixa o que você mandar; **decidir o que pode ser baixado é sua parte.** Ela
> existe para material sem direitos autorais — domínio público, Creative Commons, bibliotecas
> de áudio livres, obra própria. Baixar música protegida e transmiti-la ao vivo é o caminho
> mais curto para um strike no seu canal, e o Nebula não tem como saber a diferença.

Precisa de `yt-dlp` e `ffmpeg` instalados na máquina do servidor — veja
[self-hosting](self-hosting.md#importação-da-web-opcional). A aba avisa quando faltam, com o
comando de instalação pronto.

## Endereço do servidor

Cada cliente descobre o servidor sozinho quando dá, e todos permitem sobrescrever sem
recompilar e sem variável de ambiente:

| Cliente | Padrão | Onde a configuração fica |
|---|---|---|
| Web / Backoffice | host da própria página, porta 4000 | armazenamento local do navegador |
| Desktop | `http://localhost:4000` | `%APPDATA%\nebula\config.json` no Windows, `~/.config/nebula/config.json` nos demais |
| Mobile | host do Metro, porta 4000 | armazenamento do app |

No web e no desktop, a engrenagem no topo abre a configuração; no mobile, a engrenagem na aba
*Offline*. O endereço é normalizado ao salvar: sem esquema vira `http://`, sem porta ganha a
`:4000`, e a barra final é descartada. A janela recarrega para reabrir a conexão no endereço
novo.
