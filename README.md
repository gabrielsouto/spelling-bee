# Spelling Bee 🐝

Jogo de soletração em inglês com abelhinha em pixel art, Web Speech API e progresso local. Funciona em qualquer hospedagem de arquivos estáticos. **Não precisa de PHP, MySQL nem Node.js no servidor.**

Esta versão inclui **20 palavras de demonstração** e permite cadastrar a lista da escola diretamente em **settings**. É possível praticar com a lista demo, apenas as palavras cadastradas ou ambas.

## Publicar

1. Gere o build com `npm ci` e `npm run build`. O jogo compilado fica em `dist/`.
2. Crie ou escolha a pasta do domínio/subdomínio onde o jogo ficará. Também funciona em uma subpasta, por exemplo `/spelling-bee/`.
3. Envie **todo o conteúdo de `dist/`** para essa pasta (SFTP, FTP ou o método da sua hospedagem). `index.html`, `words.json`, `favicon.svg` e `assets/` devem ficar juntos.
4. Habilite HTTPS no domínio. A captura do microfone exige contexto seguro. Não basta abrir o `index.html` com duplo clique no computador.
5. Abra o endereço HTTPS no navegador e clique em `start`. A permissão do microfone é solicitada ao clicar em `microphone`.
6. Use o botão de configurações para escolher a voz em inglês e testar “hello”.

Não há serviços em segundo plano, contas, chaves de API, banco de dados ou instalações a fazer na hospedagem. Só o conteúdo de `dist/` precisa ser enviado ao servidor.

## Cadastrar palavras e escolher a lista

1. Abra **settings** pelo botão no canto superior direito, na tela inicial ou após uma rodada.
2. Em **Register your words**, digite ou cole as palavras da escola. Separe por linha, espaço, vírgula ou ponto e vírgula. Edite o campo para adicionar ou remover palavras.
3. Em **Words to practice**, escolha **Demo word list**, **Registered words only** (apenas cadastradas) ou **Both: demo + registered words** (ambas).
4. Clique em **save words & selection**, feche as configurações e clique em **start**.

São aceitas até 10.000 palavras cadastradas, cada uma com 1 a 40 letras A–Z. Maiúsculas são normalizadas e duplicatas removidas, inclusive entre as duas listas ao selecionar ambas. O modo apenas cadastradas exige pelo menos uma palavra. Entradas inválidas não substituem a lista salva.

As palavras e a seleção ficam salvas no navegador e endereço atuais, inclusive após recarregar a página. Não há sincronização entre dispositivos; limpar os dados do site apaga esse cadastro. O backup de recordes não inclui o cadastro das palavras. Os três modos mantêm recordes separados; alterar a seleção volta à tela inicial para começar uma nova partida.

A lista demo fica em `public/words.json` e é copiada para `dist/words.json` no build. Sua substituição manual no servidor é opcional e não exige recompilar o site. O cadastro cotidiano é feito pelas configurações.

## Regras implementadas

- Tela inicial com abelhinha voando, `start` e `records`.
- Ao clicar em `start`, a abelhinha voa até a parte superior da área de jogo. Depois do voo, a contagem 3, 2, 1 aparece abaixo dela, seguida da leitura da palavra usando `SpeechSynthesis`. A preferência por movimento reduzido é respeitada.
- A caixa exibe as letras finais reconhecidas, sem mostrar a resposta antecipadamente.
- `microphone` inicia a escuta. Enquanto ouve, o mesmo botão vira `done spelling`, permitindo concluir mesmo uma resposta com menos letras que a palavra.
- Quando há letras suficientes, uma pequena pausa também permite concluir automaticamente: 1,5 segundo desde a última atividade de voz e 1,2 segundo desde o último resultado final.
- Só resultados **finais** são avaliados; transcrições provisórias podem mudar e nunca são pontuadas.
- `repeat please` pode ser usado **uma vez por palavra**. Continua visível, desativado após o uso. A fala da abelha interrompe a captura e pausa o contador; o tempo restante é preservado. A captura é retomada quando possível.
- O contador começa apenas quando o reconhecimento confirma que começou. São 10 segundos de silêncio, renovados com atividade de voz, não com a chegada da transcrição.
- Um erro de soletração ou o tempo de silêncio encerram a sequência. Aparecem `game over`, a grafia correta, o efeito de trombone sintetizado e `play again`.
- Cada acerto mostra `congratulations!`, salva o recorde imediatamente e permite seguir com `next word`.
- `records` mostra o melhor resultado, o total de acertos, palavras para praticar e as últimas 10 partidas encerradas. Até 50 partidas são preservadas no backup.
- Trocar de aba durante uma rodada pausa o jogo sem contabilizar erro.
- Erros técnicos e transcrições não interpretáveis interrompem a escuta sem perda da sequência. A criança tenta a mesma palavra novamente.

## Como as palavras difíceis são priorizadas

Cada palavra começa com peso 1. Um erro incrementa a dificuldade até o máximo de 4; o peso é `1 + 2 × dificuldade`, chegando a 9. Um acerto reduz a dificuldade em 1. O histórico de erros continua registrado mesmo quando a dificuldade volta a zero.

