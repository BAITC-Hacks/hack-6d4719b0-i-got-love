CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('business', 'team')),
    available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    owner_user_id INTEGER REFERENCES users(id),
    title TEXT NOT NULL DEFAULT '',
    topic TEXT NOT NULL DEFAULT '',
    context TEXT NOT NULL DEFAULT '',
    need TEXT NOT NULL DEFAULT '',
    users TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL DEFAULT '',
    constraints TEXT NOT NULL DEFAULT '',
    expected_result TEXT NOT NULL DEFAULT '',
    success_criteria TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',
    interaction_format TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
    confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY,
    owner_user_id INTEGER REFERENCES users(id),
    name TEXT NOT NULL,
    interests TEXT NOT NULL DEFAULT '[]',
    skills TEXT NOT NULL DEFAULT '[]',
    technologies TEXT NOT NULL DEFAULT '[]',
    points INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS proposals (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    team_id INTEGER NOT NULL REFERENCES teams(id),
    idea TEXT NOT NULL DEFAULT '',
    plan TEXT NOT NULL DEFAULT '',
    duration TEXT NOT NULL DEFAULT '',
    prototype_url TEXT NOT NULL DEFAULT '',
    decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'selected', 'rejected')),
    progress_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (progress_confirmed IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_tasks_catalog ON tasks(status, score DESC);
CREATE INDEX IF NOT EXISTS idx_proposals_task ON proposals(task_id);
