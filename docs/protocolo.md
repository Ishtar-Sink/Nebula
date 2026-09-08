# Protocolo de sincronização

Contrato entre o servidor e os clientes. A fonte é
[`packages/protocol/src/index.ts`](../packages/protocol/src/index.ts) — este documento
explica; o arquivo manda.

## Conexão

```
ws://<servidor>/ws?deviceId=<id>&name=<nome>&platform=<web|mobile|desktop>
```

O `deviceId` é gerado e guardado pelo cliente, então o mesmo aparelho mantém a identidade
entre reinícios. Reconectar com um `deviceId` já conectado fecha a conexão antiga com o código
`4000` — a nova vence.

O servidor manda um `ping` a cada 15 s e espera o `pong`; quem não responde é considerado
desconectado. Isso é o que detecta um notebook que fechou a tampa sem fechar o socket.

## O estado

```ts
interface PlaybackState {
  rev: number;                 // revisão monotônica; só sobe em mudanças que exigem ação
  activeDeviceId: string | null; // o único aparelho que produz som
  contextId: string | null;    // 'catalog' | 'playlist:<id>' | 'album:<nome>' | 'search'
  contextName: string | null;
  queue: string[];             // ids de faixa, na ordem de reprodução
  queueIndex: number;
  trackId: string | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  positionUpdatedAt: number;   // relógio do servidor quando positionMs foi escrito
  volume: number;              // 0..1
  muted: boolean;
  shuffle: boolean;
  repeat: 'off' | 'context' | 'track';
}
```

`positionUpdatedAt` é o que permite a um aparelho **não** ativo desenhar uma barra que anda:
`estimatePosition(state)` soma o tempo decorrido desde o último relatório, limitado pela
duração.

## Cliente → servidor

| Mensagem | Quando |
|---|---|
| `{ t: 'hello', device }` | opcional; os parâmetros da URL já identificam o aparelho |
| `{ t: 'command', cmd }` | qualquer ação do usuário |
| `{ t: 'progress', positionMs, durationMs, isPlaying }` | só o aparelho ativo, 2x por segundo |
| `{ t: 'ping' }` | mantém a conexão viva por iniciativa do cliente |

`progress` de quem **não** é o ativo é ignorado — sem isso, um remoto pausado puxaria a
posição para trás.

## Servidor → cliente

| Mensagem | Quando |
|---|---|
| `{ t: 'welcome', deviceId, state, devices }` | logo após conectar |
| `{ t: 'state', state }` | a cada mudança de estado, inclusive progresso |
| `{ t: 'devices', devices }` | alguém entrou ou saiu |
| `{ t: 'library', reason }` | o catálogo ou as playlists mudaram; recarregue via REST |
| `{ t: 'error', message }` | comando recusado (ex.: transferir para aparelho offline) |
| `{ t: 'pong' }` | resposta ao `ping` |

## Comandos

```ts
type Command =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; positionMs: number }
  | { type: 'volume'; volume: number }        // 0..1; também tira do mudo
  | { type: 'mute'; muted: boolean }
  | { type: 'shuffle'; shuffle: boolean }
  | { type: 'repeat'; repeat: RepeatMode }
  | { type: 'playContext'; contextId; contextName; trackIds; startIndex }
  | { type: 'queueAdd'; trackId: string }
  | { type: 'queueRemove'; index: number }
  | { type: 'transfer'; deviceId: string; play?: boolean }
  | { type: 'trackEnded' };
```

Detalhes que não são óbvios:

- **`play` no fim da faixa reinicia.** Uma faixa parada no próprio fim não tem para onde
  retomar, então `play` volta para o zero. Sem isso, o botão parece morto quando a fila acaba.
- **`previous` depois de 3 s reinicia a faixa**, como no Spotify; antes disso volta uma.
- **Pular na mão sempre anda, mesmo com repetição desligada.** `next` na última faixa vai para
  a primeira e `previous` na primeira vai para a última. É `trackEnded` — o fim natural — que
  respeita o modo de repetição e para no fim da fila. Um botão que não faz nada quando
  apertado parece quebrado; uma fila que reinicia sozinha é que seria indesejada.
- **Pular não liga o som.** Se estava pausado, continua pausado na faixa nova; o `trackEnded`
  automático é que mantém tocando.
- **`shuffle` é reversível.** A ordem original fica guardada; desligar o aleatório a restaura,
  e a faixa atual continua tocando.
- **`transfer` para um aparelho offline** devolve `error` em vez de deixar o estado num
  aparelho que não existe.
- **`trackEnded` só conta vindo do aparelho ativo.** É um fato observado, não um pedido.
- **`playContext` valida os ids** contra o catálogo e ignora os desconhecidos.

## O modo offline usa o mesmo contrato

O redutor em [`packages/protocol/src/offline.ts`](../packages/protocol/src/offline.ts) aplica
exatamente esses `Command`s sobre exatamente esse `PlaybackState`, só que dentro do cliente e
sem rede. As diferenças são deliberadas:

- não há `activeDeviceId` para disputar: a constante `OFFLINE_DEVICE_ID` marca o dono;
- `transfer` é um no-op — não há para onde transferir;
- a duração de cada faixa vem de um callback (`durationOf`), porque os arquivos são do
  aparelho, não do catálogo; `-1` significa "não tenho mais este arquivo";
- `pruneOfflineSession` tira da fila arquivos que o ouvinte removeu, mantendo tocando o que
  sobreviveu.

Nenhuma mensagem de modo offline existe no protocolo de rede — é o ponto.
