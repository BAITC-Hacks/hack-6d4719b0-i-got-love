import { useState, type FormEvent } from "react";
import { initials, roleName, type AuthUser, type ProfileInput } from "../data/auth";

type Props = { user: AuthUser; onSave: (updates: ProfileInput) => Promise<void>; onLogout: () => Promise<void> };
export default function ProfileScreen({ user, onSave, onLogout }: Props) {
  const [name, setName] = useState(user.name);
  const [available, setAvailable] = useState(user.available);
  const [teamName, setTeamName] = useState(user.team_name ?? "");
  const [interests, setInterests] = useState(user.interests.join(", "));
  const [skills, setSkills] = useState(user.skills.join(", "));
  const [technologies, setTechnologies] = useState(user.technologies.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const list = (value: string) => {
        const items = [...new Set(value.split(",").map(item => item.trim()).filter(Boolean))];
        if (items.length > 12 || items.some(item => item.length > 80)) throw new Error("В каждом списке допустимо до 12 значений, каждое до 80 символов.");
        return items;
      };
      await onSave({ name: name.trim(), available, ...(user.role === "team" ? { team_name: teamName.trim(), interests: list(interests), skills: list(skills), technologies: list(technologies) } : {}) });
      setNotice("Профиль обновлён.");
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось сохранить профиль."); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError("");
    try { await onLogout(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось выйти."); }
    finally { setBusy(false); }
  }
  return <section className="auth-screen">
    <div className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</div><h1>Ваш профиль</h1>
    <div className="profile-summary"><span className="profile-summary-avatar">{initials(user.name)}</span><div><h2>{user.name}</h2><p>{roleName(user.role)} · {user.email}</p></div></div>
    <form className="auth-card" onSubmit={event => void save(event)}><fieldset disabled={busy}>
      {error && <p className="auth-error" role="alert">{error}</p>}{notice && <p className="auth-notice" role="status">{notice}</p>}
      <label>Ваше имя<input required maxLength={120} autoComplete="name" value={name} onChange={event => setName(event.target.value)} /></label>
      {user.role === "team" && <>
        <label>Название команды<input required maxLength={100} value={teamName} onChange={event => setTeamName(event.target.value)} /></label>
        <label>Интересы<input maxLength={1000} value={interests} onChange={event => setInterests(event.target.value)} placeholder="Образование, экология, аналитика" /><small>Перечислите через запятую до 12 направлений.</small></label>
        <label>Навыки<input maxLength={1000} value={skills} onChange={event => setSkills(event.target.value)} placeholder="Дизайн, исследование, разработка" /><small>Они помогут подобрать подходящие задачи.</small></label>
        <label>Технологии<input maxLength={1000} value={technologies} onChange={event => setTechnologies(event.target.value)} placeholder="Python, React, Figma" /></label>
      </>}
      <label className="auth-checkbox"><input type="checkbox" checked={available} onChange={event => setAvailable(event.target.checked)} /><span>Открыт для новых проектов</span></label>
      <p className="auth-help">Статус доступности сохраняется в вашем профиле. Роль аккаунта: {roleName(user.role).toLocaleLowerCase("ru")}.</p>
      <button className="button button--primary" disabled={!name.trim() || busy || (user.role === "team" && !teamName.trim())}>{busy ? "Сохраняем…" : "Сохранить профиль"}</button>
    </fieldset></form>
    <button type="button" className="button button--quiet auth-logout" disabled={busy} onClick={() => void logout()}>Выйти из аккаунта</button>
  </section>;
}
