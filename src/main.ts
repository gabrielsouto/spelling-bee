import './style.css';
import { emptyProgress, validateList, validateProgress, selectWord, recordCorrect, recordMiss, parseLetters, SilenceClock, parseCustomWords, buildWordList, type WordSettings, type WordSource, type Progress, type WordList } from './engine';
import { Sound, Voice, MicMeter, recognitionClass, type Recognition } from './audio';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, visible: boolean) => { $(id).hidden = !visible; };
const write = (id: string, text: string | number) => { $(id).textContent = String(text); };
const button = (id: string) => $<HTMLButtonElement>(id);
const delay = (ms: number) => new Promise<void>(r => setTimeout(r,ms));
type State = 'loading'|'home'|'flying'|'countdown'|'speaking'|'ready'|'listening'|'processing'|'success'|'gameover'|'error';

const sound = new Sound(), voice = new Voice(), meter = new MicMeter(), clock = new SilenceClock();
// Android Chrome gives the microphone to only one consumer (a parallel meter
// leaves recognition deaf) and repeats earlier results in continuous mode.
const isAndroid = /Android/i.test(navigator.userAgent);
let state: State = 'loading';
let list: WordList | null = null;
let demoList: WordList;
let wordSettings: WordSettings = { source: 'demo', words: [] };
let progress: Progress;
let word = '', previousWord = '', streak = 0, letters = '';
let repeated = false, token = 0, attempt = 0;
let recognition: Recognition | null = null;
let restarting = 0, startingTimeout = 0, processingTimeout = 0;
let lastSpeech = 0, lastResult = 0;
let speechSeen = false, finishing = false, recognitionFault = false;let retryKind: 'voice'|'mic'|'list' = 'list';
let resumeAfterVoice = false;
let pendingImport: Progress | null = null;

function storageKey() { return `spelling-bee:progress:${list!.id}`; }
function save() {
  try { localStorage.setItem(storageKey(),JSON.stringify(progress)); show('storage-warning',false); }
  catch { show('storage-warning',true); }
  refreshBests();
}
function refreshBests() { for (const id of ['header-best','side-best','records-best']) write(id,progress?.best ?? 0); }

function setState(next: State, message: string) {
  state = next; $('game-card').dataset.state = next;
  show('home-copy',next === 'home' || next === 'loading');
  show('speech-bubble',next === 'home' || next === 'loading');
  show('countdown',next === 'countdown');
  show('play-content',['countdown','speaking','ready','listening','processing','error'].includes(next));
  show('result',next === 'success' || next === 'gameover');
  show('home-actions',next === 'home' || next === 'loading');
  show('play-actions',['ready','speaking','listening','processing'].includes(next) || next === 'error' && retryKind === 'mic');
  show('result-actions',next === 'success' || next === 'gameover');
  show('error-actions',next === 'error' && retryKind !== 'mic');
  show('result-records',next === 'gameover');
  show('timer-row',next === 'listening' || next === 'processing');
  button('settings-button').disabled = !['home','gameover','success'].includes(next);
  button('start-button').disabled = !list || next !== 'home';
  button('records-button').disabled = !list;
  const micError = next === 'error' && retryKind === 'mic';
  button('mic-button').disabled = !['ready','listening'].includes(next) && !micError;
  button('repeat-button').disabled = repeated || !['ready','listening'].includes(next) && !micError;
  write('repeat-count',repeated ? '0' : '1');
  write('mic-label',next === 'listening' ? 'done spelling' : 'microphone');
  write('streak',String(streak).padStart(2,'0'));
  write('round-tag',next === 'home' ? "LET'S PRACTICE" : next === 'gameover' ? 'NICE TRY, LITTLE BEE' : `WORD ${streak + (next === 'success' ? 0 : 1)}`);
  write('game-message',message);
  write('tiny-note',next === 'listening' ? 'Tap done spelling when you finish. Speak each letter in English.' : 'One mistake ends the run. Every try helps you grow.');
  write('round-heading',next === 'speaking' ? 'Listen carefully…' : next === 'listening' ? "I'm listening!" : next === 'processing' ? 'Checking your letters…' : next === 'error' ? 'A little help, please' : 'Ready to spell?');
  $('sound-bars').classList.remove('hearing');
}

function updateLetters() {
  const input = $<HTMLInputElement>('letters');
  input.value = letters.split('').join(' ');
  // Long words scroll inside the field instead of overflowing the game.
  input.scrollLeft = input.scrollWidth;
}

