# NetSuite Field ID Helper

Load this directory as an unpacked extension at `chrome://extensions`.
After updating it, reload the extension and refresh your NetSuite record tab.

Click a field label to open Field Help:

- **Copy** copies the field ID, animates the button, and displays **Copied!** after a successful copy. Reduced-motion preferences disable the animation.
- **Search this value** opens an unsaved NetSuite search in a new tab for the current record type, filtered by that field's current value. The URL requests Advanced Search mode (`adv=T`). Dropdowns use internal IDs, dates use the account's current date format, and empty values search for empty fields. Multiselects match any selected value. Common transaction types use Main Line = Yes.
- **Shift-click a field label** to copy its ID directly.

Search requires NetSuite's SuiteScript 1.0 search APIs and your role's record/search permissions. On View pages where the current-record APIs are uninitialized (including location records), the extension reads the record identity and selected body field value directly from XML, without calling `nlapiLoadRecord`. Field types come from page metadata or a small mapping of standard Location fields. When the type is unavailable, choose the field's actual NetSuite type in the selector and click **Search this value** again. Numeric-looking custom IDs are not assumed to be numbers. Edit forms use live values; unreadable edits never fall back to saved values. Only record body fields are supported; some form field IDs differ from search field IDs. Unsupported fields and search errors appear beneath the buttons. Pop-ups must be allowed for the new tab. No saved search or record is saved or modified.

Run local checks with `node --test tests/*.test.cjs` and `node --check src/content.js`.
The search tests use mocked NetSuite APIs. In an authenticated account, verify a text field, a dropdown, an empty field, and a transaction search; also verify Copy and Shift-click. Live account integration is not covered by the local tests.
