/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { N4aExportButton } from './N4aExportButton';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/api/transport', () => ({ requestBinary: request }));

it('downloads only the checked sections through the native export route', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const createUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const revokeUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:checkpoint' });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  request.mockResolvedValue(new Blob(['n4a']));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<N4aExportButton sections={[
      { id: 'recipe', label: 'Recipe', payload: async () => ({ pipeline: ['SNV'] }) },
      { id: 'dataset', label: 'Dataset', payload: { spectra: [[1, 2]] } },
    ]} />));
    await act(async () => { container.querySelector('button')!.click(); });
    const checkboxes = document.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    expect(checkboxes).toHaveLength(2);
    await act(async () => { checkboxes[1].click(); });
    await act(async () => {
      Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Download .n4a')!.click();
    });
    expect(request).toHaveBeenCalledWith('/exports/n4a', 'POST', expect.objectContaining({ sections: { recipe: { pipeline: ['SNV'] } } }));
    expect(click).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    click.mockRestore();
    if (createUrl) Object.defineProperty(URL, 'createObjectURL', createUrl); else delete (URL as Partial<typeof URL>).createObjectURL;
    if (revokeUrl) Object.defineProperty(URL, 'revokeObjectURL', revokeUrl); else delete (URL as Partial<typeof URL>).revokeObjectURL;
  }
});
