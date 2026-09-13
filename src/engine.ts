export interface WordList { id: string; title: string; demo: boolean; language: string; words: string[] }
export type WordSource = 'demo' | 'custom' | 'both';
export interface WordSettings { source: WordSource; words: string[] }

export function parseCustomWords(text: string): string[] {
  const words = text.trim().split(/[\s,;]+/).filter(Boolean);
  if (!words.length) return [];
  return validateList({ id: 'registered-v1', title: 'Registered words', demo: false, language: 'en-US', words }).words;
}

export function buildWordList(demo: WordList, settings: WordSettings): WordList {
  if (settings.source === 'demo') return demo;
  if (settings.source === 'custom' && !settings.words.length) throw new Error('Add at least one registered word before choosing registered words only.');
  return {
    id: settings.source === 'custom' ? 'registered-v1' : `combined-${demo.id}`,
    title: settings.source === 'custom' ? 'Registered words' : 'Demo + registered words',
    demo: settings.source === 'both', language: demo.language,
    words: [...new Set(settings.source === 'custom' ? settings.words : [...demo.words, ...settings.words])]
  };
}
export interface WordStat { errors: number; correct: number; difficulty: number; lastMiss?: string }
export interface Run { date: string; score: number; missed: string; reason: 'spelling' | 'silence' }
export interface Progress { version: 1; listId: string; best: number; total: number; stats: Record<string, WordStat>; runs: Run[] }

export const emptyProgress = (listId: string): Progress => ({ version: 1, listId, best: 0, total: 0, stats: {}, runs: [] });

export function validateList(value: unknown): WordList {
  const v = value as Partial<WordList>;
  if (!v || typeof v.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(v.id) ||
      typeof v.title !== 'string' || typeof v.demo !== 'boolean' || !['en-US', 'en-GB'].includes(v.language ?? '') ||
      !Array.isArray(v.words) || !v.words.length || v.words.length > 10000) throw new Error('Invalid word list');
  const words = v.words.map(w => {
    if (typeof w !== 'string' || !/^[a-zA-Z]{1,40}$/.test(w.trim())) throw new Error('Use English words with letters A–Z only');
    return w.trim().toLowerCase();
  });
  return { id: v.id, title: v.title.slice(0,100), demo: v.demo, language: v.language!, words: [...new Set(words)] };
}

const safeCount = (n: unknown): number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 100000000 ? n : 0;
export function validateProgress(raw: unknown, list: WordList): Progress {
  const v = raw as Partial<Progress>;
  if (!v || v.version !== 1 || v.listId !== list.id || !v.stats || !Array.isArray(v.runs)) throw new Error('This backup belongs to another word list');
  const p = emptyProgress(list.id);
  p.best = safeCount(v.best); p.total = Math.max(p.best, safeCount(v.total));
  for (const word of list.words) {
    const s = Object.hasOwn(v.stats, word) ? v.stats[word] : undefined;
    if (s && typeof s === 'object') p.stats[word] = { errors: safeCount(s.errors), correct: safeCount(s.correct), difficulty: Math.min(4, safeCount(s.difficulty)) };
  }
  p.runs = v.runs.filter(r => r && typeof r.date === 'string' && Number.isFinite(Date.parse(r.date)) && list.words.includes(r.missed) && ['spelling', 'silence'].includes(r.reason)).slice(0,50).map(r => ({ date: r.date, score: safeCount(r.score), missed: r.missed, reason: r.reason }));
  p.best = Math.max(p.best, ...p.runs.map(r => r.score));
  p.total = Math.max(p.total, p.best);
  return p;
}

export function selectWord(words: string[], stats: Record<string, WordStat>, previous = '', random = Math.random): string {
  const pool = words.length > 1 ? words.filter(w => w !== previous) : words;
  const weights = pool.map(w => 1 + (Object.hasOwn(stats, w) ? stats[w].difficulty : 0) * 2);
  let pick = random() * weights.reduce((a,b) => a+b, 0);
  for (let i=0; i<pool.length; i++) { pick -= weights[i]; if (pick < 0) return pool[i]; }
  return pool[pool.length-1];
}

