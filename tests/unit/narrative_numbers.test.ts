import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNoNovelNumbers, NarrativeFabricationError } from '../../backend/watchdog_api/services/narrative';

const allow = (source: string, generated: string) => assert.doesNotThrow(
  () => assertNoNovelNumbers(`Observed: ${generated}.`, `Observed: ${source}.`, 'controlled'), `${source} -> ${generated}`);
const reject = (source: string, generated: string) => assert.throws(
  () => assertNoNovelNumbers(`Observed: ${generated}.`, `Observed: ${source}.`, 'controlled'),
  (error: unknown) => error instanceof NarrativeFabricationError && error.providerKey === 'controlled' &&
    error.code === 'validation_error' && error.novelNumbers.includes(generated), `${source} -> ${generated}`);

test('WD-011: nonzero signs remain part of the value, including Unicode minus', () => {
  for (const [source, generated] of [['15', '-15'], ['-15', '15'], ['15', '−15'], ['−15', '+15'],
    ['15.17', '-15.170'], ['-0.0001', '0.0001']]) reject(source, generated);
  for (const [source, generated] of [['15', '+15'], ['-15', '-15'], ['−15', '-15'], ['-15', '−15'],
    ['-0.000', '0'], ['+15.17', '15.170']]) allow(source, generated);
});

test('WD-011: documented grouping/trailing zeros and unchanged ordinary identifiers still work', () => {
  for (const [source, generated] of [['1,234', '1234'], ['1 234', '1234'], ['1\u00a0234', '1234'],
    ['-1,234.50', '−1234.500'], ['0015.1700', '15.17'], ['0.000', '+000'],
    ['1234567', '1 234 567'], ['1234567', '1,234,567'], ['15.17', '15.170']]) allow(source, generated);
  assert.doesNotThrow(() => assertNoNovelNumbers('Preset jh2016-faithful. No figures changed.',
    'Preset jh2016-faithful. Observed 15.17.', 'controlled'));
  assert.doesNotThrow(() => assertNoNovelNumbers('No figures here.', 'Observed: -15.', 'controlled'));
  reject('15.17', '15.2'); reject('15.17', '42');
});

test('WD-011: integer and decimal precision never pass through binary Number rounding', () => {
  for (const [source, generated] of [['9007199254740992', '9007199254740993'],
    ['1.00000000000000001', '1.00000000000000002'], ['-9007199254740993', '-9007199254740992'],
    ['0.0000000000000000001', '0.0000000000000000002']]) reject(source, generated);
  allow('9007199254740993.100', '9,007,199,254,740,993.1');
  allow('1' + '0'.repeat(400), '1' + '0'.repeat(400) + '.000');
  reject('1' + '0'.repeat(400), '2' + '0'.repeat(400));
});

test('WD-011: exponents form a whole signed token without new cross-notation equivalences', () => {
  for (const [source, generated] of [['1e-3', '1e3'], ['1e3', '1e-3'], ['-1e3', '1e3'],
    ['1e3', '3'], ['1e3', '1000'], ['1000', '1e3'], ['1e3', '10e2'], ['1e3', '1e300'],
    ['1e9007199254740992', '1e9007199254740993']]) reject(source, generated);
  for (const [source, generated] of [['1e-3', '1.000E−003'], ['1e3', '1.0e+3'],
    ['-1.5e-3', '−1.500E-3'], ['1e9007199254740993', '1.00e+9007199254740993']]) allow(source, generated);
});

test('WD-011: unsupported numeric-looking forms remain opaque, never known digit fragments', () => {
  for (const [source, generated] of [['15', '--15'], ['15', '+-15'], ['15', '−-15'], ['15', '±15'],
    ['15', '- 15'], ['15', '1,5'], ['1.5', '1,5'], ['15', '.15'], ['0.15', '.15'],
    ['15', '1..5'], ['15', '1 5'], ['15', '1e--5'], ['1e5', '1e'], ['0 and 20', '0x20'], ['0 and -20', '0x-20'], ['0', '0x'], ['0', '0b'], ['0', '0o'],
    ['1e3 and -4', '1e3e-4'],
    ['--15', '15'], ['1,5', '15']]) reject(source, generated);
  for (const raw of ['--15', '1,5', '.15', '1..5', '1e--5', '0x20', '0x', '0b', '0o']) allow(raw, raw);
});
