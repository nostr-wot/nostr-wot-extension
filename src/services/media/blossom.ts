import { BLOSSOM_SERVER } from '@constants/media.ts';
import { safeImageUrl } from '@utils/safeUrl.ts';
import { rpc } from '@services/rpc.ts';

interface BlossomUploadResult {
  url: string;
}

interface BlossomUploadResponse {
  url: string;
}

/**
 * Upload a file to Blossom (BUD-06).
 * Signs a kind:24242 auth event via the vault, then PUTs the file.
 */
export async function uploadToBlossom(file: File): Promise<BlossomUploadResult> {
  const buf = await file.arrayBuffer();
  const hashBytes = await crypto.subtle.digest('SHA-256', buf);
  const sha256hex = [...new Uint8Array(hashBytes)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const expiration = String(Math.floor(Date.now() / 1000) + 300);

  const authEvent = {
    created_at: Math.floor(Date.now() / 1000),
    kind: 24242,
    tags: [
      ['t', 'upload'],
      ['x', sha256hex],
      ['expiration', expiration],
    ],
    content: '',
  };

  const signed = await rpc('signEvent', { event: authEvent });
  const authHeader = 'Nostr ' + btoa(JSON.stringify(signed));

  const res = await fetch(`${BLOSSOM_SERVER}/upload`, {
    method: 'PUT',
    headers: {
      Authorization: authHeader,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: buf,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Upload failed: ${text}`);
  }

  const data: BlossomUploadResponse = await res.json();
  return { url: data.url };
}

/** Resolve the two profile images through the same uploader. Successful files
 * remain cached for this edit session, including after a partial failure. */
export async function uploadProfileImages(
  files: { picture?: File | null; banner?: File | null },
  cache: WeakMap<File, string>,
  upload: (file: File) => Promise<BlossomUploadResult> = uploadToBlossom,
): Promise<Partial<Record<'picture' | 'banner', string>>> {
  const urls: Partial<Record<'picture' | 'banner', string>> = {};
  for (const key of ['picture', 'banner'] as const) {
    const file = files[key];
    if (!file) continue;
    let url = cache.get(file);
    if (!url) {
      url = (await upload(file)).url;
      if (!safeImageUrl(url)) throw new Error('The upload server returned an invalid image URL');
      cache.set(file, url);
    }
    urls[key] = url;
  }
  return urls;
}
