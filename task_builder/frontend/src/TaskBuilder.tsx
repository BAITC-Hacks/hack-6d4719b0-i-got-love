import React, { useEffect, useRef, useState } from 'react'
import './style.css'
import { evaluatePreview } from './rating'

type Field = 'title' | 'topic' | 'context' | 'need' | 'users' | 'data' | 'constraints' | 'expected_result' | 'success_criteria' | 'contact' | 'interaction_format'
type Question = { field: Exclude<Field, 'context'>; text: string }
type Rating = { score: number; level: string; score_breakdown: Record<string, { earned: number; max: number }>; missing_fields: string[] }
type Task = Record<Field, string> & Rating & { id: number; status: 'draft' | 'published'; confirmed_at: string | null; rating_preview: Rating }
type Step = 'description' | 'questions' | 'card' | 'published'
type Source = { description: string; answers: Record<string, string> }
type Work = { source?: Source; step: Step; description: string; questions: Question[]; answers: Record<string, string>; card: Task | null; savedCard: Task | null; warning: string }
type Workspace = { version: 1; active: string | null; entries: Record<string, Work> }
export type TaskBuilderProps = { userId?: number; showListOnEntry?: boolean; initialTaskId?: number; onOpenCatalog?: () => void; onRespond?: (taskId: number) => void; onPublished?: (taskId: number) => void; onTaskChange?: (taskId?: number) => void }

const storageBase = 'lovelab.task-builder.v1'
const fields: { key: Field; label: string }[] = [
  { key: 'title', label: 'Название' }, { key: 'topic', label: 'Тема' },
  { key: 'context', label: 'Контекст' }, { key: 'need', label: 'Потребность бизнеса' },
  { key: 'users', label: 'Пользователи' }, { key: 'data', label: 'Данные' },
  { key: 'constraints', label: 'Ограничения' }, { key: 'expected_result', label: 'Ожидаемый результат' },
  { key: 'success_criteria', label: 'Критерии успеха' }, { key: 'contact', label: 'Контакт' },
  { key: 'interaction_format', label: 'Формат взаимодействия' },
]
const criteria: Record<string, string> = { context_and_need: 'Контекст и потребность', data: 'Данные', expected_result: 'Результат', success_criteria: 'Критерии успеха', constraints: 'Ограничения', users: 'Пользователи', business_contact: 'Связь с бизнесом' }
const levels: Record<string, string> = { draft: 'Черновик', working: 'Рабочая', ready: 'Готовая', priority: 'Приоритетная' }
const emptyWork = (): Work => ({ step: 'description', description: '', questions: [], answers: {}, card: null, savedCard: null, warning: '' })
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value.length <= 100000
function isRating(value: unknown): value is Rating {
  return isObject(value) && typeof value.score === 'number' && value.score >= 0 && value.score <= 100 && typeof value.level === 'string'
    && isObject(value.score_breakdown) && Object.values(value.score_breakdown).every(part => isObject(part) && typeof part.earned === 'number' && typeof part.max === 'number')
    && Array.isArray(value.missing_fields) && value.missing_fields.every(item => typeof item === 'string')
}
function isTask(value: unknown): value is Task {
  return isObject(value) && Number.isInteger(value.id) && Number(value.id) > 0 && fields.every(({ key }) => isText(value[key]))
    && (value.status === 'draft' || value.status === 'published') && (value.confirmed_at === null || typeof value.confirmed_at === 'string') && isRating(value.rating_preview) && isRating(value)
}
function isWork(value: unknown): value is Work {
  return isObject(value) && ['description', 'questions', 'card', 'published'].includes(String(value.step)) && isText(value.description) && isText(value.warning)
    && Array.isArray(value.questions) && value.questions.length <= 5 && value.questions.every(q => isObject(q) && q.field !== 'context' && fields.some(f => f.key === q.field) && isText(q.text))
    && isObject(value.answers) && Object.entries(value.answers).every(([key, answer]) => key !== 'context' && fields.some(f => f.key === key) && isText(answer))
    && (value.source === undefined || (isObject(value.source) && isText(value.source.description) && isObject(value.source.answers) && Object.entries(value.source.answers).every(([key, answer]) => key !== 'context' && fields.some(f => f.key === key) && isText(answer))))
    && (value.card === null || isTask(value.card)) && (value.savedCard === null || isTask(value.savedCard))
    && (value.step !== 'questions' || value.questions.length >= 3)
    && (!['card', 'published'].includes(String(value.step)) || (isTask(value.card) && isTask(value.savedCard) && value.card.id === value.savedCard.id))
}
function restore(storageKey: string): Workspace {
  const empty: Workspace = { version: 1, active: null, entries: {} }
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (!isObject(value) || value.version !== 1 || !isObject(value.entries)) return empty
    const entries = Object.fromEntries(Object.entries(value.entries).filter(([key, work]) => /^[a-zA-Z0-9-]+$/.test(key) && isWork(work))) as Record<string, Work>
    return { version: 1, entries, active: typeof value.active === 'string' && Object.hasOwn(entries, value.active) ? value.active : null }
  } catch { return empty }
}
const hasChanges = (work: Work) => Boolean(work.card && work.savedCard && fields.some(({ key }) => work.card![key] !== work.savedCard![key]))
const textFields = (task: Task) => Object.fromEntries(fields.map(({ key }) => [key, task[key]]))

