import {
  headlineKey,
  nextHeadlineIndex as computeNextHeadlineIndex,
  resolveCompletedHeadlineIndex,
} from './playback-state.js';
import { unitsForHeadline } from './morse-timing.js';

const START_DELAY_MS = 2000;
const STALE_MS = 6 * 60 * 60 * 1000;
const PLAYBACK_STATE_COOKIE = 'morseNewsPlaybackState';
const PLAYBACK_STATE_STORAGE_KEY = 'morseNewsPlaybackState';
const PLAYBACK_STATE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const CAST_NEW_SESSION_READY_DELAY_MS = 2500;
const CAST_LOAD_RETRY_DELAY_MS = 1500;
const CAST_LOAD_ATTEMPTS = 4;

const state = {
  headlines: [],
  payload: null,
  historyIndex: 0,
  speed: 5,
  playing: false,
  sessionActive: false,
  audio: null,
  oscillator: null,
  oscillatorStarted: false,
  gain: null,
  timeout: null,
  waitResolve: null,
  currentHeadlineIndex: 0,
  currentUnitIndex: 0,
  lastCompletedHeadlineIndex: -1,
  lastSentUnitIndex: -1,
  playbackRunId: 0,
  loopRunning: false,
  castReady: false,
  castingSpeed: null,
  startedAt: 0,
  segmentStartedAt: 0,
  remainingMs: 15 * 60 * 1000,
  durationMs: 15 * 60 * 1000,
};

const els = {
  headlineCount: document.querySelector('#headline-count'),
  headlines: document.querySelector('#headlines'),
  progress: document.querySelector('#progress'),
  meter: document.querySelector('#meter-fill'),
  start: document.querySelector('#start'),
  stop: document.querySelector('#stop'),
  refresh: document.querySelector('#refresh'),
  castPanel: document.querySelector('#cast-panel'),
  castSpeeds: [...document.querySelectorAll('.cast-speed')],
  stopCast: document.querySelector('#stop-cast'),
  previous: document.querySelector('#previous'),
  next: document.querySelector('#next'),
  snapshotTime: document.querySelector('#snapshot-time'),
  minutes: document.querySelector('#minutes'),
  frequency: document.querySelector('#frequency'),
  frequencyLabel: document.querySelector('#frequency-label'),
};

document.querySelectorAll('.speed').forEach((button) => {
  button.addEventListener('click', () => {
    setSpeed(Number(button.dataset.speed));
  });
});

els.frequency.addEventListener('input', () => {
  setFrequency(Number(els.frequency.value));
});

els.minutes.addEventListener('change', () => {
  setDurationMinutes(Number(els.minutes.value));
});

els.start.addEventListener('click', startPractice);
els.stop.addEventListener('click', togglePauseResume);
els.refresh.addEventListener('click', () => loadHeadlines({ forceUi: true, index: 0 }));
els.castSpeeds.forEach((button) => {
  button.addEventListener('click', () => castAllHeadlines(Number(button.dataset.castSpeed)));
});
els.stopCast.addEventListener('click', stopCasting);
els.previous.addEventListener('click', () => loadHeadlines({ index: state.historyIndex + 1 }));
els.next.addEventListener('click', () => loadHeadlines({ index: Math.max(0, state.historyIndex - 1) }));

restorePlaybackPreferences();
setupCast();
await loadHeadlines();
setInterval(updateSnapshotControls, 60 * 1000);

