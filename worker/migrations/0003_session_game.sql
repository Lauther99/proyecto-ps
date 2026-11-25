-- Juego que tenía la sala cuando se jugó: cambiarlo después no altera el historial.
ALTER TABLE bookings ADD COLUMN game TEXT;
