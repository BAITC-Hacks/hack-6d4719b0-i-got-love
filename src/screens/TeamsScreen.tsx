import { useState } from "react";
import Icon from "../components/Icon";
import type { Team } from "../data/teamProposals";

interface TeamsScreenProps {
  teams: Team[];
}

const teamThemes = ["violet", "blue", "green", "orange", "pink"];

export default function TeamsScreen({ teams }: TeamsScreenProps) {
  const [query, setQuery] = useState("");
  const [interest, setInterest] = useState("");
  const [skill, setSkill] = useState("");
  const [technology, setTechnology] = useState("");
  const [sort, setSort] = useState("name");
  const choices = (field: "interests" | "skills" | "technologies") => [...new Set(teams.flatMap(team => team[field]))].sort((a, b) => a.localeCompare(b, "ru"));
  const hasFilters = Boolean(query || interest || skill || technology || sort !== "name");
  function resetFilters() { setQuery(""); setInterest(""); setSkill(""); setTechnology(""); setSort("name"); }
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const visibleTeams = teams.filter((team) =>
    [team.name, ...team.interests, ...team.skills, ...team.technologies]
      .join(" ")
      .toLocaleLowerCase("ru")
      .includes(normalizedQuery) && (!interest || team.interests.includes(interest)) && (!skill || team.skills.includes(skill)) && (!technology || team.technologies.includes(technology)),
  ).sort((a, b) => (sort === "points" ? b.points - a.points : 0) || a.name.localeCompare(b.name, "ru"));

  return (
    <section className="teams-screen">
      <div className="section-heading">
        <div>
          <div className="eyebrow">СООБЩЕСТВО</div>
          <h1>Команды</h1>
          <p className="section-description">Разные навыки. Общая цель — сделать что-то стоящее. Найдите тех, кто превратит вашу задачу в решение.</p>
        </div>
        <div className="community-mark" aria-hidden="true">{teams.slice(0,3).map(team => <span key={team.id}>{team.name.slice(0,1)}</span>)}<Icon name="teams" size={24} /></div>
      </div>

      <div className="community-stats"><div><Icon name="teams" /><strong>{teams.length}</strong><span>команд в сообществе</span></div><div><Icon name="builder" /><strong>{new Set(teams.flatMap(team => team.skills)).size}</strong><span>навыков для ваших задач</span></div><div><Icon name="trophy" /><strong>{teams.reduce((total, team) => total + team.points, 0)}</strong><span>баллов за результат</span></div></div>
      <div className="toolbar">
        <label className="search-field">
          <Icon name="search" />
          <input
            aria-label="Поиск команды или навыка"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Команда, навык или технология"
            value={query}
          />
        </label>
        <span className="result-count" role="status">Найдено команд: {visibleTeams.length}</span>
      </div>
      <div className="team-filters" aria-label="Фильтры команд">
        <label>Интерес<select value={interest} onChange={event => setInterest(event.target.value)}><option value="">Все интересы</option>{choices("interests").map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Навык<select value={skill} onChange={event => setSkill(event.target.value)}><option value="">Все навыки</option>{choices("skills").map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Технология<select value={technology} onChange={event => setTechnology(event.target.value)}><option value="">Все технологии</option>{choices("technologies").map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Порядок команд<select value={sort} onChange={event => setSort(event.target.value)}><option value="name">По названию</option><option value="points">Сначала больше баллов</option></select></label>
        {hasFilters && <button type="button" className="button button--quiet button--small" onClick={resetFilters}>Сбросить фильтры</button>}
      </div>

      {visibleTeams.length > 0 ? (
        <div className="team-grid">
          {visibleTeams.map((team) => {
            const themeIndex = teams.findIndex((item) => item.id === team.id) % teamThemes.length;
            return (
              <article className="team-card" key={team.id}>
                <div className="team-card-top">
                  <div className={`team-avatar team-avatar--${teamThemes[themeIndex]}`}>
                    {team.name.slice(0, 1)}
                  </div>
                  <div className="team-name-block">
                    <h2>{team.name}</h2>
                    <span>{team.interests[0]}</span>
                  </div>
                  <div className="points-pill" title="Баллы за подтверждённый прогресс">
                    <Icon name="trophy" size={16} /> {team.points}
                  </div>
                </div>

                <div className="team-card-section">
                  <h3>Интересы</h3>
                  <div className="chip-list">
                    {team.interests.map((interest) => <span className="tag" key={interest}>{interest}</span>)}
                  </div>
                </div>
                <div className="team-card-section">
                  <h3>Навыки</h3>
                  <div className="chip-list">
                    {team.skills.map((skill) => <span className="tag tag--muted" key={skill}>{skill}</span>)}
                  </div>
                </div>
                <div className="team-card-footer">
                  <span>Технологии</span>
                  <strong>{team.technologies.join(" · ")}</strong>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <Icon name="search" />
          <h2>Команды не найдены</h2>
          <p>Попробуйте изменить запрос или фильтры.</p>
          {hasFilters && <button type="button" className="button button--quiet" onClick={resetFilters}>Показать все команды</button>}
        </div>
      )}
    </section>
  );
}
