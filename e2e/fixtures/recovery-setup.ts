import { request, expect } from '@playwright/test';
import { join } from 'node:path';

export default async function setup() {
  const api = await request.newContext({ baseURL: process.env.PLAYWRIGHT_API_BASE_URL });
  try {
    // This small gate covers scientific UI journeys, not installer onboarding.
    expect((await api.post('/api/config/skip-setup')).ok()).toBeTruthy();
    await expect.poll(async () => (await (await api.get('/api/system/readiness')).json()).ml_ready,
      { timeout: 60000, intervals: [250, 500, 1000] }).toBe(true);
    const created = await api.post('/api/workspace/create', { data: {
      path: join(process.env.RECOVERY_E2E_ROOT!, 'results-workspace'), name: 'Isolated recovery UI qualification',
    } });
    expect(created.ok(), await created.text()).toBeTruthy();
    const linked = await (await api.get('/api/workspaces')).json();
    const workspace = linked.workspaces.find((item: { name: string }) => item.name === 'Isolated recovery UI qualification');
    expect(workspace).toBeTruthy();
    expect((await api.post(`/api/workspaces/${workspace.id}/activate`)).ok()).toBeTruthy();
  } finally { await api.dispose(); }
}
