/* The app ships as classic scripts so it runs from file:// as well as https.
   That means tests can't `import` them, so they're evaluated in a sandbox and
   their top-level declarations handed back. Same files the browser loads —
   no build step, no second source of truth. */
import fs from 'fs';
import vm from 'vm';
import path from 'path';

export function load(...files) {
  const ctx = vm.createContext({ console, window: {} });
  const names = new Set();
  for (const f of files) {
    const p = path.resolve(f);
    const src = fs.readFileSync(p, 'utf8');
    vm.runInContext(src, ctx, { filename: p });
    /* Top-level `function` lands on globalThis, but `const` and `let` live in
       the script's lexical scope and stay invisible to the host. Collect their
       names and copy them across so tests can reach BASE_RATES, WEIGHTS, etc. */
    for (const m of src.matchAll(/^(?:const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  }
  if (names.size) {
    const list = [...names];
    vm.runInContext(`(function(){${list.map(n => `try{globalThis[${JSON.stringify(n)}]=${n}}catch(e){}`).join('')}})()`, ctx);
  }
  return ctx;
}

export const loadEngine = () => load('public/comments.js', 'public/engine.js', 'public/scriptgen.js');
