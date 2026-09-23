import { expect, test, type Page } from '@playwright/test';

const password = 'Test-only-password-42';
async function account(page: Page, role: 'business' | 'team') {
  const email = `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const response = await page.request.post('/api/auth/register', { data: { name: role === 'business' ? 'Тестовый бизнес' : 'Тестовый участник', email, password, role, ...(role === 'team' ? { team_name: 'Команда проверки' } : {}) } });
  expect(response.status()).toBe(201);
  return { ...(await response.json()).user, email, password };
}
async function draft(page: Page, title = 'Черновик для проверки') {
  const response = await page.request.post('/api/task-builder/drafts', { data: { description: 'Контекст проверяемой задачи', answers: { title } } });
  expect(response.status()).toBe(201);
  return response.json();
}

// All accounts, tasks and proposals belong to the disposable test database.
test('business task through publication, team proposal, owner selection and progress', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const business = await account(page, 'business');
  await page.goto('/#catalog');
  await expect(page.getByRole('heading', { name: 'Каталог задач', exact: true })).toBeVisible();
  if (process.env.CAPTURE_DOCS) await page.screenshot({ path: 'docs/screenshots/catalog.png', fullPage: true });
  await page.getByRole('link', { name: 'Конструктор', exact: true }).click();
  await page.getByRole('button', { name: '+ Новая задача', exact: true }).click();
  await page.getByLabel('Что вы хотите решить?').fill('Менеджеры долго отвечают на обращения клиентов.');
  await page.reload();
  await expect(page.getByLabel('Что вы хотите решить?')).toHaveValue('Менеджеры долго отвечают на обращения клиентов.');
  await page.getByRole('button', { name: /Получить уточняющие вопросы/ }).click();
  await expect(page.locator('.question textarea')).toHaveCount(5);
  const answers = ['Сократить время ответа', 'Операторы поддержки', 'Прототип распределения обращений', 'Ответ за 10 минут', 'Обезличенные обращения'];
  for (let i = 0; i < answers.length; i++) await page.locator('.question textarea').nth(i).fill(answers[i]);
  await page.getByRole('button', { name: /Создать черновик/ }).click();
  await page.getByLabel('Название', { exact: false }).fill('Быстрая поддержка');
  await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить карточку', exact: true }).click();
  await expect(page.getByText('Подтверждённый рейтинг', { exact: true })).toBeVisible();
  if (process.env.CAPTURE_DOCS) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: 'docs/screenshots/builder.png', fullPage: true }); }
  await page.getByRole('button', { name: 'Опубликовать →', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Задача опубликована', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Перейти к откликам' }).click();
  const proposalUrl = page.url();
  await expect(page.getByRole('button', { name: /Добавить отклик/ })).toHaveCount(0);
  await page.request.post('/api/auth/logout');
  const team = await account(page, 'team');
  await page.reload();
  await page.getByRole('button', { name: /Добавить отклик/ }).click();
  await expect(page.getByRole('combobox', { name: 'Команда', exact: true })).toHaveValue(String(team.team_id));
  await expect(page.getByRole('combobox', { name: 'Команда', exact: true }).locator('option')).toHaveCount(1);
  await page.getByLabel('Идея', { exact: true }).fill('Распределять обращения по теме');
  await page.getByLabel('План работы').fill('Изучить данные, собрать и проверить прототип');
  await page.getByLabel('Срок', { exact: true }).fill('2 недели');
  await page.getByLabel('Ссылка на прототип').fill('https://www.figma.com/proto/support-demo');
  await page.getByRole('button', { name: 'Отправить отклик', exact: true }).click();
  await expect(page.locator('.proposal-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Выбрать команду', exact: true })).toHaveCount(0);
  await page.request.post('/api/auth/logout');
  expect((await page.request.post('/api/auth/login', { data: { email: business.email, password } })).ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Выбрать команду', exact: true }).click();
  await page.getByRole('button', { name: /Подтвердить этап/ }).click();
  await expect(page.getByText('Этап подтверждён · +10 баллов', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.locator('.team-points')).toHaveText('✦ 10 баллов');
  await page.getByRole('link', { name: 'Каталог задач', exact: true }).click();
  await page.locator('.task-card').filter({ hasText: 'Быстрая поддержка' }).getByRole('button', { name: /Редактировать/ }).click();
  await page.getByRole('textbox', { name: 'Ограничения', exact: true }).fill('Без персональных данных');
  await page.getByRole('button', { name: 'Подтвердить и опубликовать изменения', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Задача опубликована', exact: true })).toBeVisible();
  await page.goto(proposalUrl);
  await expect(page.locator('.proposal-card')).toHaveCount(1);
  await expect(page.locator('.team-points')).toHaveText('✦ 10 баллов');
  expect(errors).toEqual([]);
});

test('guests browse demo content without management controls', async ({ page }) => {
  await page.goto('/#proposals?task=7');
  await expect(page.locator('.proposal-card')).toHaveCount(5);
  await expect(page.getByText('Прототип не добавлен', { exact: true })).toHaveCount(5);
  await expect(page.getByRole('link', { name: 'Прототип', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Выбрать команду', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Добавить отклик/ })).toHaveCount(0);
  if (process.env.CAPTURE_DOCS) await page.screenshot({ path: 'docs/screenshots/proposals.png', fullPage: true });
  await page.getByRole('link', { name: 'Каталог задач', exact: true }).click();
  await page.getByLabel('Уровень').selectOption('draft');
  await expect(page.locator('.task-card').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Редактировать', exact: true })).toHaveCount(0);
  await page.locator('.task-card').first().getByText('Полная карточка задачи', { exact: true }).click();
  await expect(page.locator('.task-card').first().getByText('контакт бизнеса', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const screen of ['Каталог задач', 'Команды', 'Конструктор', 'Отклики']) {
    await page.getByRole('link', { name: screen, exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('empty database, request failure and stale task link remain usable', async ({ page }) => {
  await page.route('**/api/catalog', route => route.fulfill({ json: { items: [], total: 0 } }));
  await page.route('**/api/teams', route => route.fulfill({ json: [] }));
  await page.goto('/#proposals');
  await expect(page.getByRole('heading', { name: 'Пока нет опубликованных задач' })).toBeVisible();
  await page.getByRole('button', { name: 'Создать задачу', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Конструктор для бизнеса', exact: true })).toBeVisible();
  await page.goto('/#proposals?task=99999');
  await expect(page.getByRole('heading', { name: 'Задача недоступна' })).toBeVisible();
  await page.unroute('**/api/catalog');
  await page.route('**/api/catalog', route => route.fulfill({ status: 503, json: { detail: 'Недоступно' } }));
  await page.goto('/#catalog');
  await expect(page.getByRole('alert')).toBeVisible();
  await page.unroute('**/api/catalog');
  await page.getByRole('button', { name: /Повторить загрузку/ }).click();
  await expect(page.locator('.task-card').first()).toBeVisible();
});

test('local draft survives reload and is isolated from another account', async ({ page }) => {
  await account(page, 'business');
  const task = await draft(page);
  await page.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined }));
  await page.goto(`/#builder?task=${task.id}`);
  await page.getByRole('button', { name: '← Все задачи', exact: true }).click();
  await page.getByRole('button', { name: '+ Новая задача', exact: true }).click();
  await page.getByLabel('Что вы хотите решить?').fill('Личная незавершённая задача первого бизнеса');
  await page.reload();
  await expect(page.getByLabel('Что вы хотите решить?')).toHaveValue('Личная незавершённая задача первого бизнеса');
  await page.request.post('/api/auth/logout');
  await account(page, 'business');
  await page.reload();
  await expect(page.getByRole('button', { name: '+ Новая задача', exact: true })).toBeVisible();
  await expect(page.getByText('Личная незавершённая задача первого бизнеса')).toHaveCount(0);
  await expect(page.locator('.builder-list-item')).toHaveCount(0);
});

