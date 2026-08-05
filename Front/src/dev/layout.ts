// HUD layout registry: scenes register named containers; saved positions from
// layout.json (plus dev localStorage overrides) are applied on registration.
// In layout-edit mode, registered containers become draggable (move) and
// wheel-scalable (resize), with a highlight box and live coordinates.
import Phaser from 'phaser';
import savedLayout from '../config/layout.json';
import { devState } from './state';

export interface LayoutEntry {
  name: string;
  obj: Phaser.GameObjects.Container;
  scene: Phaser.Scene;
  bounds: { x: number; y: number; w: number; h: number }; // in container space
  outline?: Phaser.GameObjects.Graphics;
  label?: Phaser.GameObjects.Text;
}

type LayoutData = Record<string, { x: number; y: number; scale: number }>;

export const layoutData: LayoutData = { ...(savedLayout as LayoutData) };

if (import.meta.env.DEV) {
  try {
    const raw = localStorage.getItem('dev-layout');
    if (raw) Object.assign(layoutData, JSON.parse(raw));
  } catch {
    /* ignore */
  }
}

function persistLayoutLocal(): void {
  if (!import.meta.env.DEV) return;
  try {
    localStorage.setItem('dev-layout', JSON.stringify(layoutData));
  } catch {
    /* ignore */
  }
}

const entries: LayoutEntry[] = [];

export function registerLayout(
  scene: Phaser.Scene,
  name: string,
  obj: Phaser.GameObjects.Container,
  bounds: { x: number; y: number; w: number; h: number }
): void {
  const saved = layoutData[name];
  if (saved) obj.setPosition(saved.x, saved.y).setScale(saved.scale);
  const entry: LayoutEntry = { name, obj, scene, bounds };
  entries.push(entry);
  scene.events.once('shutdown', () => {
    const i = entries.indexOf(entry);
    if (i >= 0) entries.splice(i, 1);
  });
  if (import.meta.env.DEV && devState.layoutEdit) enableEntry(entry);
}

function record(entry: LayoutEntry): void {
  layoutData[entry.name] = {
    x: Math.round(entry.obj.x),
    y: Math.round(entry.obj.y),
    scale: Number(entry.obj.scaleX.toFixed(3))
  };
  persistLayoutLocal();
}

function refreshOverlay(entry: LayoutEntry): void {
  const { obj, bounds } = entry;
  entry.outline?.destroy();
  entry.label?.destroy();
  const g = entry.scene.add.graphics().setDepth(5000);
  g.lineStyle(2, 0x9b5de5, 1);
  const s = obj.scaleX;
  g.strokeRect(obj.x + bounds.x * s, obj.y + bounds.y * s, bounds.w * s, bounds.h * s);
  entry.outline = g;
  entry.label = entry.scene.add
    .text(obj.x + bounds.x * s, obj.y + bounds.y * s - 18, `${entry.name}  x:${Math.round(obj.x)} y:${Math.round(obj.y)} ×${obj.scaleX.toFixed(2)}`, {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#9B5DE5',
      backgroundColor: '#17202A'
    })
    .setDepth(5000);
}

function enableEntry(entry: LayoutEntry): void {
  const { obj, scene, bounds } = entry;
  obj.setInteractive(
    new Phaser.Geom.Rectangle(bounds.x, bounds.y, bounds.w, bounds.h),
    Phaser.Geom.Rectangle.Contains
  );
  scene.input.setDraggable(obj);
  obj.on('drag', (_p: Phaser.Input.Pointer, dragX: number, dragY: number) => {
    obj.setPosition(Math.round(dragX), Math.round(dragY));
    record(entry);
    refreshOverlay(entry);
  });
  obj.on('wheel', (_p: Phaser.Input.Pointer, _dx: number, dy: number) => {
    const old = obj.scaleX;
    const next = Phaser.Math.Clamp(old * (dy > 0 ? 0.95 : 1.05), 0.4, 2.5);
    // keep the cluster's visual center fixed while scaling
    const cx = obj.x + (bounds.x + bounds.w / 2) * old;
    const cy = obj.y + (bounds.y + bounds.h / 2) * old;
    obj.setScale(next);
    obj.setPosition(cx - (bounds.x + bounds.w / 2) * next, cy - (bounds.y + bounds.h / 2) * next);
    record(entry);
    refreshOverlay(entry);
  });
  refreshOverlay(entry);
}

function disableEntry(entry: LayoutEntry): void {
  entry.obj.off('drag');
  entry.obj.off('wheel');
  entry.obj.disableInteractive();
  entry.outline?.destroy();
  entry.label?.destroy();
  entry.outline = undefined;
  entry.label = undefined;
}

export function setLayoutEdit(on: boolean): void {
  devState.layoutEdit = on;
  for (const e of entries) {
    if (on) enableEntry(e);
    else disableEntry(e);
  }
}
