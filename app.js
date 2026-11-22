'use strict';

const SAMPLE = `title The Original Tiramisu
serves 12
a: beat => beaten yolks | 4 (70 g) large egg yolks
b: beat => custard base | @a | 1/2 cup (100 g) granulated sugar | 1/2 cup (120 mL) sweet Marsala wine
c: whisk over steam => custard | @b
d: beat => mascarpone cream | @c | 1 lb. (450 g) mascarpone cheese
e: whip to soft peaks => whipped cream | 1 cup (240 mL) heavy cream
f: fold => tiramisu cream | @d | @e
g: dissolve => espresso syrup | 12 oz. (355 mL) prepared espresso | 2 tsp. (8 g) granulated sugar
h: soak 2 seconds => soaked ladyfingers | @g | about 40 ladyfinger cookies
i: assemble => layered tiramisu | @f | @g | @h
j: sift => finished tiramisu | @i | 2 Tbs. (11 g) cocoa powder
k: refrigerate 4 hours => set tiramisu | @j`;

const $ = id => document.getElementById(id);

const esc = value => String(value).replace(/[&<>"']/g, ch => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[ch]));

const AMOUNT_RE = /^((?:about\s+)?(?:\d+\s+)?\d+(?:[\/.]\d+)?(?:\s*(?:-|–|to)\s*\d+(?:[\/.]\d+)?)?\s*(?:(?:cups?|tsp|tbs|tbsp|oz|lb|g|kg|ml|mL|l|liters?|shots?|cloves?|pinch|dash|cans?|slices?|sprigs?|sticks?|pieces?)\b\.?\s*)?(?:\([^)]*\))?\s*)/i;

function splitAmount(text) {
  const source = String(text).trim();
  const match = source.match(AMOUNT_RE);
  if (match && match[1].trim()) {
    const qty = match[1].trim();
    const name = source.slice(match[1].length).trim();
    if (name) return { qty, name };
  }
  return { qty: '', name: source };
}

function parse(text) {
  const R = {
    title: '',
    serves: '',
    preps: [],
    steps: [],
    leaves: [],
    notes: [],
    grid: [],
    maxCol: 1
  };

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    let match;
    if ((match = line.match(/^title\s+(.+)$/i))) {
      R.title = match[1].trim();
      continue;
    }
    if ((match = line.match(/^(?:serves|servings)\s+(.+)$/i))) {
      R.serves = match[1].trim();
      continue;
    }
    if ((match = line.match(/^pre\s+(.+)$/i))) {
      R.preps.push(match[1].trim());
      continue;
    }

    match = line.match(/^([A-Za-z][\w-]*)\s*:\s*([^|]*?)(?:\s*=>\s*([^|]*?))?\s*(?:\|(.*))?$/);
    if (match) {
      const action = (match[2] || '').trim();
      if (!action) {
        R.notes.push('A step is missing its action.');
        continue;
      }
      R.steps.push({
        id: match[1],
        action,
        output: (match[3] || '').trim(),
        rawIns: (match[4] || '').split('|').map(part => part.trim()).filter(Boolean),
        index: R.steps.length,
        refs: [],
        ings: [],
        consumers: [],
        auto: false,
        col: 1,
        span: null
      });
      continue;
    }

    R.notes.push('Could not parse: ' + line);
  }

  const byId = new Map();
  for (const step of R.steps) {
    if (byId.has(step.id)) R.notes.push(`Duplicate step id "${step.id}".`);
    byId.set(step.id, step);
  }

  for (const step of R.steps) {
    for (const input of step.rawIns) {
      if (input.startsWith('@')) {
        const ref = byId.get(input.slice(1).trim());
        if (ref && ref !== step) {
          if (!step.refs.includes(ref)) step.refs.push(ref);
        } else {
          R.notes.push(`${step.id}: unknown step reference ${input}.`);
        }
      } else {
        const { qty, name } = splitAmount(input);
        const ing = { text: input, qty, name, row: R.leaves.length };
        R.leaves.push(ing);
        step.ings.push(ing);
      }
    }

    if (!step.refs.length && !step.ings.length) {
      if (step.index > 0) {
        step.refs.push(R.steps[step.index - 1]);
        step.auto = true;
        R.notes.push(`${step.id}: no inputs, using the previous step.`);
      } else {
        R.notes.push(`${step.id}: no inputs given.`);
      }
    }
  }

  for (const step of R.steps) step.consumers = [];
  for (const step of R.steps) {
    for (const ref of step.refs) ref.consumers.push(step);
  }

  const last = R.steps[R.steps.length - 1];
  if (last) {
    for (const step of R.steps.slice(0, -1)) {
      if (!step.consumers.length) {
        last.refs.push(step);
        step.consumers.push(last);
        step.auto = true;
        R.notes.push(`${step.id}: not used by another step, joined into ${last.id}.`);
      }
    }
  }

  return R;
}

