import type { AppEvent } from './state.js';

/** What every view gets from the app controller. */
export interface ViewContext {
  dispatch(event: AppEvent): void;
}

/** What every view hands back to the app controller. */
export interface ViewHandle {
  root: HTMLElement;
  dispose?(): void;
  /** Immediate refresh for the offline banner's "Retry" button. */
  refresh?(): void;
}
