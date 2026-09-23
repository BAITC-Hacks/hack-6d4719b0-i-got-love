import { expect, test } from '@playwright/test';

test('task picker finds by text or number without changing task until selected', async ({ page }) => {
  await page.goto('/#proposals?task=7');
  const picker = page.getByRole('combobox', { name: 'Найти задачу для откликов' });
  await picker.fill('поликлинике');
  await expect(page.getByRole('option')).toHaveCount(1);
  expect(page.url()).toContain('task=7');
  await picker.press('Enter');
  await expect(page).toHaveURL(/task=10/);
  await picker.fill('несуществующая задача');
  await expect(page.getByText('Ничего не найдено. Попробуйте другое название.')).toBeVisible();
  await picker.press('Escape');
  await expect(picker).toHaveValue('Упростить регистрацию в поликлинике');
  await page.getByRole('button', { name: 'Очистить поиск задач' }).click();
  await picker.fill('#7');
  await page.getByRole('option').click();
  await expect(page).toHaveURL(/task=7/);
});

test('team filters combine with search and reset from no results', async ({ page }) => {
  await page.goto('/#teams');
  await page.getByRole('combobox', { name: 'Технология', exact: true }).selectOption('Python');
  await expect(page.locator('.team-card')).toHaveCount(1);
  await expect(page.locator('.team-card')).toContainText('Пульс данных');
  await page.getByRole('combobox', { name: 'Интерес', exact: true }).selectOption('Логистика');
  await expect(page.getByRole('heading', { name: 'Команды не найдены' })).toBeVisible();
  await page.getByRole('button', { name: 'Показать все команды' }).click();
  await expect(page.locator('.team-card').nth(4)).toBeVisible();
  await page.getByLabel('Поиск команды или навыка').fill('крафт');
  await expect(page.locator('.team-card')).toHaveCount(1);
  await expect(page.locator('.team-card')).toContainText('Крафт Код');
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('recommendations explain matches while leaving team choice manual', async ({ page }) => {
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 900, name: 'Тест команды', email: 'team@test.example', role: 'team', available: true, team_id: 900, team_name: 'Маршрут', interests: ['Логистика'], skills: [], technologies: [] } } }));
  const writes: string[] = [];
  page.on('request', request => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.url()); });
  await page.goto('/#catalog');
  await expect(page.locator('.task-card').first()).toContainText('Упростить регистрацию в поликлинике');
  await page.getByRole('combobox', { name: 'Сортировка', exact: true }).selectOption('recommended');
  await expect(page.locator('.task-card').first()).toContainText('Оптимизировать маршруты доставки');
  await expect(page.locator('.task-card').first()).toContainText('Подходит по профилю: Логистика');
  await expect(page.locator('.task-card').first().getByRole('button', { name: /Откликнуться/ })).toBeVisible();
  expect(writes).toEqual([]);
  await page.getByRole('combobox', { name: 'Сортировка', exact: true }).selectOption('score_desc');
  await expect(page.locator('.task-card').first()).toContainText('Упростить регистрацию в поликлинике');
});
