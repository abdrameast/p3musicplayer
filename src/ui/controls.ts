import { h } from './dom';

/** Section heading used inside panels: English label + Japanese annotation. */
export function sectionTitle(text: string, jp: string): HTMLElement {
  return h('h3', { class: 'mf-section-title' }, h('span', null, text), h('span', { class: 'mf-section-title__jp', lang: 'ja' }, jp));
}

export interface Segmented<T extends string> {
  readonly el: HTMLElement;
  set(value: T): void;
  dispose(): void;
}

/** Row of slanted toggle buttons (aria-pressed) with exactly one selected. */
export function segmented<T extends string>(
  label: string,
  options: ReadonlyArray<readonly [value: T, text: string]>,
  current: T,
  onSelect: (value: T) => void,
): Segmented<T> {
  const buttons = new Map<T, HTMLButtonElement>();
  const el = h('div', { class: 'mf-segmented', role: 'group', 'aria-label': label });
  const listeners = new AbortController();
  for (const [value, text] of options) {
    const button = h('button', { type: 'button', class: 'mf-segmented__opt', 'aria-pressed': 'false' }, text);
    button.addEventListener('click', () => onSelect(value), { signal: listeners.signal });
    buttons.set(value, button);
    el.append(button);
  }
  const set = (value: T) => {
    for (const [v, button] of buttons) button.setAttribute('aria-pressed', String(v === value));
  };
  set(current);
  return { el, set, dispose: () => listeners.abort() };
}

export interface Switch {
  readonly el: HTMLElement;
  set(on: boolean): void;
  dispose(): void;
}

/** role="switch" toggle with a visible ON/OFF state. */
export function switchControl(label: string, on: boolean, onChange: (on: boolean) => void): Switch {
  const state = h('span', { class: 'mf-switch__state', 'aria-hidden': 'true' });
  const button = h(
    'button',
    { type: 'button', class: 'mf-switch', role: 'switch', 'aria-checked': 'false' },
    h('span', { class: 'mf-switch__label' }, label),
    h('span', { class: 'mf-switch__track', 'aria-hidden': 'true' }, h('span', { class: 'mf-switch__knob' })),
    state,
  );
  const listeners = new AbortController();
  button.addEventListener('click', () => onChange(button.getAttribute('aria-checked') !== 'true'), {
    signal: listeners.signal,
  });
  const set = (value: boolean) => {
    button.setAttribute('aria-checked', String(value));
    state.textContent = value ? 'ON' : 'OFF';
  };
  set(on);
  return { el: button, set, dispose: () => listeners.abort() };
}