async function loadHeadlines({ forceUi = false, index = state.historyIndex } = {}) {
  els.headlineCount.textContent = forceUi ? 'Checking headlines…' : 'Loading headlines…';
  try {
    const params = new URLSearchParams();
    if (index > 0) params.set('index', String(index));
    const query = params.toString();
    const response = await fetch(`/api/headlines${query ? `?${query}` : ''}`, {
      cache: 'default',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.headlines = payload.headlines ?? [];
    state.payload = payload;
    state.historyIndex = payload.archive?.index ?? index;
    restorePlaybackProgress();
    renderHeadlines(payload);
  } catch (error) {
    console.error(error);
    els.headlineCount.textContent = 'Could not load headlines. Try refresh in a minute.';
  }
}

function setSpeed(speed, { persist = true } = {}) {
  if (![5, 10, 15, 20].includes(speed)) return;
  state.speed = speed;
  document.querySelectorAll('.speed').forEach((item) => {
    item.classList.toggle('active', Number(item.dataset.speed) === speed);
  });
  if (persist) savePlaybackState();
}

function setDurationMinutes(minutes, { persist = true } = {}) {
  if (![5, 10, 15].includes(minutes)) return;

  const previousDurationMs = state.durationMs;
  const elapsedMs = state.sessionActive
    ? Math.max(0, previousDurationMs - remainingSessionMs())
    : 0;

  state.durationMs = minutes * 60 * 1000;
  els.minutes.value = String(minutes);

  if (state.playing) {
    state.remainingMs = Math.max(0, state.durationMs - elapsedMs);
    state.segmentStartedAt = performance.now();
    if (state.remainingMs <= 0) cancelWait();
  } else if (state.sessionActive) {
    state.remainingMs = Math.max(0, state.durationMs - elapsedMs);
  } else {
    state.remainingMs = state.durationMs;
  }

  updatePlaybackStatus();
  if (persist) savePlaybackState();
}

function setFrequency(frequency, { persist = true } = {}) {
  const min = Number(els.frequency.min);
  const max = Number(els.frequency.max);
  const step = Number(els.frequency.step) || 1;
  if (!Number.isFinite(frequency) || frequency < min || frequency > max) return;
  if ((frequency - min) % step !== 0) return;

  els.frequency.value = String(frequency);
  els.frequencyLabel.textContent = `${frequency} Hz`;
  if (state.oscillator) state.oscillator.frequency.value = frequency;
  if (persist) savePlaybackState();
}

function setupCast() {
  const maybeInitialize = (isAvailable) => {
    if (!isAvailable || !window.cast?.framework || !window.chrome?.cast?.media) return;
    if (state.castReady) return;

    const context = cast.framework.CastContext.getInstance();
    context.setOptions({
      receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
    });

    const sessionEventType = cast.framework.CastContextEventType?.SESSION_STATE_CHANGED;
    if (sessionEventType) context.addEventListener(sessionEventType, updateCastSessionState);

    state.castReady = true;
    els.castPanel.classList.remove('hidden');
    setCastButtonsDisabled(false);
    updateCastSessionState();
  };

  window.addEventListener('morse-news-cast-ready', (event) => maybeInitialize(event.detail?.isAvailable));
  maybeInitialize(window.__morseNewsCastReady);
}

async function castAllHeadlines(speedWpm) {
  if (!window.cast?.framework || !window.chrome?.cast?.media) return;

  setCastButtonsDisabled(true);
  setCastingSpeed(speedWpm);
  els.progress.textContent = `Starting Cast at ${speedWpm} WPM…`;
  try {
    const metadataResponse = await fetch('/api/cast-audio', { cache: 'no-store' });
    if (!metadataResponse.ok) throw new Error(`HTTP ${metadataResponse.status}`);
    const manifest = await metadataResponse.json();
    const media = manifest.speeds?.find((entry) => entry.speedWpm === speedWpm);
    if (!media?.mediaUrl) throw new Error(`No ${speedWpm} WPM cast media`);

    const context = cast.framework.CastContext.getInstance();
    let session = context.getCurrentSession();
    if (!session) {
      session = await context.requestSession();
      els.progress.textContent = `Connecting Cast at ${speedWpm} WPM…`;
      await wait(CAST_NEW_SESSION_READY_DELAY_MS);
    }

    const mediaInfo = new chrome.cast.media.MediaInfo(media.mediaUrl, media.contentType);
    mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
    mediaInfo.metadata.title = `Morse News - ${speedWpm} WPM`;
    mediaInfo.metadata.subtitle = `${manifest.headlineCount} headlines · ${manifest.frequencyHz} Hz`;
    mediaInfo.streamType = chrome.cast.media.StreamType.BUFFERED;
    mediaInfo.duration = Math.round(media.durationMs / 1000);

    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    await loadCastMediaWithRetry(() => context.getCurrentSession() || session, request);
    setCastingSpeed(speedWpm);
    els.progress.textContent = `Casting all headlines at ${speedWpm} WPM.`;
  } catch (error) {
    console.error(error);
    setCastingSpeed(null);
    els.progress.textContent = 'Could not start Cast playback.';
  } finally {
    setCastButtonsDisabled(false);
  }
}

async function loadCastMediaWithRetry(getSession, request, {
  attempts = CAST_LOAD_ATTEMPTS,
  retryDelayMs = CAST_LOAD_RETRY_DELAY_MS,
} = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const session = getSession();
      if (!session) throw new Error('No active Cast session');
      return await session.loadMedia(request);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(retryDelayMs);
    }
  }

  throw lastError;
}

async function stopCasting() {
  if (!window.cast?.framework) return;

  const session = cast.framework.CastContext.getInstance().getCurrentSession();
  if (!session) {
    setCastingSpeed(null);
    return;
  }

  els.stopCast.disabled = true;
  try {
    await session.endSession(true);
    setCastingSpeed(null);
    els.progress.textContent = 'Cast stopped.';
  } catch (error) {
    console.error(error);
    els.progress.textContent = 'Could not stop Cast playback.';
  } finally {
    els.stopCast.disabled = false;
  }
}

