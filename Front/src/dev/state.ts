export type AutoPlayMode = 'off' | 'gameplay' | 'full';

// VITE_DEV_AUTOSTART=true (see .env.example) boots straight into 2x speed +
// 'gameplay' autoplay, e.g. for hands-off local demos/recordings.
const autostart = import.meta.env.DEV && import.meta.env.VITE_DEV_AUTOSTART === 'true';

// Shared dev-mode flags, checked by scenes on create and by the dev panel.
export const devState = {
  layoutEdit: false,
  routeEdit: false,
  routeDensified: false, // midpoint nodes injected once per session
  speedMultiplier: autostart ? 2 : 1, // 2x speed devtool — scales GameScene's simulation dt
  // 'gameplay' auto-fires at threats but leaves day-summary interaction (shop,
  // next day) to the player; 'full' also buys upgrades and advances days itself
  autoPlay: (autostart ? 'gameplay' : 'off') as AutoPlayMode
};

// Dev console handle for scripted/regression driving, e.g.
// devState.speedMultiplier = 2; devState.autoPlay = 'full'
if (import.meta.env.DEV) (window as any).devState = devState;
