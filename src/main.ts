// Entry point: fonts, styles, button wiring and the resize observer.

import '@fontsource/bagel-fat-one/latin-400.css';
import '@fontsource/fredoka/latin-400.css';
import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import './style.css';

import { toggleSound } from './audio';
import { fit, restart, start } from './game';
import { setSoundLabel } from './hud';

function el<T extends HTMLElement>(id: string): T {
  const n = document.getElementById(id);
  if (!n) throw new Error(`missing #${id}`);
  return n as T;
}

const canvas = el<HTMLCanvasElement>('c');
const stage = el('stage');

el('rst').addEventListener('click', () => restart());
el('again').addEventListener('click', () => restart());
el('snd').addEventListener('click', () => setSoundLabel(toggleSound()));

new ResizeObserver(() => fit()).observe(stage);

start(canvas, stage);
