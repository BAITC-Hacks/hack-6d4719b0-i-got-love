import Icon from "../components/Icon";

const contacts = [
  { name: "Bayanov Zhanibek", email: "janikbayan@gmail.com", telegram: "zhanb6", initials: "ЖБ" },
  { name: "Damir Zhumabekov", email: "zhumabekov.damir.1705@gmail.com", telegram: "defusetatted", initials: "ДЖ" },
  { name: "Alla-Adil Yeskerbekuly", email: "nekkek106@gmail.com", telegram: "yeskerbekuly", initials: "АЕ" },
];

export default function HomeScreen({ onOpenCatalog, onCreate }: { onOpenCatalog: () => void; onCreate: () => void }) {
  return <section className="home-screen">
    <header className="home-intro">
      <span className="eyebrow">LOVELAB · БИЗНЕС И КОМАНДЫ</span>
      <h1>Задачи бизнеса.<br />Решения команд.</h1>
      <p>Lovelab помогает бизнесу понятно описать свою задачу, а студенческим командам — найти реальный проект и предложить решение.</p>
      <div className="home-actions">
        <button className="button button--primary" onClick={onOpenCatalog}>Найти задачу <Icon name="arrow" size={18} /></button>
        <button className="button button--quiet" onClick={onCreate}>Открыть конструктор</button>
      </div>
      <a className="home-contact-link" href="#contacts" onClick={event => { event.preventDefault(); document.getElementById("contacts")?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); document.getElementById("contacts")?.focus({ preventScroll: true }); }}>Связаться с нами ↓</a>
    </header>

    <div className="home-roles">
      <article><span className="home-role-icon"><Icon name="builder" size={25} /></span><h2>Для бизнеса</h2><p>Расскажите о проблеме. Конструктор задаст уточняющие вопросы и соберёт карточку. Проверьте её, опубликуйте и выберите подходящие предложения.</p></article>
      <article><span className="home-role-icon"><Icon name="teams" size={25} /></span><h2>Для команд</h2><p>Изучите задачи и доступные данные. Отправьте идею, план, срок и ссылку на прототип. После подтверждения этапа бизнесом команда получит баллы.</p></article>
    </div>

    <section className="home-section" aria-labelledby="how-it-works">
      <div className="home-section-heading"><span className="eyebrow">ОТ ИДЕИ ДО РЕЗУЛЬТАТА</span><h2 id="how-it-works">Как это работает</h2></div>
      <ol className="home-steps">
        <li><span className="home-step-number" aria-hidden="true">01</span><h3>Сформулируйте задачу</h3><p>Описание, уточняющие вопросы и карточка. Рейтинг покажет, каких сведений ещё не хватает.</p></li>
        <li><span className="home-step-number" aria-hidden="true">02</span><h3>Найдите друг друга</h3><p>Команды откликаются на опубликованные задачи. Бизнес сравнивает предложения и выбирает участников.</p></li>
        <li><span className="home-step-number" aria-hidden="true">03</span><h3>Покажите результат</h3><p>Бизнес подтверждает выполненный этап. Команда получает +10 баллов за этот этап один раз.</p></li>
      </ol>
      <p className="home-demo-note">Каталог открыт для всех. Для работы зарегистрируйтесь и выберите роль: бизнес или команда. Демонстрационные задачи и команды помогут познакомиться с платформой.</p>
    </section>

    <section className="home-section home-contacts" id="contacts" tabIndex={-1} aria-labelledby="contact-heading">
      <div className="home-section-heading"><span className="eyebrow">КОМАНДА LOVELAB</span><h2 id="contact-heading">Связаться с нами</h2><p>Есть вопрос, идея или обратная связь? Напишите нам в Telegram или на почту.</p></div>
      <div className="home-contact-grid">{contacts.map(contact => <article className="home-contact-card" key={contact.telegram}>
        <span className="home-contact-avatar" aria-hidden="true">{contact.initials}</span>
        <h3>{contact.name}</h3>
        <a href={`https://t.me/${contact.telegram}`} target="_blank" rel="noopener noreferrer"><span>Telegram</span><strong>@{contact.telegram} <Icon name="external" size={14} /></strong></a>
        <a href={`mailto:${contact.email}`}><span>Почта</span><strong>{contact.email}</strong></a>
      </article>)}</div>
    </section>
    <footer className="home-footer"><strong>lovelab</strong><span>От понятной задачи — к совместной работе.</span></footer>
  </section>;
}
