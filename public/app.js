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
const START_DELAY_MS = 2000;
const STALE_MS = 6 * 60 * 60 * 1000;

const state = {
  headlines: [],
  payload: null,
  historyIndex: 0,
  speed: 5,
  playing: false,
  sessionActive: false,
  audio: null,
  oscillator: null,
  gain: null,
  timeout: null,
  waitResolve: null,
  currentHeadlineIndex: 0,
  loopRunning: false,
  startedAt: 0,
  segmentStartedAt: 0,
  remainingMs: 15 * 60 * 1000,
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
  previous: document.querySelector('#previous'),
  next: document.querySelector('#next'),
  snapshotTime: document.querySelector('#snapshot-time'),
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
  if (!state.playing && !state.sessionActive) state.remainingMs = state.durationMs;
});

els.start.addEventListener('click', startPractice);
els.stop.addEventListener('click', togglePauseResume);
els.refresh.addEventListener('click', () => loadHeadlines({ force: true, forceUi: true, index: 0 }));
els.previous.addEventListener('click', () => loadHeadlines({ index: state.historyIndex + 1 }));
els.next.addEventListener('click', () => loadHeadlines({ index: Math.max(0, state.historyIndex - 1) }));

await loadHeadlines();
setInterval(updateSnapshotControls, 60 * 1000);

async function loadHeadlines({ force = false, forceUi = false, index = state.historyIndex } = {}) {
  els.headlineCount.textContent = forceUi ? 'Refreshing headlines…' : 'Loading headlines…';
  try {
    const params = new URLSearchParams();
    if (index > 0) params.set('index', String(index));
    if (force) params.set('force', '1');
    const query = params.toString();
    const response = await fetch(`/api/headlines${query ? `?${query}` : ''}`, {
      cache: force ? 'no-store' : 'default',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.headlines = payload.headlines ?? [];
    state.payload = payload;
    state.historyIndex = payload.archive?.index ?? index;
    renderHeadlines(payload);
  } catch (error) {
    console.error(error);
    els.headlineCount.textContent = 'Could not load headlines. Try refresh in a minute.';
  }
}

function renderHeadlines(payload) {
  els.headlineCount.textContent = `${state.headlines.length} headlines loaded`;
  updateSnapshotControls();
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

function updateSnapshotControls() {
  if (!state.payload?.fetchedAt) return;

  const fetchedAt = new Date(state.payload.fetchedAt);
  const archive = state.payload.archive ?? {};
  const isCurrent = (archive.index ?? 0) === 0;
  const ageMs = Date.now() - fetchedAt.getTime();
  const isStale = isCurrent && ageMs >= STALE_MS;
  const ageText = isCurrent ? ` · ${formatAge(ageMs)} old` : '';
  const archiveText = archive.count > 1 ? ` · set ${(archive.index ?? 0) + 1} of ${archive.count}` : '';
  els.snapshotTime.textContent = `Updated ${formatSnapshotTime(fetchedAt)}${ageText}${archiveText}`;
  els.previous.disabled = !archive.hasPrevious;
  els.next.disabled = !archive.hasNext;
  els.refresh.classList.toggle('hidden', !isStale);
}

async function startPractice() {
  if (state.playing || state.sessionActive || state.headlines.length === 0) return;
  state.durationMs = Number(els.minutes.value) * 60 * 1000;
  state.remainingMs = state.durationMs;
  state.currentHeadlineIndex = 0;
  state.sessionActive = true;
  await startPlayback({ delayMs: START_DELAY_MS, message: 'Starting in 2 seconds…' });
}

async function togglePauseResume() {
  if (state.playing) {
    pausePractice();
    return;
  }

  if (state.sessionActive) {
    await startPlayback({ delayMs: START_DELAY_MS, message: 'Resuming in 2 seconds…' });
  }
}

async function startPlayback({ delayMs = 0, message = '' } = {}) {
  if (state.playing || !state.sessionActive || state.headlines.length === 0) return;

  state.playing = true;
  state.segmentStartedAt = performance.now();
  if (!state.startedAt) state.startedAt = state.segmentStartedAt;
  els.start.disabled = true;
  els.stop.disabled = false;
  els.stop.textContent = 'Stop';
  await ensureAudio();

  if (delayMs > 0) {
    setTone(false);
    els.currentTitle.textContent = state.headlines[state.currentHeadlineIndex % state.headlines.length]?.title ?? 'Ready';
    els.progress.textContent = message;
    await wait(delayMs);
  }

  if (!state.playing) return;
  state.segmentStartedAt = performance.now();
  playLoop();
}

function pausePractice() {
  state.remainingMs = remainingSessionMs();
  state.playing = false;
  cancelWait();
  setTone(false);
  els.start.disabled = true;
  els.stop.disabled = false;
  els.stop.textContent = 'Resume';
  els.progress.textContent = 'Paused.';
}

function finishPractice(message) {
  state.playing = false;
  state.sessionActive = false;
  state.loopRunning = false;
  state.startedAt = 0;
  state.segmentStartedAt = 0;
  state.remainingMs = state.durationMs;
  cancelWait();
  setTone(false);
  els.start.disabled = false;
  els.stop.disabled = true;
  els.stop.textContent = 'Stop';
  els.progress.textContent = message;
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
  if (state.loopRunning) return;
  state.loopRunning = true;

  while (state.playing && remainingSessionMs() > 0) {
    const item = state.headlines[state.currentHeadlineIndex % state.headlines.length];
    els.currentTitle.textContent = item.title;
    const completed = await playText(item.title, tokensForHeadline(item.title, state.speed));
    if (!completed) break;
    state.currentHeadlineIndex += 1;
  }

  if (state.playing) {
    finishPractice('Session complete.');
    return;
  }

  state.loopRunning = false;
}

async function playText(title, events) {
  for (const event of events) {
    if (!state.playing) return false;
    setTone(event.on);
    const remainingMs = remainingSessionMs();
    const elapsed = state.durationMs - remainingMs;
    els.progress.textContent = `${state.speed} WPM Farnsworth · ${Math.max(0, Math.ceil(remainingMs / 60000))} min left`;
    els.meter.style.width = `${Math.min(100, (elapsed / state.durationMs) * 100)}%`;
    await wait(event.ms);
  }
  return true;
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
    state.waitResolve = resolve;
    state.timeout = setTimeout(() => {
      state.timeout = null;
      state.waitResolve = null;
      resolve();
    }, ms);
  });
}

function cancelWait() {
  clearTimeout(state.timeout);
  state.timeout = null;
  const resolve = state.waitResolve;
  state.waitResolve = null;
  if (resolve) resolve();
}

function remainingSessionMs() {
  if (!state.playing) return state.remainingMs;
  return Math.max(0, state.remainingMs - (performance.now() - state.segmentStartedAt));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function formatSnapshotTime(date) {
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatAge(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days} day ${remainingHours} hr` : `${days} day`;
}
