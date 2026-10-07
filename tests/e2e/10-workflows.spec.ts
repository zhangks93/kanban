import { test, expect } from '@playwright/test';
async function login(page: import('@playwright/test').Page, user = 'user_a') {
  await page.goto('/login');
  await page.getByRole('link', { name: '使用飞书登录' }).click();
  await page.locator('select[name=user]').selectOption(user);
  await page.getByRole('button', { name: '授权登录' }).click();
  await page.waitForURL('**/my');
}
test('diagonal State + Lane drag sends exactly one atomic move', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto('/workspaces/alpha/boards/ALPHA');
  const task = page.getByTestId('task-1');
  await expect(
    task.getByRole('button', { name: '统一任务状态与权限校验', exact: true }),
  ).toBeVisible();
  const before = await page.request
    .get('/api/tasks/50000000-0000-4000-8000-000000000001')
    .then((r) => r.json());
  const requests: unknown[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/tasks/50000000-0000-4000-8000-000000000001/move'))
      requests.push(r.postDataJSON());
  });
  const handle = task.getByRole('button', { name: '拖动 统一任务状态与权限校验' });
  const destination = page.getByRole('region', { name: '项目 B · 待开发', exact: true });
  const from = await handle.boundingBox();
  const to = await destination.boundingBox();
  expect(from).toBeTruthy();
  expect(to).toBeTruthy();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x - 20, from!.y + 10, { steps: 5 });
  const response = page.waitForResponse((r) =>
    r.url().endsWith('/api/tasks/50000000-0000-4000-8000-000000000001/move'),
  );
  await page.mouse.move(to!.x + 80, to!.y + 40, { steps: 15 });
  await page.mouse.up();
  const moved = await (await response).json();
  expect(requests).toHaveLength(1);
  expect((requests[0] as any).stateId).toBeTruthy();
  expect((requests[0] as any).laneId).toBe('40000000-0000-4000-8000-000000000002');
  expect(moved.version).toBe(before.version + 1);
  await expect(
    destination.getByRole('button', { name: '统一任务状态与权限校验', exact: true }),
  ).toBeVisible();
});
test('rapid Participant edits serialize returned versions; Participant becomes Responsible', async ({
  page,
}) => {
  await login(page);
  await page.goto('/workspaces/alpha/boards/ALPHA');
  await page.getByRole('button', { name: '统一任务状态与权限校验', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '参与人', exact: true }).click();
  const bodies: any[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/participants')) bodies.push(r.postDataJSON());
  });
  await page.getByRole('checkbox', { name: /周宁/ }).uncheck();
  await page.getByRole('checkbox', { name: /许晴/ }).check();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1].expectedVersion).toBe(bodies[0].expectedVersion + 1);
  await page.keyboard.press('Escape');
  await dialog
    .getByRole('combobox', { name: '负责人', exact: true })
    .selectOption('10000000-0000-4000-8000-000000000003');
  await expect(dialog.getByRole('combobox', { name: '负责人', exact: true })).toHaveValue(
    '10000000-0000-4000-8000-000000000003',
  );
  await expect(dialog.getByRole('button', { name: '参与人', exact: true })).toHaveText('许晴');
  await expect(dialog.getByRole('button', { name: '点亮任务', exact: true })).toBeDisabled();
});
test('enabled plugin nav, domain objects and dependency guard are visible', async ({ page }) => {
  await login(page);
  await page.goto('/workspaces/alpha/settings/plugins');
  await expect(page.getByText('研发管理', { exact: true })).toBeVisible();
  const row = page.locator('.workspace-row').filter({ hasText: '研发管理' });
  await row.getByRole('button', { name: '停用', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请先归档依赖此插件的看板');
  await page.goto('/workspaces/alpha/rnd/systems');
  await expect(page.getByRole('heading', { name: '研发系统与模块' })).toBeVisible();
  await expect(page.locator('.domain-row').filter({ hasText: 'Core' })).toBeVisible();
  await page.goto('/workspaces/beta/boards');
  await expect(page.getByRole('link', { name: '研发系统', exact: true })).toHaveCount(0);
});

test('My Work offers one-for-one replacement when global WIP is full', async ({ page }) => {
  await login(page);
  for (const title of ['补满 WIP', '替换目标']) {
    const response = await page.request.post(
      '/api/boards/30000000-0000-4000-8000-000000000003/tasks',
      {
        headers: { origin: 'http://localhost:5173' },
        data: { title, responsibleUserId: '10000000-0000-4000-8000-000000000002' },
      },
    );
    expect(response.status()).toBe(201);
  }
  await page.goto('/my');
  await page.getByRole('tab', { name: '我负责', exact: true }).click();
  await page.getByRole('button', { name: '点亮 补满 WIP', exact: true }).click();
  await expect(page.getByRole('button', { name: '点亮 补满 WIP', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '点亮 替换目标', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '替换一个点亮任务' })).toBeVisible();
  await page.getByRole('dialog').locator('.replace-list button').first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const me = await page.request.get('/api/me').then((r) => r.json());
  expect(me.used_wip).toBe(3);
});
