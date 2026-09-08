# Identidade do ecossistema Ishtar Sink

> Referência para nomear e desenhar cada novo projeto open source do ecossistema. Cole a
> seção **"Bloco para colar em um novo prompt"** no início do prompt-mãe de qualquer app
> novo, antes de descrever o que ele faz.
>
> Nasceu junto do [Nebula](../README.md), o primeiro produto do ecossistema — é dele que
> vêm os valores concretos usados aqui. **Este arquivo descreve uma convenção do
> ecossistema, não é específico do Nebula**: vale a pena migrá-lo depois para um repositório
> próprio quando houver um segundo produto.

## A organização: Ishtar Sink

**A regra de nomeação dos produtos não vale para a organização.** São problemas diferentes:
o nome de um produto é lido e precisa explicar o que ele faz; o nome da organização é
*digitado* — em URL, em `git clone`, em escopo de pacote, em import — e precisa antes de
tudo ser fácil de lembrar e de escrever. Por isso a organização não precisa justificar
metáfora funcional nenhuma.

O nome vem do universo de **Destiny**, por significado pessoal de quem mantém o projeto. O
Ishtar Sink é a região de Vênus onde ficava a Ishtar Collective, a organização científica da
Era de Ouro dedicada a investigar e **arquivar** conhecimento — que é a razão de a referência
ter surgido: investigação aberta e conhecimento preservado, não poder nem conquista.

Por que este termo e não "Ishtar Collective", que era a primeira escolha:

- **`ishtar-collective.net` já existe** — é o arquivo de lore de Destiny mantido pela
  comunidade, ele próprio um recurso livre e gratuito. Usar o nome criaria confusão direta e
  pegaria carona na boa vontade de outro projeto livre. Incompatível com a premissa do
  ecossistema de não causar dano a ninguém.
- **Encurta de 17 para 11 caracteres** no handle (`ishtar-sink`), o que importa num nome que
  é digitado o tempo todo.

O termo também passa nas duas verificações que a organização precisa cumprir:

1. **Não é um corpo celeste.** É uma região, um lugar. Se os produtos são corpos celestes, a
   organização sendo outro faria parecer que ela é o produto principal e os demais, satélites
   dela. Uma bacia onde as coisas se acumulam é justamente a relação certa com os produtos.
2. **Fácil de digitar**: duas palavras curtas, grafia sem ambiguidade, pronúncia estável em
   português e inglês.

**Bônus que dispensa renomear nada**: Ishtar Terra é uma região real de Vênus. O nome já é
astronômico por origem, então os produtos seguem a convenção de astronomia sem nenhum atrito
— Nebula continua coerente ao lado dele.

**Ressalva conhecida e aceita**: em software, "sink" tem o sentido técnico de "para onde o
dado vai e não volta", oposto de "source" — um eco meio infeliz num ecossistema *open
source*. Foi pesado contra a leitura alternativa (uma bacia onde as coisas se reúnem) e
contra o fato de o termo ser neutro para o público em português, e considerado aceitável.

Histórico da busca anterior, encerrada: Cosmodrome, Gantry, Trajectory, Perigee e Ignition
saíram por indisponibilidade ou por não agradarem; Atlas, Axis, Parsec, Apex e Almanac eram
fáceis mas todos disputados. A conclusão que fechou essa linha: **nessa faixa de tamanho,
toda palavra fácil e temática já está registrada** — sempre cede um dos quatro critérios. Foi
o que levou a buscar o nome fora do jogo de metáforas, no significado pessoal.

## Como nomear um novo produto

Regra dupla, sem exceção: o nome precisa carregar **(a)** o tema do ecossistema
(astronomia) **e (b)** uma metáfora funcional específica daquele produto — não "soa
espacial", mas "o fenômeno real descreve o que o software faz". Um nome que só cumpre (a) é
decoração; um nome que só cumpre (b) quebra a família.

Checklist antes de fechar um nome:

1. O mecanismo físico do termo corresponde à mecânica central do produto (não à categoria
   genérica dele — "app de produtividade" não é mecânica, "várias peças formando um padrão"
   é)?
2. Curto, fácil de pronunciar em português e inglês, sem caractere que quebre em URL ou
   nome de pacote?
3. `npm view <nome>`, domínio e organização/repositório no GitHub livres, ou variação
   aceitável (`<nome>-app`, `use<nome>`) se não estiverem?
4. Não colide com um projeto open source grande já usando o termo?

**Único nome decidido até agora:**

| Produto | Termo | Por que se qualifica |
|---|---|---|
| **Nebula** | nuvem de gás e poeira que forma estrelas | player de música — organiza mídia solta em biblioteca; nascimento a partir de partes dispersas |

## Sistema visual: paleta única em todo o ecossistema

Decisão deliberada: **todo produto usa exatamente a mesma paleta**, não uma variação por
app. Prioriza reconhecimento de marca forte sobre diferenciação visual entre produtos — a
identidade visual diz "isto é Ishtar Sink", o nome e o ícone dizem qual produto é.