function stopRecognition() {
  clearTimeout(restarting); clearTimeout(startingTimeout); clearTimeout(processingTimeout);
  attempt++;
  if (recognition) {
    recognition.onstart = recognition.onend = recognition.onerror = recognition.onresult = recognition.onspeechstart = recognition.onspeechend = null;
    try { recognition.abort(); } catch { /* already stopped */ }
    recognition = null;
  }
  meter.stop();
  clock.pause(performance.now());
  finishing = false;
}

function goHome() {
  token++; stopRecognition(); voice.cancel();
  streak = 0; letters = ''; updateLetters();
  if (!list) { void initialize(); return; }
  setState('home','Listen to the word. Spell it out loud.');
}

async function startRun() {
  if (!list || state !== 'home' && state !== 'gameover') return;
  void sound.unlock().catch(() => {}); voice.warmup();
  streak = 0;
  const flightToken = ++token;
  setState('flying','Your bee is flying over with a word…');
  await delay(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1200);
  if (flightToken !== token) return;
  await nextRound();
}

async function nextRound() {
  if (!list) return;
  stopRecognition(); voice.cancel();
  const thisToken = ++token;
  word = selectWord(list.words,progress.stats,previousWord); previousWord = word;
  letters = ''; repeated = false; finishing = false; clock.remaining = clock.limit; updateLetters();
  write('countdown','3');
  setState('countdown','Your bee has a word for you…');
  for (let i=3;i>=1;i--) {
    if (thisToken !== token) return;
    write('countdown',i); sound.cue('tick');
    await delay(1000);
  }
  if (thisToken !== token) return;
  await speakWord(false);
}

async function speakWord(resume: boolean) {
  const thisToken = token;
  resumeAfterVoice = resume;
  stopRecognition();
  setState('speaking',repeated ? 'One more listen. You can do this.' : 'Listen to your word.');
  const ok = await voice.speak(word);
  if (thisToken !== token) return;
  if (!ok) { technicalError('Your bee could not speak. Check the volume and try again.','voice'); return; }
  setState('ready',resume ? 'Ready to keep spelling? Tap microphone.' : 'Tap microphone, then say each letter in English.');
  // Resume capture after a repeat if the browser permits it. Permission failures
  // are technical errors; they never spend a life or increase word difficulty.
  if (resume) await beginListening(false);
}

async function repeatWord() {
  if (repeated || !['ready','listening'].includes(state) && !(state === 'error' && retryKind === 'mic')) return;
  const resume = state === 'listening';
  repeated = true;
  await speakWord(resume);
}

function technicalError(message: string, kind: typeof retryKind) {
  stopRecognition();
  retryKind = kind;
  setState('error',message);
  write('retry-button',kind === 'mic' ? 'microphone' : kind === 'voice' ? 'hear the word' : 'reload words');
  write('tiny-note','Your streak is safe. This does not count as a mistake.');
  button(kind === 'mic' ? 'mic-button' : 'retry-button').focus({preventScroll:true});
}

// Spelling without pauses makes speech services merge letters into a guessed word.
function uncertain() {
  letters = ''; updateLetters(); clock.remaining = clock.limit;
  technicalError("I couldn't catch each letter. Please spell it again with a short pause after each letter, like B… A… C… K.",'mic');
}

function voiceActivity() {
  if (state !== 'listening') return;
  const now = performance.now(); lastSpeech = now; speechSeen = true; clock.voice(now);
}

// Android has no energy meter, so the bars pulse on recognizer speech events instead.
let hearingTimer = 0;
function pulseHearing() {
  if (state !== 'listening') return;
  $('sound-bars').classList.add('hearing');
  clearTimeout(hearingTimer);
  hearingTimer = window.setTimeout(() => $('sound-bars').classList.remove('hearing'),700);
}

