# Store licensing information

Project-owned source code and documentation use GNU General Public License version 3 only (`GPL-3.0-only`). The full text is in [LICENSE](../LICENSE), and [NOTICE](../NOTICE) preserves original copyright and third-party terms. Earlier releases distributed under MIT retain their original license.

## Listing text

Use this paragraph in the Chrome Web Store and Firefox Add-ons descriptions when linking to the current source repository:

> Current source code and documentation: GNU GPLv3 only (GPL-3.0-only). Source: https://github.com/nostr-wot/nostr-wot-extension. Earlier versions distributed under MIT retain their original license; see the LICENSE file in each release’s source archive. Third-party components retain their own licenses.

Keep feature and privacy text intact. This wording distinguishes the current source repository from installed releases and does not claim that an existing MIT binary has been relicensed.

## Firefox version license

Mozilla stores a license per version. Use `GPL-3.0-only` for a release built from GPLv3 source. Version 0.8.12 was distributed under MIT, so its version-specific license stays MIT. The publishing script derives this field from the verified source archive rather than applying the current repository license to every historical release. See [Mozilla’s accepted license identifiers](https://mozilla.github.io/addons-server/topics/api/licenses.html).

## Chrome description

Chrome listing information is edited in the developer dashboard. Update the description with the paragraph above; preserve unrelated copy, privacy declarations and uploaded packages. A metadata edit does not create a new extension release. See [Chrome’s listing update instructions](https://developer.chrome.com/docs/webstore/update).
