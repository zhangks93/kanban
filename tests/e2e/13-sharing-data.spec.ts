import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);

const workspaceId = '20000000-0000-4000-8000-000000000001';
const responsibleUserId = '10000000-0000-4000-8000-000000000002';
const origin = 'http://localhost:5173';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('link', { name: '使用飞书登录' }).click();
  await page.locator('select[name=user]').selectOption('user_a');
  await page.getByRole('button', { name: '授权登录' }).click();
  await page.waitForURL('**/my');
}

async function createTask(page: Page, boardId: string, title: string) {
  const response = await page.request.post(`/api/boards/${boardId}/tasks`, {
    headers: { origin },
    data: { title, responsibleUserId },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string; seq: number }>;
}

test('one foundation data module supplies systems and projects to both plugins', async ({
  page,
}) => {
  await login(page);
  const suffix = Date.now().toString(36);
  const systemName = `共享系统 ${suffix}`;
  const projectName = `研发项目 ${suffix}`;
  await page.goto('/workspaces/alpha/data');
  await expect(page.getByRole('heading', { name: '基础数据', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '添加系统', exact: true }).click();
  await page.getByLabel('系统名称', { exact: true }).fill(systemName);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: systemName })).toBeVisible();
  await page
    .getByRole('navigation', { name: '基础数据分类' })
    .getByRole('button', { name: /^项目/ })
    .click();
  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  await page.getByLabel('项目名称', { exact: true }).fill(projectName);
  await page
    .getByRole('combobox', { name: '所属系统', exact: true })
    .selectOption({ label: systemName });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: projectName })).toContainText(systemName);

  const foundation = await page.request
    .get(`/api/workspaces/${workspaceId}/data`)
    .then((response) => response.json());
  const system = foundation.systems.find((row: { name: string }) => row.name === systemName);
  const project = foundation.projects.find((row: { name: string }) => row.name === projectName);
  expect(project.system_id).toBe(system.id);
  for (const [plugin, boardId, boardKey] of [
    ['rnd', '30000000-0000-4000-8000-000000000002', 'ALPHA'],
    ['ops', '30000000-0000-4000-8000-000000000004', 'OPS'],
  ]) {
    const task = await createTask(page, boardId, `共享数据验证 ${plugin} ${suffix}`);
    await page.goto(`/workspaces/alpha/boards/${boardKey}/tasks/${task.seq}`);
    const systemSelect = page.getByRole('combobox', { name: '系统', exact: true });
    await systemSelect.selectOption(system.id);
    await expect(systemSelect).toHaveValue(system.id);
    if (plugin === 'rnd') {
      const projectSelect = page.getByRole('combobox', { name: '项目', exact: true });
      await expect(projectSelect).toBeEnabled();
      await projectSelect.selectOption(project.id);
      await expect(projectSelect).toHaveValue(project.id);
    }
    await expect
      .poll(async () => {
        const saved = await page.request
          .get(`/api/tasks/${task.id}`)
          .then((response) => response.json());
        return saved.plugin_fields;
      })
      .toMatchObject({
        system_id: system.id,
        ...(plugin === 'rnd' ? { project_id: project.id } : {}),
      });
  }
});