export function recordCorrect(progress: Progress, word: string, streak: number) {
  const s = Object.hasOwn(progress.stats, word) ? progress.stats[word] : { errors: 0, correct: 0, difficulty: 0 };
  s.correct++; s.difficulty = Math.max(0, s.difficulty - 1); progress.stats[word] = s;
  progress.best = Math.max(progress.best, streak); progress.total++;
}
export function recordMiss(progress: Progress, word: string, streak: number, reason: Run['reason']) {
  const s = Object.hasOwn(progress.stats, word) ? progress.stats[word] : { errors: 0, correct: 0, difficulty: 0 };
  s.errors++; s.difficulty = Math.min(4, s.difficulty + 1); s.lastMiss = new Date().toISOString(); progress.stats[word] = s;
  progress.runs.unshift({ date: s.lastMiss, score: streak, missed: word, reason }); progress.runs = progress.runs.slice(0,50);
}

// Letter-name transcripts are preferred. Some speech services collapse a clearly
// spelled sequence ("C A T") into the dictionary word "cat", so the optional
// expected word is accepted only when the normalized transcript is an exact match.
// Near matches and unrelated words remain ambiguous; there is no fuzzy correction.
const letterNames: Record<string, string> = {
  a:'A', ay:'A', aye:'A', b:'B', bee:'B', be:'B', c:'C', cee:'C', see:'C', sea:'C',
  d:'D', dee:'D', e:'E', ee:'E', f:'F', ef:'F', eff:'F', g:'G', gee:'G',
  h:'H', aitch:'H', haitch:'H', i:'I', eye:'I', j:'J', jay:'J', k:'K', kay:'K',
  l:'L', el:'L', ell:'L', m:'M', em:'M', n:'N', en:'N', o:'O', oh:'O',
  p:'P', pee:'P', q:'Q', cue:'Q', queue:'Q', r:'R', ar:'R', are:'R',
  s:'S', ess:'S', t:'T', tee:'T', tea:'T', u:'U', you:'U', v:'V', vee:'V',
  w:'W', doubleyou:'W', doubleu:'W', x:'X', ex:'X', y:'Y', why:'Y', z:'Z', zee:'Z', zed:'Z'
};
export function parseLetters(transcript: string, expectedWord = ''): { letters: string; ambiguous: boolean } {
  const cleaned = transcript.toLowerCase().replace(/double[\s-]+(?:you|u)\b/g,'doubleu').replace(/[.,!?;:–—-]/g,' ').trim();
  if (!cleaned) return { letters: '', ambiguous: false };
  if (expectedWord && cleaned === expectedWord.toLowerCase()) {
    return { letters: expectedWord.toUpperCase(), ambiguous: false };
  }
  const tokens = cleaned.split(/\s+/);
  const ambiguous = tokens.some(t => !Object.hasOwn(letterNames, t));
  // Services also glue part of a spelling into one chunk ("BACK" then "PACK").
  // Accept a chunk only when it exactly matches the next letters of the word.
  const compact = tokens.join('');
  if (ambiguous && expectedWord && /^[a-z]+$/.test(compact) && expectedWord.toLowerCase().startsWith(compact)) {
    return { letters: compact.toUpperCase(), ambiguous: false };
  }
  return { letters: tokens.map(t => Object.hasOwn(letterNames, t) ? letterNames[t] : '').join(''), ambiguous };
}

export class SilenceClock {
  readonly limit = 10000;
  remaining = this.limit;
  active = false;
  last = 0;
  start(now: number) { this.remaining = this.limit; this.resume(now); }
  resume(now: number) { this.last = now; this.active = true; }
  pause(now: number) { this.tick(now); this.active = false; }
  voice(now: number) { if (this.active) { this.remaining = this.limit; this.last = now; } }
  tick(now: number) { if (this.active) { this.remaining = Math.max(0, this.remaining - Math.max(0, now - this.last)); this.last = now; } return this.remaining; }
}
