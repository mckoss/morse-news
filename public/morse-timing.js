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

export function unitsForHeadline(text, effectiveWpm) {
  return [
    ...unitsForText(text, effectiveWpm),
    ...unitsForProsign(END_OF_MESSAGE_PROSIGN, effectiveWpm),
    { repeatable: false, events: [{ on: false, ms: MESSAGE_GAP_MS }] },
  ];
}

export function unitsForText(text, effectiveWpm) {
  const { charUnit, spacingUnit } = timingUnits(effectiveWpm);
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

export function unitsForProsign(code, effectiveWpm) {
  const { charUnit, spacingUnit } = timingUnits(effectiveWpm);
  const units = [{ repeatable: false, events: [{ on: false, ms: spacingUnit * 7 }] }];
  const events = [];

  [...code].forEach((symbol, symbolIndex) => {
    events.push({ on: true, ms: symbol === '.' ? charUnit : charUnit * 3 });
    if (symbolIndex < code.length - 1) events.push({ on: false, ms: charUnit });
  });
  units.push({ repeatable: true, events });

  return units;
}

export function timingUnits(effectiveWpm) {
  // Farnsworth below 20 WPM: characters stay at 20 WPM while spacing stretches.
  // Above 20 WPM, send true faster code with matching character and spacing timing.
  const safeWpm = Math.max(1, Number(effectiveWpm) || FARNSWORTH_CHARACTER_WPM);
  const characterWpm = Math.max(FARNSWORTH_CHARACTER_WPM, safeWpm);
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
