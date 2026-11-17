// Runs in the page's MAIN world so NetSuite's client APIs are available.
// No saved searches or records are created or modified.
// Keep this a non-strict classic script: SuiteScript 1.0 inspects Function.caller.
(function () {
  const TRANSACTION_TYPES = new Set([
    'salesorder', 'purchaseorder', 'invoice', 'cashsale', 'creditmemo',
    'cashrefund', 'returnauthorization', 'vendorreturnauthorization',
    'vendorbill', 'vendorcredit', 'vendorpayment', 'customerpayment',
    'customerdeposit', 'customerrefund', 'estimate', 'itemfulfillment',
    'itemreceipt', 'transferorder', 'workorder', 'check', 'deposit',
    'inventoryadjustment', 'inventorytransfer',
  ]);

  const FIELD_TYPES = {
    text: 'Text', integer: 'Number', select: 'List / Record',
    multiselect: 'Multiple Select', date: 'Date', checkbox: 'Checkbox',
  };
  // Standard Location body field types from the SuiteScript Records Browser.
  // Custom fields must use metadata or an explicit user choice, never a guess
  // based on the value ("1006" might be text, a number, or a record ID).
  const LOCATION_FIELD_TYPES = {
    name: 'text', tranprefix: 'text', parent: 'select', subsidiary: 'select',
    timezone: 'select', isinactive: 'checkbox', usebins: 'checkbox',
    latitude: 'float', longitude: 'float', locationtype: 'select',
  };

  function describeError(error) {
    if (typeof error === 'string' && error.trim()) return error;
    function read(name) {
      try {
        const value = typeof error?.[name] === 'function' ? error[name]() : error?.[name];
        return typeof value === 'string' ? value : '';
      } catch { return ''; }
    }
    const code = read('getCode') || read('code') || read('name');
    const detail = read('getDetails') || read('message') || read('details');
    return [code !== 'Error' ? code : '', detail].filter(Boolean).join(': ') ||
      'NetSuite returned an error without a code or description.';
  }

  function runLegacyApi(stage, operation) {
    return new Promise(function (resolve, reject) {
      // A normal wrapper alone is insufficient: legacy APIs can walk past it
      // to an async/arrow caller. A timer starts a fresh, ordinary call stack.
      setTimeout(function runNetSuiteOperation() {
        try {
          resolve(operation());
        } catch (error) {
          reject(new Error(`${stage}: ${describeError(error)}`));
        }
      }, 0);
    });
  }

  function getCriterion(type, value) {
    const empty = value === null || value === '' || (Array.isArray(value) && !value.length);
    if (value === undefined) throw new Error('NetSuite could not read the current field value.');

    switch (type) {
      case 'select':
      case 'multiselect':
        return ['anyof', empty ? ['@NONE@'] : value];
      case 'checkbox':
        if (![true, false, 'T', 'F'].includes(value)) {
          throw new Error('NetSuite could not read the checkbox value.');
        }
        return ['is', value === true || value === 'T' ? 'T' : 'F'];
      case 'integer':
      case 'float':
      case 'currency':
      case 'currency2':
      case 'percent':
        return empty ? ['isempty'] : ['equalto', value];
      case 'date':
        return empty ? ['isempty'] : ['on', value];
      case 'text':
      case 'textarea':
      case 'email':
      case 'phone':
      case 'url':
        return empty ? ['isempty'] : ['is', value];
      default:
        throw new Error(`Search is not supported for this field type (${type || 'unknown'}).`);
    }
  }

  async function getFieldContext(fieldId, chosenType) {
    let pageFieldType;
    const pageContext = await runLegacyApi('Reading the current field', function () {
      try {
        const recordType = window.nlapiGetRecordType?.();
        const field = window.nlapiGetField?.(fieldId);
        if (field) pageFieldType = field.getType();
        if (recordType && field) {
          const type = pageFieldType;
          const value = type === 'multiselect'
            ? window.nlapiGetFieldValues?.(fieldId)
            : window.nlapiGetFieldValue?.(fieldId);
          if (value !== undefined) return { recordType, type, value };
        }
      } catch {
        // View pages can expose client APIs without an initialized current record.
      }
      return null;
    });
    if (pageContext) return pageContext;

    const url = new URL(window.location.href);
    // A stored value must not silently replace an unreadable, unsaved edit.
    if (url.searchParams.get('e')?.toUpperCase() === 'T') {
      throw new Error('NetSuite could not read this field on the edit form. Open the saved record in View mode to search it.');
    }
    if (!/^\d+$/.test(url.searchParams.get('id') || '')) {
      throw new Error('Open a saved record to search its field values.');
    }

    // Read the record's own XML identity instead of guessing from its URL or
    // a generic "type" field. Read only the selected body field's value.
    url.searchParams.set('xml', 'T');
    url.hash = '';
    const response = await window.fetch(url.href, {
      credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('NetSuite could not load the record details.');
    const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
    const record = xml.querySelector('record');
    const recordType = record?.getAttribute('recordType');
    const recordId = record?.getAttribute('id');
    if (xml.querySelector('parsererror') || !/^[a-z0-9_]+$/i.test(recordType || '') ||
        recordId !== url.searchParams.get('id')) {
      throw new Error('NetSuite did not return this record’s XML details. Refresh the record and try again.');
    }
    const fieldNode = Array.from(record.children).find(function (node) {
      return node.localName === fieldId;
    });
    if (!fieldNode) {
      throw new Error(`The record XML does not contain the body field ${fieldId}. Sublist fields are not supported.`);
    }
    const type = pageFieldType || (recordType === 'location' && LOCATION_FIELD_TYPES[fieldId]) ||
      (Object.hasOwn(FIELD_TYPES, chosenType) ? chosenType : null);
    if (!type) {
      const error = new Error(`NetSuite does not expose the type of ${fieldId} on this page. Choose its field type below, then click Search this value again.`);
      error.code = 'NSH_FIELD_TYPE_REQUIRED';
      throw error;
    }
    if (fieldNode.children.length) {
      throw new Error('This field has a structured XML value that is not supported for searching.');
    }
    const rawValue = fieldNode.textContent;
    const value = type === 'multiselect'
      ? rawValue.split(/[\u0005,]/).map(function (entry) { return entry.trim(); }).filter(Boolean)
      : rawValue;
    return { recordType, type, value };
  }

  async function createSearch(fieldId, chosenType) {
    const required = [
      'nlapiCreateSearch', 'nlobjSearchFilter', 'nlobjSearchColumn',
    ];
    if (required.some((name) => typeof window[name] !== 'function')) {
      throw new Error('NetSuite search APIs are unavailable on this page. Try opening the record in Edit mode.');
    }
    const { recordType, type, value } = await getFieldContext(fieldId, chosenType);
    const [operator, filterValue] = getCriterion(type, value);
    return runLegacyApi('Building the filtered search', function () {
      const filters = [new window.nlobjSearchFilter(fieldId, null, operator, filterValue)];
      if (TRANSACTION_TYPES.has(recordType)) {
        filters.push(new window.nlobjSearchFilter('mainline', null, 'is', 'T'));
      }
      const columns = [new window.nlobjSearchColumn('internalid')];
      if (fieldId !== 'internalid') columns.push(new window.nlobjSearchColumn(fieldId));
      const search = window.nlapiCreateSearch(recordType, filters, columns);
      if (typeof search.setRedirectURLToSearchResults !== 'function') {
        throw new Error('Opening search results is not supported on this page.');
      }
      // Validate before navigating: record field IDs are not always search field IDs.
      // Never retry without the filter, which would silently show unrelated records.
      search.runSearch().getResults(0, 1);
      return search;
    });
  }

  document.addEventListener('click', async (event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const button = event.target.closest('[data-nsh-field-search="true"]');
    if (!button || button.disabled) return;
    const container = button.closest('[data-nsh-field-id-info="true"]');
    const status = container?.querySelector('[data-nsh-search-status="true"]');
    if (!status) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const fieldId = button.dataset.fieldId;
    if (!fieldId || !/^[a-z0-9_]+$/i.test(fieldId)) return;
    button.disabled = true;
    button.textContent = 'Opening…';
    status.hidden = true;
    let searchTab;
    try {
      // Open during the user gesture, before synchronous NetSuite API calls.
      searchTab = window.open('about:blank', '_blank');
      if (!searchTab) throw new Error('Allow pop-ups for NetSuite, then try again.');
      searchTab.opener = null;
      searchTab.document.title = 'Opening NetSuite search…';
      searchTab.document.body.textContent = 'Preparing your filtered NetSuite search…';
      const typeControl = container.querySelector('[data-nsh-field-type="true"]');
      const chosenType = typeControl?.dataset.fieldId === fieldId ? typeControl.value : undefined;
      const search = await createSearch(fieldId, chosenType);
      if (searchTab.closed) return;
      // The client API loads the unsaved search into the NetSuite session.
      // Navigate explicitly because client-side redirects can be ignored.
      await runLegacyApi('Opening search results', function () {
        if (searchTab.closed) return;
        search.setRedirectURLToSearchResults();
        searchTab.location.replace(new URL('/app/common/search/searchresults.nl?api=T&adv=T', window.location.origin).href);
      });
    } catch (error) {
      if (searchTab && !searchTab.closed) searchTab.close();
      if (error?.code === 'NSH_FIELD_TYPE_REQUIRED' &&
          !container.querySelector('[data-nsh-field-type="true"]')) {
        const select = document.createElement('select');
        select.setAttribute('data-nsh-field-type', 'true');
        select.setAttribute('aria-label', 'NetSuite field type');
        select.dataset.fieldId = fieldId;
        for (const [value, label] of [['', 'Choose field type…'], ...Object.entries(FIELD_TYPES)]) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          select.appendChild(option);
        }
        select.style.fontSize = '12px';
        select.style.padding = '4px 8px';
        container.appendChild(select);
        select.focus();
      }
      const message = error?.message;
      status.textContent = `Could not open search: ${message || 'NetSuite rejected this field or search.'}`;
      status.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Search this value';
    }
  }, true);
})();