Uma palavra com dificuldade 1 tem três vezes o peso de uma palavra sem dificuldade no mesmo sorteio. A palavra imediatamente anterior é excluída do próximo sorteio quando a lista tem mais de uma palavra. A lista pode ser percorrida em ciclos indefinidamente: a sequência só termina com erro ou silêncio.

## Voz e limitações conhecidas

`SpeechRecognition` não é um reconhecedor especializado em crianças soletrando. Deve ser validado no aparelho e navegador que serão usados. A disponibilidade e a qualidade variam. O jogo detecta ausência de suporte e mostra uma mensagem em vez de usar um modo de digitação que alteraria a atividade proposta.

O parser aceita letras separadas e seus nomes em inglês, como `C A T`, `see ay tee`, `double u`, `zee` e `zed`. Como alguns serviços juntam uma sequência soletrada em uma palavra, uma transcrição inteira também é aceita quando corresponde **exatamente** à palavra da rodada. Não há correção aproximada: palavras parecidas ou transcrições não relacionadas continuam ambíguas e pedem uma nova tentativa sem registrar erro.

Mesmo um resultado final pode conter uma letra errada atribuída pelo serviço. Nenhum teste simulado garante precisão com a voz real. Recomenda-se ambiente silencioso e pronúncia clara de cada letra. Ruído alto ou a voz de outra pessoa pode renovar o contador: a detecção local de energia sonora complementa os eventos de voz do navegador, mas não identifica quem está falando.

A Web Speech API pode enviar o áudio ao serviço do navegador. Esta aplicação não grava, armazena nem envia áudio a um servidor próprio. A operação offline não é garantida. As vozes inglesas disponíveis dependem do dispositivo. O contador e a captura ficam suspensos enquanto a própria abelha fala para evitar que ela seja ouvida pelo jogo.

## Progresso e backups

Tudo é salvo em `localStorage`, no navegador e endereço atuais. Não há sincronização automática entre computadores, celulares, navegadores, HTTP/HTTPS ou domínios. Limpar dados do site pode apagar os recordes. A interface informa quando não consegue gravar o progresso.

Em `records`, use `export backup` e guarde o JSON. Para restaurar em outro aparelho com a mesma lista, use `import backup` e confirme a substituição. Backups de outro ID de lista são recusados. Não há nome, idade, gravações ou dados de identificação da criança nos backups.

## Desenvolvimento

Use Node.js 24 para executar os testes com TypeScript nativo:

```sh
npm ci
npm run dev
```

O servidor local serve para desenvolvimento. `localhost` permite usar o microfone. Um endereço HTTP de rede local não substitui HTTPS.

```sh
npm test
npm run build
```

O build gera `dist/`; envie o conteúdo dessa pasta à hospedagem para publicar alterações de código. A configuração `base: './'` suporta domínio ou subpasta. As fontes e a imagem da abelha são servidas pelo próprio site.

## Estrutura

```text
index.html             Interface e diálogos
src/main.ts            Estados do jogo e integração com a interface
src/engine.ts          Sorteio, recordes, parser e relógio de silêncio
src/audio.ts           Síntese, reconhecimento, medição local e efeitos
src/style.css          Layout responsivo e animações
public/words.json      Lista demo; cadastro adicional pelas configurações
public/assets/         Abelhinha, fontes e licenças
tests/                 Regras e fluxo com serviços de voz simulados
```

## Validação desta entrega

- Build de produção e verificação TypeScript.
- Testes automatizados de validação da lista, parsing de letras, pesos do sorteio, exclusão da palavra anterior, preservação de recordes e contador com pausa.
- Teste do fluxo da interface em DOM simulado: início, contagem, repetição única, acerto, silêncio, erro de soletração, transcrição ambígua, falha de rede e encerramento das capturas de áudio.
- Layout responsivo e preferência por movimento reduzido. Verificação local com Chrome headless em 1280, 375 e 320 pixels: contador abaixo da abelha, cadastro, persistência após recarregar, sorteio de palavras cadastradas e combinação das listas.
- Microfone físico, pronúncia, permissões e vozes de dispositivos reais ainda precisam de validação.

## GitHub

Código-fonte publicado em [github.com/gabrielsouto/spelling-bee](https://github.com/gabrielsouto/spelling-bee).

```sh
git clone https://github.com/gabrielsouto/spelling-bee.git
```

Não coloque tokens no código. `node_modules/` e `dist/` são excluídos pelo `.gitignore`; gere o build com `npm run build`.

## Créditos

- Abelhinha original criada por geração de imagem para este projeto.
- Efeitos de contagem, celebração e trombone sintetizados com Web Audio; não incluem gravação de terceiros.
- DM Sans e Space Grotesk: Google Fonts, sob SIL Open Font License. Os arquivos de licença acompanham as fontes em `public/assets/`.
- Tecnologias: TypeScript, Vite, APIs nativas do navegador; happy-dom é usado somente nos testes.

Documentação: [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API), [SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition), [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [Vite](https://vite.dev/guide/static-deploy.html).