async function api<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const response = await fetch(`/api/task-builder${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(typeof error.detail === 'string' ? error.detail : `Ошибка сервера: ${response.status}`)
  }
  return response.json() as Promise<T>
}

export default function TaskBuilder({ userId, showListOnEntry, initialTaskId, onOpenCatalog, onRespond, onPublished, onTaskChange }: TaskBuilderProps) {
  const storageKey = `${storageBase}.${userId === undefined ? 'standalone' : `user-${userId}`}`
  const [workspace, setWorkspace] = useState<Workspace>(() => restore(storageKey))
  const [tasks, setTasks] = useState<Task[]>([])
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  const [storageError, setStorageError] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyMessage, setBusyMessage] = useState('Сохраняем и загружаем данные…')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const openRequest = useRef(0)
  const openedTask = useRef<number | undefined>(undefined)
  const actionRequest = useRef(0)
  const work = workspace.active ? workspace.entries[workspace.active] : null
  const card = work?.card
  const dirty = work ? hasChanges(work) : false
  const liveRating = card ? evaluatePreview(card) : null
  const sourceChanged = Boolean(work?.source && (work.description !== work.source.description || JSON.stringify(work.answers) !== JSON.stringify(work.source.answers)))

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(workspace)); setStorageError('') }
    catch { setStorageError('Браузер не смог сохранить текущий ввод. Сохраните карточку на сервере перед уходом со страницы.') }
  }, [workspace])
  useEffect(() => {
    let active = true
    setLoading(true)
    api<{ items: Task[]; total: number }>('/tasks').then(result => { if (active) setTasks(result.items) })
      .catch(failure => { if (active) setError(failure instanceof TypeError ? 'Не удалось связаться с сервером. Проверьте подключение.' : failure instanceof Error ? failure.message : 'Не удалось загрузить задачи') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [reload])
  useEffect(() => {
    openRequest.current += 1
    if (initialTaskId && (work?.card?.id !== initialTaskId || openedTask.current !== initialTaskId)) void run(() => openTask(initialTaskId))
    else { actionRequest.current += 1; setBusy(false) }
  }, [initialTaskId])

  useEffect(() => {
    if (showListOnEntry) { openRequest.current += 1; actionRequest.current += 1; setBusy(false); setWorkspace(current => ({ ...current, active: null })); setReload(value => value + 1) }
  }, [showListOnEntry])

  useEffect(() => () => { openRequest.current += 1; actionRequest.current += 1 }, [])

  function updateWork(changes: Partial<Work>, expected?: Work) {
    const key = workspace.active
    setWorkspace(current => {
      if (!key || !Object.hasOwn(current.entries, key) || (expected && current.entries[key] !== expected)) return current
      return { ...current, entries: { ...current.entries, [key]: { ...current.entries[key], ...changes } } }
    })
  }
  function acceptTask(task: Task, step: Step = 'card', source?: Source) {
    updateWork({ card: task, savedCard: task, step, warning: '', ...(source ? { source } : {}) }, work ?? undefined)
    setTasks(current => [task, ...current.filter(item => item.id !== task.id)].sort((a, b) => b.id - a.id))
  }
  async function run(action: () => Promise<void>, message = 'Сохраняем и загружаем данные…') {
    const request = ++actionRequest.current
    setBusyMessage(message); setBusy(true); setError('')
    try { await action() } catch (failure) { if (request === actionRequest.current) setError(failure instanceof TypeError ? 'Не удалось связаться с сервером. Проверьте подключение.' : failure instanceof Error ? failure.message : 'Не удалось выполнить действие') }
    finally { if (request === actionRequest.current) setBusy(false) }
  }
  async function generateQuestions(current: Work) {
    const result = await api<{ questions: Question[]; warning: string | null }>('/questions', 'POST', { description: current.description })
    updateWork({
      questions: result.questions,
      answers: Object.fromEntries(Object.entries(current.answers).filter(([field]) => result.questions.some(question => question.field === field))),
      warning: result.warning ?? '',
      step: 'questions',
    }, current)
  }
  async function buildCard(current: Work) {
    const result = current.card?.status === 'draft'
      ? await api<Task>(`/tasks/${current.card.id}`, 'PUT', { ...textFields(current.card), context: current.description, ...current.answers })
      : await api<Task>('/drafts', 'POST', { description: current.description, answers: current.answers })
    acceptTask(result, 'card', { description: current.description, answers: current.answers })
  }
  function goToStep(next: Step) {
    if (!work || busy) return
    if (next === 'card' && sourceChanged && work.card?.status === 'draft') void run(() => buildCard(work))
    else updateWork({ step: next })
  }
  async function openTask(id: number) {
    const request = ++openRequest.current
    const task = await api<Task>(`/tasks/${id}`)
    if (request !== openRequest.current) return
    openedTask.current = id
    setWorkspace(current => {
      const existing = Object.entries(current.entries).find(([, value]) => value.card?.id === id)
      const key = existing?.[0] ?? `task-${id}`
      const local = existing?.[1]
      const restoreEdits = local && hasChanges(local)
      const entry: Work = { ...(local ?? emptyWork()), description: local?.description ?? task.context, source: local?.source ?? { description: task.context, answers: {} }, step: 'card', savedCard: task, card: restoreEdits ? { ...task, ...textFields(local.card!) } : task,
        warning: restoreEdits ? 'Восстановлены ваши несохранённые изменения. Проверьте их перед подтверждением.' : '' }
      return { ...current, active: key, entries: { ...current.entries, [key]: entry } }
    })
    onTaskChange?.(id)
  }
  function newTask() {
    openRequest.current += 1
    const key = `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setError('')
    setWorkspace(current => ({ ...current, active: key, entries: { ...current.entries, [key]: emptyWork() } }))
    onTaskChange?.()
  }
  function showList() { openRequest.current += 1; setError(''); setWorkspace(current => ({ ...current, active: null })); setReload(value => value + 1); onTaskChange?.() }

  function rating(task: Task, edited = false) {
    const confirmed = Boolean(task.confirmed_at) && !edited
    const value = confirmed ? task : evaluatePreview(task)
    return <aside className="builder-rating" aria-label="Рейтинг задачи">
      <div className="rating-heading"><div><strong>{value.score}<small> / 100</small></strong><span>{levels[value.level] ?? value.level}</span></div><b>{confirmed ? 'Подтверждённый рейтинг' : 'Предварительный рейтинг'}</b></div>
      <p className="hint">{edited ? 'Предварительная оценка текущих изменений. Сохраните и подтвердите карточку, чтобы обновить рейтинг в каталоге.' : confirmed ? 'Баллы начислены за сведения, подтверждённые бизнесом.' : 'После подтверждения эти баллы станут рейтингом задачи. Сейчас подтверждено: 0 / 100.'}</p>
      <div className="rating-breakdown">{Object.entries(value.score_breakdown).map(([key, part]) => <div key={key}><span>{criteria[key] ?? key}</span><strong>{part.earned} / {part.max}</strong><progress max={part.max} value={part.earned} aria-label={criteria[key] ?? key} /></div>)}</div>
      <p className="hint">{value.missing_fields.length ? `Для более полного описания добавьте: ${value.missing_fields.map(key => fields.find(field => field.key === key)?.label.toLowerCase() ?? key).join(', ')}.` : 'Все критерии рейтинга заполнены и прошли проверку читаемости.'} Проверяется читаемость и полнота, а не достоверность фактов. Низкий рейтинг не мешает публикации и откликам.</p>
    </aside>
  }

  return <div className="task-builder" aria-busy={busy}>
    <header className="builder-header"><div><span className="eyebrow">БИЗНЕС · ОТ ИДЕИ К РЕЗУЛЬТАТУ</span><h1>Конструктор задач</h1><p>Расскажите о потребности, уточните детали и пригласите команды к решению.</p></div><div className="builder-intro"><span className="builder-intro-mark" aria-hidden="true">✳</span><div><strong>Хорошая задача начинается с вопроса</strong><p>Описание → уточнения → карточка → публикация</p></div></div></header>
    {error && <div className="alert error" role="alert">{error}{!work && <button className="secondary" onClick={() => { setError(''); setReload(value => value + 1) }}>Повторить загрузку</button>}</div>}
    {storageError && <p className="alert" role="status">{storageError}</p>}
    {busy && <p className="hint" role="status">{busyMessage}</p>}
    {!work ? <>
      <div className="builder-overview" aria-label="Ваши задачи"><div><span>Всего сохранено</span><strong>{loading ? '—' : tasks.length}<small> задач</small></strong></div><div><span>В работе</span><strong>{loading ? '—' : tasks.filter(task => task.status === 'draft').length}<small> черновиков</small></strong></div><div><span>Доступны командам</span><strong>{loading ? '—' : tasks.filter(task => task.status === 'published').length}<small> опубликовано</small></strong></div></div>
      <div className="builder-list-heading"><h2>Ваши задачи</h2><p>Возвращайтесь к черновикам и дополняйте опубликованные карточки.</p></div>
      <div className="builder-toolbar"><div className="builder-filters" aria-label="Статус задачи">{[['all', 'Все задачи'], ['draft', 'Черновики'], ['published', 'Опубликованные']].map(([value, label]) => <button key={value} className={filter === value ? '' : 'secondary'} onClick={() => setFilter(value)} disabled={busy}>{label}</button>)}</div><button onClick={newTask} disabled={busy}>+ Новая задача</button></div>
      {filter !== 'published' && Object.entries(workspace.entries).filter(([, value]) => !value.card && (value.description || value.step === 'questions')).map(([key, value]) => <section className="builder-list-item" key={key}><div><span className="builder-badge">На этом устройстве</span><h2>{value.description.slice(0, 100) || 'Новая задача'}</h2><p>Продолжите {value.step === 'questions' ? 'ответы на вопросы' : 'описание'} — ввод сохранён в браузере.</p></div><button className="secondary" disabled={busy} onClick={() => setWorkspace(current => ({ ...current, active: key }))}>Продолжить</button></section>)}
      {loading && <p role="status" className="hint">Загружаем задачи…</p>}
      {tasks.filter(task => filter === 'all' || task.status === filter).map(task => <section key={task.id} className="builder-list-item"><div><span className={`builder-badge ${task.status === 'published' ? 'published' : ''}`}>{task.status === 'published' ? 'Опубликована' : 'Черновик'} · #{task.id}</span><h2>{task.title || 'Без названия'}</h2><p>{task.topic || 'Тема не указана'} · {task.score} / 100 {task.confirmed_at ? 'подтверждено' : 'не подтверждено'}{Object.values(workspace.entries).some(value => value.card?.id === task.id && hasChanges(value)) ? ' · Есть изменения на устройстве' : ''}</p></div><button className="secondary" disabled={busy} onClick={() => run(() => openTask(task.id))}>Открыть карточку</button></section>)}
      {!loading && !error && !tasks.some(task => filter === 'all' || task.status === filter) && <section className="builder-empty"><h2>Здесь появятся ваши задачи</h2><p>Создайте описание — мы поможем превратить его в понятную карточку.</p></section>}
    </> : <>
      <div className="builder-toolbar"><button className="secondary" disabled={busy} onClick={showList}>← Все задачи</button><span className="hint">{storageError ? 'Автосохранение недоступно' : 'Ввод сохраняется на этом устройстве'}</span></div>
      <div className="steps" aria-label="Этапы">{(['description', 'questions', 'card', 'published'] as Step[]).map((next, index) => <button type="button" disabled={busy || (card?.status === 'published' && index < 2) || (next === 'questions' && work.questions.length < 3) || (next === 'card' && !card) || (next === 'published' && card?.status !== 'published')} onClick={() => goToStep(next)} className={`${index <= ['description', 'questions', 'card', 'published'].indexOf(work.step) ? 'active' : ''} ${next === work.step ? 'current' : ''}`} aria-current={next === work.step ? 'step' : undefined} key={next}><b>{index + 1}.</b> {['Описание', 'Вопросы', 'Карточка', 'Публикация'][index]}</button>)}</div>
      {work.warning && <p className="alert" role="status">{work.warning}</p>}
      {work.step === 'description' && <section className="builder-form-section"><span className="builder-section-kicker">ШАГ 01 · ИДЕЯ</span><h2>С чего начнём?</h2><p className="builder-form-intro">Опишите ситуацию своими словами. Мы зададим уточняющие вопросы и поможем собрать понятную задачу для команды.</p><label htmlFor="description">Что вы хотите решить?</label><textarea id="description" maxLength={10000} rows={7} disabled={busy} value={work.description} onChange={event => updateWork({ description: event.target.value })} placeholder="Например: менеджеры тратят два часа в день на обработку заявок. Хотим сократить ручную работу…" /><div className="actions"><button disabled={busy || !work.description.trim()} onClick={() => run(() => generateQuestions(work), 'ИИ формулирует вопросы по вашему описанию…')}>Получить уточняющие вопросы →</button></div></section>}
      {work.step === 'questions' && <section className="builder-form-section"><span className="builder-section-kicker">ШАГ 02 · ДЕТАЛИ</span><h2>Уточним детали</h2><p>Если ответа пока нет, оставьте поле пустым. Ответы попадут в карточку дословно.</p><div className="builder-question-refresh"><button className="secondary" disabled={busy} onClick={() => run(() => generateQuestions(work), 'ИИ формулирует вопросы по вашему описанию…')}>Обновить вопросы</button><span className="hint">ИИ заново уточнит ваше описание. Ответы для совпадающих полей сохранятся.</span></div>{work.questions.map((question, index) => <label className="question" key={question.field}><span>{index + 1}. {question.text}</span><textarea maxLength={10000} disabled={busy} rows={3} value={work.answers[question.field] ?? ''} onChange={event => updateWork({ answers: { ...work.answers, [question.field]: event.target.value } })} /></label>)}<div className="actions"><button className="secondary" disabled={busy} onClick={() => updateWork({ step: 'description' })}>Назад</button><button disabled={busy} onClick={() => run(() => buildCard(work))}>{card?.status === 'draft' ? 'Обновить карточку →' : 'Создать черновик →'}</button></div></section>}
      {work.step === 'card' && card && <section className="builder-form-section"><div className="builder-card-heading"><h2>{card.status === 'published' ? 'Изменение опубликованной задачи' : 'Проверьте карточку'}</h2><span className="builder-badge">#{card.id} · {card.status === 'published' ? 'Опубликована' : 'Черновик'}</span></div><p>{card.status === 'published' ? 'Проверьте изменения и подтвердите их. Обновлённая карточка и рейтинг сразу появятся в каталоге.' : 'Дополните сведения, сохраните и подтвердите карточку перед публикацией.'}</p><div className="fields">{fields.map(({ key, label }) => <label key={key} className={key === 'context' || key === 'need' ? 'field-wide' : undefined}><span id={`builder-field-label-${key}`}>{label}{key === 'title' ? ' *' : ''}</span>{key === 'title' || key === 'topic' || key === 'contact' ? <input aria-labelledby={`builder-field-label-${key}`} aria-describedby={card[key].trim() && liveRating?.field_issues[key] ? `builder-field-issue-${key}` : undefined} maxLength={key === 'title' ? 200 : key === 'topic' ? 100 : 500} disabled={busy} required={key === 'title'} value={card[key]} onChange={event => updateWork({ card: { ...card, [key]: event.target.value } })} /> : <textarea aria-labelledby={`builder-field-label-${key}`} aria-describedby={card[key].trim() && liveRating?.field_issues[key] ? `builder-field-issue-${key}` : undefined} maxLength={key === 'interaction_format' ? 1000 : 10000} disabled={busy} rows={3} value={card[key]} onChange={event => updateWork({ card: { ...card, [key]: event.target.value } })} />}{card[key].trim() && liveRating?.field_issues[key] && <small id={`builder-field-issue-${key}`} className="field-issue">{liveRating.field_issues[key]}</small>}</label>)}</div>
        {rating(card, dirty)}
        <p className="hint">{dirty ? 'Есть несохранённые изменения.' : card.confirmed_at ? 'Текущая версия подтверждена бизнесом.' : 'Карточка сохранена. Проверьте и подтвердите сведения.'} Для подтверждения нужно название; остальные поля можно дополнить позже.</p>
        <div className="actions">{card.status === 'published' ? <><button disabled={busy || !dirty || !card.title.trim()} onClick={() => run(async () => { const updated = await api<Task>(`/tasks/${card.id}/confirmed`, 'PUT', textFields(card)); acceptTask(updated, 'published'); onPublished?.(updated.id) })}>Подтвердить и опубликовать изменения</button>{onOpenCatalog && <button className="secondary" disabled={busy} onClick={onOpenCatalog}>В каталог</button>}</> : <><button className="secondary" disabled={busy || !dirty} onClick={() => run(async () => acceptTask(await api<Task>(`/tasks/${card.id}`, 'PUT', textFields(card))))}>Сохранить изменения</button><button disabled={busy || dirty || Boolean(card.confirmed_at) || !card.title.trim()} onClick={() => run(async () => acceptTask(await api<Task>(`/tasks/${card.id}/confirm`, 'POST')))}>Подтвердить карточку</button><button disabled={busy || dirty || !card.confirmed_at} onClick={() => run(async () => { const published = await api<Task>(`/tasks/${card.id}/publish`, 'POST'); acceptTask(published, 'published'); onPublished?.(published.id) })}>Опубликовать →</button></>}</div>
        {dirty && card.status === 'draft' && <p className="hint">Сначала сохраните изменения, затем подтвердите новую версию.</p>}
      </section>}
      {work.step === 'published' && card && <section className="builder-published-section"><span className="builder-success" aria-hidden="true">✓</span><h2>Задача опубликована</h2><p><strong>#{card.id} {card.title}</strong></p><p>Карточка уже в каталоге. Команды могут предложить решение, а бизнес — выбрать участников.</p>{rating(card)}<div className="actions">{onOpenCatalog && <button disabled={busy} onClick={onOpenCatalog}>Открыть каталог</button>}{onRespond && <button className="secondary" disabled={busy} onClick={() => onRespond(card.id)}>Перейти к откликам</button>}<button className="secondary" disabled={busy} onClick={() => updateWork({ step: 'card' })}>Редактировать</button><button className="secondary" disabled={busy} onClick={newTask}>+ Новая задача</button></div></section>}
    </>}
  </div>
}
