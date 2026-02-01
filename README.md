# Shorts AI

Transforme vídeos do YouTube em shorts automaticamente com IA.

## Funcionalidades

- Extrai vídeos e legendas do YouTube
- Usa IA (GPT-4) para analisar o conteúdo e criar roteiro
- Gera narração com Text-to-Speech (ElevenLabs ou OpenAI)
- Edita automaticamente o vídeo em formato vertical (9:16)
- Exporta pronto para TikTok, Reels e YouTube Shorts

## Requisitos

- Node.js 18+
- FFmpeg
- yt-dlp
- Deno (para yt-dlp)
- Chaves de API (OpenAI e/ou ElevenLabs)

## Instalação

```bash
npm install
```

## Configuração

1. Copie `.env.example` para `.env`:
```bash
cp .env.example .env
```

2. Configure as chaves de API no `.env`:
```
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=...  # opcional
```

## Problema com YouTube (Bot Detection)

O YouTube bloqueia requisições de servidores/datacenters (como Gitpod, AWS, etc.) detectando-os como bots.

### Solução: Usar cookies do YouTube

1. Instale a extensão [Get cookies.txt LOCALLY](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc) no Chrome

2. Acesse youtube.com e faça login na sua conta

3. Clique na extensão e exporte os cookies

4. Salve o arquivo como `cookies.txt` na raiz do projeto

5. Reinicie o servidor

### Alternativa: Rodar localmente

O app funciona sem problemas quando rodado no seu computador local, pois o YouTube não bloqueia IPs residenciais.

```bash
npm run dev
```

## Uso

1. Acesse http://localhost:3000
2. Cole o link do YouTube
3. Aguarde o processamento
4. Baixe o short gerado

## Arquitetura

```
src/
├── app/
│   ├── page.tsx              # Interface principal
│   └── api/
│       ├── extract/          # Extrai vídeo + legendas
│       ├── analyze/          # IA cria roteiro
│       ├── generate/         # Gera narração + edita
│       └── download/         # Download do resultado
└── lib/
    ├── youtube.ts            # yt-dlp, legendas, Whisper
    ├── ai.ts                 # GPT-4 para roteiro
    ├── tts.ts                # ElevenLabs/OpenAI TTS
    └── video.ts              # FFmpeg para edição
```

## Licença

MIT
