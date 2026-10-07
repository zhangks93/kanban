import { test, expect } from '@playwright/test';
import { pool, transaction } from '../../apps/api/src/lib/db';
import { coreTemplates } from '../../packages/plugin-sdk/src';
test('1000-card Board virtualizes cells and remains interactive', async ({ page }) => {
  test.setTimeout(60000);
  const actor = '10000000-0000-4000-8000-000000000002';
  let board: any;
  try {
    board = await transaction(actor, async (db) => {
      const b = (
        await db.query('SELECT * FROM create_board($1,$2,$3,$4,$5)', [
          '20000000-0000-4000-8000-000000000001',
          'PERF',
          '1000 卡片',
          'workspace',
          coreTemplates[0],
        ])
      ).rows[0];
      for (let i = 0; i < 1000; i++)
        await db.query('SELECT create_task($1,$2)', [
          b.id,
          {
            title: `虚拟化任务 ${i + 1}`,
            responsibleUserId: '10000000-0000-4000-8000-000000000003',
          },
        ]);
      return b;
    });
    await page.goto('/login');
    await page.getByRole('link', { name: '使用飞书登录' }).click();
    await page.locator('select[name=user]').selectOption('user_a');
    await page.getByRole('button', { name: '授权登录' }).click();
    await page.waitForURL('**/my');
    await page.goto('/workspaces/alpha/boards/PERF');
    await expect(page.getByText('1000 项', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '虚拟化任务 1', exact: true })).toBeVisible();
    expect(await page.locator('.task-card').count()).toBeLessThan(40);
    await page
      .locator('.cell-scroll')
      .first()
      .evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
    await expect(page.getByRole('button', { name: '虚拟化任务 1000', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '虚拟化任务 1000', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '任务标题' })).toHaveValue('虚拟化任务 1000');
  } finally {
    if (board)
      await transaction(actor, (db) =>
        db.query("UPDATE board SET status='archived' WHERE id=$1", [board.id]),
      );
    await pool.end();
  }
});
