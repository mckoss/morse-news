import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MORSE,
  MORSE_REFERENCE_GROUPS,
  sanitize,
  timingUnits,
  unitsForText,
  validateTimingSpeeds,
} from '../public/morse-timing.js';

test('timingUnits uses Farnsworth spacing below 20 WPM', () => {
  assert.deepEqual(timingUnits(5), { charUnit: 60, spacingUnit: 240 });
  assert.deepEqual(timingUnits(10), { charUnit: 60, spacingUnit: 120 });
  assert.deepEqual(timingUnits(20), { charUnit: 60, spacingUnit: 60 });
});

test('timingUnits sends true faster code above 20 WPM', () => {
  assert.deepEqual(timingUnits(25), { charUnit: 48, spacingUnit: 48 });
  assert.deepEqual(timingUnits(30), { charUnit: 40, spacingUnit: 40 });
});

test('unitsForText shortens character elements above 20 WPM', () => {
  const twentyWpmDit = unitsForText('E', 20)[0].events[0].ms;
  const thirtyWpmDit = unitsForText('E', 30)[0].events[0].ms;

  assert.equal(twentyWpmDit, 60);
  assert.equal(thirtyWpmDit, 40);
});

test('timingUnits supports a custom character speed', () => {
  assert.deepEqual(timingUnits(5, 25), { charUnit: 48, spacingUnit: 240 });
  assert.equal(unitsForText('E', 5, 25)[0].events[0].ms, 48);
});

test('custom character speed must be at least the effective speed', () => {
  assert.deepEqual(validateTimingSpeeds(20, 5), {
    valid: true,
    characterWpm: 20,
    effectiveWpm: 5,
    message: '',
  });
  assert.deepEqual(validateTimingSpeeds(5, 10), {
    valid: false,
    message: 'Character speed must be greater than or equal to effective speed.',
  });
  assert.equal(validateTimingSpeeds('', 5).valid, false);
});

test('reference groups cover all headline characters the app can emit', () => {
  const referenceCharacters = MORSE_REFERENCE_GROUPS.flatMap((group) => group.characters);
  const emittedCharacters = new Set(sanitize(referenceCharacters.join('')).replace(/\s/g, '').split(''));

  assert.deepEqual(new Set(referenceCharacters), emittedCharacters);
  referenceCharacters.forEach((character) => assert.ok(MORSE[character], `${character} has Morse code`));
  assert.equal(referenceCharacters.includes('&'), false);
  assert.equal(referenceCharacters.includes('_'), false);
  assert.equal(referenceCharacters.includes('$'), false);
});
