import { test, expect } from '@playwright/test';
async function login(page: import('@playwright/test').Page, user = 'user_a') {
  await page.goto('/login');
  await page.getByRole('link', { name: '使用飞书登录' }).click();
  await page.locator('select[name=user]').selectOption(user);
  await page.getByRole('button', { name: '授权登录' }).click();
  await page.waitForURL('**/my');
}
test('login, Board, Peek, full route and create Task', async ({ page }) => {
  await login(page);
  await page.goto('/workspaces/alpha/boards/ALPHA');
  await expect(
    page.getByRole('button', { name: '统一任务状态与权限校验', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '统一任务状态与权限校验', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '任务标题' })).toHaveValue(
    '统一任务状态与权限校验',
  );
  await page.getByRole('link', { name: '展开任务' }).click();
  await expect(page).toHaveURL(/\/tasks\/1$/);
  await expect(page.getByRole('textbox', { name: '任务标题' })).toBeVisible();
  await page.getByRole('button', { name: '关闭任务' }).click();
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByLabel('标题', { exact: true }).fill('E2E 创建任务');
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(page.getByRole('button', { name: 'E2E 创建任务', exact: true })).toBeVisible();
});
