// Desktop-only flanking panels (see index.html's #side-left/#side-right,
// shown above the 1180px breakpoint). Plain DOM/CSS — deliberately outside
// Phaser so it can't touch canvas input/rendering or regress mobile.
// Left panel: a live "Meme Collection" grid mirroring GalleryScene's
// unlocked-state tiles, reading the same persisted set from memeUnlocks.ts.
// Right panel: previews whichever meme was last clicked, with the same
// share/download actions GalleryScene's zoom view offers; when nothing is
// selected it shows an ambient backdrop that also hosts the new-unlock toast
// (paired with a glow/badge on the corresponding tile in the left grid).
import { MEMES } from './memes';
import { getBestDayReached, getUnlockedTemplates } from './memeUnlocks';
import { bus, EV, type DaySummary } from './state';
import { settings } from './settings';
import { drawWatermark, shareImage, shareCanvasTo, type SharePlatform } from './share';

const SHARE_ICONS: { platform: SharePlatform; icon: string }[] = [
  { platform: 'whatsapp', icon: 'icons/share-whatsapp.png' },
  { platform: 'x', icon: 'icons/share-x.png' },
  { platform: 'facebook', icon: 'icons/share-facebook.png' }
];

/** One DAY-tier section of the left grid — mirrors GalleryScene's grouping
 *  (buildSectionHeader/buildLockedStamp) so the panel reads like the in-game
 *  gallery: a "DAY N" header, "n/m unlocked" subtitle, and a locked stamp
 *  over tiers the account hasn't reached yet (getBestDayReached, account-wide). */
interface TierSection {
  tier: number;
  ids: string[];
  sectionEl: HTMLElement;
  subEl: HTMLElement;
  stampEl: HTMLElement | null;
}

let availableArt = new Set<string>();
let sections: TierSection[] = [];
let gridEl: HTMLElement | null = null;
let countEl: HTMLElement | null = null;
let previewHintEl: HTMLElement | null = null;
let previewCardEl: HTMLElement | null = null;
const tileEls = new Map<string, HTMLElement>();
let selectedId: string | null = null;

export async function initSidePanels(): Promise<void> {
  const leftPanel = document.getElementById('side-left');
  const rightPanel = document.getElementById('side-right');
  if (!leftPanel || !rightPanel) return;

  try {
    const res = await fetch('assets/index.json');
    if (res.ok) availableArt = new Set(await res.json());
  } catch {
    /* fall back to label tiles for everything */
  }

  buildGalleryPanel(leftPanel);
  buildPreviewPanel(rightPanel);

  bus.on(EV.DAY_END, (summary: DaySummary) => {
    if (summary.newMemesUnlocked?.length) onNewUnlocks(summary.newMemesUnlocked);
    refreshSections();
  });
  // A new day can push getBestDayReached() past a tier gate — un-dim that
  // section live, the way GalleryScene would on its next rebuild.
  bus.on(EV.DAY_START, () => refreshSections());
}

function tileArtHtml(id: string): string {
  const tpl = MEMES.templates[id];
  return availableArt.has(tpl.artFile)
    ? `<img src="assets/${tpl.artFile}" alt="" />`
    : `<span class="gallery-tile-label">${tpl.label}</span>`;
}

