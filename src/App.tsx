import { useState } from "react";
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

export default function App() {
  const [activeScreen, setActiveScreen] = useState<ScreenKey>("catalog");

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
          {activeScreen === "teams" && <TeamsScreen />}
          {activeScreen === "proposals" && <ProposalsScreen />}
        </main>
      </div>
    </div>
  );
}
