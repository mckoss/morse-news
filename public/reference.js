import { END_OF_MESSAGE_PROSIGN, MORSE, MORSE_REFERENCE_GROUPS } from './morse-timing.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DOT_DIAMETER = 8;
const SYMBOL_GAP = DOT_DIAMETER;
const DASH_WIDTH = DOT_DIAMETER * 3;
const SYMBOL_HEIGHT = DOT_DIAMETER + 4;
const CHARACTER_WPM = 20;
const EFFECTIVE_WPM = 5;
const TONE_FREQUENCY_HZ = 550;

const LABELS = new Map([
  ['.', 'period'],
  [',', 'comma'],
  ['?', 'question mark'],
  ["'", 'apostrophe'],
  ['!', 'exclamation point'],
  ['/', 'slash'],
  [':', 'colon'],
  [';', 'semicolon'],
  ['=', 'equals'],
  ['+', 'plus'],
  ['-', 'hyphen'],
  ['"', 'quotation mark'],
  ['@', 'at sign'],
  ['(', 'left parenthesis'],
  [')', 'right parenthesis'],
]);

const container = document.querySelector('#reference-tables');
const showCodes = document.querySelector('#show-codes');
const audioStatus = document.querySelector('#reference-audio-status');
const audioState = {
  context: null,
  oscillator: null,
  gain: null,
  timeout: null,
  waitResolve: null,
  runId: 0,
  activeButton: null,
};

showCodes?.addEventListener('change', () => {
  container?.classList.toggle('show-codes', showCodes.checked);
});

if (container) {
  container.replaceChildren(
    ...MORSE_REFERENCE_GROUPS.map((group) => renderGroup(group)),
    renderProsign(),
  );
}

function renderGroup(group) {
  const section = document.createElement('section');
  section.className = 'reference-group';

  const heading = document.createElement('h3');
  heading.textContent = group.heading;
  section.append(heading, renderTable(group.characters));
  return section;
}

function renderTable(characters) {
  const table = document.createElement('table');
  table.className = 'morse-table';
  table.append(renderHeader());

  const body = document.createElement('tbody');
  characters.forEach((character) => {
    body.append(renderRow({
      label: displayLabel(character),
      code: MORSE[character],
      audioLabel: displayLabel(character),
    }));
  });
  table.append(body);
  return table;
}

function renderHeader() {
  const head = document.createElement('thead');
  const row = document.createElement('tr');
  ['character', 'code'].forEach((label) => {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    row.append(cell);
  });
  head.append(row);
  return head;
}

function renderRow({ label, code, audioLabel = label }) {
  const row = document.createElement('tr');

  const characterCell = document.createElement('td');
  characterCell.className = 'morse-character';
  const playButton = document.createElement('button');
  playButton.className = 'morse-play';
  playButton.type = 'button';
  playButton.textContent = label;
  playButton.setAttribute('aria-label', `Play ${audioLabel} at Farnsworth ${CHARACTER_WPM}/${EFFECTIVE_WPM} WPM`);
  playButton.addEventListener('click', () => playCode(code, audioLabel, playButton));
  characterCell.append(playButton);

  const codeCell = document.createElement('td');
  codeCell.className = 'morse-code';
  codeCell.append(renderMorseSvg(code));

  row.append(characterCell, codeCell);
  return row;
}

async function playCode(code, label, button) {
  cancelPlayback();
  const runId = audioState.runId;

  try {
    await ensureAudio();
    if (runId !== audioState.runId) return;

    audioState.activeButton = button;
    button.classList.add('playing');
    if (audioStatus) audioStatus.textContent = `Playing ${label}`;

    const dotMs = 1200 / CHARACTER_WPM;
    for (const [index, symbol] of [...code].entries()) {
      if (runId !== audioState.runId) return;
      setTone(true);
      await wait(symbol === '.' ? dotMs : dotMs * 3);
      if (index < code.length - 1) {
        setTone(false);
        await wait(dotMs);
      }
    }
  } catch (error) {
    console.error('Could not play Morse reference audio', error);
    if (audioStatus) audioStatus.textContent = 'Could not play audio';
  } finally {
    if (runId === audioState.runId) {
      setTone(false);
      button.classList.remove('playing');
      audioState.activeButton = null;
      if (audioStatus) audioStatus.textContent = `Finished ${label}`;
    }
  }
}

