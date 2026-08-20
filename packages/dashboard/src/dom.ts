/**
 * Minimal hand-rolled DOM toolkit — the whole "component layer" of this SPA
 * is `h()` plus a few focused helpers. No framework by design (§10: the
 * dashboard ships inside the worker and must stay tiny).
 */

type AttrValue = string | number | boolean | undefined | ((event: Event) => void);

/** Create an element with attrs (`class`, `on*` listeners) and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (name === 'class') {
      el.className = String(value);
    } else if (name === 'text') {
      el.textContent = String(value);
    } else if (name.startsWith('on') && typeof value === 'function') {
      el.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
    } else {
      el.setAttribute(name, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return el;
}

export function fragment(...children: Array<Node | string | null | undefined | false>): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    frag.append(child);
  }
  return frag;
}

/** Labeled input row used by every form in the app. */
export function field(
  label: string,
  input: HTMLInputElement | HTMLSelectElement,
  hint?: string,
): HTMLLabelElement {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label', text: label }),
    input,
    ...(hint !== undefined ? [h('span', { class: 'field-hint', text: hint })] : []),
  );
}

export function textInput(attrs: Partial<{ name: string; placeholder: string; value: string; type: string }> = {}): HTMLInputElement {
  return h('input', { class: 'input', type: 'text', autocomplete: 'off', ...attrs });
}

export function primaryButton(label: string, onClick: () => void, attrs: Record<string, AttrValue> = {}): HTMLButtonElement {
  return h('button', { class: 'btn btn-primary', type: 'button', onclick: onClick, ...attrs }, label);
}

export function quietButton(label: string, onClick: () => void, attrs: Record<string, AttrValue> = {}): HTMLButtonElement {
  return h('button', { class: 'btn btn-quiet', type: 'button', onclick: onClick, ...attrs }, label);
}

/** Copy-to-clipboard button with transient "Copied" feedback. */
export function copyButton(getText: () => string, label = 'Copy'): HTMLButtonElement {
  const button = quietButton(label, () => {
    const text = getText();
    const done = (): void => {
      button.textContent = 'Copied';
      button.classList.add('copied');
      window.setTimeout(() => {
        button.textContent = label;
        button.classList.remove('copied');
      }, 1200);
    };
    if (navigator.clipboard?.writeText !== undefined) {
      void navigator.clipboard.writeText(text).then(done, done);
    } else {
      // Legacy fallback (non-secure contexts).
      const area = h('textarea', { class: 'sr-only', text }) as HTMLTextAreaElement;
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      done();
    }
  });
  return button;
}

/** Status pill (online/offline/revoked/ok/error). */
export function badge(text: string, tone: string): HTMLSpanElement {
  return h('span', { class: `badge badge-${tone}`, text });
}

export function spinner(label = 'Loading…'): HTMLDivElement {
  return h('div', { class: 'loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), label);
}

export function clear(el: HTMLElement): void {
  while (el.firstChild !== null) el.removeChild(el.firstChild);
}
