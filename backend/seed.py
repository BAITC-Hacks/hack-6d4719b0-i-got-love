"""Synthetic tasks for a fresh hackathon demo database."""

from datetime import datetime, timezone
from contextlib import closing

from .db import connect, init_db
from .rating import recalculate_task


TASK_COLUMNS = (
    "id", "title", "topic", "context", "need", "users", "data",
    "constraints", "expected_result", "success_criteria", "contact",
    "interaction_format", "status", "confirmed_at",
)


def seed_demo() -> None:
    init_db()
    confirmed_at = datetime.now(timezone.utc).isoformat()
    drafts = [
        {"id": 1, "title": "Упростить запись в мастерскую", "topic": "Услуги", "context": "Клиенты записываются по телефону"},
        {"id": 2, "title": "Наладить учёт школьных запасов", "topic": "Образование", "need": "Избежать нехватки материалов"},
        {"id": 3, "title": "Улучшить доставку по городу", "topic": "Логистика", "users": "Диспетчеры"},
        {"id": 4, "title": "Изучить очереди в поликлинике", "topic": "Здравоохранение", "data": "Обезличенные данные о времени ожидания"},
        {"id": 5, "title": "Спланировать смены волонтёров", "topic": "Городская среда", "constraints": "Удобная работа с телефона"},
    ]
    published = [
        {"id": 6, "title": "Улучшить навигацию в парке", "topic": "Городская среда"},
        {"id": 7, "title": "Сократить время ответа поддержки", "topic": "Услуги", "context": "Клиенты долго ждут ответа", "need": "Определять приоритет обращений", "users": "Операторы поддержки"},
        {"id": 8, "title": "Прогнозировать потребность в материалах", "topic": "Образование", "context": "Потребность меняется каждую учебную четверть", "need": "Планировать закупки", "users": "Сотрудники школы", "data": "Обезличенная история заказов"},
        {"id": 9, "title": "Оптимизировать маршруты доставки", "topic": "Логистика", "context": "Маршруты доставки пересекаются", "need": "Сократить время в пути", "users": "Диспетчеры", "data": "Адреса доставки", "expected_result": "Прототип планировщика маршрутов", "constraints": "Без отслеживания водителей"},
        {"id": 10, "title": "Упростить регистрацию в поликлинике", "topic": "Здравоохранение", "context": "По утрам собираются длинные очереди", "need": "Упростить регистрацию на приём", "users": "Пациенты и сотрудники регистратуры", "data": "Обезличенные данные о количестве посещений", "constraints": "Без персональных медицинских данных", "expected_result": "Прототип регистрации на приём", "success_criteria": "Медианное время ожидания менее 10 минут", "contact": "clinic@example.test", "interaction_format": "Еженедельная встреча с показом результата"},
    ]
    with closing(connect()) as connection, connection:
        if connection.execute("SELECT 1 FROM tasks LIMIT 1").fetchone():
            return
        placeholders = ", ".join("?" for _ in TASK_COLUMNS)
        columns = ", ".join(TASK_COLUMNS)
        for draft in drafts:
            values = {**draft, "status": "draft", "confirmed_at": None}
            connection.execute(
                f"INSERT INTO tasks ({columns}) VALUES ({placeholders})",
                tuple(values.get(column, "") for column in TASK_COLUMNS),
            )
        for card in published:
            values = {**card, "status": "published", "confirmed_at": confirmed_at}
            connection.execute(
                f"INSERT INTO tasks ({columns}) VALUES ({placeholders})",
                tuple(values.get(column, "") for column in TASK_COLUMNS),
            )
            recalculate_task(connection, card["id"])


if __name__ == "__main__":
    seed_demo()
