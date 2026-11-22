-- Usuarios que entraron con Google. Nadie juega hasta que el admin lo aprueba.
CREATE TABLE users (
  id          TEXT PRIMARY KEY,           -- id interno (uuid)
  google_sub  TEXT UNIQUE,                -- id de la cuenta de Google (NULL en el login de desarrollo)
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  picture     TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'blocked')),
  role        TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
  created_at  INTEGER NOT NULL,           -- ms desde 1970
  last_seen_at INTEGER
);

-- Sesiones: guardamos solo el hash del token; el token real vive en la cookie del navegador.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Estados temporales del login con Google (protección CSRF + PKCE), viven 10 minutos.
CREATE TABLE oauth_states (
  state         TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  expires_at    INTEGER NOT NULL
);

-- Historial de turnos (quién jugó, cuánto y cómo terminó).
CREATE TABLE turns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER NOT NULL,
  reason      TEXT NOT NULL                -- 'time', 'left', 'skipped', 'admin'
);
CREATE INDEX turns_user ON turns(user_id);
