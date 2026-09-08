/* Supabase returns auth results to the Site URL, which is the marketing root.
   The landing page has to hand those to the app instead of rendering itself. */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.resolve('public/index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };

/* jsdom's location.replace is read-only, so run the guard against a stand-in
   window with the same shape. Same code, observable side effect. */
const guard = src.match(/\(function \(\) \{\s*var h = window\.location\.hash[\s\S]*?\}\)\(\);/)[0];

function land(hash) {
  let replaced = null;
  const window = { location: { hash, replace: (u) => { replaced = u; } } };
  new Function('window', guard)(window);
  return replaced;
}

console.log('--- root forwards auth returns ---');
check('expired reset forwarded', land('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
  === '/app.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
check('recovery session forwarded', String(land('#access_token=tok&type=recovery&expires_in=3600')).startsWith('/app.html#access_token='));
check('plain sign-in session forwarded', String(land('#access_token=abc&refresh_token=r')).startsWith('/app.html#'));
check('fragment preserved intact', String(land('#access_token=tok&type=recovery')).includes('type=recovery'));

console.log('\n--- ordinary visits are untouched ---');
check('no hash stays on the site', land('') === null);
check('anchor link stays on the site', land('#pricing') === null);
check('faq anchor stays on the site', land('#faq') === null);
check('empty hash stays', land('#') === null);

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
