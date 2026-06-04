import test from 'node:test';
import assert from 'node:assert/strict';
import { timingUnits, unitsForText } from '../public/morse-timing.js';

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
