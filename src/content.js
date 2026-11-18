(() => {
  const state = {
    lastFieldId: null,
    lastFieldLabel: null,
  };

  const FIELD_WRAPPER_SELECTOR = '[data-nsps-type="field"][data-field-name]';
  const FIELD_LABEL_SELECTOR = '[data-nsps-type="label"], .uir-label-span, .uir-label';
  const MODAL_SELECTOR = '[role="dialog"][data-role="modal"]';
  const MODAL_TITLE_SELECTOR = '[data-window-section="title"]';
  const MODAL_BODY_SELECTOR = '[data-widget="WindowBody"]';
  const IFRAME_SELECTOR = 'iframe#fieldhelp_frame';
  const TOAST_ATTR = 'data-nsh-field-id-toast';
  const copyTimers = new WeakMap();

  function styleButton(button) {
    Object.assign(button.style, {
      fontSize: '12px', fontWeight: '600', padding: '4px 8px',
      borderRadius: '4px', border: '1px solid #c0c0c0',
      background: '#fff', color: '#333', cursor: 'pointer',
      whiteSpace: 'nowrap', minWidth: '64px',
    });
  }

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function getFieldInfoFromTarget(target) {
    const wrapper = target.closest(FIELD_WRAPPER_SELECTOR);
    if (!wrapper) return null;

    const fieldId = wrapper.getAttribute('data-field-name');
    if (!fieldId) return null;

    let labelText = '';
    const labelEl = wrapper.querySelector(FIELD_LABEL_SELECTOR);
    if (labelEl) {
      labelText = normalizeText(labelEl.textContent);
    }

    return { fieldId, labelText };
  }

  function updateModalTitle(modal) {
    if (!modal || !state.lastFieldId) return;

    applyBodyStyle(modal);

    const titleEl = modal.querySelector(MODAL_TITLE_SELECTOR);
    if (titleEl && state.lastFieldLabel) {
      titleEl.textContent = state.lastFieldLabel;
    }

    const fieldText = `Field ID: ${state.lastFieldId}`;

    const bodyEl = modal.querySelector(MODAL_BODY_SELECTOR) || modal;
    if (!bodyEl) return;

    const iframeEl = bodyEl.querySelector(IFRAME_SELECTOR);
    const insertRoot = iframeEl ? iframeEl.parentElement : bodyEl;
    if (!insertRoot) return;

    let infoEl = bodyEl.querySelector('[data-nsh-field-id-info="true"]');
    if (!infoEl) {
      infoEl = document.createElement('div');
      infoEl.setAttribute('data-nsh-field-id-info', 'true');
      infoEl.style.margin = '0 0 8px 0';
      infoEl.style.padding = '8px 12px 0 12px';
      infoEl.style.textAlign = 'left';
      infoEl.style.fontWeight = '700';
      infoEl.style.fontSize = '14px';
      infoEl.style.whiteSpace = 'normal';
      infoEl.style.wordBreak = 'break-word';
      infoEl.style.display = 'grid';
      infoEl.style.gridTemplateColumns = 'minmax(0, 1fr) max-content';
      infoEl.style.alignItems = 'start';
      infoEl.style.gap = '8px 16px';
      insertRoot.insertBefore(infoEl, iframeEl || insertRoot.firstChild);
    }

    let labelEl = infoEl.querySelector('[data-nsh-field-id-label="true"]');
    if (!labelEl) {
      labelEl = document.createElement('div');
      labelEl.setAttribute('data-nsh-field-id-label', 'true');
      labelEl.style.minWidth = '0';
      labelEl.style.paddingTop = '4px';
      infoEl.appendChild(labelEl);
    }
    labelEl.textContent = fieldText;

    let actionsEl = infoEl.querySelector('[data-nsh-field-actions="true"]');
    if (!actionsEl) {
      actionsEl = document.createElement('div');
      actionsEl.setAttribute('data-nsh-field-actions', 'true');
      Object.assign(actionsEl.style, {
        display: 'flex', flexDirection: 'column', gap: '6px',
        gridColumn: '2', gridRow: '1', minWidth: '136px',
      });
      infoEl.appendChild(actionsEl);
    }

    let copyBtn = infoEl.querySelector('[data-nsh-field-id-copy="true"]');
    if (!copyBtn) {
      copyBtn = document.createElement('button');
      copyBtn.setAttribute('data-nsh-field-id-copy', 'true');
      copyBtn.type = 'button';
      copyBtn.textContent = 'Copy';
      styleButton(copyBtn);
      copyBtn.setAttribute('aria-live', 'polite');
      copyBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (copyBtn.disabled) return;
        clearTimeout(copyTimers.get(copyBtn));
        copyBtn.disabled = true;
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          copyBtn.animate([
            { transform: 'scale(1)' },
            { transform: 'scale(0.9)', offset: 0.4 },
            { transform: 'scale(1)' },
          ], { duration: 220, easing: 'ease-out' });
        }
        const copied = await copyFieldId(copyBtn.dataset.fieldId);
        copyBtn.disabled = false;
        copyBtn.textContent = copied ? 'Copied!' : 'Try again';
        copyBtn.style.background = copied ? '#e4f5e9' : '#fff0f0';
        copyBtn.style.borderColor = copied ? '#68a77a' : '#c76b6b';
        copyTimers.set(copyBtn, setTimeout(() => {
          copyBtn.textContent = 'Copy';
          copyBtn.style.background = '#fff';
          copyBtn.style.borderColor = '#c0c0c0';
        }, 1400));
      });
      actionsEl.appendChild(copyBtn);
    }
    copyBtn.dataset.fieldId = state.lastFieldId;

    let customFieldBtn = infoEl.querySelector('[data-nsh-custom-field="true"]');
    const isCustomField = /^(custbody|custcol|custentity|custitemnumber|custitem(?!number|option)|custevent|custother)[a-z0-9_]+$/i.test(state.lastFieldId);
    if (isCustomField && !customFieldBtn) {
      customFieldBtn = document.createElement('button');
      customFieldBtn.type = 'button';
      customFieldBtn.setAttribute('data-nsh-custom-field', 'true');
      customFieldBtn.textContent = 'Open custom field';
      customFieldBtn.title = 'Open the custom field definition in a new tab';
      styleButton(customFieldBtn);
      actionsEl.insertBefore(customFieldBtn, copyBtn.nextSibling);
    }
    if (customFieldBtn) {
      customFieldBtn.hidden = !isCustomField;
      customFieldBtn.dataset.fieldId = state.lastFieldId;
    }

    let searchBtn = infoEl.querySelector('[data-nsh-field-search="true"]');
    if (!searchBtn) {
      searchBtn = document.createElement('button');
      searchBtn.type = 'button';
      searchBtn.setAttribute('data-nsh-field-search', 'true');
      searchBtn.textContent = 'Search this value';
      searchBtn.title = 'Open a search of this record type using the current field value in a new tab';
      styleButton(searchBtn);
      actionsEl.appendChild(searchBtn);

      const status = document.createElement('div');
      status.setAttribute('data-nsh-search-status', 'true');
      status.setAttribute('role', 'status');
      Object.assign(status.style, {
        gridColumn: '1 / -1', fontSize: '12px', fontWeight: '400', color: '#9c2929',
      });
      status.hidden = true;
      infoEl.appendChild(status);
    }
    if (searchBtn.dataset.fieldId !== state.lastFieldId) {
      infoEl.querySelector('[data-nsh-field-type="true"]')?.remove();
      const status = infoEl.querySelector('[data-nsh-search-status="true"]');
      status.textContent = '';
      status.hidden = true;
    }
    searchBtn.dataset.fieldId = state.lastFieldId;
  }

  async function copyFieldId(fieldId, { showToast = false } = {}) {
    if (!fieldId) return false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(fieldId);
        if (showToast) showCopyToast(fieldId);
        return true;
      } catch (err) {
        // Some NetSuite pages deny Clipboard API access; try the legacy method.
      }
    }
    const temp = document.createElement('textarea');
    temp.value = fieldId;
    temp.setAttribute('readonly', 'true');
    temp.style.position = 'absolute';
    temp.style.left = '-9999px';
    const previousFocus = document.activeElement;
    document.body.appendChild(temp);
    temp.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (err) {
      // ignore
    }
    document.body.removeChild(temp);
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    if (showToast && copied) showCopyToast(fieldId);
    return copied;
  }

  function applyBodyStyle(modal) {
    const bodyEl = modal.querySelector(MODAL_BODY_SELECTOR);
    if (bodyEl) {
      bodyEl.style.backgroundColor = '#f0f0f0';
    }
  }

  function showCopyToast(fieldId) {
    const existing = document.querySelector(`[${TOAST_ATTR}="true"]`);
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.setAttribute(TOAST_ATTR, 'true');
    toast.textContent = `Field ID copied: ${fieldId}`;
    toast.style.position = 'fixed';
    toast.style.right = '16px';
    toast.style.bottom = '16px';
    toast.style.zIndex = '2147483647';
    toast.style.background = 'rgba(0, 0, 0, 0.85)';
    toast.style.color = '#fff';
    toast.style.padding = '8px 12px';
    toast.style.borderRadius = '6px';
    toast.style.fontSize = '12px';
    toast.style.fontWeight = '600';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
    toast.style.transition = 'opacity 150ms ease';
    toast.style.opacity = '1';

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
    }, 900);

    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 1200);
  }


  function maybeTrackFieldClick(event) {
    const info = getFieldInfoFromTarget(event.target);
    if (!info) return;

    state.lastFieldId = info.fieldId;
    state.lastFieldLabel = info.labelText;
  }

  function isFieldHelpModal(modal) {
    return !!modal.querySelector(IFRAME_SELECTOR);
  }

  function observeModals() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;

          const modal = node.matches(MODAL_SELECTOR)
            ? node
            : node.querySelector(MODAL_SELECTOR);

          if (!modal) continue;
          if (!isFieldHelpModal(modal)) continue;

          updateModalTitle(modal);
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function findActiveFieldHelpModal() {
    const modals = Array.from(document.querySelectorAll(MODAL_SELECTOR));
    for (const modal of modals) {
      if (isFieldHelpModal(modal)) return modal;
    }
    return null;
  }

  function scheduleModalUpdate() {
    let attempts = 0;
    const maxAttempts = 15;
    const tick = () => {
      attempts += 1;
      const modal = findActiveFieldHelpModal();
      if (modal) {
        updateModalTitle(modal);
        return;
      }
      if (attempts < maxAttempts) {
        setTimeout(tick, 150);
      }
    };
    setTimeout(tick, 0);
  }

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('[data-nsh-field-id-info="true"]')) return;
    if (event.shiftKey) {
      const inModal = !!event.target.closest(MODAL_SELECTOR);
      if (!inModal) {
        const onLabel = !!event.target.closest(FIELD_LABEL_SELECTOR);
        if (onLabel) {
          event.preventDefault();
          event.stopPropagation();
          if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
          }
          const info = getFieldInfoFromTarget(event.target);
          if (info && info.fieldId) {
            copyFieldId(info.fieldId, { showToast: true });
          }
        }
      }
    }
    maybeTrackFieldClick(event);
    scheduleModalUpdate();
  }, true);
  observeModals();
})();
