export type ShortcutAction =
  | 'toggle-play'
  | 'previous'
  | 'next'
  | 'volume-up'
  | 'volume-down'
  | 'mute'
  | 'tracklist'
  | 'sync'
  | 'fullscreen'
  | 'close'
  | 'debug';

export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  target?: EventTarget | null;
}

export interface ShortcutContext {
  isDev: boolean;
}

/** Help text, also rendered in the settings panel. */
export const SHORTCUT_HELP: ReadonlyArray<readonly [keys: string, action: string]> = [
  ['Space', 'Play / pause'],
  ['← / →', 'Previous / next track'],
  ['↑ / ↓', 'Volume up / down'],
  ['M', 'Mute'],
  ['T', 'Tracklist'],
  ['S', 'Audio sync'],
  ['F', 'Fullscreen'],
  ['Esc', 'Close panels'],
];

/** Elements whose own Space/arrow handling must win (tracklist rows, mode cards…). */
export const NATIVE_KEYS_ATTR = 'data-native-keys';

type TargetKind = 'editable' | 'control' | 'none';

interface ElementLike {
  tagName?: string;
  closest?(selector: string): unknown;
  getAttribute?(name: string): string | null;
}

const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']);
const CONTROL_ROLES = new Set(['button', 'slider', 'link', 'menuitem', 'option', 'tab', 'switch', 'radio', 'checkbox', 'spinbutton']);

function classifyTarget(target: EventTarget | null | undefined): TargetKind {
  const el = target as ElementLike | null | undefined;
  if (!el || typeof el.tagName !== 'string') return 'none';
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return 'editable';
  if (tag === 'input') {
    const type = (el.getAttribute?.('type') ?? 'text').toLowerCase();
    return NON_TEXT_INPUTS.has(type) ? 'control' : 'editable';
  }
  if (el.closest?.('[contenteditable]:not([contenteditable="false"])')) return 'editable';
  if (tag === 'button' || tag === 'summary' || (tag === 'a' && el.getAttribute?.('href') !== null)) return 'control';
  const role = el.getAttribute?.('role');
  if (role && CONTROL_ROLES.has(role)) return 'control';
  if (el.closest?.(`[${NATIVE_KEYS_ATTR}]`)) return 'control';
  return 'none';
}

const NAVIGATION_KEYS = new Set([' ', 'Spacebar', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
const REPEATABLE = new Set<ShortcutAction>(['volume-up', 'volume-down']);

/**
 * Maps a key event to an app action. Pure: no DOM writes, testable with
 * plain objects. Never steals typing, browser/OS shortcuts (Ctrl/Meta/Alt),
 * or the native Space/arrow behaviour of focused controls.
 */
export function resolveShortcut(event: KeyEventLike, ctx: ShortcutContext): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const kind = classifyTarget(event.target);
  if (kind === 'editable') return null;
  if (kind === 'control' && NAVIGATION_KEYS.has(event.key)) return null;

  const action = mapKey(event.key, ctx);
  if (!action) return null;
  if (event.repeat && !REPEATABLE.has(action)) return null;
  return action;
}

function mapKey(key: string, ctx: ShortcutContext): ShortcutAction | null {
  switch (key) {
    case ' ':
    case 'Spacebar':
      return 'toggle-play';
    case 'ArrowLeft':
      return 'previous';
    case 'ArrowRight':
      return 'next';
    case 'ArrowUp':
      return 'volume-up';
    case 'ArrowDown':
      return 'volume-down';
    case 'Escape':
    case 'Esc':
      return 'close';
  }
  switch (key.toLowerCase()) {
    case 'm':
      return 'mute';
    case 't':
      return 'tracklist';
    case 's':
      return 'sync';
    case 'f':
      return 'fullscreen';
    case 'd':
      return ctx.isDev ? 'debug' : null;
    default:
      return null;
  }
}

export type ShortcutHandlers = Partial<Record<ShortcutAction, () => void>>;

/** Window-level listener dispatching resolved shortcuts. */
export class KeyboardShortcuts {
  private attached: Window | null = null;

  constructor(
    private readonly handlers: ShortcutHandlers,
    private readonly ctx: ShortcutContext,
  ) {}

  attach(target: Window = window): void {
    if (this.attached) return;
    this.attached = target;
    target.addEventListener('keydown', this.onKeydown);
  }

  dispose(): void {
    this.attached?.removeEventListener('keydown', this.onKeydown);
    this.attached = null;
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing) return;
    const action = resolveShortcut(event, this.ctx);
    if (!action) return;
    const handler = this.handlers[action];
    if (!handler) return;
    event.preventDefault();
    handler();
  };
}
