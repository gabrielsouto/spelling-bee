import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateList, emptyProgress, validateProgress, selectWord, recordCorrect, recordMiss, parseLetters, SilenceClock, parseCustomWords, buildWordList } from '../src/engine.ts';

const list = validateList({ id:'school-2026', title:'School list', demo:false, language:'en-US', words:['Cat','dog','bee','cat'] });

test('registered words accept separators, normalize duplicates and validate limits',()=>{
  assert.deepEqual(parseCustomWords(' Apple\nBEE, apple;friend\tcat '),['apple','bee','friend','cat']);
  assert.deepEqual(parseCustomWords('  '),[]);
  for (const invalid of ['hello-world','abc123','café','a'.repeat(41),Array(10001).fill('bee').join('\n')]) assert.throws(()=>parseCustomWords(invalid));
});

test('each source draws only its selected words and both removes duplicates',()=>{
  const demo = {...list,demo:true};
  const words = ['apple','cat'];
  assert.deepEqual(buildWordList(demo,{source:'demo',words}).words,demo.words);
  const custom = buildWordList(demo,{source:'custom',words});
  const both = buildWordList(demo,{source:'both',words});
  assert.deepEqual(custom.words,['apple','cat']);
  assert.equal(custom.demo,false);
  assert.deepEqual(both.words,['cat','dog','bee','apple']);
  assert.equal(new Set([demo.id,custom.id,both.id]).size,3);
  assert.throws(()=>buildWordList(demo,{source:'custom',words:[]}));
  assert.deepEqual(buildWordList(demo,{source:'both',words:[]}).words,demo.words);
});

test('school list stays fixed, deduplicates words and rejects invalid entries',()=>{
  assert.deepEqual(list.words,['cat','dog','bee']);
  assert.throws(()=>validateList({...list,words:[]}));
  assert.throws(()=>validateList({...list,words:['hello world']}));
});
test('recognizes English letter names and exact collapsed-word transcripts',()=>{
  assert.deepEqual(parseLetters('C, A, T.'),{letters:'CAT',ambiguous:false});
  assert.deepEqual(parseLetters('bee ee ee'),{letters:'BEE',ambiguous:false});
  assert.deepEqual(parseLetters('double u, eye, en, dee'),{letters:'WIND',ambiguous:false});
  assert.deepEqual(parseLetters('zee zed'),{letters:'ZZ',ambiguous:false});
  assert.equal(parseLetters('cat').ambiguous,true);
  assert.equal(parseLetters('CAT').ambiguous,true);
  assert.deepEqual(parseLetters('cat','cat'),{letters:'CAT',ambiguous:false});
  assert.deepEqual(parseLetters('CAT.','cat'),{letters:'CAT',ambiguous:false});
  assert.deepEqual(parseLetters('bee','bee'),{letters:'BEE',ambiguous:false});
  assert.deepEqual(parseLetters('app','app'),{letters:'APP',ambiguous:false});
  assert.equal(parseLetters('cap','cat').ambiguous,true);
  assert.deepEqual(parseLetters('BACK','backpack'),{letters:'BACK',ambiguous:false});
  assert.deepEqual(parseLetters('b ack','backpack'),{letters:'BACK',ambiguous:false});
  assert.equal(parseLetters('BOBC','backpack').ambiguous,true);
  assert.deepEqual(parseLetters('be','better'),{letters:'B',ambiguous:false});
  assert.equal(parseLetters('constructor').ambiguous,true);
  assert.deepEqual(parseLetters('D A T'),{letters:'DAT',ambiguous:false});
});
test('one missed word increases practice weight; success reduces it, preserving history',()=>{
  const p=emptyProgress(list.id);
  recordMiss(p,'cat',0,'spelling');
  assert.equal(p.stats.cat.difficulty,1);
  assert.equal(p.runs[0].score,0);
  let cat=0,dog=0;
  for(let i=0;i<400;i++) { const w=selectWord(['cat','dog'],p.stats,'',()=> (i+.5)/400); if(w==='cat')cat++; else dog++; }
  assert.equal(cat,300);assert.equal(dog,100);
  recordCorrect(p,'cat',1);
  assert.equal(p.stats.cat.errors,1);assert.equal(p.stats.cat.difficulty,0);assert.equal(p.best,1);
});
test('draw avoids consecutive duplicates, but single-word lists remain playable',()=>{
  const p=emptyProgress(list.id);recordMiss(p,'cat',0,'silence');
  for(let i=0;i<100;i++)assert.notEqual(selectWord(list.words,p.stats,'cat',()=>i/100),'cat');
  assert.equal(selectWord(['cat'],p.stats,'cat'),'cat');
});
test('progress preserves best immediately, survives backup, and rejects other lists',()=>{
  const p=emptyProgress(list.id);recordCorrect(p,'cat',1);recordCorrect(p,'dog',2);recordMiss(p,'bee',2,'silence');
  const restored=validateProgress(JSON.parse(JSON.stringify(p)),list);
  assert.equal(restored.best,2);assert.equal(restored.total,2);assert.equal(restored.runs[0].missed,'bee');
  assert.throws(()=>validateProgress({...p,listId:'other'},list));
});
test('ten-second clock resets on speech, freezes for a repeat and resumes remaining time',()=>{
  const clock=new SilenceClock();clock.start(100);
  assert.equal(clock.tick(9100),1000);
  clock.voice(9100);assert.equal(clock.tick(11100),8000);
  clock.pause(12100);assert.equal(clock.remaining,7000);
  assert.equal(clock.tick(50000),7000);
  clock.resume(50000);assert.equal(clock.tick(56999),1);assert.equal(clock.tick(57000),0);
});
test('bounded difficulty and recent history do not grow indefinitely',()=>{
  const p=emptyProgress(list.id);
  for(let i=0;i<70;i++)recordMiss(p,'cat',0,'spelling');
  assert.equal(p.stats.cat.difficulty,4);assert.equal(p.runs.length,50);
});
