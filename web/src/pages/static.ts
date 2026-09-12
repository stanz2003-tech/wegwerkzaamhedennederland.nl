/**
 * Entry script for the static content pages (template `web/templates/static.html`):
 * /over/, /veelgestelde-vragen/, /privacy/, /cookies/, /disclaimer/, /colofon/, /contact/
 * and the 404 page.
 *
 * No data is needed here. `bootPage()` mounts the shared chrome (topbar with theme toggle,
 * footer cookie link, ad slot, analytics) and makes `<details>` blocks deep-linkable; the only
 * extra is the "laatst bijgewerkt" stamp for templates that carry an `#entity-updated` element.
 */
import '../styles/base.css';
import '../styles/chrome.css';
import '../styles/components.css';
import '../styles/pages.css';

import { bootPage, stampUpdated } from '../ui/page-boot';

const boot = bootPage();

void boot.meta.then(stampUpdated);
