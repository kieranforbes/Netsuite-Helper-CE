// Read NetSuite's native customization lists using the current session.
(function () {
  const BASE = '/app/common/custom/';
  const LISTS = {
    custbody: 'bodycustfield',
    custcol: 'columncustfield',
    custentity: 'entitycustfield',
    custitemnumber: 'itemnumbercustfield',
    custitem: 'itemcustfield',
    custevent: 'eventcustfield',
    custother: 'othercustfield',
  };

  async function readList(url, signal) {
    const response = await window.fetch(url.href, {
      credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', signal,
    });
    if (!response.ok || response.redirected) {
      throw new Error('NetSuite did not open the field list. Check your role’s customization permissions.');
    }
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }

  function findDefinition(page, fieldId, definitionPath, origin) {
    for (const row of page.querySelectorAll('tr.uir-list-row-tr')) {
      const matches = Array.from(row.cells).some((cell) => cell.textContent.trim().toLowerCase() === fieldId);
      if (!matches) continue;
      for (const link of row.querySelectorAll('a[href]')) {
        const url = new URL(link.getAttribute('href'), origin);
        if (url.origin === origin && url.pathname === definitionPath &&
            /^[1-9]\d*$/.test(url.searchParams.get('id') || '')) return url.href;
      }
    }
    return null;
  }

  async function resolveField(fieldId, stem) {
    const origin = window.location.origin;
    const listUrl = new URL(BASE + stem + 's.nl', origin);
    const definitionPath = BASE + stem + '.nl';
    const signal = AbortSignal.timeout(25000);
    const firstPage = await readList(listUrl, signal);
    const firstMatch = findDefinition(firstPage, fieldId, definitionPath, origin);
    if (firstMatch) return firstMatch;

    // NetSuite publishes the opaque segment values used by its Next control.
    // The initial list already includes the selected segment's rows.
    const segments = firstPage.querySelectorAll('#segment_fs [data-pagination-value]:not(.selected)');
    for (const segment of segments) {
      const pageUrl = new URL(listUrl);
      pageUrl.searchParams.set('frame', 'B');
      pageUrl.searchParams.set('segment', segment.getAttribute('data-pagination-value'));
      const page = await readList(pageUrl, signal);
      const match = findDefinition(page, fieldId, definitionPath, origin);
      if (match) return match;
    }

    if (!firstPage.querySelector('tr.uir-list-row-tr, #segment_fs')) {
      throw new Error('NetSuite did not show the field list. Check your role’s customization permissions.');
    }
    throw new Error('This script ID was not found in the field list available to your role.');
  }

  document.addEventListener('click', async (event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const button = event.target.closest('[data-nsh-custom-field="true"]');
    if (!button || button.disabled || button.hidden) return;
    const fieldId = button.dataset.fieldId;
    if (!/^[a-z0-9_]+$/i.test(fieldId || '')) return;
    const prefix = fieldId.toLowerCase().match(/^(custbody|custcol|custentity|custitemnumber|custitem(?!number|option)|custevent|custother)[a-z0-9_]+$/)?.[1];
    if (!prefix) return;
    const container = button.closest('[data-nsh-field-id-info="true"]');
    const status = container?.querySelector('[data-nsh-search-status="true"]');
    if (!status) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled = true;
    button.textContent = 'Opening…';
    status.hidden = true;
    let fieldTab;
    try {
      fieldTab = window.open('about:blank', '_blank');
      if (!fieldTab) throw new Error('Allow pop-ups for NetSuite, then try again.');
      fieldTab.opener = null;
      fieldTab.document.title = 'Opening custom field…';
      fieldTab.document.body.textContent = 'Finding the custom field definition…';
      const destination = await resolveField(fieldId.toLowerCase(), LISTS[prefix]);
      if (!fieldTab.closed) fieldTab.location.replace(destination);
    } catch (error) {
      if (fieldTab && !fieldTab.closed) fieldTab.close();
      // A reused help dialog may now be showing a different field.
      if (button.dataset.fieldId === fieldId) {
        status.textContent = `Could not open custom field: ${error?.message || 'NetSuite could not resolve this field. Check your customization permissions.'}`;
        status.hidden = false;
      }
    } finally {
      button.disabled = false;
      button.textContent = 'Open custom field';
    }
  }, true);
})();
