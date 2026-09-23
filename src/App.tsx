import { useEffect, useState } from "react";
import type { NewProposal, Proposal, ProposalDecision, Team } from "./data/teamProposals";
import BuilderScreen from "./screens/BuilderScreen";
import CatalogScreen from "./screens/CatalogScreen";
import ProposalsScreen from "./screens/ProposalsScreen";
import TeamsScreen from "./screens/TeamsScreen";
import Icon from "./components/Icon";

export type ScreenKey = "builder" | "catalog" | "teams" | "proposals";
const navigation: { key: ScreenKey; label: string }[] = [
  { key: "builder", label: "Конструктор" },
  { key: "catalog", label: "Каталог задач" },
  { key: "teams", label: "Команды" },
  { key: "proposals", label: "Отклики" },
];
type TaskSummary = { id: number; title: string };

function readRoute(): { screen: ScreenKey; taskId?: number } {
  const [screen, query = ""] = window.location.hash.slice(1).split("?");
  const taskId = Number(new URLSearchParams(query).get("task"));
  return {
    screen: navigation.some((item) => item.key === screen) ? screen as ScreenKey : "catalog",
    taskId: Number.isSafeInteger(taskId) && taskId > 0 ? taskId : undefined,
  };
}

async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof result?.detail === "string" ? result.detail : `Ошибка сервера: ${response.status}`);
  return result as T;
}
const message = (error: unknown) => error instanceof TypeError ? "Не удалось связаться с сервером. Проверьте подключение." : error instanceof Error ? error.message : "Не удалось выполнить запрос";