test('question retry replaces fallback and preserves matching answers', async ({ page }) => {
  await account(page, 'business');
  await page.goto('/#builder');
  await page.getByRole('button', { name: '+ Новая задача', exact: true }).click();
  await page.getByLabel('Что вы хотите решить?').fill('Пекарня теряет продукты из-за лишней выпечки');
  await page.getByRole('button', { name: /Получить уточняющие вопросы/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'стандартные вопросы' })).toBeVisible();
  await page.locator('.question textarea').first().fill('Уменьшить списания');
  await page.route('**/api/task-builder/questions', route => route.fulfill({ json: { source: 'ollama', warning: null, fallback_reason: null, questions: [
    { field: 'need', text: 'Какое уменьшение списаний вы считаете успешным?' },
    { field: 'data', text: 'Есть ли история продаж выпечки?' },
    { field: 'constraints', text: 'Какие ограничения производства важно учитывать?' },
  ] } }));
  await page.getByRole('button', { name: 'Обновить вопросы', exact: true }).click();
  await expect(page.locator('.question textarea')).toHaveCount(3);
  await expect(page.locator('.question textarea').first()).toHaveValue('Уменьшить списания');
  await expect(page.getByRole('status').filter({ hasText: 'стандартные вопросы' })).toHaveCount(0);
});

