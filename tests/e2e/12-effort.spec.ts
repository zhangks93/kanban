import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`estimation, work-log edits and reporting work at ${width}px`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/login');
    await page.getByRole('link', { name: '使用飞书登录' }).click();
    await page.locator('select[name=user]').selectOption('user_a');
    await page.getByRole('button', { name: '授权登录' }).click();
    await page.waitForURL('**/my');
    await page.goto('/workspaces/alpha/boards/WORK');
    await page.getByRole('button', { name: '新建任务', exact: true }).click();
    const title = `工时回归 ${width}`;
    await page.getByLabel('标题', { exact: true }).fill(title);
    await page.getByLabel('预估工时（天）', { exact: true }).selectOption('3');
    await page.getByRole('button', { name: '创建任务', exact: true }).click();
    await page.getByRole('button', { name: title, exact: true }).click();
    await expect(page.getByLabel('预估工时（天）', { exact: true })).toHaveValue('3');
    await page.getByLabel('预估工时（天）', { exact: true }).selectOption('5');
    await expect(page.getByLabel('预估工时（天）', { exact: true })).toHaveValue('5');
    const logs = page.getByRole('region', { name: '任务工时' });
    await logs.getByLabel('工作日期', { exact: true }).fill('2020-04-01');
    await logs.getByLabel('投入工时（小时）', { exact: true }).fill('2');
    await logs.getByLabel('工作说明', { exact: true }).fill('完成工时表单及校验');
    await logs.getByRole('button', { name: '登记工时', exact: true }).click();
    await expect(logs.getByText('累计投入 2 小时', { exact: true })).toBeVisible();
    await expect(logs.locator('.work-log-row')).toContainText('完成工时表单及校验');
    await logs.getByRole('button', { name: '修改记录', exact: true }).click();
    await logs.getByLabel('投入工时（小时）', { exact: true }).fill('4');
    await logs.getByLabel('工作说明', { exact: true }).fill('完成工时表单、校验及回归测试');
    await logs.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(logs.getByText('累计投入 4 小时', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭任务', exact: true }).click();
    await expect(page.locator('.task-card').filter({ hasText: title })).toContainText('预估 5 天');
    await expect(page.locator('.task-card').filter({ hasText: title })).toContainText(
      '已投入 4 小时',
    );
    await page.goto('/work-logs');
    await expect(page.getByRole('heading', { name: '工时统计', exact: true })).toBeVisible();
    const option = page
      .getByRole('combobox', { name: '任务', exact: true })
      .locator('option')
      .filter({ hasText: title });
    await expect(option).toHaveCount(1);
    await page
      .getByRole('combobox', { name: '任务', exact: true })
      .selectOption((await option.getAttribute('value'))!);
    await page.getByLabel('起始日期', { exact: true }).fill('2020-04-01');
    await page.getByLabel('结束日期', { exact: true }).fill('2020-04-01');
    await expect(page.locator('.report-summary')).toContainText('4 小时');
    await expect(page.locator('.report-table tbody')).toContainText('10% 已投入');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(page).toHaveScreenshot(`work-report-${width}.png`, { animations: 'disabled' });
    await page
      .locator('.report-table')
      .getByRole('link', { name: new RegExp(title) })
      .click();
    const fullLogs = page.getByRole('region', { name: '任务工时' });
    await expect(fullLogs.getByText('累计投入 4 小时', { exact: true })).toBeVisible();
    await fullLogs.getByRole('button', { name: '删除记录', exact: true }).click();
    await fullLogs.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(fullLogs.getByText('累计投入 0 小时', { exact: true })).toBeVisible();
  });
}
