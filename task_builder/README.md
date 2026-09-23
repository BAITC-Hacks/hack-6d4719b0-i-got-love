# Конструктор бизнес-задачи

Автономный модуль до интеграции с общей схемой. Требуются Python 3.10+, Node.js и npm.

```sh
python3 -m venv task_builder/.venv
task_builder/.venv/bin/pip install -r task_builder/requirements.txt
task_builder/.venv/bin/uvicorn task_builder.server:app --reload
```

В другом терминале:

```sh
cd task_builder/frontend
npm install
npm run dev
```

Откройте адрес Vite из терминала (обычно `http://localhost:5173`). Для проверки:

```sh
task_builder/.venv/bin/python -m unittest task_builder.test_server
cd task_builder/frontend && npm run build
```

Сценарий: введите слабое описание, ответьте на вопросы, дополните карточку (название обязательно для подтверждения), сохраните изменения, подтвердите и опубликуйте. Изменение черновика снимает подтверждение. Пустые поля не выдумываются; `context` содержит описание дословно, ответы переносятся дословно в указанные поля. `score` остаётся 0 до подключения расчёта рейтинга из модуля каталога.

## AI и локальный режим

При наличии `AI_API_URL`, `AI_API_KEY`, `AI_MODEL` сервер вызывает совместимый с Chat Completions API. Ключ хранится только в переменной окружения сервера; браузер вызывает только `/api/task-builder/questions`. Серверный промпт: `QUESTION_PROMPT` в `server.py`; вход — свободное описание в пользовательском сообщении, выход — JSON `{"questions":[{"field":"need","text":"..."}]}` с 3–5 различными допустимыми полями. Ответ проверяется по структуре и типам. При отсутствии API, сетевой ошибке или некорректном ответе сервер возвращает 5 локальных вопросов и предупреждение для экрана.

## Контракт для интеграции

Модульные маршруты:

- `POST /api/task-builder/questions` — `{description}` → `{questions, source, warning}`.
- `POST /api/task-builder/drafts` — `{description, answers: {field: text}}` → `Task`.
- `GET /api/task-builder/tasks/{id}` — `Task`.
- `PUT /api/task-builder/tasks/{id}` — все текстовые поля `Task` → `Task`; снимает подтверждение.
- `POST /api/task-builder/tasks/{id}/confirm` — фиксирует подтверждение.
- `POST /api/task-builder/tasks/{id}/publish` — публикует только подтверждённую карточку.

`Task` содержит поля из `TEAM_PLAN.md`: `id`, `title`, `topic`, `context`, `need`, `users`, `data`, `constraints`, `expected_result`, `success_criteria`, `contact`, `interaction_format`, `status`, `score`. В API конструктора есть служебное `confirmed_at` для контроля подтверждения. Если доступен согласованный `backend.db`, задачи сохраняются через его `init_db`/`connect` в общей БД (`APP_DB_PATH`). При отдельном запуске используется `task_builder/tasks.db`; `TASK_BUILDER_DB_PATH` принудительно выбирает этот путь для локальной проверки. При интеграции остаётся подключить вызов пересчёта рейтинга после подтверждения. Схема, рейтинг, каталог и общая навигация принадлежат другим участникам.