async function ensureAudio() {
  if (!audioState.context) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error('Web Audio is not supported');
    audioState.context = new AudioContext();
    audioState.oscillator = audioState.context.createOscillator();
    audioState.gain = audioState.context.createGain();
    audioState.oscillator.type = 'sine';
    audioState.oscillator.frequency.value = TONE_FREQUENCY_HZ;
    audioState.gain.gain.value = 0.0001;
    audioState.oscillator.connect(audioState.gain);
    audioState.gain.connect(audioState.context.destination);
    audioState.oscillator.start();
  }
  if (audioState.context.state === 'suspended') await audioState.context.resume();
}

function setTone(on) {
  if (!audioState.context || !audioState.gain) return;
  const now = audioState.context.currentTime;
  audioState.gain.gain.cancelScheduledValues(now);
  audioState.gain.gain.setTargetAtTime(on ? 0.18 : 0.0001, now, 0.004);
}

function wait(ms) {
  return new Promise((resolve) => {
    audioState.waitResolve = resolve;
    audioState.timeout = setTimeout(() => {
      audioState.timeout = null;
      audioState.waitResolve = null;
      resolve();
    }, ms);
  });
}

function cancelPlayback() {
  audioState.runId += 1;
  setTone(false);
  clearTimeout(audioState.timeout);
  audioState.timeout = null;
  const resolve = audioState.waitResolve;
  audioState.waitResolve = null;
  resolve?.();
  audioState.activeButton?.classList.remove('playing');
  audioState.activeButton = null;
}

function displayLabel(character) {
  const name = LABELS.get(character);
  if (name) return `${character} (${name})`;
  return character.toLowerCase();
}

function renderMorseSvg(code) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const symbols = [...code];
  const width = symbols.reduce((total, symbol, index) => {
    const symbolWidth = symbol === '-' ? DASH_WIDTH : DOT_DIAMETER;
    return total + symbolWidth + (index < symbols.length - 1 ? SYMBOL_GAP : 0);
  }, 0);
  let x = 0;

  svg.classList.add('morse-symbols');
  svg.setAttribute('viewBox', `0 0 ${width} ${SYMBOL_HEIGHT}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(SYMBOL_HEIGHT));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', code);

  symbols.forEach((symbol) => {
    if (symbol === '.') {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', String(x + DOT_DIAMETER / 2));
      dot.setAttribute('cy', String(SYMBOL_HEIGHT / 2));
      dot.setAttribute('r', String(DOT_DIAMETER / 2));
      svg.append(dot);
      x += DOT_DIAMETER + SYMBOL_GAP;
      return;
    }

    const dash = document.createElementNS(SVG_NS, 'rect');
    dash.setAttribute('x', String(x));
    dash.setAttribute('y', String((SYMBOL_HEIGHT - DOT_DIAMETER) / 2));
    dash.setAttribute('width', String(DASH_WIDTH));
    dash.setAttribute('height', String(DOT_DIAMETER));
    dash.setAttribute('rx', String(DOT_DIAMETER / 2));
    dash.setAttribute('ry', String(DOT_DIAMETER / 2));
    svg.append(dash);
    x += DASH_WIDTH + SYMBOL_GAP;
  });

  return svg;
}

function renderProsign() {
  const section = document.createElement('section');
  section.className = 'reference-group';

  const heading = document.createElement('h3');
  heading.textContent = 'Headline Separator';

  const table = document.createElement('table');
  table.className = 'morse-table';
  table.append(renderHeader());

  const body = document.createElement('tbody');
  body.append(renderRow({
    label: 'ar (end of headline)',
    code: END_OF_MESSAGE_PROSIGN,
    audioLabel: 'AR, end of headline',
  }));
  table.append(body);

  section.append(heading, table);
  return section;
}