function computeSpans(R) {
  const visiting = new Set();

  function visit(step) {
    if (step.span) return step.span;
    if (visiting.has(step)) {
      R.notes.push(`Cycle detected at ${step.id}.`);
      return { min: 0, max: Math.max(0, R.leaves.length - 1) };
    }

    visiting.add(step);
    let min = Infinity;
    let max = -Infinity;

    for (const ing of step.ings) {
      min = Math.min(min, ing.row);
      max = Math.max(max, ing.row);
    }

    for (const ref of step.refs) {
      if (ref === step) continue;
      const span = visit(ref);
      min = Math.min(min, span.min);
      max = Math.max(max, span.max);
    }

    visiting.delete(step);

    if (!Number.isFinite(min)) {
      min = 0;
      max = Math.max(0, R.leaves.length - 1);
    }

    step.span = { min, max };
    return step.span;
  }

  for (const step of R.steps) visit(step);
}

function schedule(R) {
  if (!R.steps.length) {
    R.grid = [];
    R.maxCol = 1;
    return;
  }

  // Topological order, with line order as the tie-breaker. This keeps the
  // reading order intuitive when independent branches can run in parallel.
  const indegree = new Map(R.steps.map(step => [step, step.refs.length]));
  const ready = R.steps.filter(step => indegree.get(step) === 0);
  const order = [];

  while (ready.length) {
    ready.sort((a, b) => a.index - b.index);
    const step = ready.shift();
    order.push(step);
    for (const consumer of step.consumers) {
      indegree.set(consumer, indegree.get(consumer) - 1);
      if (indegree.get(consumer) === 0) ready.push(consumer);
    }
  }

  if (order.length !== R.steps.length) {
    R.notes.push('The step links contain a cycle; using line order.');
    order.length = 0;
    order.push(...R.steps);
    order.sort((a, b) => a.index - b.index);
  }

  R.order = order;
  R.grid = Array.from({ length: Math.max(1, R.leaves.length) }, () => []);

  // Pack each step into the first free column across the ingredient rows it
  // spans. This is the layout used by the original recipe summary tables:
  // parallel work folds back into the earliest open column, while the main
  // sequence converges on the right.
  for (const step of order) {
    let col = 1;
    while (true) {
      let free = true;
      for (let row = step.span.min; row <= step.span.max; row++) {
        if (R.grid[row] && R.grid[row][col]) {
          free = false;
          break;
        }
      }
      if (free) break;
      col++;
    }

    step.col = col;
    for (let row = step.span.min; row <= step.span.max; row++) {
      if (!R.grid[row]) R.grid[row] = [];
      R.grid[row][col] = step;
    }
  }

  R.maxCol = Math.max(1, ...R.steps.map(step => step.col));
}

function renderMeta(R) {
  const title = R.title || 'Recipe chart';
  document.title = title;
  $('recipe-title').textContent = title;

  const serves = $('recipe-serves');
  if (R.serves) {
    serves.textContent = 'Serves ' + R.serves;
    serves.hidden = false;
  } else {
    serves.hidden = true;
  }

  const prep = $('prep');
  if (R.preps.length) {
    prep.innerHTML = '<strong>Prep</strong> ' + R.preps.map(esc).join(' <span aria-hidden="true">·</span> ');
    prep.hidden = false;
  } else {
    prep.innerHTML = '';
    prep.hidden = true;
  }

  const notes = $('notes');
  if (isEditMode && R.notes.length) {
    notes.innerHTML = '<ul>' + R.notes.map(note => `<li>${esc(note)}</li>`).join('') + '</ul>';
    notes.hidden = false;
  } else {
    notes.innerHTML = '';
    notes.hidden = true;
  }
}

function renderChart(R) {
  const chart = $('chart');
  const title = R.title || 'Recipe chart';
  const caption = `${title}${R.serves ? `, serves ${R.serves}` : ''}. Ingredient and action chart.`;
  const rowCount = R.leaves.length;

  if (!R.steps.length || !rowCount) {
    chart.innerHTML = `<caption class="sr-only">${esc(caption)}</caption><tbody><tr><td class="empty-state">No steps found. Open <code>?edit=1</code> to edit the recipe source.</td></tr></tbody>`;
    return;
  }

  const blocks = [];
  for (let col = 1; col <= R.maxCol; col++) {
    blocks[col] = {};
    let row = 0;
    while (row < rowCount) {
      const step = R.grid[row] && R.grid[row][col];
      if (step) {
        if (step.span.min === row) {
          blocks[col][row] = { type: 'act', step, span: step.span.max - step.span.min + 1 };
        }
        row = Math.max(row + 1, step.span.max + 1);
      } else {
        let end = row;
        while (end < rowCount && !(R.grid[end] && R.grid[end][col])) end++;
        blocks[col][row] = { type: 'empty', span: end - row };
        row = end;
      }
    }
  }

  let html = `<caption class="sr-only">${esc(caption)}</caption><tbody>`;

  for (let row = 0; row < rowCount; row++) {
    html += '<tr>';
    const ing = R.leaves[row];
    const lastRow = row === rowCount - 1;
    html += `<th class="ing${lastRow ? ' last-row' : ''}" scope="row"><span class="ing-name">${esc(ing.name)}</span>${ing.qty ? `<span class="ing-qty">${esc(ing.qty)}</span>` : ''}</th>`;

    for (let col = 1; col <= R.maxCol; col++) {
      const block = blocks[col] && blocks[col][row];
      if (!block) continue;

      const isLastRow = row + block.span - 1 === rowCount - 1;
      const isLastCol = col === R.maxCol;
      const classes = `${block.type === 'act' ? 'act' : 'empty'}${isLastRow ? ' last-row' : ''}${isLastCol ? ' last-col' : ''}`;

      if (block.type === 'act') {
        const step = block.step;
        const uses = [
          ...step.ings.map(ingredient => ingredient.text),
          ...step.refs.map(ref => ref.output || ref.action)
        ];
        const label = `${step.action}.${step.output ? ` Makes ${step.output}.` : ''}${uses.length ? ` Uses ${uses.join(', ')}.` : ''}`;
        html += `<td class="${classes}" rowspan="${block.span}" aria-label="${esc(label)}"><span class="act-label">${esc(step.action)}</span>${step.output ? `<span class="act-out"><span class="act-out-arrow" aria-hidden="true">→</span> ${esc(step.output)}</span>` : ''}</td>`;
      } else {
        html += `<td class="${classes}" rowspan="${block.span}"></td>`;
      }
    }

    html += '</tr>';
  }

  html += '</tbody>';
  chart.innerHTML = html;
}

