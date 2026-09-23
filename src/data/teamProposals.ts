export type ProposalDecision = "pending" | "selected" | "rejected";

export interface Team {
  id: number;
  name: string;
  interests: string[];
  skills: string[];
  technologies: string[];
  points: number;
}

export interface Proposal {
  id: number;
  task_id: number;
  team_id: number;
  idea: string;
  plan: string;
  duration: string;
  prototype_url: string;
  decision: ProposalDecision;
  progress_confirmed: boolean;
}

export interface DemoState {
  teams: Team[];
  proposals: Proposal[];
}

export const PROGRESS_POINTS = 10;
export const DEMO_TASK_ID = 7;
export const DEMO_TASK_TITLE = "Сократить время ответов службы поддержки";

export const INITIAL_TEAMS: Team[] = [
  {
    id: 1,
    name: "Pixel Lab",
    interests: ["E-commerce", "Пользовательский опыт", "Сервисы"],
    skills: ["UX/UI-дизайн", "Исследования", "Прототипирование"],
    technologies: ["Figma", "Webflow"],
    points: 0,
  },
  {
    id: 2,
    name: "Data Pulse",
    interests: ["Аналитика", "E-commerce", "Персонализация"],
    skills: ["Анализ данных", "Метрики", "Сегментация"],
    technologies: ["Python", "SQL", "Metabase"],
    points: 0,
  },
  {
    id: 3,
    name: "Green Stack",
    interests: ["Устойчивое развитие", "Логистика", "Маркетплейсы"],
    skills: ["Сервис-дизайн", "Логистика", "Исследование процессов"],
    technologies: ["React", "Node.js", "PostgreSQL"],
    points: 0,
  },
  {
    id: 4,
    name: "Craft Code",
    interests: ["Мобильные сервисы", "Автоматизация", "Малый бизнес"],
    skills: ["Frontend-разработка", "Интеграции", "Быстрое прототипирование"],
    technologies: ["TypeScript", "React", "Vite"],
    points: 0,
  },
  {
    id: 5,
    name: "Market Makers",
    interests: ["Рост продаж", "Лояльность", "Контент"],
    skills: ["Маркетинговая стратегия", "Копирайтинг", "A/B-тестирование"],
    technologies: ["Figma", "Google Analytics", "Notion"],
    points: 0,
  },
];

export const INITIAL_PROPOSALS: Proposal[] = [
  {
    id: 1,
    task_id: DEMO_TASK_ID,
    team_id: 1,
    idea: "Собрать понятный сценарий повторного заказа с персональными рекомендациями и заметной историей покупок.",
    plan: "Проведём короткие интервью, соберём карту пути клиента и проверим кликабельный прототип на пяти пользователях.",
    duration: "2 недели",
    prototype_url: "https://example.com/prototypes/pixel-lab",
    decision: "pending",
    progress_confirmed: false,
  },
  {
    id: 2,
    task_id: DEMO_TASK_ID,
    team_id: 2,
    idea: "Найти этапы, где клиенты чаще всего прекращают повторную покупку, и предложить точечные подсказки.",
    plan: "Опишем события аналитики, проверим доступные данные и подготовим макет персонализированного блока.",
    duration: "10 рабочих дней",
    prototype_url: "https://example.com/prototypes/data-pulse",
    decision: "pending",
    progress_confirmed: false,
  },
  {
    id: 3,
    task_id: DEMO_TASK_ID,
    team_id: 3,
    idea: "Сделать повторный заказ короче: сохранить прошлую корзину и заранее показать доступные варианты доставки.",
    plan: "Разберём путь заказа, нарисуем два варианта сценария и соберём прототип экрана повторной покупки.",
    duration: "3 недели",
    prototype_url: "https://example.com/prototypes/green-stack",
    decision: "pending",
    progress_confirmed: false,
  },
  {
    id: 4,
    task_id: DEMO_TASK_ID,
    team_id: 4,
    idea: "Добавить быстрый повтор заказа с редактированием количества и заменой отсутствующих товаров.",
    plan: "Сверим ограничения каталога и доставки, подготовим интерактивный прототип мобильного сценария.",
    duration: "12 дней",
    prototype_url: "https://example.com/prototypes/craft-code",
    decision: "pending",
    progress_confirmed: false,
  },
  {
    id: 5,
    task_id: DEMO_TASK_ID,
    team_id: 5,
    idea: "Поддержать возврат клиентов личным списком избранного и полезными напоминаниями о повторной покупке.",
    plan: "Составим карту сообщений, проверим частоту контакта и соберём прототип персонального кабинета.",
    duration: "2,5 недели",
    prototype_url: "https://example.com/prototypes/market-makers",
    decision: "pending",
    progress_confirmed: false,
  },
];

export const INITIAL_DEMO_STATE: DemoState = {
  teams: INITIAL_TEAMS,
  proposals: INITIAL_PROPOSALS,
};
