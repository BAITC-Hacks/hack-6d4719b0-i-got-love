import { useEffect, useState } from "react";

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

const fieldLabels: Record<string, string> = {
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

export function Catalog({ onRespond }: { onRespond?: (taskId: number) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [sort, setSort] = useState("score_desc");
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/catalog")
      .then((response) => {
        if (!response.ok) throw new Error("Не удалось загрузить темы");
        return response.json() as Promise<CatalogResponse>;
      })
      .then((data) => setTopics([...new Set(data.items.map((item) => item.topic))].sort()))
      .catch(() => setError("Не удалось загрузить каталог"));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ sort });
    if (topic) params.set("topic", topic);
    if (level) params.set("level", level);
    setLoading(true);
    setError("");
    fetch(`/api/catalog?${params}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Не удалось загрузить задачи");
        return response.json() as Promise<CatalogResponse>;
      })
      .then((data) => setTasks(data.items))
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setError("Не удалось загрузить каталог");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [sort, topic, level]);

  return (
    <main className="catalog">
      <header className="catalog-header">
        <p className="eyebrow">Задачи для команд</p>
        <h1>Каталог задач</h1>
        <p>Все опубликованные задачи видны независимо от рейтинга.</p>
      </header>

      <section className="filters" aria-label="Фильтры каталога">
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

      {error && <p className="message" role="alert">{error}</p>}
      {loading ? <p className="message">Загрузка…</p> : (
        <>
          <p className="count">Найдено задач: {tasks.length}</p>
          {tasks.length === 0 && <p className="message">По этим фильтрам задач нет.</p>}
          <div className="task-grid">
            {tasks.map((task) => (
              <article className="task-card" key={task.id}>
                <div className="task-topline">
                  <span className="topic">{task.topic || "Без темы"}</span>
                  <span className={`level level-${task.level}`}>{levelLabels[task.level]}</span>
                </div>
                <h2>{task.title || "Без названия"}</h2>
                <p className="task-summary">{task.need || task.context || "Описание пока не заполнено."}</p>
                <div className="score"><strong>{task.score}</strong><span> / 100 баллов</span></div>
                <details>
                  <summary>Почему такой рейтинг</summary>
                  <ul className="breakdown">
                    {Object.entries(task.score_breakdown).map(([key, value]) => (
                      <li key={key}><span>{criterionLabels[key] || key}</span><span>{value.earned}/{value.max}</span></li>
                    ))}
                  </ul>
                  <p className="missing">
                    {task.missing_fields.length
                      ? `Не хватает: ${task.missing_fields.map((field) => fieldLabels[field] || field).join(", ")}.`
                      : "Все сведения заполнены."}
                  </p>
                </details>
                {onRespond && <button type="button" onClick={() => onRespond(task.id)}>Откликнуться</button>}
              </article>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