async function beginListening(fresh = true) {
  if (!['ready','error'].includes(state)) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { technicalError('The microphone needs a secure HTTPS website (or localhost). Open the hosted game to play.','mic'); return; }
  const Recognition = recognitionClass();
  if (!Recognition) { technicalError('This browser does not support speech recognition. Try a browser with Web Speech recognition, such as Chrome on a computer.','mic'); return; }
  const thisToken = token;
  stopRecognition();
  const thisAttempt = attempt;
  const remaining = fresh ? clock.limit : clock.remaining;
  setState('processing','Allow microphone access when your browser asks.');
  show('timer-row',false);
  try {
    await sound.unlock();
    if (token !== thisToken || attempt !== thisAttempt) return;
    if (!sound.context) throw new Error('No audio engine');
    const opened = isAndroid || await meter.start(sound.context, level => {
      if (level > .022) voiceActivity();
      if (state === 'listening') $('sound-bars').classList.toggle('hearing',level > .012);
    });
    if (!opened || token !== thisToken || attempt !== thisAttempt) return;
    clock.remaining = remaining;
    speechSeen = false; lastSpeech = performance.now(); lastResult = lastSpeech;
    launchRecognition(Recognition, thisToken, thisAttempt, true);
  } catch (e) {
    if (token !== thisToken || attempt !== thisAttempt) return;
    const name = e instanceof Error ? e.name : '';
    technicalError(name === 'NotAllowedError' ? 'Microphone access was not allowed. Enable it in your browser settings, then try again.' : name === 'NotFoundError' ? 'No microphone was found. Connect one and try again.' : 'The microphone could not start. Check that it is connected and available.','mic');
  }
}

function launchRecognition(Recognition: new () => Recognition, thisToken: number, thisAttempt: number, first: boolean) {
  if (token !== thisToken || attempt !== thisAttempt) return;
  const rec = new Recognition(); recognition = rec;
  // Extra alternatives often preserve separated letter names when the top result
  // has been collapsed into a whole dictionary word by the speech service.
  rec.lang = voice.language; rec.continuous = !isAndroid; rec.interimResults = true; rec.maxAlternatives = 5;
  let consumed = 0;
  recognitionFault = false;
  const valid = () => token === thisToken && attempt === thisAttempt && recognition === rec;
  startingTimeout = window.setTimeout(() => { if (valid()) technicalError('Speech recognition did not start. Check your connection and try again.','mic'); },8000);
  rec.onstart = () => {
    if (!valid()) return;
    clearTimeout(startingTimeout);
    if (first) {
      setState('listening','Say each letter. Tap done spelling when you finish.');
      clock.resume(performance.now());
    }
  };
  rec.onspeechstart = () => { voiceActivity(); if (isAndroid) pulseHearing(); };
  rec.onspeechend = voiceActivity;
  rec.onresult = event => {
    if (!valid() || !['listening','processing'].includes(state)) return;
    if (isAndroid) { voiceActivity(); pulseHearing(); }    // Interim text is deliberately never scored: engines can revise it later.
    for (let i=consumed;i<event.results.length;i++) {
      const result = event.results[i];
      if (!result.isFinal) break;
      consumed = i+1;
      // Match an exact remaining fragment as well as explicit letter names. This
      // handles services that return "cat" for C-A-T or "app" + "le" for APP-LE.
      const remainingWord = word.slice(letters.length);
      let parsed = parseLetters(result[0].transcript,remainingWord);
      for (let alternative=1; alternative<result.length && parsed.ambiguous; alternative++) {
        parsed = parseLetters(result[alternative].transcript,remainingWord);
      }
      lastResult = performance.now();
      if (parsed.ambiguous) { uncertain(); return; }
      letters += parsed.letters;
      if (letters.length > 80) { uncertain(); return; }
      updateLetters();
    }
  };
  rec.onerror = event => {
    if (!valid()) return;
    if (event.error === 'no-speech') return; // Our own ten-second clock owns this rule.
    recognitionFault = true;
    const messages: Record<string,string> = {
      'not-allowed':'Speech recognition was not allowed. Enable microphone and speech access in your browser.',
      'service-not-allowed':'The browser speech service is unavailable. Try another supported browser.',
      'network':'Speech recognition lost its connection. Check your internet and try again.',
      'audio-capture':'The microphone became unavailable. Check the connection and try again.',
      'language-not-supported':'This speech service does not support the selected English accent.'
    };
    technicalError(messages[event.error] ?? 'Speech recognition stopped unexpectedly. Please try again.','mic');
  };
  rec.onend = () => {
    if (!valid()) return;
    clearTimeout(startingTimeout);
    if (finishing) { clearTimeout(processingTimeout); completeSpelling(); return; }
    if (state === 'processing' && first) { technicalError('Speech recognition closed before it was ready. Please try again.','mic'); return; }
    if (state === 'listening' && !recognitionFault) {
      // Restart immediately: any delay here is a gap where audio is not being
      // captured at all, which can clip the letter the child is mid-way through
      // saying when the engine auto-ends a session.
      restarting = window.setTimeout(() => launchRecognition(Recognition,thisToken,thisAttempt,false),0);
    }
  };
  try { rec.start(); } catch { technicalError('The browser could not begin listening. Tap microphone to try again.','mic'); }
}

