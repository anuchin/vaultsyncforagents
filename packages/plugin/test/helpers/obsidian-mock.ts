/**
 * Minimal fake of the `obsidian` module for unit tests (there is no real
 * Obsidian in CI — that is expected and fine). Only the surface the plugin
 * actually uses is implemented; everything records interactions so tests can
 * drive the UI imperatively.
 *
 * Wired in via the vitest `resolve.alias` (see vitest.config.ts).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ButtonRecord {
  text: string;
  cta: boolean;
  disabled: boolean;
  onClick: () => void | Promise<void>;
}

export interface SettingRecord {
  name: string;
  desc: string;
  className: string | null;
  heading: boolean;
  text: { value: string; placeholder: string; onChange: (value: string) => void } | null;
  textarea: { value: string; placeholder: string; onChange: (value: string) => void } | null;
  toggle: { value: boolean; onChange: (value: boolean) => void } | null;
  dropdown: { value: string; options: Record<string, string>; onChange: (value: string) => void } | null;
  buttons: ButtonRecord[];
}

export class Setting {
  static instances: SettingRecord[] = [];
  readonly record: SettingRecord;

  constructor(_containerEl: unknown) {
    this.record = {
      name: '',
      desc: '',
      className: null,
      heading: false,
      text: null,
      textarea: null,
      toggle: null,
      dropdown: null,
      buttons: [],
    };
    Setting.instances.push(this.record);
  }

  setName(name: string): this {
    this.record.name = name;
    return this;
  }

  setDesc(desc: string): this {
    this.record.desc = desc;
    return this;
  }

  setClass(cls: string): this {
    this.record.className = cls;
    return this;
  }

  /** Section headings (name-only Settings styled as headings). */
  setHeading(): this {
    this.record.heading = true;
    return this;
  }

  // Component methods chain on the *component* in the real API
  // (`text.setPlaceholder(…).setValue(…)`), so each stub returns itself —
  // never the enclosing Setting.

  addText(callback: (component: TextComponentStub) => unknown): this {
    const state = { value: '', placeholder: '', onChange: (_value: string) => {} };
    this.record.text = state;
    const stub: TextComponentStub = {
      setPlaceholder: (placeholder: string) => {
        state.placeholder = placeholder;
        return stub;
      },
      setValue: (value: string) => {
        state.value = value;
        return stub;
      },
      onChange: (fn: (value: string) => void) => {
        state.onChange = fn;
        return stub;
      },
    };
    callback(stub);
    return this;
  }

  /** Multi-line text (the Ignore patterns setting). Same stub shape as text. */
  addTextArea(callback: (component: TextComponentStub) => unknown): this {
    const state = { value: '', placeholder: '', onChange: (_value: string) => {} };
    this.record.textarea = state;
    const stub: TextComponentStub = {
      setPlaceholder: (placeholder: string) => {
        state.placeholder = placeholder;
        return stub;
      },
      setValue: (value: string) => {
        state.value = value;
        return stub;
      },
      onChange: (fn: (value: string) => void) => {
        state.onChange = fn;
        return stub;
      },
    };
    callback(stub);
    return this;
  }

  addToggle(callback: (component: ToggleComponentStub) => unknown): this {
    const state = { value: false, onChange: (_value: boolean) => {} };
    this.record.toggle = state;
    const stub: ToggleComponentStub = {
      setValue: (value: boolean) => {
        state.value = value;
        return stub;
      },
      onChange: (fn: (value: boolean) => void) => {
        state.onChange = fn;
        return stub;
      },
    };
    callback(stub);
    return this;
  }

  addDropdown(callback: (component: DropdownComponentStub) => unknown): this {
    const state = { value: '', options: {} as Record<string, string>, onChange: (_value: string) => {} };
    this.record.dropdown = state;
    const stub: DropdownComponentStub = {
      addOption: (value: string, display: string) => {
        state.options[value] = display;
        return stub;
      },
      setValue: (value: string) => {
        state.value = value;
        return stub;
      },
      onChange: (fn: (value: string) => void) => {
        state.onChange = fn;
        return stub;
      },
    };
    callback(stub);
    return this;
  }

  addButton(callback: (component: ButtonComponentStub) => unknown): this {
    const button: ButtonRecord = { text: '', cta: false, disabled: false, onClick: async () => {} };
    this.record.buttons.push(button);
    const stub: ButtonComponentStub = {
      setCta: () => {
        button.cta = true;
        return stub;
      },
      setButtonText: (text: string) => {
        button.text = text;
        return stub;
      },
      setDisabled: (disabled: boolean) => {
        button.disabled = disabled;
        return stub;
      },
      onClick: (fn: () => void | Promise<void>) => {
        button.onClick = fn;
        return stub;
      },
    };
    callback(stub);
    return this;
  }
}

export interface TextComponentStub {
  setPlaceholder(placeholder: string): unknown;
  setValue(value: string): unknown;
  onChange(fn: (value: string) => void): unknown;
}
export interface ToggleComponentStub {
  setValue(value: boolean): unknown;
  onChange(fn: (value: boolean) => void): unknown;
}
export interface DropdownComponentStub {
  addOption(value: string, display: string): unknown;
  setValue(value: string): unknown;
  onChange(fn: (value: string) => void): unknown;
}
export interface ButtonComponentStub {
  setCta(): unknown;
  setButtonText(text: string): unknown;
  setDisabled(disabled: boolean): unknown;
  onClick(fn: () => void | Promise<void>): unknown;
}

