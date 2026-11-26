-- Registro de cada partida, para revisar reclamos. Sin IP. Se borra a los 90 días.
CREATE TABLE session_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  at         INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  detail     TEXT                          -- JSON opcional
);
CREATE INDEX session_events_booking ON session_events(booking_id, at);
CREATE INDEX session_events_at ON session_events(at);
