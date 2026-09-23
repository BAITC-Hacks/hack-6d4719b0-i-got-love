import { useEffect, useState } from "react";
import {
  DEMO_TASK_ID,
  DEMO_TASK_TITLE,
  PROGRESS_POINTS,
  type NewProposal,
  type Proposal,
  type ProposalDecision,
  type Team,
} from "./data/teamProposals";
import BuilderScreen from "./screens/BuilderScreen";
import CatalogScreen from "./screens/CatalogScreen";
import ProposalsScreen from "./screens/ProposalsScreen";
import TeamsScreen from "./screens/TeamsScreen";

export type ScreenKey = "builder" | "catalog" | "teams" | "proposals";

const navigation: { key: ScreenKey; label: string; symbol: string }[] = [
  { key: "builder", label: "Конструктор", symbol: "✳" },
  { key: "catalog", label: "Каталог задач", symbol: "▤" },
  { key: "teams", label: "Команды", symbol: "◉" },
  { key: "proposals", label: "Отклики", symbol: "↗" },
];

const screenTitles: Record<ScreenKey, string> = {
  builder: "Конструктор задачи",
  catalog: "Каталог задач",
  teams: "Команды",
  proposals: "Предложения команд",
};

async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      typeof result === "object" && result !== null && "detail" in result && typeof result.detail === "string"
        ? result.detail
        : `Ошибка сервера: ${response.status}`;
    throw new Error(detail);
  }
  return result as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось выполнить запрос";
}

export default function App() {
  const [activeScreen, setActiveScreen] = useState<ScreenKey>("catalog");
  const [selectedTaskId, setSelectedTaskId] = useState(DEMO_TASK_ID);
  const [selectedTaskTitle, setSelectedTaskTitle] = useState(DEMO_TASK_TITLE);
  const [teams, setTeams] = useState<Team[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    setProposals([]);

    Promise.all([
      api<Team[]>("/api/teams", { signal: controller.signal }),
      api<Proposal[]>(`/api/proposals?task_id=${selectedTaskId}`, { signal: controller.signal }),
      api<{ id: number; title: string }>(`/api/catalog/${selectedTaskId}`, { signal: controller.signal }),
    ])
      .then(([loadedTeams, loadedProposals, task]) => {
        setTeams(loadedTeams);
        setProposals(loadedProposals);
        setSelectedTaskTitle(task.title || `Задача #${task.id}`);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLoadError(errorMessage(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [selectedTaskId, reloadVersion]);

  async function addProposal(proposal: NewProposal): Promise<void> {
    setActionError("");
    try {
      const created = await api<Proposal>("/api/proposals", { method: "POST", body: proposal });
      setProposals((current) => [created, ...current]);
    } catch (error) {
      setActionError(errorMessage(error));
      throw error;
    }
  }

  async function decideProposal(proposalId: number, decision: Exclude<ProposalDecision, "pending">) {
    setActionError("");
    try {
      const updated = await api<Proposal>(`/api/proposals/${proposalId}/decision`, {
        method: "PATCH",
        body: { decision },
      });
      setProposals((current) => current.map((proposal) => (proposal.id === proposalId ? updated : proposal)));
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  async function confirmProgress(proposalId: number) {
    setActionError("");
    try {
      const updated = await api<Proposal>(`/api/proposals/${proposalId}/progress`, { method: "POST" });
      setProposals((current) => current.map((proposal) => (proposal.id === proposalId ? updated : proposal)));
      const loadedTeams = await api<Team[]>("/api/teams");
      setTeams(loadedTeams);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  function openProposals(taskId: number) {
    setSelectedTaskId(taskId);
    setActiveScreen("proposals");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#catalog" onClick={() => setActiveScreen("catalog")}>
          <span className="brand-mark">L</span>
          <span>
            <strong>lovelab</strong>
            <small>проектная платформа</small>
          </span>
        </a>

        <div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav aria-label="Главная навигация" className="main-nav">
          {navigation.map((item) => (
            <button
              aria-current={activeScreen === item.key ? "page" : undefined}
              className={`nav-link${activeScreen === item.key ? " is-active" : ""}`}
              key={item.key}
              onClick={() => setActiveScreen(item.key)}
              type="button"
            >
              <span aria-hidden="true" className="nav-symbol">
                {item.symbol}
              </span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="profile-avatar">Б</div>
          <div className="profile-copy">
            <strong>Бизнес-аккаунт</strong>
            <span>Команда проекта</span>
          </div>
          <span aria-hidden="true" className="profile-more">···</span>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Рабочее пространство</span>
            <span aria-hidden="true">/</span>
            <strong>{screenTitles[activeScreen]}</strong>
          </div>
          <div className="topbar-actions">
            <span className="demo-badge"><span /> Демо-режим</span>
            <button aria-label="Уведомления" className="icon-button" type="button">♧</button>
            <div aria-label="Профиль бизнес-аккаунта" className="top-avatar">Б</div>
          </div>
        </header>

        <main className="page-content">
          {loadError && (
            <div className="app-error" role="alert">
              <span>{loadError}. Проверьте, что API запущен и демо-данные подготовлены.</span>
              <button onClick={() => setReloadVersion((version) => version + 1)} type="button">Повторить</button>
            </div>
          )}
          {actionError && <p className="app-error app-error--action" role="alert">{actionError}</p>}
          {activeScreen === "builder" && <BuilderScreen />}
          {activeScreen === "catalog" && <CatalogScreen onRespond={openProposals} />}
          {activeScreen === "teams" && (loading ? <p>Загрузка команд…</p> : <TeamsScreen teams={teams} />)}
          {activeScreen === "proposals" && (
            loading ? <p>Загрузка команд и откликов…</p> : (
              <ProposalsScreen
                teams={teams}
                proposals={proposals}
                taskId={selectedTaskId}
                taskTitle={selectedTaskTitle}
                onAddProposal={addProposal}
                onConfirmProgress={confirmProgress}
                onDecideProposal={decideProposal}
              />
            )
          )}
        </main>
      </div>
    </div>
  );
}
