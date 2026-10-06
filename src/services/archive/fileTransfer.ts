import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { MAX_ARCHIVE_FILE_BYTES, MAX_ARCHIVE_LINE_BYTES } from '@constants/archive.ts';

export async function importArchiveFile(file: File, password: string, accountId: string): Promise<number> {
  if (file.size > MAX_ARCHIVE_FILE_BYTES) throw new Error(t('archive.fileTooLarge'));
  const { sessionId } = await rpc<{ sessionId: string }>('archive_importBegin', { accountId, password });
  let reader: ReadableStreamDefaultReader<string> | undefined;
  let remainder = '';
  async function upload(line: string) {
    if (!line.trim()) return;
    if (new TextEncoder().encode(line).byteLength > MAX_ARCHIVE_LINE_BYTES)
      throw new Error(t('archive.fileTooLarge'));
    await rpc('archive_importChunk', { accountId, sessionId, line });
  }
  try {
    reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      remainder += chunk.value;
      let newline;
      while ((newline = remainder.indexOf('\n')) !== -1) {
        await upload(remainder.slice(0, newline));
        remainder = remainder.slice(newline + 1);
      }
      if (new TextEncoder().encode(remainder).byteLength > MAX_ARCHIVE_LINE_BYTES)
        throw new Error(t('archive.fileTooLarge'));
    }
    await upload(remainder);
    return (await rpc<{ count: number }>('archive_importFinish', { accountId, sessionId })).count;
  } catch (error) {
    await rpc('archive_fileCancel', { accountId, sessionId }).catch(() => {});
    throw error;
  } finally {
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

export async function downloadArchive(password: string, accountId: string): Promise<Blob> {
  const { sessionId } = await rpc<{ sessionId: string }>('archive_exportBegin', { accountId, password });
  const lines: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const page = await rpc<{ line: string; done: boolean }>('archive_exportPage', { accountId, sessionId });
      bytes += new TextEncoder().encode(page.line).byteLength + 1;
      if (bytes > MAX_ARCHIVE_FILE_BYTES) throw new Error(t('archive.fileTooLarge'));
      lines.push(page.line + '\n');
      if (page.done) break;
    }
    return new Blob(lines, { type: 'application/x-ndjson' });
  } catch (error) {
    await rpc('archive_fileCancel', { accountId, sessionId }).catch(() => {});
    throw error;
  }
}
