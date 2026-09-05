export interface PresentableWindow {
  show(): void;
  focus(): void;
}

/** Present the main window without mutating its persistent z-order. */
export function presentMainWindow(window: PresentableWindow): void {
  window.show();
  window.focus();
}
