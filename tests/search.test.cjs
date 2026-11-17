const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(`${__dirname}/../src/search.js`, 'utf8');

function harness(options = {}) {
  const calls = {};
  let click;
  class Element {}
  const status = { hidden: true };
  const button = new Element();
  button.dataset = { fieldId: options.fieldId || 'custbody_test' };
  let typeControl = options.chosenType ? {
    dataset: { fieldId: button.dataset.fieldId }, value: options.chosenType,
  } : null;
  const container = {
    querySelector: selector => selector.includes('field-type') ? typeControl : status,
    appendChild: element => { typeControl = element; },
  };
  button.closest = () => container;
  const target = new Element();
  target.closest = () => button;
  const tab = {
    document: { body: {} },
    location: { replace: (url) => { calls.url = url; } },
    close: () => { calls.closed = true; },
  };
  const window = {
    location: { origin: 'https://test.app.netsuite.com', href: options.href || 'https://test.app.netsuite.com/app/common/location/location.nl?id=204' },
    open: () => { calls.opened = true; return options.blockPopup ? null : tab; },
    nlapiGetRecordType: () => Object.hasOwn(options, 'recordType') ? options.recordType : 'salesorder',
    nlapiGetField: () => options.missingField ? null : { getType: () => options.type || 'text' },
    nlapiGetFieldValue: () => options.value,
    nlapiGetFieldValues: () => options.value,
    fetch: async (url, init) => {
      calls.fetch = { url, credentials: init.credentials };
      return { ok: !options.httpError, text: async () => '<record />' };
    },
    nlapiLoadRecord: (recordType, id) => {
      calls.load = { recordType, id };
      throw new Error('Client record loading is unavailable');
    },
    nlobjSearchFilter: function (name, join, operator, value) {
      Object.assign(this, { name, join, operator, value });
    },
    nlobjSearchColumn: function (name) { this.name = name; },
    nlapiCreateSearch: (recordType, filters, columns) => {
      calls.search = JSON.parse(JSON.stringify({ recordType, filters, columns }));
      return {
        runSearch: () => ({ getResults: (start, end) => {
          calls.validation = [start, end];
          if (options.searchError) throw options.searchError;
          if (options.invalidFilter) throw new Error('Invalid search filter');
          return [];
        } }),
        setRedirectURLToSearchResults: () => { calls.prepared = true; },
      };
    },
  };
  if (options.missingApi) delete window.nlapiCreateSearch;
  if (options.inspectCallers) {
    // Reproduce SuiteScript 1.0's legacy stack inspection using actual JS
    // caller access. Arrow/async frames throw the user's exact TypeError.
    const instrument = vm.runInNewContext(`(function instrument(implementation) {
      return function legacyApi() {
        var frame = legacyApi.caller;
        while (frame) frame = frame.caller;
        var result = implementation.apply(this, arguments);
        if (result && typeof result === 'object') {
          Object.keys(result).forEach(function (key) {
            if (typeof result[key] === 'function') result[key] = instrument(result[key]);
          });
        }
        return result;
      };
    })`);
    for (const name of Object.keys(window)) {
      if (name.startsWith('nl')) window[name] = instrument(window[name]);
    }
  }
  vm.runInNewContext(source, {
    window, Element, URL, setTimeout,
    AbortSignal: { timeout: () => undefined },
    DOMParser: class {
      parseFromString() {
        return { querySelector: (selector) => {
          if (selector === 'parsererror') return options.malformedXml ? {} : null;
          if (!options.xmlRecord) return null;
          return {
            getAttribute: (name) => options.xmlRecord[name] ?? null,
            children: options.xmlField ? [{
              localName: options.xmlField.name || button.dataset.fieldId,
              textContent: options.xmlField.value,
              children: options.structuredValue ? [{}] : [],
            }] : [],
          };
        } };
      }
    },
    document: {
      addEventListener: (name, fn) => { click = fn; },
      createElement: () => ({
        dataset: {}, style: {}, children: [], value: '',
        setAttribute() {}, appendChild(node) { this.children.push(node); }, focus() {},
      }),
    },
  });
  return {
    calls, status, button,
    getTypeControl: () => typeControl,
    click: (isTrusted = true) => click({
      target, isTrusted, preventDefault() {}, stopImmediatePropagation() {},
    }),
  };
}

