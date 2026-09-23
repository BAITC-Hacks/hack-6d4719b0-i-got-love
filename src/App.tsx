import { useEffect, useState } from "react";
import type { NewProposal, Proposal, ProposalDecision, Team } from "./data/teamProposals";
import BuilderScreen from "./screens/BuilderScreen";
import CatalogScreen from "./screens/CatalogScreen";
import ProposalsScreen from "./screens/ProposalsScreen";
import TeamsScreen from "./screens/TeamsScreen";
import HomeScreen from "./screens/HomeScreen";
import Icon from "./components/Icon";
import TaskPicker from "./components/TaskPicker";
import AuthScreen from "./screens/AuthScreen";
import ProfileScreen from "./screens/ProfileScreen";
import { initials, roleName, type AuthInput, type AuthUser, type ProfileInput } from "./data/auth";
import "./auth.css";

export type ScreenKey = "home" | "builder" | "catalog" | "teams" | "proposals" | "login" | "register" | "profile";
const navigation: { key: Exclude<ScreenKey, "login" | "register" | "profile">; label: string }[] = [
  { key: "home", label: "Главная" },
  { key: "builder", label: "Конструктор" },
  { key: "catalog", label: "Каталог задач" },
  { key: "teams", label: "Команды" },
  { key: "proposals", label: "Отклики" },
];
type TaskSummary = { id: number; title: string; owner_user_id?: number | null };

