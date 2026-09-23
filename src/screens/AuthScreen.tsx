import { useState, type FormEvent } from "react";
import type { AuthInput, AuthRole } from "../data/auth";

type Props = { mode: "login" | "register"; onSubmit: (input: AuthInput) => Promise<void>; onChangeMode: () => void };
export default function AuthScreen({ mode, onSubmit, onChangeMode }: Props) {
  const register = mode === "register";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AuthRole | "">("");
  const [teamName, setTeamName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || (register && !role)) return;
    setBusy(true); setError("");
    try { await onSubmit({ email: email.trim(), password, ...(register ? { name: name.trim(), role: role as AuthRole, ...(role === "team" ? { team_name: teamName.trim() } : {}) } : {}) }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось выполнить вход. Попробуйте ещё раз."); }
    finally { setBusy(false); }
  }
  return <section className="auth-screen">
    <div className="eyebrow">ВАШЕ ПРОСТРАНСТВО LOVELAB</div>
    <h1>{register ? "Создать аккаунт" : "Войти в Lovelab"}</h1>
    <p className="auth-intro">{register ? "Выберите свою роль: бизнес публикует задачи и выбирает решения, команды предлагают идеи и работают над проектами." : "Войдите, чтобы вернуться к своим задачам, предложениям и профилю."}</p>
    <form className="auth-card" onSubmit={event => void submit(event)}>
      <fieldset disabled={busy}>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {register && <label>Ваше имя<input required maxLength={120} autoComplete="name" value={name} onChange={event => setName(event.target.value)} /></label>}
        <label>Электронная почта<input required maxLength={254} type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label>Пароль<input required minLength={register ? 12 : undefined} maxLength={128} type="password" autoComplete={register ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} />{register && <small>Не менее 12 символов.</small>}</label>
        {register && <><label>Ваша роль<select required value={role} onChange={event => setRole(event.target.value as AuthRole | "")}><option value="" disabled>Выберите роль</option><option value="business">Бизнес — публиковать задачи</option><option value="team">Команда — предлагать решения</option></select></label>{role === "team" && <label>Название команды<input required maxLength={100} value={teamName} onChange={event => setTeamName(event.target.value)} /><small>Для аккаунта будет создан отдельный профиль команды.</small></label>}</>}
        <button className="button button--primary auth-submit" disabled={busy || (register && (!role || !name.trim() || (role === "team" && !teamName.trim())))}>{busy ? "Подождите…" : register ? "Зарегистрироваться" : "Войти"}</button>
      </fieldset>
    </form>
    <p className="auth-switch">{register ? "Уже есть аккаунт?" : "Впервые здесь?"} <button type="button" disabled={busy} onClick={onChangeMode}>{register ? "Войти" : "Создать аккаунт"}</button></p>
  </section>;
}