function updateCastSessionState() {
  if (!window.cast?.framework) return;
  const session = cast.framework.CastContext.getInstance().getCurrentSession();
  if (!session) setCastingSpeed(null);
}

function setCastButtonsDisabled(disabled) {
  els.castSpeeds.forEach((button) => {
    button.disabled = disabled || !state.castReady;
  });
}

function setCastingSpeed(speedWpm) {
  state.castingSpeed = speedWpm;
  els.castSpeeds.forEach((button) => {
    button.classList.toggle('casting', Number(button.dataset.castSpeed) === speedWpm);
  });
  els.stopCast.classList.toggle('hidden', !speedWpm);
}

function renderHeadlines(payload) {
  els.headlineCount.textContent = `${state.headlines.length} headlines loaded`;
  updateSnapshotControls();
  els.headlines.innerHTML = state.headlines.map((item, index) => `
    <li data-headline-index="${index}">
      <span class="headline-title">${escapeHtml(item.title)}</span>
      <small>
        ${escapeHtml(item.source)} · ${escapeHtml(item.category)}
        ${item.link ? ` · <a href="${escapeAttr(item.link)}" target="_blank" rel="noopener noreferrer">Link</a>` : ''}
      </small>
    </li>
  `).join('');
  updateHeadlineMarker();
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
  if (state.headlines.length === 0) return;

  if (state.sessionActive) {
    state.remainingMs = state.durationMs;
    state.startedAt = 0;
    state.segmentStartedAt = 0;
    state.playing = false;
    state.playbackRunId += 1;
    cancelWait();
    setTone(false);
  } else {
    state.remainingMs = state.durationMs;
    state.currentHeadlineIndex = nextHeadlineIndex();
    state.sessionActive = true;
  }

  state.currentUnitIndex = 0;
  state.lastSentUnitIndex = -1;
  updateHeadlineMarker();
  await startPlayback({ delayMs: START_DELAY_MS, message: 'Starting this headline in 2 seconds…' });
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
  state.playbackRunId += 1;
  const runId = state.playbackRunId;
  els.start.disabled = false;
  els.stop.disabled = false;
  els.stop.textContent = 'Stop';
  try {
    await ensureAudio();
  } catch (error) {
    console.error(error);
    state.playing = false;
    state.playbackRunId += 1;
    els.start.disabled = false;
    els.stop.disabled = true;
    els.stop.textContent = 'Stop';
    els.progress.textContent = 'Could not start audio in this browser.';
    return;
  }

  if (delayMs > 0) {
    setTone(false);
    els.progress.textContent = message;
    await wait(delayMs);
  }

  if (!state.playing || runId !== state.playbackRunId) return;
  state.segmentStartedAt = performance.now();
  playLoop(runId);
}

function pausePractice() {
  state.remainingMs = remainingSessionMs();
  if (state.lastSentUnitIndex >= 0) state.currentUnitIndex = state.lastSentUnitIndex;
  state.playing = false;
  state.playbackRunId += 1;
  cancelWait();
  setTone(false);
  els.start.disabled = false;
  els.stop.disabled = false;
  els.stop.textContent = 'Resume';
  els.progress.textContent = 'Paused. Resume repeats the last character.';
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
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) {
      els.progress.textContent = 'This browser does not support Web Audio.';
      throw new Error('Web Audio is not supported');
    }
    state.audio = new AudioCtor();
    state.oscillator = state.audio.createOscillator();
    state.gain = state.audio.createGain();
    state.oscillator.type = 'sine';
    state.oscillator.frequency.value = Number(els.frequency.value);
    state.gain.gain.value = 0.0001;
    state.oscillator.connect(state.gain).connect(state.audio.destination);
  }
  if (state.audio.state !== 'running') await state.audio.resume();
  if (state.audio.state !== 'running') throw new Error(`Audio context is ${state.audio.state}`);
  if (!state.oscillatorStarted) {
    state.oscillator.start();
    state.oscillatorStarted = true;
  }
}

async function playLoop(runId) {
  state.loopRunning = true;

  while (state.playing && runId === state.playbackRunId && remainingSessionMs() > 0) {
    const item = state.headlines[state.currentHeadlineIndex % state.headlines.length];
    updateHeadlineMarker();
    const completed = await playHeadline(item.title, runId);
    if (!completed) break;
    state.lastCompletedHeadlineIndex = state.currentHeadlineIndex % state.headlines.length;
    savePlaybackState();
    state.currentHeadlineIndex += 1;
    state.currentUnitIndex = 0;
    state.lastSentUnitIndex = -1;
    updateHeadlineMarker();
  }

  if (state.playing) {
    finishPractice('Session complete.');
    return;
  }

  state.loopRunning = false;
}

