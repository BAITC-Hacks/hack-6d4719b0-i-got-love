import { useState, type FormEvent } from "react";
import {
  DEMO_TASK_ID,
  DEMO_TASK_TITLE,
  PROGRESS_POINTS,
  type Proposal,
  type ProposalDecision,
  type Team,
} from "../data/teamProposals";

interface ProposalsScreenProps {
  teams: Team[];
  proposals: Proposal[];
  onAddProposal: (proposal: Proposal) => void;
  onConfirmProgress: (proposalId: number) => void;
  onDecideProposal: (proposalId: number, decision: Exclude<ProposalDecision, "pending">) => void;
}

type ProposalFilter = "all" | ProposalDecision;

const filterLabels: { key: ProposalFilter; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "pending", label: "Ожидают решения" },
  { key: "selected", label: "Выбраны" },
  { key: "rejected", label: "Отклонены" },
];

const decisionLabels: Record<ProposalDecision, string> = {
  pending: "Ожидает решения",
  selected: "Выбрана бизнесом",
  rejected: "Отклонена",
};

export default function ProposalsScreen({
  teams,
  proposals,
  onAddProposal,
  onConfirmProgress,
  onDecideProposal,
}: ProposalsScreenProps) {
  const [filter, setFilter] = useState<ProposalFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [teamId, setTeamId] = useState(teams[0]?.id ?? 0);
  const [idea, setIdea] = useState("");
  const [plan, setPlan] = useState("");
  const [duration, setDuration] = useState("");
  const [prototypeUrl, setPrototypeUrl] = useState("");

  const filteredProposals = proposals.filter((proposal) => filter === "all" || proposal.decision === filter);
  const pendingCount = proposals.filter((proposal) => proposal.decision === "pending").length;
  const selectedCount = proposals.filter((proposal) => proposal.decision === "selected").length;
  const rejectedCount = proposals.filter((proposal) => proposal.decision === "rejected").length;

  function submitProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!teamId) return;

    onAddProposal({
      id: Date.now(),
      task_id: DEMO_TASK_ID,
      team_id: teamId,
      idea: idea.trim(),
      plan: plan.trim(),
      duration: duration.trim(),
      prototype_url: prototypeUrl.trim(),
      decision: "pending",
      progress_confirmed: false,
    });
    setIdea("");
    setPlan("");
    setDuration("");
    setPrototypeUrl("");
    setFormOpen(false);
    setFilter("all");
  }

  return (
    <section>
      <div className="eyebrow">РЕШЕНИЯ БИЗНЕСА</div>
      <div className="section-heading proposal-heading">
        <div>
          <h1>Предложения команд</h1>
          <p className="section-description">Сравните идеи и вручную выберите команды для задачи.</p>
        </div>
        <button className="button button--primary" onClick={() => setFormOpen((open) => !open)} type="button">
          <span aria-hidden="true">＋</span> Добавить отклик
        </button>
      </div>

      <article className="task-summary">
        <div className="task-summary-icon" aria-hidden="true">▤</div>
        <div>
          <span className="task-summary-label">ОПУБЛИКОВАННАЯ ЗАДАЧА</span>
          <h2>{DEMO_TASK_TITLE}</h2>
        </div>
        <span className="status-pill status-pill--published">Опубликована</span>
      </article>

      {formOpen && (
        <form className="proposal-form" onSubmit={submitProposal}>
          <div className="form-heading">
            <div>
              <h2>Новый отклик</h2>
              <p>Заполните идею, план, срок и ссылку на прототип.</p>
            </div>
            <button aria-label="Закрыть форму" className="icon-button" onClick={() => setFormOpen(false)} type="button">×</button>
          </div>
          <label className="form-field">
            <span>Команда</span>
            <select onChange={(event) => setTeamId(Number(event.target.value))} required value={teamId}>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          <label className="form-field">
            <span>Идея</span>
            <textarea onChange={(event) => setIdea(event.target.value)} required rows={2} value={idea} />
          </label>
          <label className="form-field">
            <span>План работы</span>
            <textarea onChange={(event) => setPlan(event.target.value)} required rows={2} value={plan} />
          </label>
          <div className="form-grid">
            <label className="form-field">
              <span>Срок</span>
              <input onChange={(event) => setDuration(event.target.value)} placeholder="Например, 2 недели" required value={duration} />
            </label>
            <label className="form-field">
              <span>Ссылка на прототип</span>
              <input onChange={(event) => setPrototypeUrl(event.target.value)} placeholder="https://..." required type="url" value={prototypeUrl} />
            </label>
          </div>
          <div className="form-actions">
            <button className="button button--quiet" onClick={() => setFormOpen(false)} type="button">Отмена</button>
            <button className="button button--primary" type="submit">Отправить отклик</button>
          </div>
        </form>
      )}

      <div className="proposal-overview">
        <div className="proposal-stats">
          <div><strong>{proposals.length}</strong><span>всего</span></div>
          <div><strong>{pendingCount}</strong><span>ожидают решения</span></div>
          <div><strong>{selectedCount}</strong><span>выбраны</span></div>
          <div><strong>{rejectedCount}</strong><span>отклонены</span></div>
        </div>
        <div className="filter-tabs" aria-label="Фильтр предложений">
          {filterLabels.map((item) => (
            <button
              aria-pressed={filter === item.key}
              className={filter === item.key ? "filter-tab is-active" : "filter-tab"}
              key={item.key}
              onClick={() => setFilter(item.key)}
              type="button"
            >
              {item.label}
              <span>{item.key === "all" ? proposals.length : item.key === "pending" ? pendingCount : item.key === "selected" ? selectedCount : rejectedCount}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="proposal-list">
        {filteredProposals.map((proposal, index) => {
          const team = teams.find((item) => item.id === proposal.team_id);
          if (!team) return null;

          return (
            <article className="proposal-card" key={proposal.id}>
              <div className="proposal-card-header">
                <div className="proposal-team">
                  <div className={`team-avatar team-avatar--${["violet", "blue", "green", "orange", "pink"][index % 5]}`}>
                    {team.name.slice(0, 1)}
                  </div>
                  <div>
                    <h2>{team.name}</h2>
                    <span>{team.interests.slice(0, 2).join(" · ")}</span>
                  </div>
                </div>
                <span className={`decision-badge decision-badge--${proposal.decision}`}>
                  <span aria-hidden="true" />{decisionLabels[proposal.decision]}
                </span>
              </div>

              <div className="proposal-copy-grid">
                <div className="proposal-copy">
                  <h3>Идея</h3>
                  <p>{proposal.idea}</p>
                </div>
                <div className="proposal-copy">
                  <h3>План работы</h3>
                  <p>{proposal.plan}</p>
                </div>
              </div>

              <div className="proposal-card-footer">
                <div className="proposal-meta">
                  <span><span aria-hidden="true">◷</span> {proposal.duration}</span>
                  <a href={proposal.prototype_url} rel="noreferrer" target="_blank">
                    Прототип <span aria-hidden="true">↗</span>
                  </a>
                  <span className="team-points"><span aria-hidden="true">✦</span> {team.points} баллов</span>
                </div>
                <div className="proposal-actions">
                  {proposal.decision === "pending" && (
                    <>
                      <button className="button button--quiet button--small" onClick={() => onDecideProposal(proposal.id, "rejected")} type="button">Отклонить</button>
                      <button className="button button--primary button--small" onClick={() => onDecideProposal(proposal.id, "selected")} type="button">Выбрать команду</button>
                    </>
                  )}
                  {proposal.decision === "selected" && !proposal.progress_confirmed && (
                    <button className="button button--progress button--small" onClick={() => onConfirmProgress(proposal.id)} type="button">
                      Подтвердить этап <span>+{PROGRESS_POINTS} баллов</span>
                    </button>
                  )}
                  {proposal.progress_confirmed && (
                    <span className="confirmed-label"><span aria-hidden="true">✓</span> Этап подтверждён · +{PROGRESS_POINTS} баллов</span>
                  )}
                </div>
              </div>
            </article>
          );
        })}
        {filteredProposals.length === 0 && (
          <div className="empty-state">
            <span aria-hidden="true">◷</span>
            <h2>Здесь пока пусто</h2>
            <p>Предложения выбранного статуса появятся в этом списке.</p>
          </div>
        )}
      </div>
      <p className="manual-decision-note">Команды выбирает бизнес вручную. Автоматического назначения нет.</p>
    </section>
  );
}
