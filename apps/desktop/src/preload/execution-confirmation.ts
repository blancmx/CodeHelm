import { ipcRenderer } from 'electron';

// This sandboxed preload has no general-purpose bridge. Only trusted local input
// can answer this window's review; the main renderer cannot invoke its decision.
window.addEventListener('DOMContentLoaded', () => {
  let answered = false;
  const decide = (approved: boolean, event: Event) => {
    if (!event.isTrusted || answered) return;
    answered = true;
    document.querySelectorAll('button').forEach(button => { button.disabled = true; });
    ipcRenderer.send('codehelm:execution-review:decision', approved);
  };
  document.getElementById('approve')?.addEventListener('click', event => decide(true, event));
  for (const id of ['cancel', 'close']) {
    document.getElementById(id)?.addEventListener('click', event => decide(false, event));
  }
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); decide(false, event); }
  });
  document.getElementById('cancel')?.focus();
});
