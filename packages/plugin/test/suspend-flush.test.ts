import { describe, expect, it } from 'vitest';
import { installSuspendFlush, type DocumentLike } from '../src/suspend-flush.js';

class FakeDocument implements DocumentLike {
  visibilityState = 'visible';
  private listeners = new Map<string, Array<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener));
  }
  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }
}

describe('installSuspendFlush', () => {
  it('flushes on visibilitychange → hidden and on pagehide; not on visible', () => {
    const doc = new FakeDocument();
    let flushes = 0;
    const uninstall = installSuspendFlush({ document: doc, flush: () => { flushes += 1; } });

    doc.visibilityState = 'visible';
    doc.emit('visibilitychange');
    expect(flushes).toBe(0);

    doc.visibilityState = 'hidden';
    doc.emit('visibilitychange');
    expect(flushes).toBe(1);

    doc.emit('pagehide');
    expect(flushes).toBe(2);

    uninstall();
    doc.emit('visibilitychange');
    doc.emit('pagehide');
    expect(flushes).toBe(2);
    expect(doc.listenerCount('visibilitychange')).toBe(0);
    expect(doc.listenerCount('pagehide')).toBe(0);
  });

  it('returns a no-op uninstaller when no document exists', () => {
    const uninstall = installSuspendFlush({ flush: () => {} });
    expect(() => uninstall()).not.toThrow();
  });
});
