import { useEffect, useId, useRef, useState } from "react";
import Icon from "./Icon";

type TaskOption = { id: number; title: string };
export default function TaskPicker({ tasks, selectedId, onSelect }: { tasks: TaskOption[]; selectedId?: number; onSelect: (id: number) => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const selected = tasks.find(task => task.id === selectedId);
  const selectedTitle = selected?.title || (selected ? `Задача #${selected.id}` : "");
  const [query, setQuery] = useState(selectedTitle);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => { setQuery(selectedTitle); setOpen(false); }, [selectedId, selectedTitle]);
  const search = query.trim().toLocaleLowerCase("ru");
  const matches = tasks.filter(task => !search || task.title.toLocaleLowerCase("ru").includes(search) || String(task.id) === search.replace(/^#/, ""));
  const options = matches.slice(0, 10);
  function select(task: TaskOption) { setQuery(task.title || `Задача #${task.id}`); setOpen(false); onSelect(task.id); }
  return <div className="task-search-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setOpen(false); setQuery(selectedTitle); } }}>
    <label htmlFor={id}>Задача для откликов</label>
    <div className="task-search-control"><Icon name="search" size={18} /><input ref={input} id={id} role="combobox" aria-label="Найти задачу для откликов" autoComplete="off" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-results`} aria-activedescendant={open && options[active] ? `${id}-option-${active}` : undefined} value={query} placeholder="Введите название или номер задачи" maxLength={200}
      onFocus={event => { setOpen(true); setActive(0); event.target.select(); }}
      onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); }}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActive(index => Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))); }
        if (event.key === "Enter" && open && options[active]) { event.preventDefault(); select(options[active]); }
        if (event.key === "Escape") { setOpen(false); setQuery(selectedTitle); }
      }} />
      {query && <button type="button" className="task-search-clear" aria-label="Очистить поиск задач" onClick={() => { setQuery(""); setOpen(true); setActive(0); input.current?.focus(); }}>×</button>}
    </div>
    {open && <div className="task-search-popup"><ul id={`${id}-results`} role="listbox" aria-label="Найденные задачи">{options.map((task, index) => <li id={`${id}-option-${index}`} key={task.id} role="option" aria-selected={index === active} onMouseDown={event => event.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => select(task)}><span>{task.title || `Задача #${task.id}`}</span><small>#{task.id}</small></li>)}</ul>{!options.length && <p role="status">Ничего не найдено. Попробуйте другое название.</p>}{matches.length > 10 && <p>Показаны первые 10 задач. Уточните запрос.</p>}</div>}
  </div>;
}
