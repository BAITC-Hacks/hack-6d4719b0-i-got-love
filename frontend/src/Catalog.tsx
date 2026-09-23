import { useEffect, useState } from "react";
import "./styles.css";

type Level = "draft" | "working" | "ready" | "priority";
type Breakdown = Record<string, { earned: number; max: number }>;

type Task = {
  id: number;
  title: string;
  topic: string;
  context: string;
  need: string;
  users: string;
  data: string;
  constraints: string;
  expected_result: string;
  success_criteria: string;
  contact: string;
  interaction_format: string;
  score: number;
  level: Level;
  score_breakdown: Breakdown;
  missing_fields: string[];
};

type CatalogResponse = { items: Task[]; total: number };

const levelLabels: Record<Level, string> = {
  draft: "Черновик",
  working: "Рабочая",
  ready: "Готовая",
  priority: "Приоритетная",
};

const fieldLabels = {
  context: "контекст",
  need: "потребность",
  data: "данные",
  expected_result: "ожидаемый результат",
  success_criteria: "критерии успеха",
  constraints: "ограничения",
  users: "пользователи",
  contact: "контакт бизнеса",
  interaction_format: "формат взаимодействия",
};

const criterionLabels: Record<string, string> = {
  context_and_need: "Контекст и потребность",
  data: "Данные",
  expected_result: "Результат",
  success_criteria: "Критерии успеха",
  constraints: "Ограничения",
  users: "Пользователи",
  business_contact: "Связь с бизнесом",
};

type CatalogProps = {
  onRespond?: (taskId: number) => void;
  onEdit?: (taskId: number) => void;
};

export function Catalog({ onRespond, onEdit }: CatalogProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [search, setSearch] = useState("");
  const [retry, setRetry] = useState(0);
  const [sort, setSort] = useState("score_desc");
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch("/api/catalog", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Не удалось загрузить задачи");
        return response.json() as Promise<CatalogResponse>;
      })
      .then((data) => {
        if (!controller.signal.aborted) setTasks(data.items);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("Не удалось загрузить каталог. Проверьте соединение и попробуйте ещё раз.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [retry]);

  const topics = [...new Set(tasks.map((task) => task.topic).filter(Boolean))].sort();
  const query = search.trim().toLocaleLowerCase("ru");
  const visibleTasks = tasks
    .filter((task) => (!topic || task.topic === topic) && (!level || task.level === level))
    .filter((task) => !query || [task.title, task.topic, task.context, task.need, task.users, task.expected_result]
      .some((value) => value.toLocaleLowerCase("ru").includes(query)))
    .sort((left, right) => (sort === "score_asc" ? left.score - right.score : right.score - left.score) || left.id - right.id);
  const hasFilters = Boolean(query || topic || level);

  function resetFilters() {
    setSearch("");
    setTopic("");
    setLevel("");
  }

  return (
    <section className="catalog">
      <header className="catalog-header">
        <p className="eyebrow">Задачи для команд</p>
        <h1>Каталог задач</h1>
        <p>Все опубликованные задачи видны независимо от рейтинга.</p>
      </header>

      <section className="filters" aria-label="Фильтры каталога">
        <label className="catalog-search">
          Поиск задачи
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название, потребность или тема" />
        </label>
        <label>
          Сортировка
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="score_desc">Сначала высокий рейтинг</option>
            <option value="score_asc">Сначала низкий рейтинг</option>
          </select>
        </label>
        <label>
          Тема
          <select value={topic} onChange={(event) => setTopic(event.target.value)}>
            <option value="">Все темы</option>
            {topics.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          Уровень
          <select value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="">Все уровни</option>
            {(Object.keys(levelLabels) as Level[]).map((value) => (
              <option key={value} value={value}>{levelLabels[value]}</option>
            ))}
          </select>
        </label>
      </section>

      {loading ? <p className="message" role="status">Загрузка задач…</p> : error ? (
        <div className="message catalog-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>Повторить загрузку</button>
        </div>
      ) : (
        <>
          <div className="catalog-results">
            <p className="count" role="status">Найдено задач: {visibleTasks.length}</p>
            {hasFilters && <button type="button" className="catalog-secondary" onClick={resetFilters}>Сбросить фильтры</button>}
          </div>
          {visibleTasks.length === 0 && (
            <div className="message catalog-empty">
              <h2>{hasFilters ? "Ничего не найдено" : "Пока нет опубликованных задач"}</h2>
              <p>{hasFilters ? "Измените поисковый запрос или сбросьте фильтры." : "Подтвердите и опубликуйте первую задачу в конструкторе."}</p>
            </div>
          )}
          <div className="task-grid">
            {visibleTasks.map((task) => (
              <article className="task-card" key={task.id}>
                <div className="task-topline">
                  <span className="topic">{task.topic || "Без темы"}</span>
                  <span className={`level level-${task.level}`}>{levelLabels[task.level]}</span>
                </div>
                <h2>{task.title || "Без названия"}</h2>
                <p className="catalog-task-summary">{task.need || task.context || "Описание пока не заполнено."}</p>
                <div className="score"><strong>{task.score}</strong><span> / 100 баллов готовности</span></div>
                <details className="catalog-task-details">
                  <summary>Полная карточка задачи</summary>
                  <dl>
                    {(Object.keys(fieldLabels) as (keyof typeof fieldLabels)[]).map((field) => (
                      <div key={field}>
                        <dt>{fieldLabels[field]}</dt>
                        <dd>{task[field] || "Пока не указано"}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
                <details>
                  <summary>Почему такой рейтинг</summary>
                  <ul className="breakdown">
                    {Object.entries(task.score_breakdown).map(([key, value]) => (
                      <li key={key}><span>{criterionLabels[key] || key}</span><span>{value.earned}/{value.max}</span></li>
                    ))}
                  </ul>
                  <p className="missing">
                    {task.missing_fields.length
                      ? `Не хватает: ${task.missing_fields.map((field) => fieldLabels[field as keyof typeof fieldLabels] || field).join(", ")}.`
                      : "Все сведения заполнены."}
                  </p>
                </details>
                {(onRespond || onEdit) && (
                  <div className="catalog-card-actions">
                    {onRespond && <button type="button" onClick={() => onRespond(task.id)}>Откликнуться</button>}
                    {onEdit && <button type="button" className="catalog-secondary" onClick={() => onEdit(task.id)}>Редактировать</button>}
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
