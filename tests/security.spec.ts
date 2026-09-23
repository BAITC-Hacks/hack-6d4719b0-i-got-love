import { expect, test } from '@playwright/test';

test('untrusted task text stays text and unsafe prototype schemes stay unclickable', async ({ page }) => {
  const payload = '<img src=x onerror="window.injected=true">';
  await page.route('**/api/catalog', async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.items[0].title = payload;
    data.items[0].context = payload;
    await route.fulfill({ json: data });
  });
  await page.goto('/#catalog');
  await expect(page.locator('.task-card').first().getByRole('heading')).toHaveText(payload);
  await expect(page.locator('.task-card img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { injected?: boolean }).injected)).toBeUndefined();
  await page.route('**/api/proposals?task_id=7', async route => {
    const response = await route.fetch();
    const data = await response.json();
    data[0].prototype_url = 'javascript:window.injected=true';
    data[0].idea = payload;
    await route.fulfill({ json: data });
  });
  await page.goto('/#proposals?task=7');
  await expect(page.locator('.proposal-card').first()).toContainText(payload);
  await expect(page.locator('.proposal-card').first().getByText('Прототип не добавлен')).toBeVisible();
  await expect(page.locator('.proposal-card img, .proposal-card a')).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { injected?: boolean }).injected)).toBeUndefined();
});

test('corrupted browser draft does not prevent opening the builder', async ({ page }) => {
  const signup = await page.request.post('/api/auth/register', { data: { name: 'Проверка хранилища', email: `storage-${Date.now()}@test.example`, password: 'Secure-test-password-934', role: 'business' } });
  expect(signup.status()).toBe(201);
  const { user } = await signup.json();
  await page.addInitScript(id => localStorage.setItem(`lovelab.task-builder.v1.user-${id}`, '{malformed'), user.id);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#builder');
  await expect(page.getByRole('heading', { name: 'Конструктор задач', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '+ Новая задача', exact: true }).click();
  await page.getByLabel('Что вы хотите решить?').fill('Новая задача после повреждённого локального черновика');
  expect(errors).toEqual([]);
});
