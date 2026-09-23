import { useState } from "react";
import type { Team } from "../data/teamProposals";

interface TeamsScreenProps {
  teams: Team[];
}

const teamThemes = ["violet", "blue", "green", "orange", "pink"];

export default function TeamsScreen({ teams }: TeamsScreenProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const visibleTeams = teams.filter((team) =>
    [team.name, ...team.interests, ...team.skills, ...team.technologies]
      .join(" ")
      .toLocaleLowerCase("ru")
      .includes(normalizedQuery),
  );

  return (
    <section>
      <div className="section-heading">
        <div>
          <div className="eyebrow">СООБЩЕСТВО</div>
          <h1>Команды</h1>
          <p className="section-description">Профили, интересы и технологии команд платформы.</p>
        </div>
        <div className="heading-stat"><strong>{teams.length}</strong><span>профилей</span></div>
      </div>

      <div className="toolbar">
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Поиск команды или навыка"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Команда, навык или технология"
            value={query}
          />
        </label>
        <span className="result-count">{visibleTeams.length} команд</span>
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
                    <span aria-hidden="true">✦</span> {team.points}
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
          <span aria-hidden="true">⌕</span>
          <h2>Команды не найдены</h2>
          <p>Попробуйте изменить запрос.</p>
        </div>
      )}
    </section>
  );
}
