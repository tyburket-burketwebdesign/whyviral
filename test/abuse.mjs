/* Trial abuse. The attack is not clever — a second email for a second seven
   days — so the defence has to cover the lazy variants exhaustively. */
import { normalizeEmail, isDisposable, trialSignals } from '../api/_abuse.js';
import { claimTrial, trialAlreadyUsed } from '../api/_auth.js';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };

console.log('--- email normalisation ---');
const same = (a, b) => normalizeEmail(a) === normalizeEmail(b);
check('gmail dots collapse', same('ty.burket@gmail.com', 'tyburket@gmail.com'));
check('many gmail dots collapse', same('t.y.b.u.r.k.e.t@gmail.com', 'tyburket@gmail.com'));
check('gmail plus tag stripped', same('tyburket+trial2@gmail.com', 'tyburket@gmail.com'));
check('dots and plus together', same('ty.burket+free@gmail.com', 'tyburket@gmail.com'));
check('googlemail equals gmail', same('tyburket@googlemail.com', 'tyburket@gmail.com'));
check('case ignored', same('TyBurket@Gmail.com', 'tyburket@gmail.com'));
check('whitespace trimmed', same('  tyburket@gmail.com ', 'tyburket@gmail.com'));
check('plus stripped on any domain', same('ty+a@outlook.com', 'ty@outlook.com'));
check('dots kept on non-gmail', !same('ty.burket@outlook.com', 'tyburket@outlook.com'));
check('different people stay different', !same('ty@gmail.com', 'sam@gmail.com'));
check('different domains stay different', !same('ty@gmail.com', 'ty@outlook.com'));
check('null email handled', normalizeEmail(null) === null);
check('garbage handled', normalizeEmail('not-an-email') === null);
check('empty local part handled', normalizeEmail('@gmail.com') === null);

console.log('\n--- disposable domains ---');
check('mailinator flagged', isDisposable('x@mailinator.com'));
check('10minutemail flagged', isDisposable('x@10minutemail.com'));
check('yopmail flagged', isDisposable('x@yopmail.com'));
check('subdomain of throwaway flagged', isDisposable('x@inbox.mailinator.com'));
check('case ignored', isDisposable('X@MAILINATOR.COM'));
check('gmail not flagged', !isDisposable('ty@gmail.com'));
check('company domain not flagged', !isDisposable('ty@burketwebdesign.com'));
check('null handled', !isDisposable(null));

console.log('\n--- signals ---');
let s = trialSignals({ email: 'ty.burket+x@gmail.com', deviceId: 'd1', cardFingerprint: 'fp1' });
check('three signals produced', s.length === 3);
check('email normalised in signal', s.find(x => x.kind === 'email').value === 'tyburket@gmail.com');
check('missing card is omitted', trialSignals({ email: 'a@b.com', deviceId: 'd' }).length === 2);
check('empty input yields nothing', trialSignals({}).length === 0);

console.log('\n--- claim enforcement ---');
/* Stand-in for the unique (kind,value) primary key. */
function mockDb() {
  const claims = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = String(u);
    if (url.includes('/trial_claims')) {
      if ((init.method || 'GET') === 'GET') {
        const kind = decodeURIComponent((url.match(/kind=eq\.([^&]+)/) || [])[1] || '');
        const value = decodeURIComponent((url.match(/value=eq\.([^&]+)/) || [])[1] || '');
        const hit = claims.find(c => c.kind === kind && c.value === value);
        return { ok: true, status: 200, json: async () => (hit ? [hit] : []) };
      }
      const row = JSON.parse(init.body);
      if (claims.some(c => c.kind === row.kind && c.value === row.value)) {
        return { ok: false, status: 409, text: async () => 'duplicate key' };
      }
      claims.push(row);
      return { ok: true, status: 204, json: async () => null };
    }
    return { ok: true, status: 200, json: async () => [] };
  };
  return { env: { SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'y' }, claims };
}
const realFetch = globalThis.fetch;

let { env, claims } = mockDb();
const sigA = trialSignals({ email: 'ty@gmail.com', deviceId: 'd1', cardFingerprint: 'fp1' });
let r = await claimTrial(env, 'acc-1', sigA);
check('first trial granted', r.granted === true);
check('all signals recorded', claims.length === 3, String(claims.length));

r = await claimTrial(env, 'acc-1', sigA);
check('same account re-claiming is fine', r.granted === true);

/* New email, same browser and same card — the realistic attack. */
const sigB = trialSignals({ email: 'ty2@gmail.com', deviceId: 'd1', cardFingerprint: 'fp1' });
r = await claimTrial(env, 'acc-2', sigB);
check('second account with same device+card denied', r.granted === false);
check('conflicts name device and card', r.conflicts.includes('device') && r.conflicts.includes('card'), r.conflicts.join(','));

/* Gmail dot trick with a fresh browser and a fresh card. */
({ env, claims } = mockDb());
await claimTrial(env, 'acc-1', trialSignals({ email: 'tyburket@gmail.com', deviceId: 'd1', cardFingerprint: 'fp1' }));
r = await claimTrial(env, 'acc-2', trialSignals({ email: 'ty.burket@gmail.com', deviceId: 'd2', cardFingerprint: 'fp2' }));
check('gmail dot alias denied a second trial', r.granted === false);
check('conflict identified as email', r.conflicts.includes('email'));

/* Genuinely different person must not be blocked. */
({ env, claims } = mockDb());
await claimTrial(env, 'acc-1', trialSignals({ email: 'ty@gmail.com', deviceId: 'd1', cardFingerprint: 'fp1' }));
r = await claimTrial(env, 'acc-2', trialSignals({ email: 'sam@outlook.com', deviceId: 'd2', cardFingerprint: 'fp2' }));
check('unrelated person still gets a trial', r.granted === true);

/* Same household, different card and email — device alone is a soft signal
   but still blocks. Documented tradeoff, not a bug. */
({ env, claims } = mockDb());
await claimTrial(env, 'acc-1', trialSignals({ email: 'ty@gmail.com', deviceId: 'shared', cardFingerprint: 'fp1' }));
r = await claimTrial(env, 'acc-2', trialSignals({ email: 'partner@gmail.com', deviceId: 'shared', cardFingerprint: 'fp2' }));
check('shared device blocks (known tradeoff)', r.granted === false && r.conflicts.join() === 'device');

console.log('\n--- read-only pre-check ---');
({ env, claims } = mockDb());
await claimTrial(env, 'acc-1', trialSignals({ email: 'ty@gmail.com', deviceId: 'd1' }));
check('pre-check sees another account used it',
  await trialAlreadyUsed(env, 'acc-2', trialSignals({ email: 'ty+new@gmail.com', deviceId: 'd9' })) === true);
check('pre-check clears an unrelated identity',
  await trialAlreadyUsed(env, 'acc-2', trialSignals({ email: 'new@outlook.com', deviceId: 'd9' })) === false);
check('own account is not a conflict',
  await trialAlreadyUsed(env, 'acc-1', trialSignals({ email: 'ty@gmail.com', deviceId: 'd1' })) === false);

globalThis.fetch = realFetch;
console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
