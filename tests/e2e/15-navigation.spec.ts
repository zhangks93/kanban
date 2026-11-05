import { test, expect, type Page } from '@playwright/test';

async function login(page: Page, user = 'user_a') {
  await page.goto('/login');
  await page.getByRole('link', { name: '使用飞书登录', exact: true }).click();
  await page.locator('select[name=user]').selectOption(user);
  await page.getByRole('button', { name: '授权登录', exact: true }).click();
  await page.waitForURL('**/my');
}

test('navigation groups expose only available management modules and keep board context', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'user_c');
  await page.goto('/workspaces/alpha/boards/ALPHA/tasks/1');
  const navigation = page.getByRole('navigation', { name: '工作模块', exact: true });
  await expect(navigation.getByRole('heading', { name: '个人工作', exact: true })).toBeVisible();
  await expect(navigation.getByRole('heading', { name: '空间协作', exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: '空间成员', exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: '插件与设置', exact: true })).toHaveCount(0);
  await expect(navigation.getByRole('link', { name: '审计记录', exact: true })).toHaveCount(0);
  await expect(navigation.getByRole('link', { name: '平台用户', exact: true })).toHaveCount(0);
  await expect(navigation.getByRole('link', { name: '研发综合', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const breadcrumb = page.getByRole('navigation', { name: '当前位置', exact: true });
  await expect(breadcrumb).toContainText('研发综合');
  await expect(breadcrumb).toContainText('任务详情');
  await navigation.getByRole('link', { name: 'Agent 访问', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agent 访问', exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Agent 访问', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('mobile navigation traps focus, restores focus on Escape and closes after selecting a module', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const open = page.getByRole('button', { name: '打开导航', exact: true });
  await open.click();
  const drawer = page.getByRole('dialog', { name: '工作导航', exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('#main-content')).toHaveAttribute('inert', '');
  await page.keyboard.press('Shift+Tab');
  await expect(drawer.getByRole('button', { name: '退出登录', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(drawer.getByRole('button', { name: '关闭导航', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(open).toBeFocused();
  await open.click();
  await drawer.getByRole('link', { name: 'Agent 访问', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agent 访问', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '工作导航', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开导航', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
