/* Supabase signs tokens two ways depending on project age: HS256 with a shared
   secret, or ES256 against a published JWKS. Supporting only HS256 meant every
   valid session from a new project was rejected, and the app just said
   "signed out" with no explanation. */
import { verifyToken } from '../api/_auth.js';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };
const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = o => b64(new TextEncoder().encode(JSON.stringify(o)));
const now = () => Math.floor(Date.now() / 1000);

const SECRET = 'shared-secret-value';
async function hs256(claims, secret = SECRET, alg = 'HS256') {
  const h = enc({ alg, typ: 'JWT' }), p = enc(claims);
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64(s)}`;
}

console.log('--- HS256 (older projects) ---');
const good = await hs256({ sub: 'u1', email: 'ty@x.com', exp: now() + 3600 });
check('valid token accepted', (await verifyToken(good, SECRET))?.sub === 'u1');
check('wrong secret rejected', await verifyToken(good, 'nope') === null);
check('expired rejected', await verifyToken(await hs256({ sub: 'u', exp: now() - 5 }), SECRET) === null);
check('alg none rejected', await verifyToken(await hs256({ sub: 'u', exp: now() + 60 }, SECRET, 'none'), SECRET) === null);

console.log('\n--- ES256 (current projects) ---');
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
jwk.kid = 'key-1';
const realFetch = globalThis.fetch;
let jwksHits = 0;
globalThis.fetch = async (u) => {
  if (String(u).includes('jwks.json')) { jwksHits++; return { ok: true, json: async () => ({ keys: [jwk] }) }; }
  return { ok: false, json: async () => ({}) };
};
async function es256(claims, kid = 'key-1') {
  const h = enc({ alg: 'ES256', typ: 'JWT', kid }), p = enc(claims);
  const s = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64(s)}`;
}

const URL_ = 'https://proj.supabase.co';
const esTok = await es256({ sub: 'u2', email: 'c@x.com', exp: now() + 3600 });
check('ES256 token accepted', (await verifyToken(esTok, null, URL_))?.sub === 'u2');
check('works without any shared secret', (await verifyToken(esTok, undefined, URL_))?.email === 'c@x.com');
check('jwks was fetched', jwksHits >= 1);

const before = jwksHits;
await verifyToken(esTok, null, URL_);
check('jwks cached, not refetched', jwksHits === before);

check('expired ES256 rejected', await verifyToken(await es256({ sub: 'u', exp: now() - 5 }), null, URL_) === null);
check('unknown kid falls back to first key', (await verifyToken(await es256({ sub: 'u3', exp: now() + 60 }, 'other'), null, URL_))?.sub === 'u3');
check('no supabase url means no verification', await verifyToken(esTok, null, null) === null);

/* A token signed by a different key must not pass. */
const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const hdr = enc({ alg: 'ES256', typ: 'JWT', kid: 'key-1' }), pl = enc({ sub: 'evil', exp: now() + 60 });
const badSig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, other.privateKey, new TextEncoder().encode(`${hdr}.${pl}`));
check('token signed by another key rejected', await verifyToken(`${hdr}.${pl}.${b64(badSig)}`, null, URL_) === null);

const tampered = esTok.split('.'); tampered[1] = enc({ sub: 'admin', exp: now() + 3600 });
check('tampered ES256 payload rejected', await verifyToken(tampered.join('.'), null, URL_) === null);

globalThis.fetch = realFetch;
console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
