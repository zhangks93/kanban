import { test, expect } from '@playwright/test';
async function login(page: import('@playwright/test').Page) {
  await page.clock.setFixedTime(new Date('2026-10-07T04:00:00Z'));
  await page.goto('/login');
  await page.getByRole('link', { name: '使用飞书登录' }).click();
  await page.locator('select[name=user]').selectOption('user_a');
  await page.getByRole('button', { name: '授权登录' }).click();
  await page.waitForURL('**/my');
  await expect(page.getByRole('heading', { name: '我的工作', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '统一任务状态与权限校验', exact: true }),
  ).toBeVisible();
}
test('desktop visual baselines: My, Board, Peek, full detail; focus trap', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await expect(page).toHaveScreenshot('my-desktop.png', { animations: 'disabled' });
  await page.goto('/workspaces/alpha/boards/ALPHA');
  await expect(
    page.getByRole('button', { name: '统一任务状态与权限校验', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot('board-desktop.png', { animations: 'disabled' });
  await page.getByRole('button', { name: '统一任务状态与权限校验', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('combobox', { name: '系统', exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot('peek-desktop.png', { animations: 'disabled' });
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(
      true,
    );
  }
  await page.getByRole('link', { name: '展开任务' }).click();
  await expect(page.getByRole('textbox', { name: '任务标题' })).toBeVisible();
  await expect(page).toHaveScreenshot('full-desktop.png', { animations: 'disabled' });
});
test('mobile visual baselines and no document overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await expect(page).toHaveScreenshot('my-mobile.png', { animations: 'disabled' });
  await page.goto('/workspaces/alpha/boards/ALPHA');
  await expect(
    page.getByRole('button', { name: '统一任务状态与权限校验', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page).toHaveScreenshot('board-mobile.png', { animations: 'disabled' });
  await page.getByRole('button', { name: '统一任务状态与权限校验', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('combobox', { name: '系统', exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot('peek-mobile.png', { animations: 'disabled' });
  await page.getByRole('link', { name: '展开任务' }).click();
  await expect(page.getByRole('textbox', { name: '任务标题' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page).toHaveScreenshot('full-mobile.png', { animations: 'disabled' });
});
for (const width of [1280, 1920])
  test(`desktop ${width}px stays usable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await page.goto('/workspaces/alpha/boards/ALPHA');
    await expect(
      page.getByRole('button', { name: '统一任务状态与权限校验', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
