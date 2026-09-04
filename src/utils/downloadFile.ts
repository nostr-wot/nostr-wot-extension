/**
 * Trigger a file download from the popup UI.
 *
 * Safari quirks this works around:
 *
 * 1. The anchor MUST be attached to the document before clicking. A detached
 *    anchor with a blob: href makes Safari ignore the click entirely.
 * 2. Revoking the blob URL synchronously after click cancels the download in
 *    Safari — defer revocation by ~1s so the browser can start the transfer.
 * 3. Safari treats `text/plain` (and other renderable MIME types) blob URLs
 *    as navigation and opens them in a new tab instead of downloading them,
 *    even with the `download` attribute set. Using `application/octet-stream`
 *    forces Safari into download mode. The filename's extension still drives
 *    what app the user opens it with after saving, so this is purely a hint
 *    to the browser about transport, not about the file's true type.
 * 4. Safari ignores the `download` attribute's filename hint when the href
 *    is a blob: or File-backed object URL — the saved file ends up named
 *    "Unknown". Encoding the payload as a `data:` URI sidesteps this:
 *    Safari honours `download` on data URIs and writes the file with the
 *    requested name. Backup payloads here are kilobyte-scale, so the
 *    base64 overhead and lack of streaming are not a concern.
 */
export function downloadFile(
  content: string,
  filename: string,
  mime: string = 'application/octet-stream'
): void {
  const bytes = new TextEncoder().encode(content);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const url = `data:${mime};base64,${btoa(binary)}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    setTimeout(() => a.remove(), 1000);
  }
}
