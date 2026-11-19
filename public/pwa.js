export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch((error) => {
    console.warn('Could not register service worker for offline use', error);
  });
}

export function setupInstallButton({ row, button, hint }) {
  if (!row || !button || isRunningInstalled()) return;

  const showPrompt = () => {
    if (!window.__morseNewsInstallPrompt) return;
    hint.classList.add('hidden');
    row.classList.remove('hidden');
  };

  button.addEventListener('click', async () => {
    const prompt = window.__morseNewsInstallPrompt;
    if (!prompt) {
      hint.classList.toggle('hidden');
      return;
    }
    window.__morseNewsInstallPrompt = null;
    row.classList.add('hidden');
    await prompt.prompt();
  });

  window.addEventListener('morse-news-install-ready', showPrompt);
  window.addEventListener('appinstalled', () => row.classList.add('hidden'));

  if (window.__morseNewsInstallPrompt) showPrompt();
  else if (isIosBrowser()) row.classList.remove('hidden');
}

function isRunningInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function isIosBrowser() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