Valores em produção, tirados de [`packages/theme/src/index.ts`](../packages/theme/src/index.ts):

```ts
export const colors = {
  // Fundo violeta quase preto — mais escuro que o cinza do Spotify, para os acentos roxos brilharem.
  bg: '#0A0713',
  bgElevated: '#120C22',
  surface: '#1A1130',
  surfaceHover: '#241740',
  surfaceMuted: '#150F28',
  border: '#2E1F52',

  primary: '#A855F7',
  primaryBright: '#C084FC',
  primaryDeep: '#7C3AED',
  accent: '#EC4899',
  accentSoft: '#F472B6',

  text: '#F6F2FF',
  textMuted: '#A99CC8',
  textFaint: '#6E6190',

  success: '#34D399',
  danger: '#FB7185',
};

export const gradients = {
  brand: ['#A855F7', '#EC4899'],   // roxo → rosa — o gradiente de marca
  deep: ['#7C3AED', '#A855F7'],
  night: ['#1A1130', '#0A0713'],
};
```

Escalas de forma e espaço, também compartilhadas:

```ts
export const radii = { sm: 8, md: 12, lg: 18, xl: 26, pill: 999 };
export const space = (n: number) => n * 4; // grade de 4px
```

**Regra prática**: todo produto novo importa o pacote de tema compartilhado (hoje
`packages/theme` dentro do Nebula, a ser extraído para a organização) em vez de redeclarar
essas cores. Um valor mudado no pacote muda em todos os produtos de uma vez — é a garantia de
que a paleta não diverge com o tempo.

### O truque de cor determinística por item

Onde o produto tem uma coleção de itens sem imagem própria (faixas sem capa, no Nebula —
mas o mesmo serve pra projetos sem ícone, entradas de diário sem humor definido, etc.), usa
um hash simples do id pra escolher sempre o mesmo par de cores daquele item, sem guardar
nada:

```ts
export const artPalettes: Array<[string, string]> = [
  ['#A855F7', '#EC4899'], ['#7C3AED', '#2DD4BF'], ['#F472B6', '#8B5CF6'],
  ['#6366F1', '#A855F7'], ['#DB2777', '#7C3AED'], ['#8B5CF6', '#38BDF8'],
  ['#C026D3', '#F59E0B'], ['#4C1D95', '#EC4899'], ['#9333EA', '#22D3EE'],
  ['#E879F9', '#6D28D9'],
];

export function paletteFor(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return artPalettes[h % artPalettes.length];
}
```

Mesmo id → mesma cor em todo cliente, sem round-trip ao servidor nem estado extra.

## Tipografia

Fonte **Outfit** (geométrica, sans-serif), com uma regra de tracking que já aparece em todo
o Nebula ([`apps/web/src/styles.css`](../apps/web/src/styles.css)):

- **Títulos grandes**: peso 700–800, `letter-spacing` **negativo** (`-0.4px` a `-1.6px`
  conforme o tamanho sobe) — aperta o texto grande, evita o efeito "solto".
- **Rótulos pequenos em caixa alta** ("eyebrow", badges, seções): peso 600, `letter-spacing`
  **positivo** (`0.9px` a `1.4px`) — abre o texto pequeno, mantém legibilidade em maiúsculas.

```css
font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;

.page-title      { font-size: 44px; font-weight: 800; letter-spacing: -1.6px; line-height: 1.05; }
.section-title   { font-size: 21px; font-weight: 700; letter-spacing: -0.5px; }
.page-eyebrow    { font-size: 12px; font-weight: 600; letter-spacing: 1.4px; text-transform: uppercase; }
```

## Bloco para colar em um novo prompt

```markdown
## Identidade do ecossistema Ishtar Sink

Este produto pertence ao ecossistema Ishtar Sink (github.com/ishtar-sink). Duas regras
não-negociáveis:

1. **Nome do produto**: já decidido como "<NOME>" — termo de astronomia cujo fenômeno real
   mapeia para a mecânica central do produto (ver docs/identidade-ecossistema.md do Nebula
   para o precedente e o checklist, caso o nome ainda não esteja fechado).

2. **Identidade visual**: usar a paleta e os tokens do ecossistema tal como estão, sem criar
   uma paleta própria para este produto.
   - Fundo violeta quase preto (`#0A0713`), superfícies em `#1A1130`/`#241740`,
     texto em `#F6F2FF`/`#A99CC8`/`#6E6190`.
   - Marca: gradiente roxo → rosa (`#A855F7` → `#EC4899`).
   - Fonte Outfit; títulos grandes com letter-spacing negativo, rótulos pequenos em
     caixa alta com letter-spacing positivo.
   - Raios de borda: 8/12/18/26px, pill para badges e botões redondos.
   - Se houver itens sem imagem própria (cards, avatares, tags), gerar a cor a partir de
     um hash determinístico do id, não de estado salvo — ver "cor determinística por item"
     no doc de identidade.
```
