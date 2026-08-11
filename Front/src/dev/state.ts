export type AutoPlayMode = 'off' | 'gameplay' | 'full';

// Shared dev-mode flags, checked by scenes on create and by the dev panel.
export const devState = {
  layoutEdit: false,
  routeEdit: false,
  routeDensified: false, // midpoint nodes injected once per session
  speedMultiplier: 1, // 2x speed devtool — scales GameScene's simulation dt
  // 'gameplay' auto-fires at threats but leaves day-summary interaction (shop,
  // next day) to the player; 'full' also buys upgrades and advances days itself
  autoPlay: 'off' as AutoPlayMode
};
