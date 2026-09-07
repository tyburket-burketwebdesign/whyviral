/* The app ships as classic scripts sharing one global scope, so two files
   declaring the same top-level name is a hard SyntaxError that takes the whole
   page down. This guards the trade-off made when we dropped ES modules. */
import fs from 'fs';
const FILES = ['public/auth.js', 'public/comments.js', 'public/engine.js', 'public/scriptgen.js', 'public/app.js'];
const RE = /^(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)/gm;

let pass = 0, fail = 0;
const seen = new Map();
for (const f of FILES) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(RE)) {
    const name = m[1];
    if (seen.has(name)) {
      fail++;
      console.log(`  FAIL: "${name}" declared in both ${seen.get(name)} and ${f}`);
    } else seen.set(name, f);
  }
}
if (!fail) { pass++; console.log(`  no collisions across ${FILES.length} files (${seen.size} top-level names)`); }

/* And prove they actually co-execute in one scope. */
import vm from 'vm';
const ctx = vm.createContext({ console, window: {} });
try {
  for (const f of FILES.slice(0, 3)) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
  pass++; console.log('  all three engine files load together cleanly');
} catch (e) { fail++; console.log('  FAIL: files do not co-execute — ' + e.message); }

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
