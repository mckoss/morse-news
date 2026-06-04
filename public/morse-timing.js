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

export function unitsForHeadline(text, effectiveWpm) {
  return [
    ...unitsForText(text, effectiveWpm),
    ...unitsForProsign(END_OF_MESSAGE_PROSIGN, effectiveWpm),
    { repeatable: false, events: [{ on: false, ms: MESSAGE_GAP_MS }] },
  ];
}

export function unitsForText(text, effectiveWpm) {
  // Farnsworth: characters are sent at 20 WPM, spacing is stretched for slower effective copy speeds.
  const characterWpm = 20;
  const charUnit = 1200 / characterWpm;
  const spacingUnit = 1200 / Math.min(effectiveWpm, characterWpm);
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
  const characterWpm = 20;
  const charUnit = 1200 / characterWpm;
  const spacingUnit = 1200 / Math.min(effectiveWpm, characterWpm);
  const units = [{ repeatable: false, events: [{ on: false, ms: spacingUnit * 7 }] }];
  const events = [];

  [...code].forEach((symbol, symbolIndex) => {
    events.push({ on: true, ms: symbol === '.' ? charUnit : charUnit * 3 });
    if (symbolIndex < code.length - 1) events.push({ on: false, ms: charUnit });
  });
  units.push({ repeatable: true, events });

  return units;
}

export function sanitize(text) {
  return text
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9.,?'!/:;=+\-"@$()\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
