import './ui/styles';
import { App } from './core/App';

const root = document.getElementById('app');

function showFatal(host: HTMLElement, error: unknown): void {
  console.error('[MIDNIGHT FREQUENCY] start-up failed', error);
  const box = document.createElement('div');
  box.className = 'fatal';
  box.setAttribute('role', 'alert');
  const title = document.createElement('p');
  title.className = 'fatal__title';
  title.textContent = 'SIGNAL LOST';
  const text = document.createElement('p');
  text.className = 'fatal__text';
  text.textContent = 'The experience could not start. Please reload the page.';
  box.append(title, text);
  host.replaceChildren(box);
}

if (root) {
  const app = new App(root);
  app.start().catch((error: unknown) => {
    app.dispose();
    showFatal(root, error);
  });
  if (import.meta.hot) import.meta.hot.dispose(() => app.dispose());
}