function finishSpelling() {
  if (state !== 'listening' || finishing) return;
  finishing = true;
  clock.pause(performance.now());
  meter.stop(); clearTimeout(restarting);
  setState('processing','Checking what the microphone heard…');
  processingTimeout = window.setTimeout(() => {
    if (state === 'processing' && finishing) technicalError('The speech service took too long to answer. Please spell this word again.','mic');
  },7000);
  // stop() asks for the last final transcript; abort() would throw it away.
  if (recognition) { try { recognition.stop(); } catch { completeSpelling(); } }
  else completeSpelling();
}

function completeSpelling() {
  if (!finishing) return;
  if (!letters) { uncertain(); return; }
  const correct = letters.toLowerCase() === word;
  stopRecognition();
  if (correct) {
    streak++; recordCorrect(progress,word,streak); save();
    write('result-kicker',streak === progress.best ? 'LOOK AT YOU GO!' : 'BEAUTIFULLY SPELLED');
    write('result-heading','congratulations!'); write('result-word',word.toUpperCase());
    write('result-detail',`${streak} ${streak === 1 ? 'word' : 'words'} in a row. Keep going!`);
    write('next-label','next word');
    setState('success','That’s right! Your next word is waiting.');
    sound.cue('win'); button('next-button').focus({preventScroll:true});
  } else gameOver('spelling');
}

function gameOver(reason: 'spelling'|'silence') {
  if (state === 'gameover') return;
  stopRecognition(); voice.cancel();
  recordMiss(progress,word,streak,reason); save();
  write('result-kicker',reason === 'silence' ? '10 SECONDS OF SILENCE' : 'A WORD TO PRACTICE');
  write('result-heading','game over'); write('result-word',word.toUpperCase());
  write('result-detail',reason === 'spelling' ? `Letters heard: ${letters.split('').join(' ')}. Correct spelling above.` : 'Here is the spelling for next time.');
  write('next-label','play again');
  setState('gameover',`${streak} ${streak === 1 ? 'word' : 'words'} in a row. Let’s try for one more!`);
  sound.cue('sad'); button('next-button').focus({preventScroll:true});
}

// Silence is measured from local audio/speech activity, not the arrival of text.
// The native recognition service can stop earlier; we restart it without
// resetting this clock. Repeats preserve the remaining time while speech is paused.
window.setInterval(() => {
  if (state !== 'listening') return;
  const now = performance.now();
  const remaining = clock.tick(now);
  const seconds = Math.ceil(remaining/1000);
  write('timer-label',`${seconds}s`); $('timer-fill').style.width = `${remaining/100}%`;
  $('timer-track').setAttribute('aria-valuenow',String(seconds)); $('timer-track').classList.toggle('urgent',seconds <= 3);
  // Wait for a quiet gap after final letters. The child may also explicitly
  // finish a shorter spelling using the microphone button.
  if (letters.length >= word.length && now-lastSpeech > 1500 && now-lastResult > 1200) { finishSpelling(); return; }
  if (remaining <= 0) {
    if (speechSeen && now-lastResult > 6000 && !letters) {
      technicalError('I heard your voice, but the speech service did not return any letters. Please try again.','mic');
    } else gameOver('silence');
  }
},100);

function renderRecords() {
  if (!list) return;
  refreshBests(); write('records-total',progress.total);
  const practice = $('practice-words'); practice.replaceChildren();
  const difficult = Object.entries(progress.stats).filter(([,s]) => s.difficulty > 0).sort((a,b) => b[1].difficulty-a[1].difficulty);
  if (!difficult.length) { const p = document.createElement('p'); p.className='empty-record'; p.textContent='No tricky words yet. Keep spelling!'; practice.append(p); }
  for (const [w,s] of difficult) { const chip = document.createElement('span'); chip.className='word-chip'; chip.textContent=w; chip.title=`${s.errors} ${s.errors === 1 ? 'miss' : 'misses'} · ${1+s.difficulty*2}× draw weight`; practice.append(chip); }
  const runs = $('runs'); runs.replaceChildren();
  if (!progress.runs.length) { const p = document.createElement('p'); p.className='empty-record'; p.textContent='Your finished runs will appear here.'; runs.append(p); }
  for (const run of progress.runs.slice(0,10)) {
    const row=document.createElement('div'); row.className='run-row';
    const info=document.createElement('div'); info.textContent=new Date(run.date).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
    const detail=document.createElement('small'); detail.textContent=`Practice: ${run.missed} · ${run.reason === 'silence' ? 'silence timeout' : 'spelling'}`;
    info.append(detail); const score=document.createElement('b'); score.textContent=`${run.score} ${run.score === 1 ? 'word' : 'words'}`; row.append(info,score); runs.append(row);
  }
}
function openRecords() { if (!list) return; renderRecords(); $<HTMLDialogElement>('records-dialog').showModal(); }

