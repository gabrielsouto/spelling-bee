import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import ts from 'typescript';

test('game flow: countdown, repeat, spelling, timeout, records and speech faults',async t=>{
  const win=new Window({url:'https://spelling.example/',settings:{disableJavaScriptEvaluation:true,disableCSSFileLoading:true,disableJavaScriptFileLoading:true}});
  win.document.write(await readFile(new URL('../index.html',import.meta.url),'utf8'));
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date']});
  let now=0;
  t.mock.method(performance,'now',()=>now);
  win.setInterval=globalThis.setInterval as never; win.setTimeout=globalThis.setTimeout as never;
  win.clearInterval=globalThis.clearInterval as never; win.clearTimeout=globalThis.clearTimeout as never;
  Object.defineProperty(win,'isSecureContext',{value:true});
  const original=new Map<string,PropertyDescriptor|undefined>();
  const put=(key:string,value:unknown)=>{original.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});};
  let speechText='', activeTracks=0;
  class Utterance {text:string;onend:(()=>void)|null=null;constructor(text:string){this.text=text;}}
  const synthesis={getVoices:()=>[],addEventListener:()=>{},resume:()=>{},cancel:()=>{},speak:(u:Utterance)=>{if(u.text.trim())speechText=u.text;setTimeout(()=>u.onend?.(),10);}};
  const audioNode=()=>({connect:()=>{},disconnect:()=>{},start:()=>{},stop:()=>{},frequency:{value:0,setValueAtTime:()=>{},linearRampToValueAtTime:()=>{}},gain:{setValueAtTime:()=>{},linearRampToValueAtTime:()=>{},exponentialRampToValueAtTime:()=>{}}});
  class AudioContextMock {state='running';currentTime=0;destination={};resume=async()=>{};createOscillator=audioNode;createGain=audioNode;createBiquadFilter=audioNode;createMediaStreamSource=audioNode;createAnalyser=()=>({fftSize:1024,getFloatTimeDomainData:(data:Float32Array)=>data.fill(0)});}
  class RecognitionMock {
    static current:RecognitionMock;
    onstart:(()=>void)|null=null;onend:(()=>void)|null=null;onerror:((e:{error:string})=>void)|null=null;
    onspeechstart:(()=>void)|null=null;onspeechend:(()=>void)|null=null;
    onresult:((event:unknown)=>void)|null=null;
    results:{isFinal:boolean;length:number;0:{transcript:string;confidence:number}}[]=[];
    constructor(){RecognitionMock.current=this;}
    start(){setTimeout(()=>this.onstart?.(),10);}
    stop(){setTimeout(()=>this.onend?.(),10);}
    abort(){}
    emit(transcript:string,final=true){this.onspeechstart?.();this.results.push({isFinal:final,length:1,0:{transcript,confidence:.9}});this.onresult?.({resultIndex:this.results.length-1,results:this.results});}
  }
  Object.assign(win,{SpeechRecognition:RecognitionMock,AudioContext:AudioContextMock,speechSynthesis:synthesis});
  Object.defineProperty(win.navigator,'mediaDevices',{value:{getUserMedia:async()=>{activeTracks++;let stopped=false;return{getTracks:()=>[{stop:()=>{if(!stopped){stopped=true;activeTracks--;}}}]};}}});
  for(const [key,value] of Object.entries({window:win,Option:class { constructor(text:string,value:string) { const o=win.document.createElement("option"); o.textContent=text; o.value=value; return o; } },document:win.document,navigator:win.navigator,localStorage:win.localStorage,speechSynthesis:synthesis,SpeechSynthesisUtterance:Utterance,AudioContext:AudioContextMock,fetch:async()=>({ok:true,json:async()=>({id:'test',title:'Test',demo:true,language:'en-US',words:['cat','dog']})})}))put(key,value);
  t.after(async()=>{win.dispatchEvent(new win.Event('pagehide'));for(const [key,d] of original){if(d)Object.defineProperty(globalThis,key,d);else delete (globalThis as Record<string,unknown>)[key];}await win.happyDOM.abort();});
  const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  const advance=async(ms:number)=>{now+=ms;t.mock.timers.tick(ms);await flush();};
  const element=(id:string)=>win.document.getElementById(id)!;
  const state=()=>element('game-card').dataset.state;
  const click=(id:string)=>{(element(id) as unknown as {click():void}).click();};
  const saved=()=>JSON.parse(win.localStorage.getItem('spelling-bee:progress:test')!);
  let source=await readFile(new URL('../src/main.ts',import.meta.url),'utf8');
  source=source.replace("import './style.css';",'').replace("from './engine'",`from '${new URL('../src/engine.ts',import.meta.url).href}'`).replace("from './audio'",`from '${new URL('../src/audio.ts',import.meta.url).href}'`).replace('import.meta.env.BASE_URL',"'./'");
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);await flush();
  assert.equal(state(),'home');
  click('start-button');await flush();assert.equal(state(),'flying');
  assert.equal(element('countdown').hidden,true);
  await advance(1200);assert.equal(state(),'countdown');
  await advance(1000);assert.equal(element('countdown').textContent,'2');
  await advance(1000);await advance(1000);await advance(20);
  assert.equal(state(),'ready');assert.equal((element('letters') as unknown as {value:string}).value,'');
  click('repeat-button');await flush();await advance(20);assert.equal(state(),'ready');
  assert.equal((element('repeat-button') as unknown as {disabled:boolean}).disabled,true);
  click('mic-button');await flush();await advance(20);assert.equal(state(),'listening');
  assert.equal((RecognitionMock.current as unknown as {maxAlternatives:number}).maxAlternatives,5);
  // Chrome frequently collapses a spoken sequence such as C-A-T back to "cat".
  RecognitionMock.current.emit(speechText);click('mic-button');await advance(20);
  assert.equal(state(),'success');assert.equal(saved().best,1);assert.equal(activeTracks,0);
  click('next-button');await flush();await advance(1000);await advance(1000);await advance(1000);await advance(20);
  click('mic-button');await flush();await advance(20);
  await advance(4000);assert.equal(element('timer-label').textContent,'6s');
  click('repeat-button');await flush();await advance(20);await advance(20);
  assert.equal(state(),'listening');await advance(5000);assert.equal(state(),'listening');await advance(1100);
  assert.equal(state(),'gameover');assert.equal(saved().runs[0].reason,'silence');assert.equal(saved().best,1);assert.equal(activeTracks,0);
  click('next-button');await flush();await advance(1200);await advance(1000);await advance(1000);await advance(1000);await advance(20);
  click('mic-button');await flush();await advance(20);
  RecognitionMock.current.emit('the whole word');assert.equal(state(),'error');assert.equal(saved().runs.length,1);
  click('retry-button');await flush();await advance(20);assert.equal(state(),'listening');
  RecognitionMock.current.onerror?.({error:'network'});assert.equal(state(),'error');assert.equal(saved().runs.length,1);assert.equal(activeTracks,0);
  click('retry-button');await flush();await advance(20);
  RecognitionMock.current.emit('X X X');click('mic-button');await advance(20);
  assert.equal(state(),'gameover');assert.equal(saved().runs.length,2);assert.equal(saved().runs[0].reason,'spelling');
  click('home-button');assert.equal(state(),'home');assert.equal(element('header-best').textContent,'1');

  // Word registration lives in settings; invalid submissions leave the list intact.
  click('settings-button');
  const sourceSelect = element('word-source') as unknown as {value:string};
  const wordsInput = element('custom-words') as unknown as {value:string};
  const submitWords = () => element('word-settings-form').dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));
  sourceSelect.value='custom'; submitWords();
  assert.match(element('words-status').textContent!,/at least one/);
  assert.equal(win.localStorage.getItem('spelling-bee:words'),null);
  wordsInput.value='APPLE\napple, flower'; submitWords();
  assert.deepEqual(JSON.parse(win.localStorage.getItem('spelling-bee:words')!),{source:'custom',words:['apple','flower']});
  assert.match(element('list-label').textContent!,/Registered words · 2/);
  assert.equal(element('demo-tag').hidden,true);
  assert.equal(element('header-best').textContent,'0');
  (element('settings-dialog') as unknown as {close():void}).close();
  click('start-button');await flush();await advance(1200);await advance(1000);await advance(1000);await advance(1000);await advance(20);
  assert.ok(['apple','flower'].includes(speechText));
  click('home-button');click('settings-button');
  wordsInput.value='cat\nflower'; sourceSelect.value='both';submitWords();
  assert.match(element('list-label').textContent!,/Demo \+ registered words · 3/);
  assert.equal(element('demo-tag').textContent,'DEMO + REGISTERED WORDS');
  wordsInput.value='bad-word';submitWords();
  assert.match(element('words-status').textContent!,/letters/);
  assert.deepEqual(JSON.parse(win.localStorage.getItem('spelling-bee:words')!).words,['cat','flower']);
  wordsInput.value='cat\nflower';sourceSelect.value='demo';submitWords();
  assert.equal(element('header-best').textContent,'1');
  assert.match(element('list-label').textContent!,/Test · 2/);

  // Going home during takeoff cancels the pending round.
  (element('settings-dialog') as unknown as {close():void}).close();
  click('start-button');await flush();click('home-button');await advance(1200);
  assert.equal(state(),'home');
});
