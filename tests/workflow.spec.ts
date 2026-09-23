import { expect, test } from '@playwright/test';

// These tests run against a disposable database, including the real Python API.
test('business task through publication, proposal, manual selection and progress', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Каталог задач' })).toBeVisible();
  await expect(page.locator('.task-card')).toHaveCount(5);
  if (process.env.CAPTURE_DOCS) await page.screenshot({ path: 'docs/screenshots/catalog.png', fullPage: true });
  await page.getByRole('link', { name: 'Конструктор', exact: true }).click();
  await page.getByRole('button', { name: '+ Новая задача', exact: true }).click();
  await page.getByLabel('Что вы хотите решить?').fill('Менеджеры долго отвечают на обращения клиентов.');
  await page.reload();
  await expect(page.getByLabel('Что вы хотите решить?')).toHaveValue('Менеджеры долго отвечают на обращения клиентов.');
  await page.getByRole('button', { name: /Получить уточняющие вопросы/ }).click();
  await expect(page.locator('.question textarea')).toHaveCount(5);
  await expect(page.getByRole('status').filter({ hasText: 'стандартные вопросы' })).toBeVisible();
  const answers = ['Сократить время ответа', 'Операторы поддержки', 'Прототип распределения обращений', 'Ответ за 10 минут', 'Обезличенные обращения'];
  for (let i = 0; i < answers.length; i++) await page.locator('.question textarea').nth(i).fill(answers[i]);
  await page.getByRole('button', { name: /Создать черновик/ }).click();
  await page.getByLabel('Название', { exact: false }).fill('Быстрая поддержка');
  await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить карточку', exact: true }).click();
  await expect(page.getByText('Подтверждённый рейтинг', { exact: true })).toBeVisible();
  if (process.env.CAPTURE_DOCS) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'docs/screenshots/builder.png', fullPage: true });
  }
  await page.getByRole('button', { name: 'Опубликовать →', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Задача опубликована', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Перейти к откликам' }).click();
  const proposalUrl = page.url();
  await page.getByRole('button', { name: /Добавить отклик/ }).click();
  await page.getByRole('combobox', { name: 'Команда', exact: true }).selectOption('1');
  await page.getByLabel('Идея', { exact: true }).fill('Распределять обращения по теме');
  await page.getByLabel('План работы').fill('Изучить данные, собрать и проверить прототип');
  await page.getByLabel('Срок', { exact: true }).fill('2 недели');
  await page.getByLabel('Ссылка на прототип').fill('https://www.figma.com/proto/support-demo');
  await page.getByRole('button', { name: 'Отправить отклик', exact: true }).click();
  await expect(page.locator('.proposal-card')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Прототип', exact: true })).toHaveAttribute('href', 'https://www.figma.com/proto/support-demo');
  await page.getByRole('button', { name: 'Выбрать команду', exact: true }).click();
  await page.getByRole('button', { name: /Подтвердить этап/ }).click();
  await expect(page.getByText('Этап подтверждён · +10 баллов', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Этап подтверждён · +10 баллов', { exact: false })).toBeVisible();
  await expect(page.locator('.team-points')).toHaveText('✦ 10 баллов');
  await page.getByRole('link', { name: 'Каталог задач', exact: true }).click();
  const card = page.locator('.task-card').filter({ hasText: 'Быстрая поддержка' });
  await card.getByRole('button', { name: /Редактировать/ }).click();
  await page.getByRole('textbox', { name: 'Ограничения', exact: true }).fill('Без персональных данных');
  await page.getByRole('button', { name: 'Подтвердить и опубликовать изменения', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Задача опубликована', exact: true })).toBeVisible();
  await page.goto(proposalUrl);
  await expect(page.locator('.proposal-card')).toHaveCount(1);
  await expect(page.locator('.team-points')).toHaveText('✦ 10 баллов');
  expect(errors).toEqual([]);
});

test('demo proposals, filters, complete details and mobile layout', async ({ page }) => {
  await page.goto('/#proposals?task=7');
  await expect(page.locator('.proposal-card')).toHaveCount(5);
  await expect(page.getByText('Прототип не добавлен', { exact: true })).toHaveCount(5);
  await expect(page.getByRole('link', { name: 'Прототип', exact: true })).toHaveCount(0);
  if (process.env.CAPTURE_DOCS) await page.screenshot({ path: 'docs/screenshots/proposals.png', fullPage: true });
  await page.getByRole('button', { name: 'Выбрать команду', exact: true }).nth(0).click();
  await page.getByRole('button', { name: 'Выбрать команду', exact: true }).nth(0).click();
  await page.getByRole('button', { name: 'Отклонить', exact: true }).nth(0).click();
  await expect(page.getByText('Выбрана бизнесом', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Отклонена', { exact: true })).toHaveCount(1);
  await page.getByRole('link', { name: 'Каталог задач', exact: true }).click();
  await page.getByLabel('Уровень').selectOption('draft');
  await expect(page.locator('.task-card')).toHaveCount(2);
  await page.locator('.task-card').first().getByText('Полная карточка задачи', { exact: true }).click();
  await expect(page.locator('.task-card').first().getByText('контакт бизнеса', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const screen of ['Каталог задач', 'Команды', 'Конструктор', 'Отклики']) {
    await page.getByRole('link', { name: screen, exact: true }).click();
    await expect(page.locator('main')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('empty database, request failure and stale task link remain usable', async ({ page }) => {
  await page.route('**/api/catalog', route => route.fulfill({ json: { items: [], total: 0 } }));
  await page.route('**/api/teams', route => route.fulfill({ json: [] }));
  await page.goto('/#proposals');
  await expect(page.getByRole('heading', { name: 'Пока нет опубликованных задач' })).toBeVisible();
  await page.getByRole('button', { name: 'Создать задачу', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Конструктор задач', exact: true })).toBeVisible();
  await page.goto('/#proposals?task=99999');
  await expect(page.getByRole('heading', { name: 'Задача недоступна' })).toBeVisible();
  await page.unroute('**/api/catalog');
  await page.route('**/api/catalog', route => route.fulfill({ status: 503, json: { detail: 'Unavailable' } }));
  await page.goto('/#catalog');
  await expect(page.getByRole('alert')).toBeVisible();
  await page.unroute('**/api/catalog');
  await page.getByRole('button', { name: /Повторить/ }).click();
  await expect(page.locator('.task-card').first()).toBeVisible();
});


test('new local draft survives reload after opening a task by URL', async ({ page }) => {
  // HTTP access from another device does not expose crypto.randomUUID.
  await page.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined }));
  await page.goto('/#builder?task=1');
  await expect(page.getByRole('textbox', { name: 'Название', exact: false })).toBeVisible();
  await page.getByRole('button', { name: '← Все задачи', exact: true }).click();
  await page.getByRole('button', { name: '+ Новая задача', exact: true }).click();
  await page.getByLabel('Что вы хотите решить?').fill('Новая задача для проверки восстановления');
  await page.reload();
  await expect(page.getByLabel('Что вы хотите решить?')).toHaveValue('Новая задача для проверки восстановления');
  await page.getByRole('link', { name: 'Каталог задач', exact: true }).click();
  await page.getByRole('link', { name: 'Конструктор', exact: true }).click();
  await expect(page.getByLabel('Что вы хотите решить?')).toHaveValue('Новая задача для проверки восстановления');
});


test('question retry replaces fallback and preserves matching answers', async ({ page }) => {
  await page.goto('/#builder');
  await page.getByRole('button', { name: '+ Новая задача', exact: true }).click();
  await page.getByLabel('Что вы хотите решить?').fill('Пекарня теряет продукты из-за лишней выпечки');
  await page.getByRole('button', { name: /Получить уточняющие вопросы/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'стандартные вопросы' })).toBeVisible();
  await page.locator('.question textarea').first().fill('Уменьшить списания');
  await page.route('**/api/task-builder/questions', route => route.fulfill({ json: {
    source: 'ollama', warning: null, fallback_reason: null,
    questions: [
      { field: 'need', text: 'Какое уменьшение списаний вы считаете успешным?' },
      { field: 'data', text: 'Есть ли история продаж выпечки?' },
      { field: 'constraints', text: 'Какие ограничения производства важно учитывать?' },
    ],
  } }));
  await page.getByRole('button', { name: 'Обновить вопросы', exact: true }).click();
  await expect(page.locator('.question textarea')).toHaveCount(3);
  await expect(page.locator('.question textarea').first()).toHaveValue('Уменьшить списания');
  await expect(page.getByRole('status').filter({ hasText: 'стандартные вопросы' })).toHaveCount(0);
});

test('mobile proposal form keeps focused fields above navigation', async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/#proposals?task=7');
    await page.reload();
    await page.getByRole('button', { name: /Добавить отклик/ }).click();
    await page.getByLabel('Идея', { exact: true }).focus();
    for (let index = 0; index < 5; index++) {
      await expect.poll(() => page.evaluate(() => {
        const field = document.activeElement!.getBoundingClientRect();
        const navigation = document.querySelector('.sidebar')!.getBoundingClientRect();
        return field.top >= 0 && field.bottom < navigation.top;
      })).toBe(true);
      await page.keyboard.press('Tab');
    }
    const cancel = await page.getByRole('button', { name: 'Отмена', exact: true }).boundingBox();
    expect(cancel!.height).toBeLessThan(50);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
});
