import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
const dir = path.resolve('public');
/* The exact fragment from the failed magic link. */
const dom = new JSDOM(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), {
  runScripts: 'outside-only', pretendToBeVisual: true,
  url: 'https://whyviral.io/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
});
const { window } = dom;
const errs = []; window.addEventListener('error', e => errs.push(e.message));
window.fetch = async (u) => String(u).startsWith('/api/account')
  ? { ok: true, status: 200, json: async () => ({ billing: true, signedIn: false, plan: 'free', remaining: 0, trialMode: 'card', trialDays: 7 }) }
  : { ok: true, status: 200, json: async () => ({}) };
window.scrollTo = () => {};
const store = {};
Object.defineProperty(window, 'localStorage', { value: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } });
window.WHYVIRAL_CONFIG = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' };
window.eval(['auth.js','comments.js','engine.js','scriptgen.js'].map(f => fs.readFileSync(path.join(dir,f),'utf8')).join('\n')
  + '\n' + fs.readFileSync(path.join(dir,'app.js'),'utf8').replace(/^import .*$/gm,''));
await new Promise(r => setTimeout(r, 300));
const $ = s => window.document.querySelector(s);
let pass=0, fail=0; const check=(n,c,d='')=>{c?pass++:(fail++,console.log('  FAIL: '+n+' '+d));};
console.log('--- expired magic link ---');
check('lands on the sign-in screen', $('#screen-auth').classList.contains('active'));
check('explains what happened', !$('#auth-error').hidden);
check('mentions email scanners', /scanners/i.test($('#auth-error').textContent), $('#auth-error').textContent.slice(0,80));
check('points at the code', /code/i.test($('#auth-error').textContent));
check('token fragment cleared from the url', !window.location.hash.includes('error_code'));
check('no runtime errors', errs.length===0, errs.join('|'));
console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail?1:0);