function readRoute(): { screen: ScreenKey; taskId?: number; builderList: boolean } {
  const [screen, query = ""] = window.location.hash.slice(1).split("?");
  const taskId = Number(new URLSearchParams(query).get("task"));
  return {
    screen: [...navigation.map(item => item.key), "login", "register", "profile"].includes(screen) ? screen as ScreenKey : "home",
    builderList: new URLSearchParams(query).get("view") === "list",
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

function ProposalWorkspace({ task, teams, user, onLogin, onRefreshTeams }: { task: TaskSummary; teams: Team[]; user: AuthUser | null; onLogin: () => void; onRefreshTeams: () => void }) {
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
    if (user?.role !== "team" || proposal.team_id !== user.team_id) throw new Error("Отклик может отправить только участник своей команды.");
    setError("");
    try {
      const created = await api<Proposal>("/api/proposals", { method: "POST", body: proposal });
      setProposals((current) => [created, ...current]);
    } catch (error) { setError(message(error)); throw error; }
  }
  async function update(id: number, decision?: Exclude<ProposalDecision, "pending">) {
    if (busyId !== null || user?.role !== "business" || task.owner_user_id !== user.id) return;
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
    {loading && <p role="status">Загрузка откликов…</p>}
    <ProposalsScreen
      teams={teams} proposals={proposals} taskId={task.id} taskTitle={task.title || `Задача #${task.id}`}
      canManage={user?.role === "business" && task.owner_user_id === user.id} canSubmit={user?.role === "team" && Boolean(user.team_id)} allowedTeamId={user?.team_id ?? undefined} onLogin={!user ? onLogin : undefined}
      busy={busyId !== null || loading} onAddProposal={add} onDecideProposal={update} onConfirmProgress={(id) => void update(id)}
    />
  </>;
}

export default function App() {
  const [route, setRoute] = useState(readRoute);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [authVersion, setAuthVersion] = useState(0);
  const [authReturn, setAuthReturn] = useState<{ screen: ScreenKey; taskId?: number }>({ screen: "profile" });
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
    const controller = new AbortController();
    setAuthError("");
    api<{ user: AuthUser | null }>("/api/auth/me", { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setUser(result.user); })
      .catch(failure => { if (!controller.signal.aborted) setAuthError(message(failure)); })
      .finally(() => { if (!controller.signal.aborted) setAuthLoading(false); });
    return () => controller.abort();
  }, [authVersion]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setAuthVersion(value => value + 1); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);

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
  }, [teamVersion, screen, user?.id]);

  function navigate(next: ScreenKey, id?: number) {
    window.location.hash = id ? `${next}?task=${id}` : next === "builder" ? "builder?view=list" : next;
  }

  function loginFor(next: ScreenKey = "profile", id?: number) { setAuthReturn({ screen: next, taskId: id }); navigate("login"); }
  async function authenticate(input: AuthInput) {
    const result = await api<{ user: AuthUser }>(`/api/auth/${screen === "register" ? "register" : "login"}`, { method: "POST", body: input });
    setUser(result.user); setAuthVersion(value => value + 1); setAuthError(""); setVersion(value => value + 1); setTeamVersion(value => value + 1);
    navigate(authReturn.screen, authReturn.taskId);
  }
  async function saveProfile(updates: ProfileInput) {
    const result = await api<{ user: AuthUser }>("/api/auth/profile", { method: "PATCH", body: updates });
    setUser(result.user); setAuthVersion(value => value + 1); setTeamVersion(value => value + 1);
  }
  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null); setAuthVersion(value => value + 1); setVersion(value => value + 1); navigate("home");
  }
  const screenName = navigation.find(item => item.key === screen)?.label ?? ({ login: "Вход", register: "Регистрация", profile: "Профиль" } as Record<string, string>)[screen];

  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById("main-content")?.focus(); }}>К содержимому</a>
    <aside className="sidebar">
      <a className="brand" href="#home"><span className="brand-mark">L</span><span><strong>lovelab</strong><small>проектная платформа</small></span></a>
      <div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <nav aria-label="Главная навигация" className="main-nav">
        {navigation.map((item) => <a key={item.key} href={item.key === "builder" ? "#builder?view=list" : `#${item.key}`} aria-label={item.label} title={item.label}
          aria-current={screen === item.key ? "page" : undefined} className={`nav-link${screen === item.key ? " is-active" : ""}`}>
          <span className="nav-symbol"><Icon name={item.key} /></span><span className="nav-label">{item.label}</span>
        </a>)}
      </nav>
      <button type="button" className="sidebar-bottom" aria-label={user ? "Открыть профиль" : "Войти в аккаунт"} onClick={() => user ? navigate("profile") : loginFor()}><span className="profile-avatar">{user ? initials(user.name) : "Г"}</span><span className="profile-copy"><strong>{user?.name ?? "Гость"}</strong><span>{user ? roleName(user.role) : "Войти в аккаунт"}</span></span></button>
    </aside>
    <div className="main-column">
      <header className="topbar"><a className="mobile-brand" href="#home">lovelab<span>✳</span></a><div className="breadcrumbs"><a href="#home">Ваше пространство</a><span aria-hidden="true">/</span><a href={`#${screen}`} aria-current="page"><strong>{screenName}</strong></a></div>
        <div className="topbar-actions"><button type="button" aria-label={user ? "Ваш профиль" : "Войти"} className="top-avatar" onClick={() => user ? navigate("profile") : loginFor()}>{user ? initials(user.name) : "Г"}</button></div>
      </header>
      <main id="main-content" tabIndex={-1} className="page-content">
        {authError && <div className="app-error" role="alert">{authError}<button onClick={() => setAuthVersion(value => value + 1)}>Повторить проверку входа</button></div>}
        {(screen === "login" || screen === "register") && <AuthScreen key={screen} mode={screen} onSubmit={authenticate} onChangeMode={() => navigate(screen === "login" ? "register" : "login")} />}
        {screen === "profile" && (authLoading ? <p role="status">Загружаем профиль…</p> : user ? <ProfileScreen key={user.id} user={user} onSave={saveProfile} onLogout={logout} /> : <section className="auth-gate"><h1>Войдите в свой аккаунт</h1><p>В профиле можно изменить имя и доступность для новых проектов.</p><button className="button button--primary" onClick={() => loginFor()}>Войти</button></section>)}
        {screen === "home" && <HomeScreen onOpenCatalog={() => navigate("catalog")} onCreate={() => navigate("builder")} />}
        {screen === "builder" && (authLoading ? <p role="status">Проверяем вход…</p> : user?.role === "business" ? <BuilderScreen key={user.id} userId={user.id} showListOnEntry={route.builderList} initialTaskId={taskId} onOpenCatalog={() => navigate("catalog")}
          onRespond={(id) => navigate("proposals", id)} onTaskChange={(id) => { window.location.hash = id ? `builder?task=${id}` : "builder"; }} onPublished={() => setVersion((value) => value + 1)} /> : <section className="auth-gate"><h1>Конструктор для бизнеса</h1><p>{user ? "Ваш аккаунт команды позволяет откликаться на опубликованные задачи. Создание и изменение задач доступно бизнесу." : "Войдите или зарегистрируйтесь как бизнес, чтобы создавать задачи и управлять своими карточками."}</p><button className="button button--primary" onClick={() => user ? navigate("catalog") : loginFor("builder", taskId)}>{user ? "Открыть каталог" : "Войти"}</button></section>)}
        {screen === "catalog" && <CatalogScreen recommendationProfile={user?.role === "team" ? { interests: user.interests, skills: user.skills, technologies: user.technologies } : undefined} onCreate={() => navigate("builder")} onRespond={(id) => navigate("proposals", id)} currentUserId={user?.role === "business" ? user.id : undefined} onEdit={user?.role === "business" ? (id) => navigate("builder", id) : undefined} />}
        {(screen === "teams" || screen === "proposals") && teamError && <div className="app-error" role="alert">{teamError}<button onClick={() => setTeamVersion((value) => value + 1)}>Повторить загрузку команд</button></div>}
        {screen === "teams" && (teamsLoading ? <p role="status">Загрузка команд…</p> : !teamError && <TeamsScreen teams={teams} />)}
        {screen === "proposals" && <>
          {error && <div className="app-error" role="alert">{error}<button onClick={() => setVersion((value) => value + 1)}>Повторить</button></div>}
          {loading || teamsLoading ? <p role="status">Загрузка задач и команд…</p> : !error && !teamError && <>
            {tasks.length > 0 && <TaskPicker tasks={tasks} selectedId={selectedTask?.id} onSelect={id => navigate("proposals", id)} />}
            {selectedTask ? <ProposalWorkspace key={`${selectedTask.id}-${user?.id ?? "guest"}`} user={user} onLogin={() => loginFor("proposals", selectedTask.id)} task={selectedTask} teams={teams} onRefreshTeams={() => setTeamVersion((value) => value + 1)} />
              : <div className="empty-state"><h1>{taskId ? "Задача недоступна" : "Пока нет опубликованных задач"}</h1><p>{taskId ? "Выберите другую задачу в каталоге." : "Создайте и опубликуйте первую задачу в конструкторе."}</p><button className="button button--primary" onClick={() => navigate(taskId ? "catalog" : "builder")}>{taskId ? "Открыть каталог" : "Создать задачу"}</button></div>}
          </>}
        </>}
      </main>
    </div>
  </div>;
}
