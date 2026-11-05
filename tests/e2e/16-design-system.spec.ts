import { test, expect } from '@playwright/test';

const pages = [
  { path: '/my', name: 'my', heading: '我的工作' },
  { path: '/workspaces/alpha/boards/ALPHA', name: 'board', heading: '研发综合' },
  { path: '/work-logs', name: 'report', heading: '工时统计' },
  { path: '/agent-access', name: 'agent', heading: 'Agent 访问' },
  { path: '/workspaces/alpha/settings/members', name: 'members', heading: '空间成员' },
  { path: '/workspaces/alpha/data', name: 'data', heading: '基础数据' },
];

for (const width of [1440, 390]) {
  test(`shared layouts stay within the viewport and render only five font levels at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date('2026-10-07T04:00:00Z'));
    await page.goto('/login');
    await page.getByRole('link', { name: '使用飞书登录', exact: true }).click();
    await page.locator('select[name=user]').selectOption('user_a');
    await page.getByRole('button', { name: '授权登录', exact: true }).click();
    await page.waitForURL('**/my');
    for (const entry of pages) {
      await page.goto(entry.path);
      await expect(page.getByRole('heading', { name: entry.heading, exact: true })).toBeVisible();
      if (entry.name === 'my') await expect(page.locator('.my-task-row').first()).toBeVisible();
      if (entry.name === 'board') await expect(page.locator('.task-card').first()).toBeVisible();
      if (width === 390 && entry.name === 'report') {
        const main = page.locator('#main-content');
        await main.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        await expect(page.getByRole('button', { name: '打开导航', exact: true })).toBeInViewport();
        await main.evaluate((element) => {
          element.scrollTop = 0;
        });
      }
      const sizes = await page.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const actual = new Set<string>();
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const element = node.parentElement;
          if (!node.textContent?.trim() || !element?.getClientRects().length) continue;
          const style = getComputedStyle(element);
          if (style.visibility !== 'hidden' && style.display !== 'none') actual.add(style.fontSize);
        }
        return [...actual];
      });
      expect(
        sizes.filter((size) => !['12px', '13px', '14px', '18px', '24px'].includes(size)),
        entry.path,
      ).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        entry.path,
      ).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`${entry.name}-${width}.png`) });
    }
  });
}
