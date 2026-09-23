"""Repair known legacy demo values; preserve user edits and progress."""

import json
from contextlib import closing

from .db import connect, init_db


LEGACY_TASK_FIELDS = {1: {'title': ('Improve workshop booking', 'Упростить запись в мастерскую'),
     'topic': ('Services', 'Услуги'),
     'context': ('Customers call to book', 'Клиенты записываются по телефону')},
 2: {'title': ('Track school supplies', 'Наладить учёт школьных запасов'),
     'topic': ('Education', 'Образование'),
     'need': ('Avoid stockouts', 'Избежать нехватки материалов')},
 3: {'title': ('Help local deliveries', 'Улучшить доставку по городу'),
     'topic': ('Logistics', 'Логистика'),
     'users': ('Dispatchers', 'Диспетчеры')},
 4: {'title': ('Review clinic queues', 'Изучить очереди в поликлинике'),
     'topic': ('Healthcare', 'Здравоохранение'),
     'data': ('Anonymous wait times', 'Обезличенные данные о времени ожидания')},
 5: {'title': ('Plan volunteer shifts', 'Спланировать смены волонтёров'),
     'topic': ('Community', 'Городская среда'),
     'constraints': ('Mobile-friendly', 'Удобная работа с телефона')},
 6: {'title': ('Explore park signage', 'Улучшить навигацию в парке'), 'topic': ('Community', 'Городская среда')},
 7: {'title': ('Shorten support replies', 'Сократить время ответа поддержки'),
     'topic': ('Services', 'Услуги'),
     'context': ('Replies are slow', 'Клиенты долго ждут ответа'),
     'need': ('Prioritize tickets', 'Определять приоритет обращений'),
     'users': ('Support agents', 'Операторы поддержки')},
 8: {'title': ('Forecast supply demand', 'Прогнозировать потребность в материалах'),
     'topic': ('Education', 'Образование'),
     'context': ('Demand changes each term', 'Потребность меняется каждую учебную четверть'),
     'need': ('Plan orders', 'Планировать закупки'),
     'users': ('School staff', 'Сотрудники школы'),
     'data': ('Anonymous order history', 'Обезличенная история заказов')},
 9: {'title': ('Route local deliveries', 'Оптимизировать маршруты доставки'),
     'topic': ('Logistics', 'Логистика'),
     'context': ('Routes overlap', 'Маршруты доставки пересекаются'),
     'need': ('Reduce travel time', 'Сократить время в пути'),
     'users': ('Dispatchers', 'Диспетчеры'),
     'data': ('Delivery locations', 'Адреса доставки'),
     'expected_result': ('Route prototype', 'Прототип планировщика маршрутов'),
     'constraints': ('No driver tracking', 'Без отслеживания водителей')},
 10: {'title': ('Improve clinic check-in', 'Упростить регистрацию в поликлинике'),
      'topic': ('Healthcare', 'Здравоохранение'),
      'context': ('Morning queues are long', 'По утрам собираются длинные очереди'),
      'need': ('Simplify check-in', 'Упростить регистрацию на приём'),
      'users': ('Patients and receptionists', 'Пациенты и сотрудники регистратуры'),
      'data': ('Anonymous visit counts', 'Обезличенные данные о количестве посещений'),
      'constraints': ('No personal health data', 'Без персональных медицинских данных'),
      'expected_result': ('Check-in prototype', 'Прототип регистрации на приём'),
      'success_criteria': ('Median wait under 10 minutes', 'Медианное время ожидания менее 10 минут'),
      'interaction_format': ('Weekly demo call', 'Еженедельная встреча с показом результата')}}

LEGACY_TEAM_FIELDS = {1: {'name': ('Pixel Lab', 'Пиксель Лаб'),
     'interests': (['E-commerce', 'Пользовательский опыт', 'Сервисы'],
                   ['Электронная коммерция', 'Пользовательский опыт', 'Сервисы']),
     'skills': (['UX/UI-дизайн', 'Исследования', 'Прототипирование'],
                ['Дизайн интерфейсов', 'Исследования', 'Прототипирование'])},
 2: {'name': ('Data Pulse', 'Пульс данных'),
     'interests': (['Аналитика', 'E-commerce', 'Персонализация'],
                   ['Аналитика', 'Электронная коммерция', 'Персонализация'])},
 3: {'name': ('Green Stack', 'Зелёный стек')},
 4: {'name': ('Craft Code', 'Крафт Код'),
     'skills': (['Frontend-разработка', 'Интеграции', 'Быстрое прототипирование'],
                ['Веб-разработка', 'Интеграции', 'Быстрое прототипирование'])},
 5: {'name': ('Market Makers', 'Мастера роста')}}

LEGACY_PROTOTYPE_URLS = {
    1: "https://example.com/prototypes/pixel-lab",
    2: "https://example.com/prototypes/data-pulse",
    3: "https://example.com/prototypes/green-stack",
    4: "https://example.com/prototypes/craft-code",
    5: "https://example.com/prototypes/market-makers",
}


def localize_demo_data() -> int:
    """Apply exact legacy-value replacements atomically; safe to run repeatedly."""
    init_db()
    changed = 0
    with closing(connect()) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        for task_id, fields in LEGACY_TASK_FIELDS.items():
            for field, (original, translated) in fields.items():
                changed += connection.execute(
                    f"UPDATE tasks SET {field} = ? WHERE id = ? AND {field} = ?",
                    (translated, task_id, original),
                ).rowcount
        for team_id, fields in LEGACY_TEAM_FIELDS.items():
            row = connection.execute("SELECT * FROM teams WHERE id = ?", (team_id,)).fetchone()
            if row is None:
                continue
            for field, (original, translated) in fields.items():
                current = row[field]
                if isinstance(original, list):
                    try:
                        current = json.loads(current)
                    except (TypeError, ValueError):
                        continue
                if current == original:
                    value = json.dumps(translated, ensure_ascii=False) if isinstance(translated, list) else translated
                    connection.execute(f"UPDATE teams SET {field} = ? WHERE id = ?", (value, team_id))
                    changed += 1
        for proposal_id, placeholder in LEGACY_PROTOTYPE_URLS.items():
            changed += connection.execute(
                """UPDATE proposals SET prototype_url = ''
                   WHERE id = ? AND task_id = 7 AND team_id = ? AND prototype_url = ?""",
                (proposal_id, proposal_id, placeholder),
            ).rowcount
    return changed


if __name__ == "__main__":
    print(f"Обновлено полей демонстрационных данных: {localize_demo_data()}")