function buildGalleryPanel(panel: HTMLElement): void {
  const ids = Object.keys(MEMES.templates);
  const unlocked = getUnlockedTemplates();

  panel.innerHTML = `
    <div class="gallery-card">
      <div class="gallery-card-header">
        <span class="gallery-card-title">Meme Collection</span>
        <span class="gallery-card-count" id="gallery-count"></span>
      </div>
      <div class="gallery-card-meta"><span>Archive status</span><span>Today · live</span></div>
      <div class="gallery-search-row">
        <input class="gallery-search" id="gallery-search" type="search" placeholder="Search memes…" aria-label="Search meme collection" />
        <button class="gallery-filter" id="gallery-filter" type="button">ALL</button>
      </div>
      <div class="gallery-card-grid" id="gallery-grid"></div>
    </div>
  `;
  gridEl = panel.querySelector('#gallery-grid');
  countEl = panel.querySelector('#gallery-count');
  updateCount();

  if (!gridEl) return;
  const bestDay = Math.max(1, getBestDayReached());

  // Group by dayTier, same as GalleryScene.buildGrid.
  const tiers = new Map<number, string[]>();
  for (const id of ids) {
    const tier = MEMES.templates[id].dayTier;
    const bucket = tiers.get(tier);
    if (bucket) bucket.push(id);
    else tiers.set(tier, [id]);
  }

  sections = [];
  for (const tier of [...tiers.keys()].sort((a, b) => a - b)) {
    const tierIds = tiers.get(tier)!;
    const reached = tier <= bestDay;

    const sectionEl = document.createElement('div');
    sectionEl.className = `gallery-section${reached ? '' : ' tier-locked'}`;
    sectionEl.innerHTML = `
      <div class="gallery-section-header">
        <span class="gallery-section-title">DAY ${tier}</span>
        <span class="gallery-section-sub"></span>
      </div>
      <div class="gallery-section-grid"></div>
    `;
    const sectionGrid = sectionEl.querySelector('.gallery-section-grid')!;

    for (const id of tierIds) {
      const isUnlocked = unlocked.has(id);
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = `gallery-tile ${isUnlocked ? 'unlocked' : 'locked'}`;
      tile.dataset.label = MEMES.templates[id].label.toLowerCase();
      tile.dataset.unlocked = isUnlocked ? 'true' : 'false';
      tile.setAttribute('aria-label', `${MEMES.templates[id].label}${isUnlocked ? '' : ' (locked)'}`);
      tile.innerHTML = `${tileArtHtml(id)}<span class="gallery-tile-badge">NEW</span>`;
      if (isUnlocked) tile.addEventListener('click', () => selectTile(id));
      sectionGrid.appendChild(tile);
      tileEls.set(id, tile);
    }

    let stampEl: HTMLElement | null = null;
    if (!reached) {
      stampEl = document.createElement('div');
      stampEl.className = 'gallery-locked-stamp';
      stampEl.innerHTML = `
        <span class="gallery-locked-stamp-icon">🔒</span>
        <span class="gallery-locked-stamp-text">available in day ${tier}</span>
      `;
      sectionGrid.appendChild(stampEl);
    }

    gridEl.appendChild(sectionEl);
    sections.push({
      tier,
      ids: tierIds,
      sectionEl,
      subEl: sectionEl.querySelector('.gallery-section-sub')!,
      stampEl
    });
  }
  refreshSections();

  let filter: 'all' | 'unlocked' = 'all';
  const search = panel.querySelector<HTMLInputElement>('#gallery-search');
  const filterBtn = panel.querySelector<HTMLButtonElement>('#gallery-filter');
  const applyFilters = (): void => {
    const query = search?.value.trim().toLowerCase() ?? '';
    for (const tile of tileEls.values()) {
      const labelMatches = !query || tile.dataset.label?.includes(query);
      const stateMatches = filter === 'all' || tile.dataset.unlocked === 'true';
      tile.style.display = labelMatches && stateMatches ? '' : 'none';
    }
    // Collapse a whole DAY section when the filter hides every tile in it.
    for (const s of sections) {
      const anyVisible = s.ids.some(id => tileEls.get(id)?.style.display !== 'none');
      s.sectionEl.style.display = anyVisible ? '' : 'none';
    }
  };
  search?.addEventListener('input', applyFilters);
  filterBtn?.addEventListener('click', () => {
    filter = filter === 'all' ? 'unlocked' : 'all';
    filterBtn.textContent = filter === 'all' ? 'ALL' : 'UNLOCKED';
    filterBtn.setAttribute('aria-pressed', filter === 'unlocked' ? 'true' : 'false');
    applyFilters();
  });

  const firstUnlocked = ids.find(id => unlocked.has(id));
  if (firstUnlocked) requestAnimationFrame(() => selectTile(firstUnlocked));
}

function buildPreviewPanel(panel: HTMLElement): void {
  panel.innerHTML = `
    <div class="side-backdrop"><span class="side-backdrop-mark">HORMUZ HOLD'EM &middot; HORMUZ HOLD'EM</span></div>
    <div class="side-toast" id="side-toast"></div>
    <div class="preview-hint" id="preview-hint">
      <span class="preview-hint-title">MEME PREVIEW</span>
      <span class="preview-hint-sub">Click an unlocked meme to view it here</span>
    </div>
  `;
  previewHintEl = panel.querySelector('#preview-hint');
}

/** Re-derives each DAY section's reached state + subtitle from the persisted
 *  account progress. Subtitle wording matches GalleryScene.buildSectionHeader. */
function refreshSections(): void {
  const unlocked = getUnlockedTemplates();
  const bestDay = Math.max(1, getBestDayReached());
  for (const s of sections) {
    const reached = s.tier <= bestDay;
    if (reached) {
      s.sectionEl.classList.remove('tier-locked');
      s.stampEl?.remove();
      s.stampEl = null;
    }
    if (s.tier === 1) {
      s.subEl.textContent = `${s.ids.length} memes · always in the mix`;
    } else if (reached) {
      const n = s.ids.filter(id => unlocked.has(id)).length;
      s.subEl.textContent = `${s.ids.length} memes · reached — ${n}/${s.ids.length} unlocked`;
    } else {
      s.subEl.textContent = `${s.ids.length} memes`;
    }
  }
}

function updateCount(): void {
  if (!countEl) return;
  countEl.textContent = `${getUnlockedTemplates().size}/${Object.keys(MEMES.templates).length}`;
}

