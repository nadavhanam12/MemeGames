// DOM overlay form for score submission (name + email). DOM instead of canvas
// because text input needs the real keyboard (mobile IME, paste, autofill).
// Resolves with the submit outcome, or null if the player cancels.

import { HEX } from '../core/palette';
import { ScoreResponse } from './api';
import { LeaderboardService, PlayerIdentity } from './leaderboard';

export interface SubmitOutcome {
  response: ScoreResponse;
  identity: PlayerIdentity;
}

export function openSubmitOverlay(service: LeaderboardService, score: number): Promise<SubmitOutcome | null> {
  return new Promise(resolve => {
    const saved = service.getIdentity();

    const backdrop = document.createElement('div');
    backdrop.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:1000',
      'background:rgba(23,32,42,0.82)',
      'display:flex', 'align-items:center', 'justify-content:center',
      `font-family:"Helvetica Neue",Arial,sans-serif`
    ].join(';');

    const card = document.createElement('div');
    card.style.cssText = [
      `background:${HEX.navy}`, `border:5px solid ${HEX.gold}`, 'border-radius:10px',
      'padding:28px 32px', 'width:min(420px,86vw)', 'box-shadow:0 12px 40px rgba(0,0,0,0.5)',
      `color:${HEX.cream}`, 'text-align:center'
    ].join(';');
    backdrop.appendChild(card);

    card.innerHTML = `
      <div style="font-size:26px;font-weight:900;letter-spacing:1px;margin-bottom:4px">SUBMIT SCORE</div>
      <div style="font-size:38px;font-weight:900;color:${HEX.gold};margin-bottom:18px">${score}</div>
      <input id="mg-name" type="text" maxlength="24" placeholder="PLAYER NAME" autocomplete="nickname">
      <input id="mg-email" type="email" maxlength="120" placeholder="EMAIL (keeps your best score)" autocomplete="email">
      <div id="mg-status" style="min-height:22px;font-size:14px;font-weight:700;color:${HEX.gold};margin:10px 0 14px"></div>
      <div style="display:flex;gap:12px;justify-content:center">
        <button id="mg-cancel">SKIP</button>
        <button id="mg-send">SUBMIT</button>
      </div>
      <div style="font-size:11px;opacity:0.6;margin-top:12px">Email is hashed server-side and never shown publicly.</div>
    `;

    const inputCss = [
      'display:block', 'width:100%', 'box-sizing:border-box', 'margin-bottom:10px',
      'padding:12px 14px', 'font-size:16px', 'font-weight:700', 'border-radius:6px',
      `border:3px solid ${HEX.ink}`, `background:${HEX.cream}`, `color:${HEX.ink}`, 'outline:none'
    ].join(';');
    const nameEl = card.querySelector<HTMLInputElement>('#mg-name')!;
    const emailEl = card.querySelector<HTMLInputElement>('#mg-email')!;
    nameEl.style.cssText = inputCss;
    emailEl.style.cssText = inputCss;
    if (saved) {
      nameEl.value = saved.name;
      emailEl.value = saved.email;
    }

    const statusEl = card.querySelector<HTMLDivElement>('#mg-status')!;
    const cancelBtn = card.querySelector<HTMLButtonElement>('#mg-cancel')!;
    const sendBtn = card.querySelector<HTMLButtonElement>('#mg-send')!;
    const btnCss = (bg: string, fg: string) =>
      [
        `background:${bg}`, `color:${fg}`, `border:3px solid ${HEX.ink}`, 'border-radius:6px',
        'padding:12px 26px', 'font-size:17px', 'font-weight:900', 'cursor:pointer', 'letter-spacing:1px'
      ].join(';');
    cancelBtn.style.cssText = btnCss('#39424e', HEX.cream);
    sendBtn.style.cssText = btnCss(HEX.green, HEX.ink);

    let busy = false;
    const close = (result: SubmitOutcome | null) => {
      backdrop.remove();
      resolve(result);
    };
    cancelBtn.addEventListener('click', () => {
      if (!busy) close(null);
    });

    sendBtn.addEventListener('click', async () => {
      if (busy) return;
      const name = nameEl.value.trim();
      const email = emailEl.value.trim();
      if (name.length < 2) {
        statusEl.style.color = HEX.red;
        statusEl.textContent = 'NAME NEEDS AT LEAST 2 CHARACTERS';
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        statusEl.style.color = HEX.red;
        statusEl.textContent = 'THAT EMAIL LOOKS OFF';
        return;
      }
      busy = true;
      sendBtn.style.opacity = '0.5';
      statusEl.style.color = HEX.gold;
      try {
        const response = await service.submit(score, { name, email }, msg => (statusEl.textContent = msg));
        close({ response, identity: { name, email } });
      } catch {
        busy = false;
        sendBtn.style.opacity = '1';
        statusEl.style.color = HEX.red;
        statusEl.textContent = 'COULD NOT REACH SERVER — TRY AGAIN';
      }
    });

    emailEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') sendBtn.click();
    });

    document.body.appendChild(backdrop);
    if (!saved) nameEl.focus();
  });
}
