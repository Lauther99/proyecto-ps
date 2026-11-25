-- Créditos, recargas, turnos comprados y configuración. Explicación en worker/diseno/DISENO.md.

-- --- Usuarios: entrada automática y apodo ---
ALTER TABLE users ADD COLUMN nickname TEXT;
ALTER TABLE users ADD COLUMN nickname_key TEXT;          -- apodo en minúsculas, para que no se repita
ALTER TABLE users ADD COLUMN blocked_reason TEXT;
ALTER TABLE users ADD COLUMN notice TEXT;                -- JSON de Notice, o NULL

-- El nombre de Google nunca se publica: quien ya existía recibe un apodo neutro que puede cambiar.
UPDATE users SET status = 'approved' WHERE status = 'pending';
UPDATE users SET nickname = 'Jugador-' || substr(replace(id, '-', ''), 1, 8);
UPDATE users SET nickname_key = lower(nickname);
CREATE UNIQUE INDEX users_nickname ON users(nickname_key);

-- --- Login: a dónde volver y en qué navegador empezó ---
ALTER TABLE oauth_states ADD COLUMN next TEXT NOT NULL DEFAULT '/';
ALTER TABLE oauth_states ADD COLUMN browser_hash TEXT;

-- --- Dinero ---
-- Saldo. Solo lo cambia el trigger de ledger. Los CHECK hacen imposible un saldo negativo.
CREATE TABLE wallets (
  user_id    TEXT PRIMARY KEY REFERENCES users(id),
  available  INTEGER NOT NULL DEFAULT 0 CHECK (available >= 0),
  reserved   INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0)
);
INSERT INTO wallets (user_id) SELECT id FROM users;

-- Libro de movimientos: solo se agrega. op_key impide aplicar dos veces la misma operación.
CREATE TABLE ledger (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  op_key          TEXT NOT NULL UNIQUE,   -- 'recharge:<id>', 'reserve:<booking>', 'charge:<booking>'...
  user_id         TEXT NOT NULL REFERENCES wallets(user_id),
  kind            TEXT NOT NULL CHECK (kind IN ('recharge', 'reserve', 'release', 'charge', 'refund', 'adjust')),
  available_delta INTEGER NOT NULL,
  reserved_delta  INTEGER NOT NULL DEFAULT 0,
  booking_id      TEXT,
  recharge_id     TEXT,
  actor_id        TEXT,                   -- admin que lo hizo; NULL = el sistema o el propio usuario
  detail          TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX ledger_user ON ledger(user_id, id);

CREATE TRIGGER ledger_apply AFTER INSERT ON ledger BEGIN
  UPDATE wallets
     SET available = available + NEW.available_delta,
         reserved = reserved + NEW.reserved_delta
   WHERE user_id = NEW.user_id;
END;
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger BEGIN
  SELECT RAISE(ABORT, 'ledger: solo se agrega');
END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger BEGIN
  SELECT RAISE(ABORT, 'ledger: solo se agrega');
END;

CREATE TABLE recharges (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  request_key  TEXT NOT NULL,             -- clave del navegador: un reintento no crea otra
  amount       INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 500),
  operation    TEXT NOT NULL,             -- texto: conserva los ceros iniciales
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reason       TEXT,
  resolved_by  TEXT REFERENCES users(id),
  resolved_at  INTEGER,
  created_at   INTEGER NOT NULL,
  UNIQUE (user_id, request_key)
);
CREATE INDEX recharges_status ON recharges(status, created_at);
CREATE INDEX recharges_operation ON recharges(operation);
CREATE INDEX recharges_user ON recharges(user_id, created_at);

