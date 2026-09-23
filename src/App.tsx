import { useEffect, useState } from "react";
import {
  DEMO_TASK_ID,
  INITIAL_DEMO_STATE,
  PROGRESS_POINTS,
  type DemoState,
  type Proposal,
  type ProposalDecision,
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

const STORAGE_KEY = "lovelab-team-proposals-demo-v2";

function loadDemoState(): DemoState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "teams" in parsed &&
        "proposals" in parsed &&
        Array.isArray(parsed.teams) &&
        Array.isArray(parsed.proposals)
      ) {
        return parsed as DemoState;
      }
    }
  } catch {
    // Fall back to the seed data if local demo storage is unavailable or invalid.
  }

  return INITIAL_DEMO_STATE;
}

export default function App() {
  const [activeScreen, setActiveScreen] = useState<ScreenKey>("catalog");
  const [demoState, setDemoState] = useState<DemoState>(loadDemoState);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(demoState));
    } catch {
      // The demo remains usable for this session when browser storage is unavailable.
    }
  }, [demoState]);

  function addProposal(proposal: Proposal) {
    setDemoState((current) => ({
      ...current,
      proposals: [proposal, ...current.proposals],
    }));
  }

  function decideProposal(proposalId: number, decision: Exclude<ProposalDecision, "pending">) {
    setDemoState((current) => ({
      ...current,
      proposals: current.proposals.map((proposal) =>
        proposal.id === proposalId && proposal.decision === "pending"
          ? { ...proposal, decision }
          : proposal,
      ),
    }));
  }

  function confirmProgress(proposalId: number) {
    setDemoState((current) => {
      const proposal = current.proposals.find((item) => item.id === proposalId);
      if (!proposal || proposal.decision !== "selected" || proposal.progress_confirmed) {
        return current;
      }

      return {
        teams: current.teams.map((team) =>
          team.id === proposal.team_id ? { ...team, points: team.points + PROGRESS_POINTS } : team,
        ),
        proposals: current.proposals.map((item) =>
          item.id === proposalId ? { ...item, progress_confirmed: true } : item,
        ),
      };
    });
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
          {activeScreen === "builder" && <BuilderScreen />}
          {activeScreen === "catalog" && <CatalogScreen />}
          {activeScreen === "teams" && <TeamsScreen teams={demoState.teams} />}
          {activeScreen === "proposals" && (
            <ProposalsScreen
              teams={demoState.teams}
              proposals={demoState.proposals.filter((proposal) => proposal.task_id === DEMO_TASK_ID)}
              onAddProposal={addProposal}
              onConfirmProgress={confirmProgress}
              onDecideProposal={decideProposal}
            />
          )}
        </main>
      </div>
    </div>
  );
}
