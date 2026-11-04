import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';

const workspaceId = '20000000-0000-4000-8000-000000000001';
const boardId = '30000000-0000-4000-8000-000000000002';
const responsibleUserId = '10000000-0000-4000-8000-000000000002';

async function finishFeishuLogin(page: Page) {
  await page.locator('select[name=user]').selectOption('user_a');
  await page.getByRole('button', { name: '授权登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agent 访问', exact: true })).toBeVisible();
}

test('human confirms a narrowed read-only grant after Feishu login and can revoke it', async ({
  page,
  request,
}, testInfo) => {
  const clientName = `浏览器只读授权 ${Date.now()}`;
  const start = await request.post('/api/agent/device', {
    data: { clientName, scopes: ['read', 'write'] },
  });
  expect(start.ok()).toBe(true);
  const device = (await start.json()) as {
    userCode: string;
    deviceCode: string;
    verificationUri: string;
  };
  await page.goto(device.verificationUri);
  await finishFeishuLogin(page);
  await expect(page).toHaveURL(device.verificationUri);
  await expect(page.getByLabel('设备验证码', { exact: true })).toHaveText(device.userCode);
  await expect(page.getByRole('button', { name: '授权只读访问', exact: true })).toBeDisabled();
  const writeChoice = page.getByRole('checkbox', { name: /同时允许创建、修改和删除任务/ });
  await expect(writeChoice).not.toBeChecked();
  await page.getByRole('combobox', { name: '工作空间', exact: true }).selectOption(workspaceId);
  await expect(page.getByRole('combobox', { name: '授权有效期', exact: true })).toHaveValue('3600');
  await expect(page.getByRole('button', { name: '授权只读访问', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('agent-consent-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('agent-consent-mobile.png'), fullPage: true });

  await page.getByRole('button', { name: '授权只读访问', exact: true }).click();
  await expect(page.getByText(/授权已确认，请返回 CLI 完成登录/)).toBeVisible();
  const tokenResponse = await request.post('/api/agent/device/token', {
    data: { deviceCode: device.deviceCode },
  });
  expect(tokenResponse.ok()).toBe(true);
  const token = (await tokenResponse.json()) as {
    status: string;
    accessToken: string;
    authorization: { scopes: string[] };
  };
  expect(token.status).toBe('approved');
  expect(token.authorization.scopes).toEqual(['read']);
  const headers = { authorization: `Bearer ${token.accessToken}` };
  expect((await request.get('/api/agent/v1/me', { headers })).status()).toBe(200);
  expect(
    (
      await request.post(`/api/agent/v1/boards/${boardId}/tasks`, {
        headers,
        data: {
          title: '只读授权不能创建任务',
          responsibleUserId,
          clientMutationId: randomUUID(),
        },
      })
    ).status(),
  ).toBe(403);
  const grant = page.locator('.agent-grant').filter({ hasText: clientName });
  await expect(grant).toContainText('只读');
  await expect(grant).toContainText('有效');
  await grant.getByRole('button', { name: `撤销 ${clientName} 的授权`, exact: true }).click();
  await expect(grant).toContainText('已撤销');
  expect((await request.get('/api/agent/v1/me', { headers })).status()).toBe(401);
});

test('a human can deny a request without granting a CLI token', async ({ page, request }) => {
  const start = await request.post('/api/agent/device', {
    data: { clientName: `拒绝授权 ${Date.now()}`, scopes: ['read'] },
  });
  expect(start.ok()).toBe(true);
  const device = (await start.json()) as { deviceCode: string; verificationUri: string };
  await page.goto(device.verificationUri);
  await finishFeishuLogin(page);
  await expect(page.getByRole('checkbox', { name: /同时允许创建、修改和删除任务/ })).toHaveCount(0);
  await page.getByRole('button', { name: '拒绝请求', exact: true }).click();
  await expect(
    page.getByText('请求已拒绝，CLI 无法获得本次访问授权。', { exact: true }),
  ).toBeVisible();
  const poll = await request.post('/api/agent/device/token', {
    data: { deviceCode: device.deviceCode },
  });
  expect(await poll.json()).toEqual({ status: 'denied' });
});