for (const [type, value, operator, expected] of [
  ['text', 'A&B <hello> "quotes"', 'is', 'A&B <hello> "quotes"'],
  ['select', '123', 'anyof', '123'],
  ['multiselect', ['12', '34'], 'anyof', ['12', '34']],
  ['multiselect', [], 'anyof', ['@NONE@']],
  ['select', '', 'anyof', ['@NONE@']],
  ['checkbox', false, 'is', 'F'],
  ['checkbox', 'F', 'is', 'F'],
  ['checkbox', true, 'is', 'T'],
  ['currency', 0, 'equalto', 0],
  ['integer', '0', 'equalto', '0'],
  ['date', '16/09/2026', 'on', '16/09/2026'],
  ['text', '', 'isempty', undefined],
]) {
  test(`search ${type} ${JSON.stringify(value)}`, async () => {
    const h = harness({ type, value });
    await h.click();
    assert.equal(h.calls.search.recordType, 'salesorder');
    const filter = h.calls.search.filters[0];
    assert.equal(filter.name, 'custbody_test');
    assert.equal(filter.operator, operator);
    assert.deepEqual(filter.value, expected);
    assert.deepEqual(h.calls.validation, [0, 1]);
    assert.equal(h.calls.search.filters[1].name, 'mainline');
    assert.equal(h.calls.prepared, true);
    assert.equal(h.calls.url, 'https://test.app.netsuite.com/app/common/search/searchresults.nl?api=T&adv=T');
    assert.equal(h.status.hidden, true);
    assert.equal(h.button.disabled, false);
  });
}

test('custom records keep their record type without transaction filters', async () => {
  const h = harness({ recordType: 'customrecord_example', value: 'test' });
  await h.click();
  assert.equal(h.calls.search.recordType, 'customrecord_example');
  assert.equal(h.calls.search.filters.length, 1);
});

for (const options of [
  { invalidFilter: true }, { missingApi: true }, { missingField: true },
  { type: 'password' }, { blockPopup: true }, { value: undefined },
]) {
  test(`failed searches do not navigate: ${JSON.stringify(options)}`, async () => {
    const h = harness({ value: 'test', ...options });
    await h.click();
    assert.equal(h.calls.url, undefined);
    assert.equal(h.calls.prepared, undefined);
    assert.equal(h.status.hidden, false);
    assert.match(h.status.textContent, /Could not open search:/);
    assert.equal(h.button.disabled, false);
    if (!options.blockPopup) assert.equal(h.calls.closed, true);
  });
}

test('synthetic clicks cannot trigger page API calls or navigation', async () => {
  const h = harness({ value: 'test' });
  await h.click(false);
  assert.deepEqual(h.calls, {});
});

test('location View mode reads XML identity and selected value without loading a record', async () => {
  const h = harness({
    recordType: null, missingField: true, fieldId: 'custrecord_5826_loc_branch_id',
    xmlRecord: { recordType: 'location', id: '204' },
    xmlField: { value: '1006' }, chosenType: 'text',
  });
  await h.click();
  assert.equal(new URL(h.calls.fetch.url).searchParams.get('xml'), 'T');
  assert.equal(h.calls.fetch.credentials, 'same-origin');
  assert.equal(h.calls.load, undefined);
  assert.equal(h.calls.search.recordType, 'location');
  assert.deepEqual(h.calls.search.filters, [{
    name: 'custrecord_5826_loc_branch_id', join: null, operator: 'is', value: '1006',
  }]);
  assert.equal(h.calls.prepared, true);
});

test('custom site ID requires an explicit type when metadata is unavailable, then retries', async () => {
  const h = harness({
    inspectCallers: true, recordType: null, missingField: true,
    fieldId: 'custrecord_tevalis_siteid',
    xmlRecord: { recordType: 'location', id: '204' },
    xmlField: { value: '8266' },
  });
  await h.click();
  assert.equal(h.calls.load, undefined);
  assert.equal(h.calls.search, undefined);
  assert.match(h.status.textContent, /Choose its field type/);
  const control = h.getTypeControl();
  assert.equal(control.value, '');
  assert.equal(control.dataset.fieldId, 'custrecord_tevalis_siteid');
  control.value = 'text';
  await h.click();
  assert.equal(h.status.hidden, true, h.status.textContent);
  assert.deepEqual(h.calls.search.filters, [{
    name: 'custrecord_tevalis_siteid', join: null, operator: 'is', value: '8266',
  }]);
  assert.equal(h.calls.load, undefined);
  assert.ok(h.calls.url);
});

test('page metadata supplies the custom field type even when record type is missing', async () => {
  const h = harness({
    recordType: null, type: 'integer', value: null,
    fieldId: 'custrecord_tevalis_siteid',
    xmlRecord: { recordType: 'location', id: '204' },
    xmlField: { value: '8266' },
  });
  await h.click();
  assert.equal(h.calls.search.filters[0].operator, 'equalto');
  assert.equal(h.calls.search.filters[0].value, '8266');
  assert.equal(h.getTypeControl(), null);
  assert.equal(h.calls.load, undefined);
});