function onNewUnlocks(ids: string[]): void {
  updateCount();

  for (const id of ids) {
    const tile = tileEls.get(id);
    if (!tile) continue;
    if (tile.classList.contains('locked')) {
      tile.classList.remove('locked');
      tile.classList.add('unlocked');
      tile.dataset.unlocked = 'true';
      tile.setAttribute('aria-label', MEMES.templates[id].label);
      tile.innerHTML = `${tileArtHtml(id)}<span class="gallery-tile-badge">NEW</span>`;
      tile.addEventListener('click', () => selectTile(id));
    }
    if (!settings.reducedMotion) {
      tile.classList.remove('gallery-tile-new');
      void tile.offsetWidth; // restart the glow animation
      tile.classList.add('gallery-tile-new');
      tile.addEventListener('animationend', () => tile.classList.remove('gallery-tile-new'), { once: true });
    }
  }

  const firstTile = tileEls.get(ids[0]);
  firstTile?.scrollIntoView({ behavior: settings.reducedMotion ? 'auto' : 'smooth', block: 'center' });

  showToast(ids[0]);
}

function showToast(id: string): void {
  const toast = document.getElementById('side-toast');
  if (!toast) return;
  const tpl = MEMES.templates[id];
  toast.innerHTML = `
    ${availableArt.has(tpl.artFile) ? `<img src="assets/${tpl.artFile}" alt="" />` : ''}
    <span class="side-toast-text">New meme unlocked!</span>
  `;
  if (settings.reducedMotion) {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px)';
    }, 2400);
    return;
  }
  toast.classList.remove('show');
  void toast.offsetWidth; // restart the fade in/out animation
  toast.classList.add('show');
}

function selectTile(id: string): void {
  if (selectedId) tileEls.get(selectedId)?.classList.remove('selected');
  selectedId = id;
  tileEls.get(id)?.classList.add('selected');
  showPreview(id);
}

function deselectTile(): void {
  if (selectedId) tileEls.get(selectedId)?.classList.remove('selected');
  selectedId = null;
  previewCardEl?.remove();
  previewCardEl = null;
  if (previewHintEl) previewHintEl.style.display = '';
}

function showPreview(id: string): void {
  const rightPanel = document.getElementById('side-right');
  if (!rightPanel) return;
  const tpl = MEMES.templates[id];
  const hasImg = availableArt.has(tpl.artFile);

  if (previewHintEl) previewHintEl.style.display = 'none';
  previewCardEl?.remove();

  const card = document.createElement('div');
  card.className = 'preview-card';
  card.innerHTML = `
    <button class="preview-close" type="button" aria-label="Close preview">&#10005;</button>
    <div class="preview-card-heading">
      <span class="preview-card-eyebrow">MEME PREVIEW</span>
      <strong>${tpl.label}</strong>
      <span class="preview-card-rarity">EPIC · COLLECTION INTEL</span>
    </div>
    ${hasImg ? `<img class="preview-img" src="assets/${tpl.artFile}" alt="${tpl.label}" />` : `<div class="preview-fallback">${tpl.label}</div>`}
    <span class="preview-share-title">SHARE TO</span>
    <div class="preview-share-row">
      ${SHARE_ICONS.map(s => `<button class="preview-share-btn" type="button" data-platform="${s.platform}"><img src="${s.icon}" alt="${s.platform}" /></button>`).join('')}
    </div>
    <button class="preview-download" type="button">DOWNLOAD</button>
  `;
  rightPanel.appendChild(card);
  previewCardEl = card;

  card.querySelector('.preview-close')?.addEventListener('click', deselectTile);

  const img = card.querySelector('.preview-img') as HTMLImageElement | null;
  const filename = `hormuz-meme-${id}.png`;
  const shareText = "From my HORMUZ HOLD'EM collection";

  card.querySelector('.preview-download')?.addEventListener('click', async () => {
    if (!img) return;
    const canvas = await watermarkedCanvas(img);
    if (canvas) await shareImage(canvas, filename, shareText, 'gallery-desktop', 'download');
  });

  card.querySelectorAll<HTMLButtonElement>('.preview-share-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!img) return;
      const platform = btn.dataset.platform as SharePlatform;
      const canvas = await watermarkedCanvas(img);
      if (canvas) await shareCanvasTo(canvas, filename, shareText, 'gallery-desktop', platform);
    });
  });
}

/** Draws a loaded <img> onto a canvas and stamps the same watermark used by
 *  the in-game SAVE buttons (share.ts), for the download/share actions. */
async function watermarkedCanvas(img: HTMLImageElement): Promise<HTMLCanvasElement | null> {
  const source = img.complete ? img : await new Promise<HTMLImageElement>(resolve => (img.onload = () => resolve(img)));
  const canvas = document.createElement('canvas');
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;
  const cx = canvas.getContext('2d');
  if (!cx) return null;
  cx.drawImage(source, 0, 0);
  drawWatermark(cx, canvas.width, canvas.height);
  return canvas;
}