for (const config of [
  {
    plugin: 'rnd',
    template: 'rnd.development',
    name: '研发项目',
    entry: '需求提报',
    noun: '需求',
    titleLabel: '需求标题',
    descriptionLabel: '需求说明',
  },
  {
    plugin: 'ops',
    template: 'ops.operations',
    name: '运维支持',
    entry: '运维工单提报',
    noun: '工单',
    titleLabel: '问题标题',
    descriptionLabel: '问题说明',
  },
]) {
  test(`${config.name} public share is read-only and accepts a visitor submission`, async ({
    page,
    browser,
  }, testInfo) => {
    await login(page);
    const suffix = Date.now().toString(36).toUpperCase();
    const key = `S${config.plugin === 'rnd' ? 'R' : 'O'}${suffix}`;
    const boardName = `${config.name}公开回归 ${suffix}`;
    const boardResponse = await page.request.post(`/api/workspaces/${workspaceId}/boards`, {
      headers: { origin },
      data: { name: boardName, key, templateKey: config.template, accessMode: 'workspace' },
    });
    expect(boardResponse.status()).toBe(201);
    const board = (await boardResponse.json()) as { id: string };
    const taskTitle = `公开只读任务 ${suffix}`;
    await createTask(page, board.id, taskTitle);
    await page.goto(`/workspaces/alpha/boards/${key}`);
    await page.getByRole('button', { name: '分享', exact: true }).click();
    const shareDialog = page.getByRole('dialog', { name: '公开分享', exact: true });
    await shareDialog.getByRole('button', { name: '开启公开分享', exact: true }).click();
    const linkField = shareDialog.getByRole('textbox', { name: '公开链接', exact: true });
    await expect(linkField).toHaveValue(/^http:\/\/localhost:5173\/share\/[A-Za-z0-9_-]{43}$/);
    const shareUrl = await linkField.inputValue();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await shareDialog.getByRole('button', { name: '复制链接', exact: true }).click();
    await expect(shareDialog.getByRole('button', { name: '已复制', exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shareUrl);
    await shareDialog.getByRole('button', { name: '关闭', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: '分享', exact: true }).click();
    await expect(linkField).toHaveValue(shareUrl);

    const guestContext = await browser.newContext({ baseURL: origin });
    try {
      const guest = await guestContext.newPage();
      await guest.goto(shareUrl);
      await expect(guest).toHaveURL(shareUrl);
      await expect(guest.getByRole('heading', { name: boardName, exact: true })).toBeVisible();
      await expect(guest.getByText('公开只读', { exact: true })).toBeVisible();
      await expect(guest.getByRole('heading', { name: taskTitle, exact: true })).toBeVisible();
      await guest.screenshot({ path: testInfo.outputPath('public-desktop.png'), fullPage: true });
      await guest.setViewportSize({ width: 390, height: 844 });
      await expect(guest.getByRole('button', { name: config.entry, exact: true })).toBeInViewport();
      expect(await guest.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
      await guest.screenshot({ path: testInfo.outputPath('public-mobile.png'), fullPage: true });
      await guest.setViewportSize({ width: 1280, height: 720 });
      await expect(guest.getByRole('button', { name: '新建任务', exact: true })).toHaveCount(0);
      await expect(guest.getByRole('button', { name: '管理看板', exact: true })).toHaveCount(0);
      expect((await guest.request.get('/api/me')).status()).toBe(401);
      expect(
        (
          await guest.request.post(`/api/boards/${board.id}/tasks`, {
            headers: { origin },
            data: { title: '访客不应能直接创建任务', responsibleUserId },
          })
        ).status(),
      ).toBe(401);

      const submissionTitle = `${config.name}访客提报 ${suffix}`;
      await guest.getByRole('button', { name: config.entry, exact: true }).click();
      const form = guest.getByRole('dialog', { name: config.entry, exact: true });
      await form.getByLabel(config.titleLabel, { exact: true }).fill(submissionTitle);
      await form
        .getByLabel(config.descriptionLabel, { exact: true })
        .fill('请协助处理该问题并安排跟进。');
      await form.getByLabel('姓名', { exact: true }).fill('公开访客');
      await form.getByLabel('联系方式（选填）', { exact: true }).fill('visitor@example.com');
      await form
        .getByRole('button', {
          name: config.plugin === 'rnd' ? '提交需求' : '提交运维工单',
          exact: true,
        })
        .click();
      await expect(form.getByRole('heading', { name: '提交成功', exact: true })).toBeVisible();
      await form.getByRole('button', { name: '完成', exact: true }).click();
      await expect(guest.getByText(submissionTitle, { exact: true })).toHaveCount(0);

      await shareDialog.getByRole('button', { name: '关闭', exact: true }).click();
      await page.getByRole('button', { name: config.noun, exact: true }).click();
      const intake = page.getByRole('dialog', { name: `${config.noun}提报`, exact: true });
      const request = intake.locator('.intake-list > div').filter({ hasText: submissionTitle });
      await expect(request).toContainText('公开访客');
      await expect(request).toContainText('访客提报');
      await expect(request).toContainText('visitor@example.com');
      await request.getByRole('button', { name: '接受并创建任务', exact: true }).click();
      await expect(request).toContainText('已接受');
      await intake.getByRole('button', { name: '关闭', exact: true }).click();
      await expect(page.getByRole('button', { name: submissionTitle, exact: true })).toBeVisible();

      await page.getByRole('button', { name: '分享', exact: true }).click();
      await shareDialog.getByRole('button', { name: '关闭分享', exact: true }).click();
      await expect(
        shareDialog.getByRole('button', { name: '开启公开分享', exact: true }),
      ).toBeVisible();
      await guest.reload();
      await expect(
        guest.getByRole('heading', { name: '分享链接已失效', exact: true }),
      ).toBeVisible();
      await expect(guest.getByRole('button', { name: config.entry, exact: true })).toHaveCount(0);
      await expect(guest).toHaveURL(shareUrl);
    } finally {
      await guestContext.close();
    }
  });
}
