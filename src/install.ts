// "Add to home screen", offered once after the first game over (DESIGN.md §10).
//
// Chrome-family browsers fire beforeinstallprompt and let us trigger the real
// prompt. iOS Safari fires nothing and has no API, so all we can do there is
// tell the player where the button is.

const DISMISS_KEY = 'slimeSmashA2HS';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as BeforeInstallPromptEvent;
});

window.addEventListener('appinstalled', () => {
  deferred = null;
  remember();
});

function remember(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* private mode — we simply offer again next time */
  }
}

function alreadyAsked(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function isInstalled(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as a Mac, but with touch points
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** Reveal the offer inside the game-over overlay, if it makes sense to. */
export function maybeOfferInstall(): void {
  const box = document.getElementById('install');
  const btn = document.getElementById('installBtn');
  const hint = document.getElementById('installHint');
  if (!box || !btn || !hint) return;
  if (isInstalled() || alreadyAsked()) return;

  if (deferred) {
    hint.hidden = true;
    btn.hidden = false;
    box.hidden = false;
    btn.onclick = async () => {
      const d = deferred;
      if (!d) return;
      deferred = null;
      box.hidden = true;
      remember();
      try {
        await d.prompt();
        await d.userChoice;
      } catch {
        /* the browser withdrew the prompt; nothing to do */
      }
    };
  } else if (isIOS()) {
    btn.hidden = true;
    hint.hidden = false;
    box.hidden = false;
    remember();
  }
}