test('mobile proposal form keeps focused fields above navigation', async ({ page }) => {
  await account(page, 'team');
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
    expect((await page.getByRole('button', { name: 'Отмена', exact: true }).boundingBox())!.height).toBeLessThan(50);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
});

test('a delayed save cannot replace a newer local task or newer edits', async ({ page }) => {
  await account(page, 'business');
  const task = await draft(page);
  let releaseSave!: () => void;
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  await page.route(`**/api/task-builder/tasks/${task.id}`, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    const changes = route.request().postDataJSON(); await saveGate;
    await route.fulfill({ json: { ...task, ...changes } });
  });
  await page.goto(`/#builder?task=${task.id}`);
  await page.getByLabel('Название', { exact: false }).fill('Сохранение с задержкой');
  const pendingSave = page.waitForRequest(request => request.method() === 'PUT' && request.url().endsWith(`/tasks/${task.id}`));
  await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click(); await pendingSave;
  await page.evaluate(() => { window.location.hash = 'builder'; });
  await page.getByLabel('Название', { exact: false }).fill('Более новое локальное изменение');
  await page.getByRole('button', { name: '← Все задачи', exact: true }).click();
  await page.getByRole('button', { name: '+ Новая задача', exact: true }).click();
  await page.getByLabel('Что вы хотите решить?').fill('Новая идея не должна стать старой карточкой');
  const savedResponse = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/tasks/${task.id}`));
  releaseSave(); await savedResponse;
  await expect(page.getByLabel('Что вы хотите решить?')).toHaveValue('Новая идея не должна стать старой карточкой');
  await page.reload();
  await expect(page.getByLabel('Что вы хотите решить?')).toHaveValue('Новая идея не должна стать старой карточкой');
  await page.getByRole('button', { name: '← Все задачи', exact: true }).click();
  await page.locator('.builder-list-item').filter({ has: page.getByText(`Черновик · #${task.id}`, { exact: true }) }).getByRole('button', { name: 'Открыть карточку' }).click();
  await expect(page.getByLabel('Название', { exact: false })).toHaveValue('Более новое локальное изменение');
});

test('refreshing proposals after a failed submit preserves all form input', async ({ page }) => {
  const team = await account(page, 'team');
  await page.route('**/api/proposals', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { detail: 'Временная ошибка отправки' } }) : route.continue());
  await page.goto('/#proposals?task=7');
  await page.getByRole('button', { name: /Добавить отклик/ }).click();
  await page.getByLabel('Идея', { exact: true }).fill('Идея, которую нельзя потерять');
  await page.getByLabel('План работы').fill('Проверить процесс и собрать прототип');
  await page.getByLabel('Срок', { exact: true }).fill('2 недели');
  await page.getByLabel('Ссылка на прототип').fill('https://www.figma.com/proto/retained-draft');
  await page.getByRole('button', { name: 'Отправить отклик', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Временная ошибка отправки');
  await page.getByRole('button', { name: 'Обновить отклики', exact: true }).click();
  await expect(page.getByText('Загрузка откликов…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Команда', exact: true })).toHaveValue(String(team.team_id));
  await expect(page.getByRole('textbox', { name: 'Идея', exact: true })).toHaveValue('Идея, которую нельзя потерять');
  await expect(page.getByRole('textbox', { name: 'План работы', exact: true })).toHaveValue('Проверить процесс и собрать прототип');
  await expect(page.getByLabel('Срок', { exact: true })).toHaveValue('2 недели');
  await expect(page.getByLabel('Ссылка на прототип')).toHaveValue('https://www.figma.com/proto/retained-draft');
});

