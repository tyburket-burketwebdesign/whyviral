/* Mechanical audit: find every mismatch between markup, styles and script. */
import fs from 'fs';
const read = f => fs.readFileSync(f, 'utf8');
const problems = [];
const note = (kind, msg) => problems.push(`${kind.padEnd(14)} ${msg}`);

const htmlFiles = ['public/app.html', 'public/index.html', 'public/terms.html', 'public/privacy.html'];
const jsFiles = ['public/app.js', 'public/auth.js', 'public/engine.js', 'public/scriptgen.js', 'public/comments.js'];
const css = read('public/app.css') + read('public/site.css');
const js = jsFiles.map(read).join('\n');

for (const f of htmlFiles) {
  const h = read(f);
  const ids = [...h.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
  [...new Set(dupes)].forEach(d => note('DUPLICATE-ID', `${f}: #${d}`));
}

/* JS touching elements that don't exist in app.html */
const appHtml = read('public/app.html');
const appIds = new Set([...appHtml.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const referenced = new Set([...read('public/app.js').matchAll(/\$\('#([\w-]+)'\)/g)].map(m => m[1]));
for (const r of referenced) if (!appIds.has(r)) note('MISSING-EL', `app.js queries #${r}, not in app.html`);

/* Elements that exist but nothing ever uses */
const usedAnywhere = read('public/app.js') + read('public/auth.js') + appHtml;
for (const id of appIds) {
  if (id.startsWith('screen-')) continue;          /* reached via show(name) */
  const uses = (usedAnywhere.match(new RegExp(`['"#]${id}\\b`, 'g')) || []).length;
  if (uses <= 1) note('ORPHAN-EL', `#${id} declared in app.html but never used`);
}

/* Classes used in markup with no rule anywhere */
const classAttrs = [...(appHtml + read('public/index.html')).matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/));
const jsClasses = [...js.matchAll(/(?:classList\.(?:add|toggle|remove)\(|el\(['"][a-z]+['"],\s*)['"]([\w -]+)['"]/g)].flatMap(m => m[1].split(/\s+/));
const allClasses = [...new Set([...classAttrs, ...jsClasses])].filter(Boolean);
for (const c of allClasses) {
  if (!new RegExp(`\\.${c.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`).test(css)) note('NO-STYLE', `.${c} used but never styled`);
}

/* Handlers bound to ids that don't exist */
for (const m of read('public/app.js').matchAll(/\$\('#([\w-]+)'\)(\?)?\.(onclick|addEventListener)/g)) {
  if (!appIds.has(m[1]) && !m[2]) note('UNSAFE-BIND', `#${m[1]} bound without optional chaining — throws if absent`);
}

/* Screens declared vs screens routed to */
const screens = [...appHtml.matchAll(/id="screen-([\w-]+)"/g)].map(m => m[1]);
const shown = [...new Set([...read('public/app.js').matchAll(/show\('([\w-]+)'\)/g)].map(m => m[1]))];
screens.forEach(s => { if (!shown.includes(s)) note('DEAD-SCREEN', `screen-${s} exists but show('${s}') is never called`); });
shown.forEach(s => { if (!screens.includes(s)) note('MISSING-SCREEN', `show('${s}') called but #screen-${s} does not exist`); });

/* The bug that shipped: a class setting `display` silently overrides the
   browser's [hidden] rule, so hidden elements render as empty boxes. Both
   stylesheets must force it back. */
for (const f of ['public/app.css', 'public/site.css']) {
  if (!/\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(read(f))) {
    note('HIDDEN-BUG', `${f} does not force [hidden]{display:none!important}`);
  }
}
const hiddenWithDisplay = [];
for (const m of (appHtml + read('public/index.html')).matchAll(/<[^>]*\sid="([\w-]+)"[^>]*>/g)) {
  if (!/\shidden[\s>]/.test(m[0])) continue;
  const cls = /class="([^"]+)"/.exec(m[0]);
  if (!cls) continue;
  for (const c of cls[1].split(/\s+/)) {
    if (new RegExp(`\\.${c}\\s*\\{[^}]*display\\s*:`).test(css)) hiddenWithDisplay.push(`#${m[1]} (.${c})`);
  }
}
if (hiddenWithDisplay.length) {
  console.log(`note: ${hiddenWithDisplay.length} hidden elements rely on the [hidden] override — ${hiddenWithDisplay.join(', ')}`);
}

console.log(problems.length ? problems.join('\n') : 'no problems found');
console.log(`\n${problems.length} issues`);
