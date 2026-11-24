-- Registro de las fotografías originales, conservadas en el repo /pics.
insert into public.gallery_photos (storage_path, alt_text, category, sort_order)
values
  ('casa1.jpg', 'Casa Oaxtepec · 01', 'Casa', 1),
  ('casa2.jpg', 'Casa Oaxtepec · 02', 'Casa', 2),
  ('casa3.jpg', 'Casa Oaxtepec · 03', 'Casa', 3),
  ('casa4.jpg', 'Casa Oaxtepec · 04', 'Casa', 4),
  ('casa5.jpg', 'Casa Oaxtepec · 05', 'Casa', 5),
  ('casa6.jpg', 'Casa Oaxtepec · 06', 'Casa', 6),
  ('casa7.jpg', 'Casa Oaxtepec · 07', 'Casa', 7),
  ('casa8.jpg', 'Casa Oaxtepec · 08', 'Casa', 8),
  ('casa9.jpg', 'Casa Oaxtepec · 09', 'Casa', 9),
  ('casa10.jpg', 'Casa Oaxtepec · 10', 'Casa', 10),
  ('casa11.jpg', 'Casa Oaxtepec · 11', 'Casa', 11),
  ('casa12.jpg', 'Casa Oaxtepec · 12', 'Casa', 12),
  ('casa13.jpg', 'Casa Oaxtepec · 13', 'Casa', 13),
  ('casa14.jpg', 'Casa Oaxtepec · 14', 'Casa', 14),
  ('casa15.jpg', 'Casa Oaxtepec · 15', 'Casa', 15),
  ('casa16.jpg', 'Casa Oaxtepec · 16', 'Casa', 16),
  ('casa17.jpg', 'Casa Oaxtepec · 17', 'Casa', 17),
  ('casa18.jpg', 'Casa Oaxtepec · 18', 'Casa', 18),
  ('casa19.jpg', 'Casa Oaxtepec · 19', 'Casa', 19),
  ('casa20.jpg', 'Casa Oaxtepec · 20', 'Casa', 20),
  ('casa21.jpg', 'Casa Oaxtepec · 21', 'Casa', 21)
on conflict (storage_path) do update
set alt_text = excluded.alt_text, category = excluded.category, sort_order = excluded.sort_order, is_active = true;