-- --- Sala y turnos ---
CREATE TABLE rooms (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  console      TEXT NOT NULL,
  game         TEXT NOT NULL DEFAULT '',
  paused       INTEGER NOT NULL DEFAULT 0,
  pause_cause  TEXT,                      -- 'admin' o 'fault'
  youtube      INTEGER NOT NULL DEFAULT 0,
  control_user TEXT REFERENCES users(id), -- admin que tiene el control, o NULL
  control_since INTEGER
);
INSERT INTO rooms (id, name, console) VALUES ('main', 'Sala 1', 'PS4');

-- Una compra de tiempo, desde que entra a la cola hasta que termina. También es el historial.
CREATE TABLE bookings (
  id               TEXT PRIMARY KEY,
  room_id          TEXT NOT NULL REFERENCES rooms(id),
  user_id          TEXT NOT NULL REFERENCES users(id),
  status           TEXT NOT NULL CHECK (status IN ('queued', 'offered', 'playing', 'done', 'cancelled', 'expired')),
  position         INTEGER NOT NULL,      -- orden en la cola (puede ser negativo: vuelve primero)
  minutes          INTEGER NOT NULL CHECK (minutes > 0),
  credits          INTEGER NOT NULL CHECK (credits >= 0), -- precio al comprar; no cambia si sube después
  charged          INTEGER NOT NULL DEFAULT 0,
  remaining_ms     INTEGER NOT NULL,      -- lo que falta jugar (se actualiza al detener el turno)
  offer_expires_at INTEGER,
  started_at       INTEGER,               -- primera vez que empezó
  segment_at       INTEGER,               -- inicio del tramo en curso
  ends_at          INTEGER,
  outage_at        INTEGER,               -- desde cuándo falla la consola o el agente
  played_ms        INTEGER NOT NULL DEFAULT 0,
  refunded         INTEGER NOT NULL DEFAULT 0 CHECK (refunded >= 0 AND refunded <= credits),
  result           TEXT CHECK (result IN ('complete', 'left', 'interrupted', 'skipped')),
  ended_at         INTEGER,
  rating           INTEGER CHECK (rating BETWEEN 1 AND 5),
  problems         TEXT,
  created_at       INTEGER NOT NULL
);
-- Una compra activa por persona, y un solo turno ofrecido o en juego por sala.
CREATE UNIQUE INDEX bookings_one_per_user ON bookings(user_id) WHERE status IN ('queued', 'offered', 'playing');
CREATE UNIQUE INDEX bookings_one_turn ON bookings(room_id) WHERE status IN ('offered', 'playing');
CREATE INDEX bookings_queue ON bookings(room_id, status, position);
CREATE INDEX bookings_user ON bookings(user_id, started_at);

-- --- Configuración, juegos y auditoría ---
CREATE TABLE settings (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  block_minutes      INTEGER NOT NULL DEFAULT 30 CHECK (block_minutes > 0),
  block_credits      INTEGER NOT NULL DEFAULT 15 CHECK (block_credits > 0),
  max_minutes        INTEGER NOT NULL DEFAULT 120 CHECK (max_minutes >= block_minutes AND max_minutes % block_minutes = 0),
  accept_seconds     INTEGER NOT NULL DEFAULT 60 CHECK (accept_seconds BETWEEN 15 AND 300),
  yape_holder        TEXT NOT NULL DEFAULT '',
  yape_number        TEXT NOT NULL DEFAULT '',
  yape_qr_url        TEXT,
  youtube_channel_id TEXT
);
INSERT INTO settings (id) VALUES (1);

CREATE TABLE games (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  genre   TEXT NOT NULL,
  players INTEGER NOT NULL DEFAULT 1,
  status  TEXT NOT NULL DEFAULT 'soon' CHECK (status IN ('available', 'soon', 'unavailable')),
  art     TEXT                            -- JSON opcional con el dibujo de píxeles
);

CREATE TABLE audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id   TEXT NOT NULL REFERENCES users(id),
  action     TEXT NOT NULL,
  target     TEXT,
  reason     TEXT,
  created_at INTEGER NOT NULL
);

-- La tabla 'turns' de la versión anterior se conserva sin cambios (historial antiguo).
