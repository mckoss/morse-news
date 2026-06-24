import { END_OF_MESSAGE_PROSIGN, MORSE, MORSE_REFERENCE_GROUPS } from './morse-timing.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DOT_DIAMETER = 8;
const SYMBOL_GAP = DOT_DIAMETER;
const DASH_WIDTH = DOT_DIAMETER * 3;
const SYMBOL_HEIGHT = DOT_DIAMETER + 4;

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

function renderRow({ label, code }) {
  const row = document.createElement('tr');

  const characterCell = document.createElement('td');
  characterCell.className = 'morse-character';
  characterCell.textContent = label;

  const codeCell = document.createElement('td');
  codeCell.className = 'morse-code';
  codeCell.append(renderMorseSvg(code));

  row.append(characterCell, codeCell);
  return row;
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
  }));
  table.append(body);

  section.append(heading, table);
  return section;
}