function populateVoices() {
  const select=$<HTMLSelectElement>('voice-select'); select.replaceChildren(new Option('Automatic English voice',''));
  for (const v of voice.voices()) select.add(new Option(`${v.name} · ${v.lang}`,v.voiceURI));
  select.value=voice.voiceURI;
}
function saveSettings() {
  try { localStorage.setItem('spelling-bee:settings',JSON.stringify({language:voice.language,voiceURI:voice.voiceURI,effects:sound.enabled})); } catch { /* progress storage has its own visible warning */ }
}
function loadSettings() {
  try {
    const s=JSON.parse(localStorage.getItem('spelling-bee:settings') ?? '{}');
    if (s && ['en-US','en-GB'].includes(s.language)) voice.language=s.language;
    if (s && typeof s.voiceURI === 'string') voice.voiceURI=s.voiceURI;
    if (s && typeof s.effects === 'boolean') sound.enabled=s.effects;
  } catch { /* Use defaults when preferences are unavailable. */ }
  $<HTMLSelectElement>('accent').value=voice.language; $<HTMLInputElement>('effects').checked=sound.enabled;
  populateVoices();
}

function activateWordList(nextList: WordList) {
  list = nextList;
  previousWord = '';
  progress = emptyProgress(list.id);
  try {
    const saved = localStorage.getItem(storageKey());
    if (saved) progress = validateProgress(JSON.parse(saved),list);
  } catch { show('storage-warning',true); }
  refreshBests();
  write('list-label',`${list.title} · ${list.words.length} ${list.words.length === 1 ? 'word' : 'words'}`);
  show('demo-tag',list.demo);
  write('demo-tag',wordSettings.source === 'both' ? 'DEMO + REGISTERED WORDS' : 'DEMO WORD LIST');
}

function populateWordSettings() {
  $<HTMLSelectElement>('word-source').value = wordSettings.source;
  $<HTMLTextAreaElement>('custom-words').value = wordSettings.words.join('\n');
  write('words-count',`${wordSettings.words.length} registered ${wordSettings.words.length === 1 ? 'word' : 'words'} · ${demoList.words.length} demo ${demoList.words.length === 1 ? 'word' : 'words'}`);
}

async function initialize() {
  try {
    const response=await fetch(`${import.meta.env.BASE_URL}words.json`,{cache:'no-cache'});
    if (!response.ok) throw new Error('Word list missing');
    demoList=validateList(await response.json());
    voice.language=demoList.language; loadSettings();
    try {
      const saved = JSON.parse(localStorage.getItem('spelling-bee:words') ?? 'null');
      if (saved) {
        if (!['demo','custom','both'].includes(saved.source) || !Array.isArray(saved.words) || !saved.words.every((w: unknown) => typeof w === 'string')) throw new Error('Invalid saved words');
        const settings: WordSettings = { source: saved.source, words: parseCustomWords(saved.words.join('\n')) };
        buildWordList(demoList,settings);
        wordSettings = settings;
      }
    } catch { write('words-status','Saved words could not be loaded. Please register them again.'); }
    activateWordList(buildWordList(demoList,wordSettings));
    setState('home','Listen to the word. Spell it out loud.');
    if (!recognitionClass()) write('game-message','This browser may not support the microphone. Check voice & sound settings before playing.');
  } catch { technicalError('The word list could not be loaded. Check words.json and reload.','list'); }
}

