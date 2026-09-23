import { useEffect, useState } from "react";
import "./styles.css";

type Level = "draft" | "working" | "ready" | "priority";
type Breakdown = Record<string, { earned: number; max: number }>;

type Task = {
  owner_user_id?: number | null;
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
export type RecommendationProfile = { interests: string[]; skills: string[]; technologies: string[] };

function recommendation(task: Task, profile?: RecommendationProfile) {
  if (!profile) return { score: 0, reasons: [] as string[] };
  const text = [task.title, task.topic, task.context, task.need, task.expected_result, task.data].join(" ").toLocaleLowerCase("ru");
  const reasons: string[] = [];
  let score = 0;
  for (const [values, weight] of [[profile.interests, 3], [profile.skills, 2], [profile.technologies, 1]] as const) {
    for (const value of values) {
      const term = value.trim().toLocaleLowerCase("ru");
      if (term.length >= 2 && text.includes(term) && !reasons.includes(value)) { reasons.push(value); score += weight; }
    }
  }
  return { score, reasons };
}

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

function TopicIcon({ topic = "" }: { topic?: string }) {
  const key = topic.toLowerCase();
  let drawing;
  if (/education|образован/.test(key)) {
    drawing = <><path d="m3 9 9-5 9 5-9 5-9-5Z" /><path d="M6 11v6c4 3 8 3 12 0v-6M21 9v7" /></>;
  } else if (/health|медицин|здоров/.test(key)) {
    drawing = <><path d="M12 20S3 14.5 3 8.8A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 9 2.8C21 14.5 12 20 12 20Z" /><path d="M8 12h3l1-3 2 6 1-3h3" /></>;
  } else if (/logistic|логист/.test(key)) {
    drawing = <><path d="M3 5h11v12H3zM14 9h4l3 4v4h-7" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></>;
  } else if (/community|сообще/.test(key)) {
    drawing = <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2" /></>;
  } else if (/service|сервис|услуг/.test(key)) {
    drawing = <><rect x="4" y="5" width="16" height="12" rx="3" /><path d="M8 21h8M12 17v4m-4-10 3 3 5-5" /></>;
  } else {
    drawing = <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>;
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{drawing}</svg>;
}

type CatalogProps = {
  onRespond?: (taskId: number) => void;
  onCreate?: () => void;
  currentUserId?: number;
  recommendationProfile?: RecommendationProfile;
  onEdit?: (taskId: number) => void;
};

export function Catalog({ onRespond, onEdit, onCreate, currentUserId, recommendationProfile }: CatalogProps) {
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
    .sort((left, right) => (sort === "recommended" ? recommendation(right, recommendationProfile).score - recommendation(left, recommendationProfile).score : 0) || (sort === "score_asc" ? left.score - right.score : right.score - left.score) || left.id - right.id);
  const hasFilters = Boolean(query || topic || level);

  function resetFilters() {
    setSearch("");
    setTopic("");
    setLevel("");
  }

  return (
    <section className="catalog">
      <header className="catalog-header">
        <div className="catalog-intro">
          <p className="eyebrow"><span aria-hidden="true" /> Задачи для команд</p>
          <div className="catalog-title-row"><h1>Каталог задач</h1>{!loading && !error && <span className="catalog-total">Опубликовано: {tasks.length}</span>}</div>
          <p className="catalog-description">Выберите задачу бизнеса и предложите решение своей командой.</p>
        </div>
        {onCreate && <button type="button" className="catalog-create" onClick={onCreate}>Открыть конструктор</button>}
      </header>

      {!loading && !error && topics.length > 0 && (
        <section className="catalog-directions" aria-label="Направления задач">
          <div className="catalog-section-title"><h2>Найдите своё направление</h2><span>{topics.length} направлений</span></div>
          <div className="catalog-topic-tiles">
            <button type="button" className={`catalog-topic-tile${!topic ? " is-active" : ""}`} aria-pressed={!topic} onClick={() => setTopic("")}>
              <span className="catalog-topic-icon"><TopicIcon /></span>
              <span className="catalog-topic-name">Все темы</span><span className="catalog-topic-count">{tasks.length}</span>
            </button>
            {topics.map((value, index) => (
              <button type="button" key={value} className={`catalog-topic-tile catalog-tone-${index % 4}${topic === value ? " is-active" : ""}`} aria-pressed={topic === value} onClick={() => setTopic(value)}>
                <span className="catalog-topic-icon"><TopicIcon topic={value} /></span>
                <span className="catalog-topic-name">{value}</span><span className="catalog-topic-count">{tasks.filter((task) => task.topic === value).length}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="filters" aria-label="Фильтры каталога">
        <label className="catalog-search">
          Поиск задачи
          <span className="catalog-search-input"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название, потребность или тема" /></span>
        </label>
        <label>
          Сортировка
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="score_desc">Сначала высокий рейтинг</option>
            {recommendationProfile && <option value="recommended">Подходящие моей команде</option>}
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
      {sort === "recommended" && recommendationProfile && <p className="catalog-recommendation-info">Подбор по совпадениям с интересами, навыками и технологиями вашей команды. {Object.values(recommendationProfile).every(values => values.length === 0) ? "Заполните профиль, чтобы получить рекомендации. Пока задачи отсортированы по рейтингу." : "При равном совпадении выше задачи с большим рейтингом. Вы сами решаете, куда откликнуться."}</p>}

      {loading ? <p className="message" role="status">Загрузка задач…</p> : error ? (
        <div className="message catalog-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>Повторить загрузку</button>
        </div>
      ) : (
        <>
          <div className="catalog-results">
            <div><p className="count" role="status">Найдено задач: <strong>{visibleTasks.length}</strong></p><p className="catalog-access-note">Все опубликованные задачи видны независимо от рейтинга.</p></div>
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
                  <div className="catalog-task-category"><span className="catalog-task-icon"><TopicIcon topic={task.topic} /></span><div><span className="topic">{task.topic || "Без темы"}</span><span className="catalog-task-id">Задача #{String(task.id).padStart(3, "0")}</span></div></div>
                  <span className={`level level-${task.level}`}>{levelLabels[task.level]}</span>
                </div>
                <h2>{task.title || "Без названия"}</h2>
                <p className="catalog-task-summary">{task.need || task.context || "Описание пока не заполнено."}</p>
                {sort === "recommended" && recommendation(task, recommendationProfile).reasons.length > 0 && <p className="catalog-match">Подходит по профилю: {recommendation(task, recommendationProfile).reasons.join(", ")}</p>}
                <div className="catalog-readiness">
                  <div className="score"><span>Готовность задачи</span><div><strong>{task.score}</strong><span> / 100</span></div></div>
                  <progress value={task.score} max={100} aria-label={`Готовность задачи: ${task.score} из 100`} />
                  <span className="catalog-readiness-note">{task.missing_fields.length ? `Полей для уточнения: ${task.missing_fields.length}` : "Все детали на месте — можно начинать"}</span>
                </div>
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
                      <li key={key}><span>{criterionLabels[key] || "Другой критерий"}</span><span>{value.earned}/{value.max}</span></li>
                    ))}
                  </ul>
                  <p className="missing">
                    {task.missing_fields.length
                      ? `Не хватает: ${task.missing_fields.map((field) => fieldLabels[field as keyof typeof fieldLabels] || "дополнительные сведения").join(", ")}.`
                      : "Все сведения заполнены."}
                  </p>
                </details>
                {(onRespond || onEdit) && (
                  <div className="catalog-card-actions">
                    {onRespond && <button type="button" onClick={() => onRespond(task.id)}>Откликнуться <span aria-hidden="true">↗</span></button>}
                    {onEdit && currentUserId !== undefined && task.owner_user_id === currentUserId && <button type="button" className="catalog-secondary" onClick={() => onEdit(task.id)}>Редактировать</button>}
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
