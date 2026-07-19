/**
 * @language  JavaScript (React / JSX)
 * @updated   2026-07-19
 * @changed   New inline-math composer: prose + live MathQuill fields share one contentEditable line, serialized to $...$ on read.
 */
import React, { useRef, useState, useCallback, useLayoutEffect, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { EditableMathField, addStyles as addMathquillStyles } from 'react-mathquill';
import { looksLikeMath } from '../utils/markdown';

// MathQuill ships its own stylesheet that must be injected once before any field
// renders. addStyles() is idempotent, so a module-load call is safe.
addMathquillStyles();

// Monotonic id source for math-field host spans. A plain counter (not
// Date.now/Math.random) keeps ids stable and collision-free within a session.
let _fieldSeq = 0;
const nextFieldId = () => `rmi-${++_fieldSeq}`;

// Split a stored value string ("text $x^2$ more") into ordered parts so an
// external write (send-clear, quick prompt, voice transcription) can be rebuilt
// into the editor DOM. Uses the shared looksLikeMath rule so a bare "$5" price
// stays text rather than becoming a field. Display math ($$…$$) is normalised to
// a single inline field — the composer only edits inline expressions.
function parseValue(str) {
  const parts = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  let m;
  while ((m = re.exec(str))) {
    const tex = m[1] != null ? m[1] : m[2];
    if (m[1] == null && !looksLikeMath(tex)) {
      // Rejected inline pair (e.g. currency) — skip only its opening $ so real
      // math later in the string still pairs up.
      re.lastIndex = m.index + 1;
      continue;
    }
    if (m.index > last) parts.push({ type: 'text', value: str.slice(last, m.index) });
    parts.push({ type: 'math', latex: tex.trim() });
    last = re.lastIndex;
  }
  if (last < str.length) parts.push({ type: 'text', value: str.slice(last) });
  return parts;
}

/**
 * A chat composer surface that holds plain prose and live, in-line MathQuill
 * fields on the same editable line. The `<textarea>` it replaces could only hold
 * flat text; this contentEditable div lets an equation stay a rendered, editable
 * field right where the caret is instead of collapsing to `$...$`.
 *
 * Controlled/uncontrolled split: the div is UNCONTROLLED for editing (React never
 * rewrites its innerHTML from props, so the caret never jumps). It emits the
 * serialized `$...$` string up via onChange so the parent's `input` state stays
 * in sync; it only rebuilds its DOM from `value` when the parent writes a value
 * we didn't just emit (send-clear, quick prompt, voice).
 */
const RichMathInput = forwardRef(function RichMathInput(
  { value, onChange, onSend, onPaste, placeholder, disabled, className, domRef },
  ref,
) {
  const editorRef = useRef(null);
  // id -> latex for every live field currently in the line. Mirrored into a ref
  // so serialize()/handleInput read the latest map without a stale closure.
  const [fields, setFields] = useState({});
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  // The last string we pushed up via onChange. Guards the value-sync effect from
  // rebuilding the DOM (and nuking the caret) in response to our own emit.
  // Starts undefined so a non-empty initial value still builds on first mount.
  const lastEmittedRef = useRef(undefined);
  // Field id to focus once its portal mounts (set when ƒ× inserts a new field).
  const pendingFocusRef = useRef(null);
  const [isEmpty, setIsEmpty] = useState(!value);

  // Walk the editor's child nodes in document order and rebuild the flat value:
  // text nodes verbatim, math host spans back to `$latex$`, <br> to newline. This
  // is the single source of truth for what gets sent.
  const serialize = useCallback(() => {
    const el = editorRef.current;
    if (!el) return '';
    let out = '';
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.nodeValue;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const id = node.dataset?.mathId;
        if (id) {
          const tex = (fieldsRef.current[id] || '').trim();
          if (tex) out += `$${tex}$`;
        } else if (node.tagName === 'BR') {
          out += '\n';
        } else {
          out += node.textContent;
        }
      }
    });
    return out;
  }, []);

  // Push the current serialized value to the parent, recording it so the
  // value-sync effect knows this change originated here.
  const emitChange = useCallback(() => {
    const s = serialize();
    lastEmittedRef.current = s;
    onChange?.(s);
  }, [serialize, onChange]);

  // Reconcile React field state against the DOM after every edit: the browser
  // deletes a host span natively when the user backspaces a field, so drop any
  // field whose span is gone. Also refresh the empty flag (drives the
  // placeholder) and emit the new value.
  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const present = new Set(
      Array.from(el.querySelectorAll('[data-math-id]')).map((n) => n.dataset.mathId),
    );
    setFields((prev) => {
      let changed = false;
      const next = {};
      for (const id of Object.keys(prev)) {
        if (present.has(id)) next[id] = prev[id];
        else changed = true;
      }
      return changed ? next : prev;
    });
    setIsEmpty(present.size === 0 && el.textContent.trim() === '');
    emitChange();
  }, [emitChange]);

  // Rebuild the editor DOM from a value string. Only called for EXTERNAL writes
  // (parseValue → text nodes + empty host spans), then seeds field latex state so
  // the portals mount with the right expressions.
  const buildFromValue = useCallback((str) => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = '';
    const nextFields = {};
    parseValue(str).forEach((part) => {
      if (part.type === 'text') {
        el.appendChild(document.createTextNode(part.value));
      } else {
        const id = nextFieldId();
        const span = document.createElement('span');
        span.dataset.mathId = id;
        span.contentEditable = 'false';
        span.className = 'rmi-field';
        el.appendChild(span);
        nextFields[id] = part.latex;
      }
    });
    setFields(nextFields);
    setIsEmpty(str.trim() === '');
    lastEmittedRef.current = str;
  }, []);

  // Insert a fresh, empty math field at the caret (ƒ× button). Splits the current
  // text node so the field lands exactly where the cursor is, drops a trailing
  // text node so the caret has somewhere to go after the field, and queues the
  // field for autofocus so the user can type the equation immediately.
  const insertMath = useCallback(() => {
    const el = editorRef.current;
    if (!el || disabled) return;
    el.focus();
    const sel = window.getSelection();
    let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!range || !el.contains(range.commonAncestorContainer)) {
      // No caret in the editor (e.g. inserting from an unfocused state) — append.
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    range.deleteContents();
    const id = nextFieldId();
    const span = document.createElement('span');
    span.dataset.mathId = id;
    span.contentEditable = 'false';
    span.className = 'rmi-field';
    range.insertNode(span);
    // Ensure a caret landing spot after the field, then place the caret there.
    const after = document.createTextNode(' ');
    span.after(after);
    const caret = document.createRange();
    caret.setStart(after, after.length);
    caret.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caret);
    pendingFocusRef.current = id;
    setFields((prev) => ({ ...prev, [id]: '' }));
    setIsEmpty(false);
    emitChange();
  }, [disabled, emitChange]);

  // Update one field's latex as the user edits inside MathQuill, then re-emit.
  const updateFieldLatex = useCallback((id, latex) => {
    setFields((prev) => (prev[id] === latex ? prev : { ...prev, [id]: latex }));
    // fieldsRef updates on re-render; emit after so serialize sees the new latex.
    fieldsRef.current = { ...fieldsRef.current, [id]: latex };
    emitChange();
  }, [emitChange]);

  // Expose the imperative surface the composer drives: ƒ× insertion + focus.
  useImperativeHandle(ref, () => ({ insertMath, focus: () => editorRef.current?.focus() }), [insertMath]);

  // Mirror the DOM node up to the parent's domRef so its existing auto-grow
  // effect (height from scrollHeight) keeps working unchanged.
  const attachEditor = useCallback((node) => {
    editorRef.current = node;
    if (typeof domRef === 'function') domRef(node);
    else if (domRef) domRef.current = node;
  }, [domRef]);

  // Value-sync: rebuild only when the parent writes a value we did not emit (send
  // clears to '', quick prompt / voice set text). Our own edits set lastEmitted,
  // so they short-circuit here and the caret is left untouched.
  useLayoutEffect(() => {
    const incoming = value || '';
    if (incoming === lastEmittedRef.current) return;
    buildFromValue(incoming);
  }, [value, buildFromValue]);

  // Enter (no Shift) sends; Shift+Enter is a newline. Keydown inside a MathQuill
  // field never reaches here — portalled fields aren't React descendants of this
  // div, and the field's own handler stops Enter — so equations edit freely.
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend?.();
    }
  }, [onSend]);

  // Paste: let the parent handle image paste first (it pins images to the
  // prompt); if it didn't consume the event, insert clipboard text as PLAIN text
  // so pasted rich HTML never pollutes the contentEditable.
  const handlePaste = useCallback((e) => {
    onPaste?.(e);
    if (e.defaultPrevented) return;
    const text = e.clipboardData?.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    handleInput();
  }, [onPaste, handleInput]);

  return (
    <div className="relative">
      <div
        ref={attachEditor}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Message"
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        className={className}
      />
      {/* Placeholder overlay — contentEditable has no native placeholder, so show
          our own only while the line is truly empty. */}
      {isEmpty && (
        <span className="pointer-events-none absolute left-1 top-2 text-gray-400 text-base sm:text-lg select-none">
          {placeholder}
        </span>
      )}
      {/* One live MathQuill field portalled into each host span. Rendering as a
          portal (not a child of the editable div) keeps the field out of this
          div's React event tree, so its Enter/typing never triggers send. */}
      {Object.keys(fields).map((id) => {
        const host = editorRef.current?.querySelector(`[data-math-id="${id}"]`);
        if (!host) return null;
        return createPortal(
          <EditableMathField
            latex={fields[id]}
            onChange={(mf) => updateFieldLatex(id, mf.latex())}
            mathquillDidMount={(mf) => {
              if (pendingFocusRef.current === id) {
                mf.focus();
                pendingFocusRef.current = null;
              }
            }}
            // Keep Enter/Escape inside the equation from bubbling to send.
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') e.stopPropagation();
            }}
            className="rmi-mathfield"
          />,
          host,
        );
      })}
    </div>
  );
});

export default RichMathInput;