function renderSteps(R) {
  const list = $('steps-list');
  if (!R.steps.length) {
    list.innerHTML = '';
    return;
  }

  const ordered = R.order && R.order.length ? R.order : R.steps;

  list.innerHTML = ordered.map((step, index) => {
    const uses = [
      ...step.ings.map(ingredient => ingredient.text),
      ...step.refs.map(ref => ref.output || ref.action)
    ];
    const output = step.output
      ? `<span class="step-out"> <span aria-hidden="true">→</span> ${esc(step.output)}</span>`
      : '';
    const chips = uses.length
      ? `<div class="step-uses"><span class="sr-only">Uses: </span>${uses.map(item => `<span class="chip">${esc(item)}</span>`).join('')}</div>`
      : '';

    return `<li class="step"><span class="step-num" aria-hidden="true">${index + 1}</span><div class="step-body"><p class="step-action">${esc(step.action)}${output}</p>${chips}</div></li>`;
  }).join('');
}

function updateHint() {
  const frame = $('frame');
  const hint = $('scroll-hint');
  const overflowing = frame.scrollWidth > frame.clientWidth + 2;

  hint.hidden = !overflowing;

  if (overflowing) {
    frame.tabIndex = 0;
    frame.setAttribute('aria-label', 'Recipe chart. Scroll horizontally to see later steps.');
  } else {
    frame.tabIndex = -1;
    frame.removeAttribute('aria-label');
  }
}

function render(text) {
  const recipe = parse(text);
  computeSpans(recipe);
  schedule(recipe);
  renderMeta(recipe);
  renderChart(recipe);
  renderSteps(recipe);
  requestAnimationFrame(updateHint);
}

function encodeZ(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeZ(value) {
  let source = String(value).replace(/-/g, '+').replace(/_/g, '/');
  while (source.length % 4) source += '=';
  const binary = atob(source);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const params = new URLSearchParams(location.search);
const themeParam = params.get('theme');
if (themeParam === 'light' || themeParam === 'dark') {
  document.documentElement.dataset.theme = themeParam;
}

const titleHidden = params.get('title') === '0';
if (titleHidden) $('head').hidden = true;

const isEditMode = params.get('edit') === '1';
const sourceEl = $('source');

let initialSource = SAMPLE;
if (params.get('z')) {
  try {
    initialSource = decodeZ(params.get('z'));
  } catch (error) {
    initialSource = SAMPLE;
  }
} else if (params.get('r')) {
  initialSource = params.get('r');
}

if (isEditMode) {
  $('editor').hidden = false;
  sourceEl.value = initialSource;
}

render(initialSource);

let statusTimer;
function setStatus(message) {
  const status = $('status');
  status.textContent = message;
  clearTimeout(statusTimer);
  if (message) {
    statusTimer = setTimeout(() => {
      status.textContent = '';
    }, 3600);
  }
}

if (isEditMode) {
  $('render').addEventListener('click', () => {
    render(sourceEl.value);
    setStatus('Chart updated.');
  });

  sourceEl.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      $('render').click();
    }
  });

  $('copy').addEventListener('click', async () => {
    if (location.protocol === 'file:') {
      setStatus('Host this page first; file links cannot be embedded.');
      return;
    }

    const recipe = sourceEl.value.trim() || SAMPLE;
    const theme = themeParam === 'light' || themeParam === 'dark' ? '&theme=' + themeParam : '';
    const hidden = titleHidden ? '&title=0' : '';
    const url = location.origin + location.pathname + '?z=' + encodeZ(recipe) + hidden + theme;

    try {
      await navigator.clipboard.writeText(url);
    } catch (error) {
      window.prompt('Copy this embed link:', url);
    }

    const local = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
    setStatus(local ? 'Copied. Host this page publicly before embedding.' : 'Embed link copied.');
  });
}

window.addEventListener('resize', updateHint);
