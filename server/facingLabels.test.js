import test from 'node:test';
import assert from 'node:assert/strict';
import { compassLabel } from './facingLabels.js';

test('converts degrees to project compass labels', () => {
  assert.equal(compassLabel(0), 'N');
  assert.equal(compassLabel(22.4), 'N');
  assert.equal(compassLabel(22.5), 'NE');
  assert.equal(compassLabel(44), 'NE');
  assert.equal(compassLabel(90), 'E');
  assert.equal(compassLabel(110), 'E');
  assert.equal(compassLabel(111), 'SE');
  assert.equal(compassLabel(181), 'S');
  assert.equal(compassLabel(299), 'W');
  assert.equal(compassLabel(300), 'NW');
  assert.equal(compassLabel(315), 'NW');
  assert.equal(compassLabel(337.5), 'N');
});
