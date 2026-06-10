// Lazy-loaded common-words Set + post-processor that wraps non-common,
// >=6 char alphabetic words in `<span class="defineable" data-word="...">`.
// Hover handler in ChatPage reads `data-word` to fetch a definition.
//
// The wordlist intentionally only contains common English words >=6 chars
// (see scripts/build-wordlist note in repo). Words below that threshold
// never get wrapped, so they don't need to be in the list.

let _setPromise = null;

export const loadDefineableSet = () => {
  if (!_setPromise) {
    _setPromise = import('../assets/dictionary-words.json').then(
      (mod) => new Set(mod.default),
    );
  }
  return _setPromise;
};

const SKIP_TAGS = new Set([
  'CODE', 'PRE', 'A', 'SCRIPT', 'STYLE', 'TEXTAREA',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
]);

const shouldSkipElement = (el) => {
  if (!el || el.nodeType !== 1) return false;
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.classList) {
    for (const c of el.classList) {
      if (c === 'defineable' || c.startsWith('katex')) return true;
    }
  }
  return false;
};

const WORD_RE = /[A-Za-z]+/g;

const wrapTextNode = (textNode, commonSet) => {
  const text = textNode.nodeValue;
  if (!text) return false;
  WORD_RE.lastIndex = 0;
  let m;
  let lastIdx = 0;
  const parts = [];
  let wrappedAny = false;
  while ((m = WORD_RE.exec(text)) !== null) {
    const word = m[0];
    const start = m.index;
    if (word.length < 6) continue;
    if (commonSet.has(word.toLowerCase())) continue;
    if (start > lastIdx) parts.push({ kind: 'text', value: text.slice(lastIdx, start) });
    parts.push({ kind: 'word', value: word });
    wrappedAny = true;
    lastIdx = start + word.length;
  }
  if (!wrappedAny) return false;
  if (lastIdx < text.length) parts.push({ kind: 'text', value: text.slice(lastIdx) });

  const frag = document.createDocumentFragment();
  for (const p of parts) {
    if (p.kind === 'text') {
      frag.appendChild(document.createTextNode(p.value));
    } else {
      const span = document.createElement('span');
      span.className = 'defineable';
      span.dataset.word = p.value.toLowerCase();
      span.textContent = p.value;
      frag.appendChild(span);
    }
  }
  textNode.parentNode.replaceChild(frag, textNode);
  return true;
};

const processNode = (node, commonSet) => {
  if (node.nodeType === 3) {
    wrapTextNode(node, commonSet);
    return;
  }
  if (node.nodeType !== 1) return;
  if (shouldSkipElement(node)) return;
  const children = Array.from(node.childNodes);
  for (const child of children) processNode(child, commonSet);
};

export const wrapDefineableWordsInDom = (root, commonSet) => {
  if (!root || !commonSet) return;
  const children = Array.from(root.childNodes);
  for (const child of children) processNode(child, commonSet);
};