export class Notice {
  /** All notices issued since the last mock reset (with durations). */
  static messages: Array<{ message: string; duration?: number }> = [];
  constructor(message: string | DocumentFragment, duration?: number) {
    Notice.messages.push({ message: String(message), duration });
  }
}

export const Platform = {
  isDesktopApp: true,
  isDesktop: true,
  isMobile: false,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
  isPhone: false,
  isTablet: false,
};

/** Registered protocol handlers: action → callback. */
export const protocolHandlers: Record<string, (params: Record<string, unknown>) => void> = {};

export function registerObsidianProtocolHandler(
  action: string,
  callback: (params: Record<string, unknown>) => void,
): void {
  protocolHandlers[action] = callback;
}

export class Modal {
  static instances: Array<{ onOpenCalled: boolean; openCalled: boolean }> = [];
  /** The modal objects themselves, so tests can dismiss them directly. */
  static opened: Modal[] = [];
  app: unknown;
  contentEl: Record<string, unknown> = {};
  private readonly record = { onOpenCalled: false, openCalled: false };
  constructor(app?: unknown) {
    this.app = app;
    Modal.instances.push(this.record);
    Modal.opened.push(this);
  }
  open(): void {
    this.record.openCalled = true;
    this.onOpen();
  }
  close(): void {
    this.onClose?.();
  }
  onOpen(): void {}
  onClose?(): void {}
}

export class PluginSettingTab {
  app: unknown;
  plugin: unknown;
  containerEl: {
    children: unknown[];
    emptied: number;
    empty(): void;
  } = {
    children: [],
    emptied: 0,
    empty() {
      this.children.length = 0;
      this.emptied += 1;
    },
  };
  constructor(app: unknown, plugin: unknown) {
    this.app = app;
    this.plugin = plugin;
  }
  display(): void {}
  hide(): void {}
}

export class Plugin {
  app: any;
  manifest: any;
  /** In-memory data.json stand-in. */
  store: Record<string, unknown> | null = null;
  settingTabs: PluginSettingTab[] = [];
  statusBarItems: Array<Record<string, unknown>> = [];
  registeredIntervals: number[] = [];
  registeredEventRefs: unknown[] = [];
  /** Commands registered via addCommand (the command palette entries). */
  readonly commands: MockCommand[] = [];

  constructor(app: any, manifest: any) {
    this.app = app;
    this.manifest = manifest;
  }

  async loadData(): Promise<Record<string, unknown> | null> {
    return this.store === null ? null : JSON.parse(JSON.stringify(this.store));
  }

  async saveData(data: unknown): Promise<void> {
    this.store = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  }

  addCommand(command: MockCommand): MockCommand {
    this.commands.push(command);
    return command;
  }

  addSettingTab(tab: PluginSettingTab): void {
    this.settingTabs.push(tab);
  }

  registerObsidianProtocolHandler(
    action: string,
    handler: (params: Record<string, unknown>) => void,
  ): void {
    registerObsidianProtocolHandler(action, handler);
  }

  addStatusBarItem(): Record<string, unknown> {
    const item = {
      textContent: '',
      classes: new Set<string>(),
      attributes: {} as Record<string, string>,
      addClass(cls: string) {
        this.classes.add(cls);
      },
      removeClass(cls: string) {
        this.classes.delete(cls);
      },
      setAttribute(name: string, value: string) {
        this.attributes[name] = value;
      },
      removed: false,
      remove() {
        this.removed = true;
      },
    };
    this.statusBarItems.push(item);
    return item;
  }

  registerEvent(ref: unknown): unknown {
    this.registeredEventRefs.push(ref);
    return ref;
  }

  registerInterval(id: number): number {
    this.registeredIntervals.push(id);
    return id;
  }

  onunload(): void {}
}

/** A recorded `addCommand` registration (id + name + callback). */
export interface MockCommand {
  id: string;
  name: string;
  callback: () => unknown;
}

/** The mock-only surface of a plugin instance (recorded UI state). */
export interface MockPluginSurface {
  store: Record<string, unknown> | null;
  settingTabs: PluginSettingTab[];
  statusBarItems: Array<Record<string, any>>;
  registeredIntervals: number[];
  commands: MockCommand[];
}

/** Tests reach the mock's bookkeeping through this cast. */
export function asMockPlugin(plugin: unknown): MockPluginSurface {
  return plugin as MockPluginSurface;
}

/** Reset all recorded state (call in beforeEach). */
export function resetObsidianMock(): void {
  Setting.instances = [];
  Notice.messages = [];
  Modal.instances = [];
  Modal.opened = [];
  for (const action of Object.keys(protocolHandlers)) delete protocolHandlers[action];
  Platform.isDesktopApp = true;
  Platform.isDesktop = true;
  Platform.isMobile = false;
  Platform.isMobileApp = false;
  Platform.isIosApp = false;
  Platform.isAndroidApp = false;
}
