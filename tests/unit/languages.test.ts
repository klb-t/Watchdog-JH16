import { test } from 'node:test';
import assert from 'node:assert/strict';
import data from '../../config/languages.json';
import access from '../../config/access/ui.json';
import messages from '../../config/access/messages.json';
import { LANGUAGE_CODES, languages, languageFromBrowser, isMachineTranslated, localeOf } from '../../shared/languages';

test('the language registry and the type list name the same languages, each with a locale', () => {
  assert.deepEqual(data.languages.map(l => l.code), [...LANGUAGE_CODES]);
  for (const code of LANGUAGE_CODES) assert.match(localeOf(code), /^[a-z]{2}-[A-Z]{2}$/);
  assert.deepEqual(Object.keys(access.languages), [...LANGUAGE_CODES], 'access screens carry every language');
  assert.deepEqual(Object.keys(messages.languages), [...LANGUAGE_CODES], 'emails carry every language');
});

test('Dutch is marked as an unread machine translation; Polish and English are not', () => {
  assert.equal(isMachineTranslated('nl'), true);
  assert.equal(isMachineTranslated('pl'), false);
  assert.equal(isMachineTranslated('en'), false);
});

test('the browser language is the first entry of the phone list that the interface has', () => {
  assert.equal(languageFromBrowser(['pl-PL']), 'pl');
  assert.equal(languageFromBrowser(['nl-NL', 'en-US']), 'nl');
  assert.equal(languageFromBrowser(['nl-BE']), 'nl', 'a regional variant matches its language');
  assert.equal(languageFromBrowser(['en-US', 'pl-PL']), 'en', 'the order of the list is the reader\'s preference');
  assert.equal(languageFromBrowser(['uk-UA', 'pl-PL']), 'pl', 'an unsupported first choice falls through to the next');
  assert.equal(languageFromBrowser(['uk-UA']), languages.default);
  assert.equal(languageFromBrowser([]), languages.default);
});
