import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

type Field = 'title' | 'topic' | 'context' | 'need' | 'users' | 'data' | 'constraints' | 'expected_result' | 'success_criteria' | 'contact' | 'interaction_format'
type Question = { field: Exclude<Field, 'context'>; text: string }
type Task = Record<Field, string> & { id: number; status: 'draft' | 'published'; score: number; confirmed_at: string | null }
type Step = 'description' | 'questions' | 'card' | 'published'

const fields: { key: Field; label: string }[] = [
  { key: 'title', label: 'Название' },
  { key: 'topic', label: 'Тема' },
  { key: 'context', label: 'Контекст' },
  { key: 'need', label: 'Потребность бизнеса' },
  { key: 'users', label: 'Пользователи' },
  { key: 'data', label: 'Данные' },
  { key: 'constraints', label: 'Ограничения' },
  { key: 'expected_result', label: 'Ожидаемый результат' },
  { key: 'success_criteria', label: 'Критерии успеха' },
  { key: 'contact', label: 'Контакт' },
  { key: 'interaction_format', label: 'Формат взаимодействия' },
]

async function api<T>(path: string, method: string, body?: object): Promise<T> {
  const response = await fetch(`/api/task-builder${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(typeof error.detail === 'string' ? error.detail : `Ошибка сервера: ${response.status}`)
  }
  return response.json() as Promise<T>
}

function App() {
  const [step, setStep] = useState<Step>('description')
  const [description, setDescription] = useState('')
  const [questions, setQuestions] = useState<Question[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [card, setCard] = useState<Task | null>(null)
  const [savedCard, setSavedCard] = useState<Task | null>(null)
  const [warning, setWarning] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await action() } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось выполнить действие')
    } finally { setBusy(false) }
  }

  function textFields(task: Task): Record<Field, string> {
    return Object.fromEntries(fields.map(({ key }) => [key, task[key]])) as Record<Field, string>
  }

  const dirty = card && savedCard && fields.some(({ key }) => card[key] !== savedCard[key])

  return <main>
    <header>
      <span className="eyebrow">Хакатон · бизнес-задача</span>
      <h1>Конструктор задачи</h1>
      <p>Опишите идею, ответьте на уточнения, проверьте карточку и опубликуйте её.</p>
    </header>

    <div className="steps" aria-label="Этапы">
      {['Описание', 'Вопросы', 'Карточка', 'Публикация'].map((label, index) =>
        <span className={index <= ['description', 'questions', 'card', 'published'].indexOf(step) ? 'active' : ''} key={label}>{index + 1}. {label}</span>
      )}
    </div>

    {error && <p className="alert error" role="alert">{error}</p>}
    {warning && <p className="alert" role="status">{warning}</p>}

    {step === 'description' && <section>
      <h2>Свободное описание</h2>
      <label htmlFor="description">Что вы хотите решить?</label>
      <textarea id="description" rows={7} value={description} onChange={event => setDescription(event.target.value)} placeholder="Опишите ситуацию своими словами" />
      <button disabled={busy || !description.trim()} onClick={() => run(async () => {
        const result = await api<{ questions: Question[]; warning: string | null }>('/questions', 'POST', { description })
        setQuestions(result.questions)
        setWarning(result.warning ?? '')
        setStep('questions')
      })}>Получить уточняющие вопросы</button>
    </section>}

    {step === 'questions' && <section>
      <h2>Уточните задачу</h2>
      <p>Если ответа пока нет, оставьте поле пустым. Эти ответы попадут в карточку дословно.</p>
      {questions.map((question, index) => <label className="question" key={question.field}>
        <span>{index + 1}. {question.text}</span>
        <textarea rows={3} value={answers[question.field] ?? ''} onChange={event => setAnswers({ ...answers, [question.field]: event.target.value })} />
      </label>)}
      <div className="actions">
        <button className="secondary" onClick={() => setStep('description')}>Назад</button>
        <button disabled={busy} onClick={() => run(async () => {
          const draft = await api<Task>('/drafts', 'POST', { description, answers })
          setCard(draft)
          setSavedCard(draft)
          setStep('card')
        })}>Создать черновик</button>
      </div>
    </section>}

    {step === 'card' && card && <section>
      <h2>Карточка задачи</h2>
      <p>Проверьте и дополните поля. Пустые сведения не заполняются автоматически.</p>
      <div className="fields">{fields.map(({ key, label }) => <label key={key}>
        <span>{label}</span>
        {key === 'title' || key === 'topic' || key === 'contact'
          ? <input value={card[key]} onChange={event => setCard({ ...card, [key]: event.target.value })} />
          : <textarea rows={3} value={card[key]} onChange={event => setCard({ ...card, [key]: event.target.value })} />}
      </label>)}</div>
      <p className="hint">Статус: {card.status === 'draft' ? 'черновик' : 'опубликована'}{card.confirmed_at && !dirty ? ' · подтверждена' : ''}</p>
      <div className="actions">
        <button className="secondary" disabled={busy || !dirty} onClick={() => run(async () => {
          const updated = await api<Task>(`/tasks/${card.id}`, 'PUT', textFields(card))
          setCard(updated)
          setSavedCard(updated)
        })}>Сохранить изменения</button>
        <button disabled={busy || Boolean(dirty) || Boolean(card.confirmed_at)} onClick={() => run(async () => {
          const confirmed = await api<Task>(`/tasks/${card.id}/confirm`, 'POST')
          setCard(confirmed)
          setSavedCard(confirmed)
        })}>Подтвердить карточку</button>
        <button disabled={busy || Boolean(dirty) || !card.confirmed_at} onClick={() => run(async () => {
          const published = await api<Task>(`/tasks/${card.id}/publish`, 'POST')
          setCard(published)
          setSavedCard(published)
          setStep('published')
        })}>Опубликовать</button>
      </div>
      {dirty && <p className="hint">Сначала сохраните изменения. После сохранения карточку нужно подтвердить заново.</p>}
    </section>}

    {step === 'published' && card && <section>
      <h2>Задача опубликована</h2>
      <p><strong>#{card.id} {card.title}</strong></p>
      <p>Статус: {card.status}. Карточка сохранена и готова к отображению в каталоге после интеграции.</p>
    </section>}
  </main>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
