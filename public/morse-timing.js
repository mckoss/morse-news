export const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..',
  J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
  S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...',
  8: '---..', 9: '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--',
  '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-',
  '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.', '$': '...-..-', '@': '.--.-.',
};

export const END_OF_MESSAGE_PROSIGN = '.-.-.'; // AR
export const MESSAGE_GAP_MS = 5000;
export const FARNSWORTH_CHARACTER_WPM = 20;
export const MORSE_REFERENCE_GROUPS = [
  {
    heading: 'Letters',
    characters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  },
  {
    heading: 'Numbers',
    characters: '0123456789'.split(''),
  },
  {
    heading: 'Punctuation',
    characters: ['.', ',', '?', "'", '!', '/', ':', ';', '=', '+', '-', '"', '@', '(', ')'],
  },
];

export function unitsForHeadline(text, effectiveWpm, characterWpm) {
  return [
    ...unitsForText(text, effectiveWpm, characterWpm),
    ...unitsForProsign(END_OF_MESSAGE_PROSIGN, effectiveWpm, characterWpm),
    { repeatable: false, events: [{ on: false, ms: MESSAGE_GAP_MS }] },
  ];
}

export function unitsForText(text, effectiveWpm, characterWpm) {
  const { charUnit, spacingUnit } = timingUnits(effectiveWpm, characterWpm);
  const units = [];
  const words = sanitize(text).split(/\s+/).filter(Boolean);

  words.forEach((word, wordIndex) => {
    [...word].forEach((char, charIndex) => {
      const code = MORSE[char];
      if (!code) return;
      const events = [];
      [...code].forEach((symbol, symbolIndex) => {
        events.push({ on: true, ms: symbol === '.' ? charUnit : charUnit * 3 });
        if (symbolIndex < code.length - 1) events.push({ on: false, ms: charUnit });
      });
      units.push({ repeatable: true, events });
      if (charIndex < word.length - 1) units.push({ repeatable: false, events: [{ on: false, ms: spacingUnit * 3 }] });
    });
    if (wordIndex < words.length - 1) units.push({ repeatable: false, events: [{ on: false, ms: spacingUnit * 7 }] });
  });
  units.push({ repeatable: false, events: [{ on: false, ms: spacingUnit * 10 }] });
  return units;
}

export function unitsForProsign(code, effectiveWpm, characterWpm) {
  const { charUnit, spacingUnit } = timingUnits(effectiveWpm, characterWpm);
  const units = [{ repeatable: false, events: [{ on: false, ms: spacingUnit * 7 }] }];
  const events = [];

  [...code].forEach((symbol, symbolIndex) => {
    events.push({ on: true, ms: symbol === '.' ? charUnit : charUnit * 3 });
    if (symbolIndex < code.length - 1) events.push({ on: false, ms: charUnit });
  });
  units.push({ repeatable: true, events });

  return units;
}

export function validateTimingSpeeds(characterWpm, effectiveWpm) {
  const character = Number(characterWpm);
  const effective = Number(effectiveWpm);
  if (!Number.isFinite(character) || character <= 0 || !Number.isFinite(effective) || effective <= 0) {
    return { valid: false, message: 'Enter positive character and effective speeds.' };
  }
  if (character < effective) {
    return { valid: false, message: 'Character speed must be greater than or equal to effective speed.' };
  }
  return { valid: true, characterWpm: character, effectiveWpm: effective, message: '' };
}

export function timingUnits(effectiveWpm, requestedCharacterWpm) {
  // Farnsworth below 20 WPM: characters stay at 20 WPM while spacing stretches.
  // Above 20 WPM, send true faster code with matching character and spacing timing.
  const safeWpm = Math.max(1, Number(effectiveWpm) || FARNSWORTH_CHARACTER_WPM);
  const defaultCharacterWpm = Math.max(FARNSWORTH_CHARACTER_WPM, safeWpm);
  const characterWpm = Math.max(safeWpm, Number(requestedCharacterWpm) || defaultCharacterWpm);
  return {
    charUnit: 1200 / characterWpm,
    spacingUnit: 1200 / safeWpm,
  };
}

export function sanitize(text) {
  return text
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9.,?'!/:;=+\-"@$()\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
