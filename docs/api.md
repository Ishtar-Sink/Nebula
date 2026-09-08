# API REST

Base: `http://<servidor>:4000`. Tudo é JSON; erros vêm como `{ "error": "mensagem" }` com o
status apropriado. CORS é liberado — os clientes rodam em outra origem.

O WebSocket fica na mesma porta, em `/ws` — veja [protocolo.md](protocolo.md).

## Saúde

```
GET /api/health
→ { ok, tracks, playlists, devices, uptimeSec }
```

## Faixas

```
GET /api/tracks                 todas as faixas do catálogo
GET /api/tracks?q=<busca>       busca por título, artista ou álbum
GET /api/tracks?source=catalog  filtra pela origem
GET /api/tracks/:id             uma faixa
```

```ts
interface Track {
  id: string;
  title: string; artist: string; album: string;
  durationMs: number;
  source: 'catalog' | 'local';
  coverUrl: string | null;          // caminho da imagem, quando há uma
  colorA: string; colorB: string;   // capa gerada, usada quando coverUrl é null
}
```

`source: 'local'` só aparece em faixas do **modo offline**, que existem apenas dentro de um
cliente — a API nunca as devolve.

## Estado de reprodução

```
GET /api/state
→ { state: PlaybackState, devices: DeviceInfo[] }
```

Fotografia do que o WebSocket transmite continuamente. Útil para diagnosticar sem abrir um
socket.

## Playlists

```
GET    /api/playlists                       lista
POST   /api/playlists                       { name, description? }
GET    /api/playlists/:id                   com as faixas (PlaylistDetail)
PATCH  /api/playlists/:id                   { name?, description? }
DELETE /api/playlists/:id                   → 204

POST   /api/playlists/:id/tracks            { trackId } ou { trackIds: [...] }
DELETE /api/playlists/:id/tracks/:trackId
PUT    /api/playlists/:id/order             { trackIds: [...] }  ordem completa

PUT    /api/playlists/:id/cover             corpo = bytes da imagem
DELETE /api/playlists/:id/cover             volta ao degradê gerado
```

A mesma faixa pode aparecer duas vezes numa playlist — cada entrada tem identidade própria.

Toda alteração dispara um `{ t: 'library' }` no WebSocket, e os clientes recarregam.

## Streaming

```
GET  /stream/:trackId
HEAD /stream/:trackId
```

Implementa requisições Range: responde 200 quando não há `Range`, 206 com `Content-Range` e
`Accept-Ranges: bytes` quando há, 416 quando o intervalo cai fora do arquivo. Ranges de
sufixo (`bytes=-500`) funcionam. É isso que faz o seek funcionar e o que o Safari e as pilhas
de mídia dos celulares exigem.

## Imagens

```
GET  /cover/:file
HEAD /cover/:file
```

Serve as capas enviadas para playlists e álbuns. O `coverUrl` de uma faixa ou playlist é o
caminho a usar aqui; `null` significa "sem imagem", e o cliente desenha o degradê gerado.

Cada envio grava um arquivo com nome novo, então a URL muda junto com a imagem — não há cache
velho para invalidar. O arquivo antigo é apagado assim que nada mais aponta para ele. Formatos
aceitos: jpeg, png, webp e gif, até 6 MB.

## Backoffice

Todas em `/api/admin/*`. Quando `NEBULA_ADMIN_TOKEN` está definido, exigem o token
(cabeçalho `x-admin-token` ou query `?token=`); sem a variável, ficam abertas.

```
GET    /api/admin/overview
→ { tracks, albums, totals, catalogDir, protected }
  tracks: cada faixa com sizeBytes, inPlaylists e coverUrl
  albums: { name, artist, count, durationMs, coverUrl }
  totals: { tracks, sizeBytes, durationMs, playlists }

POST   /api/admin/catalog?name=<arquivo>&title=&artist=&album=&license=&sourceUrl=
       corpo = bytes do áudio; devolve 201 com a entrada criada

PATCH  /api/admin/catalog/:id     { title?, artist?, album?, license?, sourceUrl? }
DELETE /api/admin/catalog/:id     ?keepFile=1 mantém o arquivo em disco → 204
PATCH  /api/admin/albums          { from, album?, artist? }  renomeia o álbum inteiro

PUT    /api/admin/albums/cover?album=<nome>   corpo = bytes da imagem
DELETE /api/admin/albums/cover?album=<nome>   remove a imagem do álbum
```

Um álbum é só um metadado, então sua capa é gravada em todas as faixas que o compõem; a
resposta diz quantas mudaram.

O upload é gravado num arquivo temporário e só entra no catálogo quando termina inteiro — um
envio interrompido não deixa faixa quebrada.

Remover uma faixa a tira também das playlists que a usavam, sem apagar as playlists.

`license` e `sourceUrl` são atribuição: ficam só no `catalog.json` e nunca chegam ao tocador,
que não tem o que fazer com eles.

`sourceId` é a identidade da faixa na origem, no formato `<extrator>:<id>` —
`youtube:dQw4w9WgXcQ`. É por ela que uma reimportação é reconhecida: a mesma música tem várias
URLs (`youtu.be`, `?list=`, parâmetros de rastreio) e o endereço sozinho não serve de chave.
Faixas importadas antes deste campo existir são reconhecidas pelo id extraído do `sourceUrl`.

## Importação da web

```
GET  /api/admin/import/tools[?refresh=1]
→ { ready, ytdlp: { found, version }, ffmpeg: { found, version }, hint }
  hint traz o comando de instalação quando falta alguma coisa

GET  /api/admin/import/providers
→ { providers: [{ id, name, notes, hosts }] }

POST /api/admin/import/probe      { url }
→ { provider, kind: 'track' | 'collection', title, uploader, suggestedLicense, entries }
  entries: { url, sourceId, title, uploader, durationMs, thumbnail, duplicateOf }

POST /api/admin/import   { items: [{ url, sourceId?, title?, artist?, album?, license? }] }
→ 202 com o trabalho recém-criado

GET    /api/admin/import/:jobId   → estado do trabalho
DELETE /api/admin/import/:jobId   → { cancelled } — interrompe o download em curso
```

O trabalho é uma lista de itens com `status` (`pendente`, `baixando`, `ok`, `erro`,
`cancelada`, `duplicada`), `detail` no caso de erro e `trackId` no caso de sucesso. `finishedAt` deixa de
ser `null` quando acaba; meia hora depois disso o trabalho é esquecido.

Os downloads correm **um de cada vez**, de propósito: uma playlist de cinquenta abriria
cinquenta conexões ao mesmo servidor. Um item que falha não interrompe os seguintes.

A duplicata é verificada duas vezes: na sondagem, para desmarcar na tela, e de novo antes de
cada download — uma playlist longa leva tempo, e o catálogo pode crescer no meio, inclusive
por causa de um item anterior do mesmo trabalho.

Sem `yt-dlp` e `ffmpeg` na máquina do servidor, `probe` e `import` devolvem `503` com o texto
de `hint`. O Nebula não distribui nenhum dos dois.

## Códigos de status

| Código | Quando |
|---|---|
| `400` | parâmetro obrigatório ausente, formato de áudio ou de imagem não aceito |
| `401` | token de administração inválido |
| `404` | faixa, playlist ou rota inexistente |
| `413` | imagem acima de 6 MB |
| `416` | `Range` fora do arquivo |
| `500` | bug de verdade — sai com stack no log do servidor |
| `502` | o `yt-dlp` recusou o endereço (vídeo indisponível, restrito, sem áudio) |
| `503` | `yt-dlp` ou `ffmpeg` não estão instalados no servidor |