button('start-button').onclick=()=>{void startRun();};
button('home-button').onclick=goHome;
button('back-button').onclick=goHome;
button('records-button').onclick=openRecords;
button('result-records').onclick=openRecords;
button('repeat-button').onclick=()=>{void repeatWord();};
button('mic-button').onclick=()=>{ if (state === 'listening') finishSpelling(); else if (state === 'ready') void beginListening(); else if (state === 'error' && retryKind === 'mic') {letters='';updateLetters();void beginListening();} };
button('next-button').onclick=()=>{if (state === 'gameover') void startRun(); else if (state === 'success') {void sound.unlock().catch(()=>{}); void nextRound();}};
button('retry-button').onclick=()=>{
  if (retryKind === 'list') {void initialize(); return;}
  if (retryKind === 'voice') {voice.warmup(); void speakWord(resumeAfterVoice); return;}
  // Restart the current spelling, preserving the word, repeat allowance and score.
  letters=''; updateLetters(); void beginListening();
};
button('settings-button').onclick=()=>{populateVoices(); populateWordSettings(); $<HTMLDialogElement>('settings-dialog').showModal();};
$<HTMLFormElement>('word-settings-form').onsubmit=event=>{
  event.preventDefault();
  if (!['home','success','gameover'].includes(state)) return;
  try {
    const settings: WordSettings = { source: $<HTMLSelectElement>('word-source').value as WordSource, words: parseCustomWords($<HTMLTextAreaElement>('custom-words').value) };
    const nextList = buildWordList(demoList,settings);
    try { localStorage.setItem('spelling-bee:words',JSON.stringify(settings)); }
    catch { write('words-status','Could not save your words. Allow browser storage and try again.'); return; }
    wordSettings = settings;
    activateWordList(nextList);
    goHome();
    populateWordSettings();
    write('words-status',`Saved! ${list!.words.length} ${list!.words.length === 1 ? 'word' : 'words'} ready to practice.`);
  } catch (error) { write('words-status',error instanceof Error ? error.message : 'Check your words and try again.'); }
};
button('test-voice').onclick=async()=>{button('test-voice').disabled=true; const ok=await voice.speak('hello'); button('test-voice').disabled=false; write('test-voice',ok ? 'hear “hello” again' : 'Voice unavailable — try again');};
$<HTMLSelectElement>('accent').onchange=event=>{voice.language=(event.target as HTMLSelectElement).value;voice.voiceURI='';populateVoices();saveSettings();};
$<HTMLSelectElement>('voice-select').onchange=event=>{voice.voiceURI=(event.target as HTMLSelectElement).value;saveSettings();};
$<HTMLInputElement>('effects').onchange=event=>{sound.enabled=(event.target as HTMLInputElement).checked;saveSettings();};
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog')?.close());
$<HTMLDialogElement>('settings-dialog').addEventListener('close',()=>voice.cancel());
$<HTMLDialogElement>('records-dialog').addEventListener('close',()=>{pendingImport=null;show('import-confirm',false);});
if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged',populateVoices);
button('export-button').onclick=()=>{
  if (!list) return;
  const blob=new Blob([JSON.stringify(progress,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=`spelling-bee-${list.id}-backup.json`;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  write('backup-status','Backup exported. Keep it somewhere safe.');
};
button('import-button').onclick=()=>{$<HTMLInputElement>('import-file').value='';$<HTMLInputElement>('import-file').click();};
$<HTMLInputElement>('import-file').onchange=async event=>{
  const file=(event.target as HTMLInputElement).files?.[0]; if (!file || !list) return;
  try {
    if (file.size>1000000) throw new Error('Backup too large');
    pendingImport=validateProgress(JSON.parse(await file.text()),list); show('import-confirm',true);
    write('backup-status',`Backup found: best streak ${pendingImport.best}, total correct ${pendingImport.total}.`);
  } catch { pendingImport=null;show('import-confirm',false);write('backup-status','Could not import this file. Use a valid backup for the current word list.'); }
};
button('confirm-import').onclick=()=>{if (!pendingImport) return;progress=pendingImport;pendingImport=null;save();renderRecords();show('import-confirm',false);write('backup-status','Progress restored.');};
button('cancel-import').onclick=()=>{pendingImport=null;show('import-confirm',false);write('backup-status','Import cancelled. Your progress has not changed.');};

document.addEventListener('visibilitychange',()=>{
  if (!document.hidden) return;
  if (state === 'flying') { goHome(); return; }
  if (['listening','processing','ready','speaking','countdown'].includes(state)) {
    token++;voice.cancel();technicalError('The game paused while you were away. Your streak is safe.','voice');resumeAfterVoice=false;
  }
});
window.addEventListener('pagehide',()=>{token++;stopRecognition();voice.cancel();});
void initialize();