async function playHeadline(title, runId) {
  for (let unitIndex = state.currentUnitIndex; ; unitIndex += 1) {
    const units = unitsForHeadline(title, state.speed);
    if (unitIndex >= units.length) break;
    const unit = units[unitIndex];
    if (!state.playing || runId !== state.playbackRunId) return false;
    state.currentUnitIndex = unitIndex;
    if (unit.repeatable) state.lastSentUnitIndex = unitIndex;

    for (const event of unit.events) {
      if (!state.playing || runId !== state.playbackRunId) return false;
      setTone(event.on);
      updatePlaybackStatus();
      await wait(event.ms);
    }
  }
  return true;
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

function updatePlaybackStatus() {
  const remainingMs = remainingSessionMs();
  const elapsed = Math.max(0, state.durationMs - remainingMs);
  const duration = Math.max(1, state.durationMs);
  els.progress.textContent = `${state.speed} WPM Farnsworth · ${Math.max(0, Math.ceil(remainingMs / 60000))} min left`;
  els.meter.style.width = `${Math.min(100, (elapsed / duration) * 100)}%`;
}

function nextHeadlineIndex() {
  return computeNextHeadlineIndex(state.lastCompletedHeadlineIndex, state.headlines.length);
}

function updateHeadlineMarker() {
  if (state.headlines.length === 0) return;
  const activeIndex = state.sessionActive
    ? state.currentHeadlineIndex % state.headlines.length
    : nextHeadlineIndex();

  els.headlines.querySelectorAll('li').forEach((item) => {
    const itemIndex = Number(item.dataset.headlineIndex);
    const isActive = Number.isFinite(activeIndex) && itemIndex === activeIndex;
    item.classList.toggle('next-headline', isActive);
    if (isActive) item.setAttribute('aria-current', 'true');
    else item.removeAttribute('aria-current');
  });
}

function restorePlaybackPreferences() {
  const saved = readPlaybackState();
  setSpeed(Number(saved?.speed) || state.speed, { persist: false });
  setDurationMinutes(Number(saved?.durationMinutes) || Math.round(state.durationMs / 60000), { persist: false });
  setFrequency(Number(saved?.frequencyHz) || Number(els.frequency.value), { persist: false });
}

function restorePlaybackProgress() {
  state.lastCompletedHeadlineIndex = -1;
  if (state.headlines.length === 0) return;

  const saved = readPlaybackState();
  if (!saved) return;

  const completedIndex = resolveCompletedHeadlineIndex(saved, state.headlines, state.payload?.fetchedAt);
  if (completedIndex < 0) return;

  state.lastCompletedHeadlineIndex = completedIndex;
  state.currentHeadlineIndex = nextHeadlineIndex();
}

function savePlaybackState() {
  const completedHeadline = state.headlines[state.lastCompletedHeadlineIndex];
  const playbackState = {
    version: 1,
    speed: state.speed,
    durationMinutes: Math.round(state.durationMs / 60000),
    frequencyHz: Number(els.frequency.value),
    fetchedAt: state.payload?.fetchedAt ?? '',
    lastCompletedHeadlineIndex: state.lastCompletedHeadlineIndex,
    lastCompletedHeadlineKey: completedHeadline ? headlineKey(completedHeadline) : '',
    updatedAt: Date.now(),
  };

  const encoded = encodeURIComponent(JSON.stringify(playbackState));
  document.cookie = `${PLAYBACK_STATE_COOKIE}=${encoded}; max-age=${PLAYBACK_STATE_MAX_AGE_SECONDS}; path=/; SameSite=Lax`;

  try {
    localStorage.setItem(PLAYBACK_STATE_STORAGE_KEY, JSON.stringify(playbackState));
  } catch (error) {
    console.warn('Could not save Morse playback state to localStorage', error);
  }
}

function readPlaybackState() {
  const fromCookie = readPlaybackStateCookie();
  const fromStorage = readPlaybackStateStorage();

  if (!fromCookie) return fromStorage;
  if (!fromStorage) return fromCookie;

  return Number(fromStorage.updatedAt || 0) > Number(fromCookie.updatedAt || 0)
    ? fromStorage
    : fromCookie;
}

function readPlaybackStateCookie() {
  const prefix = `${PLAYBACK_STATE_COOKIE}=`;
  const cookie = document.cookie
    .split('; ')
    .find((item) => item.startsWith(prefix));
  if (!cookie) return null;

  try {
    return JSON.parse(decodeURIComponent(cookie.slice(prefix.length)));
  } catch (error) {
    console.warn('Could not read Morse playback state cookie', error);
    return null;
  }
}

function readPlaybackStateStorage() {
  try {
    const value = localStorage.getItem(PLAYBACK_STATE_STORAGE_KEY);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.warn('Could not read Morse playback state from localStorage', error);
    return null;
  }
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