test('wizard edits preserve one draft and rating previews update before confirmation', async ({ page }) => {
  await account(page, 'business');
  await page.goto('/#builder');
  await page.getByRole('button', { name: '+ Новая задача', exact: true }).click();
  await page.getByLabel('Что вы хотите решить?').fill('Исходное описание');
  await page.getByRole('button', { name: /Получить уточняющие вопросы/ }).click();
  await page.locator('.question textarea').first().fill('Исходная потребность');
  const created = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/drafts'));
  await page.getByRole('button', { name: /Создать черновик/ }).click();
  const task = await (await created).json();
  await page.getByLabel('Название', { exact: false }).fill('Проверка пошагового редактора');
  await expect(page.locator('.rating-heading > div > strong')).toHaveText(/20\s*\/\s*100/);
  await page.getByRole('textbox', { name: 'Данные', exact: true }).fill('asdasdasd qwerty');
  await expect(page.locator('.rating-heading > div > strong')).toHaveText(/20\s*\/\s*100/);
  await expect(page.locator('.field-issue')).toContainText('Замените набор символов');
  await page.getByRole('textbox', { name: 'Данные', exact: true }).fill('История обращений');
  await expect(page.locator('.rating-heading > div > strong')).toHaveText(/40\s*\/\s*100/);
  await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить карточку', exact: true }).click();
  await page.getByRole('button', { name: /1\. Описание/ }).click();
  await expect(page.getByLabel('Что вы хотите решить?')).toHaveValue('Исходное описание');
  await page.getByLabel('Что вы хотите решить?').fill('Исправленное описание');
  await page.getByRole('button', { name: /2\. Вопросы/ }).click();
  await expect(page.locator('.question textarea').first()).toHaveValue('Исходная потребность');
  await page.locator('.question textarea').first().fill('Исправленная потребность');
  await page.getByRole('button', { name: /Обновить карточку/ }).click();
  await expect(page.getByRole('textbox', { name: 'Контекст', exact: true })).toHaveValue('Исправленное описание');
  await expect(page.getByRole('textbox', { name: 'Потребность бизнеса', exact: true })).toHaveValue('Исправленная потребность');
  await expect(page.getByLabel('Название', { exact: false })).toHaveValue('Проверка пошагового редактора');
  await expect(page.getByRole('textbox', { name: 'Данные', exact: true })).toHaveValue('История обращений');
  await expect(page.getByRole('button', { name: 'Опубликовать →', exact: true })).toBeDisabled();
  const list = await (await page.request.get('/api/task-builder/tasks')).json();
  expect(list.items).toHaveLength(1); expect(list.items[0].id).toBe(task.id);
  await page.getByRole('button', { name: 'Подтвердить карточку', exact: true }).click();
  await page.getByRole('button', { name: 'Опубликовать →', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть каталог', exact: true }).click();
  const published = page.locator('.task-card').filter({ hasText: 'Проверка пошагового редактора' });
  await expect(published.locator('.score strong')).toHaveText('40');
  const scores = await page.locator('.task-card .score strong').allTextContents();
  expect(scores.map(Number)).toEqual(scores.map(Number).sort((a, b) => b - a));
});

test('registration requires a role and profile changes survive login', async ({ page }) => {
  const email = `ui-${Date.now()}@example.test`;
  await page.goto('/#register');
  await page.getByLabel('Ваше имя', { exact: true }).fill('Участник интерфейса');
  await page.getByLabel('Электронная почта', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: false }).fill(password);
  await expect(page.getByRole('button', { name: 'Зарегистрироваться', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Ваша роль', exact: true }).selectOption('team');
  await page.getByLabel('Название команды', { exact: false }).fill('Команда интерфейса');
  await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ваш профиль', exact: true })).toBeVisible();
  await page.getByLabel('Навыки', { exact: false }).fill('Аналитика, Исследование');
  await page.getByLabel('Интересы', { exact: false }).fill('Образование');
  await page.getByLabel('Технологии', { exact: true }).fill('Python');
  await page.getByLabel('Открыт для новых проектов', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Сохранить профиль', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Профиль обновлён.');
  await page.getByRole('button', { name: 'Выйти из аккаунта', exact: true }).click();
  await expect(page).toHaveURL(/#home$/);
  await page.goto('/#login');
  await page.getByLabel('Электронная почта', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.locator('.auth-card').getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ваш профиль', exact: true })).toBeVisible();
  await expect(page.getByLabel('Навыки', { exact: false })).toHaveValue('Аналитика, Исследование');
  await expect(page.getByLabel('Открыт для новых проектов', { exact: true })).not.toBeChecked();
  await page.getByRole('link', { name: 'Конструктор', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Конструктор для бизнеса', exact: true })).toBeVisible();
});

test('home introduces the app, exposes real contacts and opens both workflows', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Задачи бизнеса\.\s*Решения команд\./ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Главная', exact: true }).first()).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: /Связаться с нами/ }).click();
  await expect(page.locator('#contacts')).toBeFocused();
  await expect(page.locator('.home-contact-card')).toHaveCount(3);
  for (const link of await page.locator('.home-contact-card a').all()) {
    expect(await link.getAttribute('href')).toMatch(/^(https:\/\/t\.me\/[a-zA-Z0-9_]+|mailto:[^\s@]+@[^\s@]+\.[^\s@]+)$/);
  }
  await page.getByRole('button', { name: 'Найти задачу', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Каталог задач', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Главная', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть конструктор', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Конструктор для бизнеса', exact: true })).toBeVisible();
});