test('field type choices from a different field are ignored', async () => {
  const h = harness({
    recordType: null, missingField: true, chosenType: 'integer',
    fieldId: 'custrecord_tevalis_siteid',
    xmlRecord: { recordType: 'location', id: '204' }, xmlField: { value: '8266' },
  });
  h.getTypeControl().dataset.fieldId = 'some_other_field';
  await h.click();
  assert.equal(h.calls.search, undefined);
  assert.match(h.status.textContent, /Choose its field type/);
});

for (const [searchError, expected] of [
  ['Permission denied by NetSuite', /Permission denied by NetSuite/],
  [{ code: 'SSS_INVALID_SRCH_FILTER', details: 'Unknown field' }, /SSS_INVALID_SRCH_FILTER: Unknown field/],
  [{ getCode: () => 'INSUFFICIENT_PERMISSION', getDetails: () => '' }, /INSUFFICIENT_PERMISSION/],
  [{ getCode: () => 'API_ERROR', getDetails: () => { throw Error(); } }, /API_ERROR/],
]) {
  test(`preserve NetSuite error details: ${expected}`, async () => {
    const h = harness({ value: 'test', searchError });
    await h.click();
    assert.match(h.status.textContent, expected);
    assert.equal(h.calls.url, undefined);
    assert.equal(h.button.disabled, false);
  });
}

test('missing current record context does not turn a null page value into an empty search', async () => {
  const h = harness({
    recordType: '', missingField: true, value: null, fieldId: 'parent',
    xmlRecord: { recordType: 'location', id: '204' },
    xmlField: { value: '208' },
  });
  await h.click();
  assert.equal(h.calls.search.filters[0].operator, 'anyof');
  assert.equal(h.calls.search.filters[0].value, '208');
});

test('live edit values take priority over stored values', async () => {
  const h = harness({ recordType: 'location', value: 'Changed name' });
  await h.click();
  assert.equal(h.calls.fetch, undefined);
  assert.equal(h.calls.load, undefined);
  assert.equal(h.calls.search.filters[0].value, 'Changed name');
});

test('unreadable edit forms never fall back to stored values', async () => {
  const h = harness({
    recordType: null, missingField: true,
    href: 'https://test.app.netsuite.com/app/common/location/location.nl?id=204&e=T',
  });
  await h.click();
  assert.equal(h.calls.fetch, undefined);
  assert.equal(h.calls.url, undefined);
  assert.match(h.status.textContent, /edit form/);
});

test('legacy caller inspection works for live field reads and the entire search flow', async () => {
  const h = harness({
    inspectCallers: true, recordType: 'location', value: 'Bristol',
    href: 'https://test.app.netsuite.com/app/common/location/location.nl?id=204&e=T',
  });
  await h.click();
  assert.equal(h.status.hidden, true, h.status.textContent);
  assert.equal(h.calls.fetch, undefined);
  assert.equal(h.calls.search.filters[0].value, 'Bristol');
  assert.equal(h.calls.prepared, true);
  assert.ok(h.calls.url);
});

test('legacy caller inspection works when searching a location from View mode', async () => {
  const h = harness({
    inspectCallers: true, recordType: null, missingField: true,
    xmlRecord: { recordType: 'location', id: '204' },
    xmlField: { value: '1006' }, chosenType: 'text',
  });
  await h.click();
  assert.equal(h.status.hidden, true, h.status.textContent);
  assert.equal(h.calls.load, undefined);
  assert.equal(h.calls.search.filters[0].value, '1006');
  assert.equal(h.calls.prepared, true);
  assert.ok(h.calls.url);
});

for (const options of [
  { xmlRecord: { recordType: 'location', id: '999' } },
  { malformedXml: true }, { httpError: true }, { structuredValue: true },
  { xmlField: null }, { xmlField: { name: 'different_field', value: 'Bristol' } },
]) {
  test(`invalid record responses do not navigate: ${JSON.stringify(options)}`, async () => {
    const h = harness({
      recordType: null, missingField: true,
      xmlRecord: { recordType: 'location', id: '204' },
      xmlField: { value: 'Bristol' }, chosenType: 'text', ...options,
    });
    await h.click();
    assert.equal(h.calls.search, undefined);
    assert.equal(h.calls.url, undefined);
    assert.equal(h.calls.closed, true);
    assert.equal(h.status.hidden, false);
  });
}
