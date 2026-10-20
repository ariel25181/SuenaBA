import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window as any;
const g = globalThis as any;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'Node', 'Element', 'Event', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle', 'DocumentFragment', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame'])
  if (!(k in g) || k === 'window' || k === 'document') Object.defineProperty(g, k, { value: w[k], configurable: true, writable: true });
Object.defineProperty(g, 'navigator', { value: w.navigator, configurable: true });
g.IS_REACT_ACT_ENVIRONMENT = true;