function ProposalWorkspace({ task, teams, onRefreshTeams }: { task: TaskSummary; teams: Team[]; onRefreshTeams: () => void }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [busyId, setBusyId] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<Proposal[]>(`/api/proposals?task_id=${task.id}`, { signal: controller.signal })
      .then(setProposals)
      .catch((error) => { if (!controller.signal.aborted) setError(message(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [task.id, version]);

  async function add(proposal: NewProposal) {
    setError("");
    try {
      const created = await api<Proposal>("/api/proposals", { method: "POST", body: proposal });
      setProposals((current) => [created, ...current]);
    } catch (error) { setError(message(error)); throw error; }
  }
  async function update(id: number, decision?: Exclude<ProposalDecision, "pending">) {
    if (busyId !== null) return;
    setBusyId(id);
    setError("");
    try {
      const updated = await api<Proposal>(`/api/proposals/${id}/${decision ? "decision" : "progress"}`, {
        method: decision ? "PATCH" : "POST", body: decision ? { decision } : undefined,
      });
      setProposals((current) => current.map((item) => item.id === id ? updated : item));
      if (!decision) onRefreshTeams();
    } catch (error) { setError(message(error)); }
    finally { setBusyId(null); }
  }
  return <>
    {error && <div className="app-error" role="alert">{error}<button type="button" onClick={() => setVersion((value) => value + 1)}>Обновить отклики</button></div>}
    {loading ? <p role="status">Загрузка откликов…</p> : <ProposalsScreen
      teams={teams} proposals={proposals} taskId={task.id} taskTitle={task.title || `Задача #${task.id}`}
      busy={busyId !== null} onAddProposal={add} onDecideProposal={update} onConfirmProgress={(id) => void update(id)}
    />}
  </>;
}

export default function App() {
  const [route, setRoute] = useState(readRoute);
  const [teams, setTeams] = useState<Team[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [teamVersion, setTeamVersion] = useState(0);
  const [teamError, setTeamError] = useState("");
  const [teamsLoading, setTeamsLoading] = useState(true);
  const { screen, taskId } = route;
  const selectedTask = tasks.find((task) => task.id === taskId) ?? (!taskId ? tasks[0] : undefined);

  useEffect(() => {
    const change = () => { setRoute(readRoute()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<{ items: TaskSummary[] }>("/api/catalog", { signal: controller.signal })
      .then((result) => setTasks(result.items))
      .catch((error) => { if (!controller.signal.aborted) setError(message(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [version, screen]);

  useEffect(() => {
    const controller = new AbortController();
    setTeamError("");
    api<Team[]>("/api/teams", { signal: controller.signal })
      .then(setTeams)
      .catch((error) => { if (!controller.signal.aborted) setTeamError(message(error)); })
      .finally(() => { if (!controller.signal.aborted) setTeamsLoading(false); });
    return () => controller.abort();
  }, [teamVersion, screen]);

  function navigate(next: ScreenKey, id?: number) {
    window.location.hash = id ? `${next}?task=${id}` : next;
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById("main-content")?.focus(); }}>К содержимому</a>
    <aside className="sidebar">
      <a className="brand" href="#catalog"><span className="brand-mark">L</span><span><strong>lovelab</strong><small>проектная платформа</small></span></a>
      <div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <nav aria-label="Главная навигация" className="main-nav">
        {navigation.map((item) => <a key={item.key} href={`#${item.key}`} aria-label={item.label} title={item.label}
          aria-current={screen === item.key ? "page" : undefined} className={`nav-link${screen === item.key ? " is-active" : ""}`}>
          <span className="nav-symbol"><Icon name={item.key} /></span><span className="nav-label">{item.label}</span>
        </a>)}
      </nav>
      <div className="sidebar-story"><span className="sidebar-story-icon"><Icon name="builder" size={27} /></span><strong>Из задачи —<br />в результат.</strong><p>Превратите потребность бизнеса в следующий проект команды.</p><a href="#builder">В конструктор <Icon name="arrow" size={17} /></a></div>
      <div className="sidebar-bottom"><div className="profile-avatar">Б</div><div className="profile-copy"><strong>Открытое пространство</strong><span>Бизнес + команды</span></div></div>
    </aside>
    <div className="main-column">
      <header className="topbar"><a className="mobile-brand" href="#catalog">lovelab<span>✳</span></a><div className="breadcrumbs"><span>Ваше пространство</span><span aria-hidden="true">/</span><strong>{navigation.find((item) => item.key === screen)?.label}</strong></div>
        <div className="topbar-actions"><span className="demo-badge"><span /> Открыто для идей</span><div aria-label="Демо-профиль" className="top-avatar">Б</div></div>
      </header>
      <main id="main-content" tabIndex={-1} className="page-content">
        {screen === "builder" && <BuilderScreen initialTaskId={taskId} onOpenCatalog={() => navigate("catalog")}
          onRespond={(id) => navigate("proposals", id)} onTaskChange={(id) => navigate("builder", id)} onPublished={() => setVersion((value) => value + 1)} />}
        {screen === "catalog" && <CatalogScreen onCreate={() => navigate("builder")} onRespond={(id) => navigate("proposals", id)} onEdit={(id) => navigate("builder", id)} />}
        {(screen === "teams" || screen === "proposals") && teamError && <div className="app-error" role="alert">{teamError}<button onClick={() => setTeamVersion((value) => value + 1)}>Повторить загрузку команд</button></div>}
        {screen === "teams" && (teamsLoading ? <p role="status">Загрузка команд…</p> : !teamError && <TeamsScreen teams={teams} />)}
        {screen === "proposals" && <>
          {error && <div className="app-error" role="alert">{error}<button onClick={() => setVersion((value) => value + 1)}>Повторить</button></div>}
          {loading || teamsLoading ? <p role="status">Загрузка задач и команд…</p> : !error && !teamError && <>
            {tasks.length > 0 && <label className="task-picker">Задача для откликов
              <select value={selectedTask?.id ?? ""} onChange={(event) => navigate("proposals", Number(event.target.value))}>
                {!selectedTask && <option value="" disabled>Выберите опубликованную задачу</option>}
                {tasks.map((task) => <option key={task.id} value={task.id}>{task.title || `Задача #${task.id}`}</option>)}
              </select>
            </label>}
            {selectedTask ? <ProposalWorkspace key={selectedTask.id} task={selectedTask} teams={teams} onRefreshTeams={() => setTeamVersion((value) => value + 1)} />
              : <div className="empty-state"><h1>{taskId ? "Задача недоступна" : "Пока нет опубликованных задач"}</h1><p>{taskId ? "Выберите другую задачу в каталоге." : "Создайте и опубликуйте первую задачу в конструкторе."}</p><button className="button button--primary" onClick={() => navigate(taskId ? "catalog" : "builder")}>{taskId ? "Открыть каталог" : "Создать задачу"}</button></div>}
          </>}
        </>}
      </main>
    </div>
  </div>;
}
