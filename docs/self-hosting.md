# Self-hosting

Como manter o servidor no ar para a casa inteira. O servidor é um processo Node só — sem
banco externo, sem container obrigatório, sem dependência nativa para compilar.

## Requisitos

- **Node 22 ou superior.** O servidor usa `node:sqlite` (embutido) e roda os arquivos `.ts`
  direto, sem passo de build.
- **pnpm** para instalar as dependências.
- Espaço em disco para o catálogo. O modo offline dos clientes **não** ocupa nada aqui: esses
  arquivos ficam em cada aparelho.

## Subindo

```bash
pnpm install
pnpm seed                          # opcional: gera o catálogo de demonstração
pnpm --filter @nebula/server start # só o servidor, sem recarregar a cada alteração
```

(`pnpm server` faz a mesma coisa com `--watch`, para desenvolvimento.)

O servidor escuta em `0.0.0.0:4000`, então já responde na rede local. Confira com:

```bash
curl http://localhost:4000/api/health
```

## Servindo o front

Em produção o front é estático. Compile e sirva com qualquer servidor de arquivos:

```bash
pnpm build:web                          # gera apps/web/dist
pnpm --filter @nebula/admin build       # gera apps/admin/dist
```

O front descobre a API pelo host da própria página na porta 4000. Se você servir o front em
outra origem, aponte com `VITE_API_URL` na hora do build, ou use a engrenagem no app (a
configuração fica no navegador, por aparelho).

## Variáveis de ambiente

| Variável | Padrão | Para quê |
|---|---|---|
| `NEBULA_PORT` | `4000` | porta do servidor |
| `NEBULA_HOST` | `0.0.0.0` | interface de escuta |
| `NEBULA_CATALOG_DIR` | `media/catalog` | pasta do catálogo curado |
| `NEBULA_DATA_DIR` | `apps/server/data` | banco SQLite |
| `NEBULA_ADMIN_TOKEN` | *(vazio)* | exige token no backoffice quando definido |
| `NEBULA_YTDLP` | `yt-dlp` | caminho do `yt-dlp`, quando não está no `PATH` |
| `NEBULA_FFMPEG` | `ffmpeg` | caminho do `ffmpeg`, quando não está no `PATH` |
| `VITE_API_URL` | *(derivado do host)* | força a URL da API no build do web/backoffice |

## Importação da web (opcional)

A aba *Importar da web* do backoffice depende de duas ferramentas externas, que o Nebula não
distribui. Sem elas o resto do sistema funciona normalmente — a aba só mostra o que falta.

```bash
# Debian/Ubuntu
sudo apt install ffmpeg && sudo pip install -U yt-dlp
# macOS
brew install yt-dlp ffmpeg
# Windows
winget install yt-dlp.yt-dlp Gyan.FFmpeg
```

O `yt-dlp` envelhece rápido, porque os sites mudam; atualize-o quando os downloads começarem a
falhar. Rodando como serviço, lembre que o `PATH` do systemd é curto: aponte `NEBULA_YTDLP` e
`NEBULA_FFMPEG` para o caminho completo se a detecção falhar.

## Como serviço

### systemd (Linux)

```ini
# /etc/systemd/system/nebula.service
[Unit]
Description=Nebula
After=network.target

[Service]
Type=simple
User=nebula
WorkingDirectory=/opt/nebula
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning apps/server/src/index.ts
Environment=NEBULA_ADMIN_TOKEN=troque-isto
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now nebula
```

### launchd (macOS)

Um `~/Library/LaunchAgents/com.nebula.server.plist` com `ProgramArguments` apontando para o
mesmo comando e `RunAtLoad`/`KeepAlive` ligados. Carregue com
`launchctl load -w ~/Library/LaunchAgents/com.nebula.server.plist`.

## Atrás de um proxy reverso

O servidor fala HTTP e WebSocket na **mesma porta**, no caminho `/ws`. O proxy precisa
encaminhar o upgrade:

```nginx
location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;

    # O streaming usa requisições Range; buffer no proxy atrapalha o seek.
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

Servindo por HTTPS, o front usará `wss://` automaticamente — ele deriva o esquema do
protocolo da página.

## Backup

Duas coisas guardam estado:

| Caminho | O que é | Precisa de backup? |
|---|---|---|
| `apps/server/data/nebula.db` | playlists e o índice de faixas | **sim** — é o único lugar onde as playlists vivem |
| `media/catalog/` | os arquivos de áudio e o `catalog.json` | sim, se o catálogo não for regenerável |

O `catalog.json` é o registro vivo: o backoffice o reescreve, e no boot o servidor sincroniza
o banco com ele. Restaurar a pasta `media/catalog` inteira restaura o catálogo.

As bibliotecas offline dos clientes **não** têm backup no servidor — por definição, elas nunca
saem do aparelho.

## Segurança

O padrão é pensado para rede doméstica: sem autenticação, escutando em toda a interface.
Antes de expor à internet:

1. **Defina `NEBULA_ADMIN_TOKEN`.** Sem ele, qualquer um que alcance a porta pode alterar o
   catálogo.
2. **Ponha atrás de HTTPS.** Além do óbvio, alguns recursos do navegador (como
   `crypto.randomUUID`) só existem em contexto seguro; o cliente tem alternativa, mas o
   ambiente seguro é o certo.
3. **Lembre que a API de reprodução é aberta.** Qualquer cliente conectado pode comandar o
   aparelho ativo — é o recurso, não um bug. Restrinja no nível da rede ou do proxy.
