import browser from '@lib/browser';
import { AsyncLock } from '@utils/asyncLock';
import { validateTemplate, type PermissionTemplate } from '@domain/permissions/templates';
const KEY = 'permissionTemplates';
const lock = new AsyncLock();
export async function listTemplates(): Promise<PermissionTemplate[]> {
  const value = (await browser.storage.local.get(KEY))[KEY];
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap(item => { try { return [validateTemplate(item)]; } catch { return []; } });
}
export async function saveTemplate(value: unknown) {
  const template = validateTemplate(value);
  return lock.run(async () => {
    const all = await listTemplates();
    const next = all.filter(item => item.id !== template.id);
    if (next.length >= 50) throw new Error('Template limit reached');
    await browser.storage.local.set({ [KEY]: [...next, template] });
    return template;
  });
}
export async function deleteTemplate(id: string) {
  return lock.run(async () => { await browser.storage.local.set({ [KEY]: (await listTemplates()).filter(item => item.id !== id) }); });
}
