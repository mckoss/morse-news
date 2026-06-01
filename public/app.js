const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..',
  J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
  S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...',
  8: '---..', 9: '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--',
  '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-',
  '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.', '$': '...-..-', '@': '.--.-.'
};

const END_OF_MESSAGE_PROSIGN = '.-.-.'; // AR
const MESSAGE_GAP_MS = 5000;

const state = {
  headlines: [],
  speed: 5,
  playing: false,
  audio: null,
  oscillator: null,
  gain: null,
  timeout: null,
  startedAt: 0,
  durationMs: 15 * 60 * 1000,
};

const els = {
  headlineCount: document.querySelector('#headline-count'),
  headlines: document.querySelector('#headlines'),
  currentTitle: document.querySelector('#current-title'),
  progress: document.querySelector('#progress'),
  meter: document.querySelector('#meter-fill'),
  start: document.querySelector('#start'),
  stop: document.querySelector('#stop'),
  refresh: document.querySelector('#refresh'),
  minutes: document.querySelector('#minutes'),
  frequency: document.querySelector('#frequency'),
  frequencyLabel: document.querySelector('#frequency-label'),
};

document.querySelectorAll('.speed').forEach((button) => {
  button.addEventListener('click', () => {
    state.speed = Number(button.dataset.speed);
    document.querySelectorAll('.speed').forEach((item) => item.classList.toggle('active', item === button));
  });
});

els.frequency.addEventListener('input', () => {
  els.frequencyLabel.textContent = `${els.frequency.value} Hz`;
  if (state.oscillator) state.oscillator.frequency.value = Number(els.frequency.value);
});

els.minutes.addEventListener('change', () => {
  state.durationMs = Number(els.minutes.value) * 60 * 1000;
});

els.start.addEventListener('click', startPractice);
els.stop.addEventListener('click', stopPractice);
els.refresh.addEventListener('click', () => loadHeadlines({ forceUi: true }));

await loadHeadlines();

async function loadHeadlines({ forceUi = false } = {}) {
  els.headlineCount.textContent = forceUi ? 'Refreshing headlines…' : 'Loading headlines…';
  try {
    const response = await fetch('/api/headlines');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.headlines = payload.headlines ?? [];
    renderHeadlines(payload);
  } catch (error) {
    console.error(error);
    els.headlineCount.textContent = 'Could not load headlines. Try refresh in a minute.';
  }
}

function renderHeadlines(payload) {
  const fetched = new Date(payload.fetchedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  els.headlineCount.textContent = `${state.headlines.length} headlines loaded · ${fetched}${payload.stale ? ' · stale cache' : ''}`;
  els.headlines.innerHTML = state.headlines.map((item) => `
    <li>
      ${escapeHtml(item.title)}
      <small>
        ${escapeHtml(item.source)} · ${escapeHtml(item.category)}
        ${item.link ? ` · <a href="${escapeAttr(item.link)}" target="_blank" rel="noopener noreferrer">Link</a>` : ''}
      </small>
    </li>
  `).join('');
}

async function startPractice() {
  if (state.playing || state.headlines.length === 0) return;
  state.playing = true;
  state.startedAt = performance.now();
  state.durationMs = Number(els.minutes.value) * 60 * 1000;
  els.start.disabled = true;
  els.stop.disabled = false;
  await ensureAudio();
  playLoop();
}

function stopPractice() {
  state.playing = false;
  clearTimeout(state.timeout);
  setTone(false);
  els.start.disabled = false;
  els.stop.disabled = true;
  els.progress.textContent = 'Stopped.';
}

async function ensureAudio() {
  if (!state.audio) {
    state.audio = new AudioContext();
    state.oscillator = state.audio.createOscillator();
    state.gain = state.audio.createGain();
    state.oscillator.type = 'sine';
    state.oscillator.frequency.value = Number(els.frequency.value);
    state.gain.gain.value = 0;
    state.oscillator.connect(state.gain).connect(state.audio.destination);
    state.oscillator.start();
  }
  if (state.audio.state !== 'running') await state.audio.resume();
}

async function playLoop() {
  let i = 0;

  while (state.playing && performance.now() - state.startedAt < state.durationMs) {
    const item = state.headlines[i % state.headlines.length];
    els.currentTitle.textContent = item.title;
    await playText(item.title, tokensForHeadline(item.title, state.speed));
    i += 1;
  }

  if (state.playing) {
    stopPractice();
    els.progress.textContent = 'Session complete.';
  }
}

async function playText(title, events) {
  for (const event of events) {
    if (!state.playing) return;
    setTone(event.on);
    const elapsed = performance.now() - state.startedAt;
    els.progress.textContent = `${state.speed} WPM Farnsworth · ${Math.max(0, Math.ceil((state.durationMs - elapsed) / 60000))} min left`;
    els.meter.style.width = `${Math.min(100, (elapsed / state.durationMs) * 100)}%`;
    await wait(event.ms);
  }
}

function tokensForHeadline(text, effectiveWpm) {
  return [
    ...tokensForText(text, effectiveWpm),
    ...tokensForProsign(END_OF_MESSAGE_PROSIGN, effectiveWpm),
    { on: false, ms: MESSAGE_GAP_MS },
  ];
}

function tokensForText(text, effectiveWpm) {
  // Farnsworth: characters are sent at 20 WPM, spacing is stretched for slower effective copy speeds.
  const characterWpm = 20;
  const charUnit = 1200 / characterWpm;
  const spacingUnit = 1200 / Math.min(effectiveWpm, characterWpm);
  const events = [];
  const words = sanitize(text).split(/\s+/).filter(Boolean);

  words.forEach((word, wordIndex) => {
    [...word].forEach((char, charIndex) => {
      const code = MORSE[char];
      if (!code) return;
      [...code].forEach((symbol, symbolIndex) => {
        events.push({ on: true, ms: symbol === '.' ? charUnit : charUnit * 3 });
        if (symbolIndex < code.length - 1) events.push({ on: false, ms: charUnit });
      });
      if (charIndex < word.length - 1) events.push({ on: false, ms: spacingUnit * 3 });
    });
    if (wordIndex < words.length - 1) events.push({ on: false, ms: spacingUnit * 7 });
  });
  events.push({ on: false, ms: spacingUnit * 10 });
  return events;
}

function tokensForProsign(code, effectiveWpm) {
  const characterWpm = 20;
  const charUnit = 1200 / characterWpm;
  const spacingUnit = 1200 / Math.min(effectiveWpm, characterWpm);
  const events = [{ on: false, ms: spacingUnit * 7 }];

  [...code].forEach((symbol, symbolIndex) => {
    events.push({ on: true, ms: symbol === '.' ? charUnit : charUnit * 3 });
    if (symbolIndex < code.length - 1) events.push({ on: false, ms: charUnit });
  });

  return events;
}

function sanitize(text) {
  return text
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9.,?'!/:;=+\-"@$()\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function setTone(on) {
  if (!state.gain || !state.audio) return;
  const t = state.audio.currentTime;
  state.gain.gain.cancelScheduledValues(t);
  state.gain.gain.setTargetAtTime(on ? 0.18 : 0.0001, t, 0.004);
}

function wait(ms) {
  return new Promise((resolve) => {
    state.timeout = setTimeout(resolve, ms);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}
