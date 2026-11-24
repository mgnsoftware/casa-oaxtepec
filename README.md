# Casa Oaxtepec

Sitio estático publicado con GitHub Pages. Las 21 fotografías originales se conservan en `pics/`, están en el bucket público `gallery` de Supabase y se muestran desde `public.gallery_photos` en una galería adaptable con filtros, visor y navegación por teclado.

## Preparación local

Abre `index.html` directamente o sirve la carpeta con cualquier servidor estático. No se requieren dependencias para la galería.

## Supabase y reservaciones

`supabase/schema.sql` contiene las tablas y políticas de galería, reservaciones, promociones y cupones. `supabase/reservations.sql` agrega las funciones seguras de calendario y captura. Aplica primero el esquema inicial si aún no existe y luego ejecuta la migración de reservaciones desde SQL Editor. Ambos scripts se limitan al esquema `public` y al bucket `gallery`.

`supabase-config.js` usa el Project URL, la clave publishable del navegador y el WhatsApp del propietario. La página consulta las fotos activas y conserva `pics/` como respaldo. El RPC `get_unavailable_dates` devuelve solo fechas confirmadas, sin datos de huéspedes. `submit_reservation_request` valida y guarda cada solicitud como `pending`; no acepta del navegador un estado, precio o referencia de pago. Las noches pendientes no se bloquean.

Flujo de propietario: revisar filas nuevas de `public.reservations` en Table Editor; cambiar `pending` a `approved` cuando autorice y envíe instrucciones de depósito; verificar el depósito por fuera del sitio y cambiar el estado a `confirmed`. Solo `confirmed` aparece ocupado y un trigger impide confirmar rangos que se traslapen. `declined` o `cancelled` no bloquean. Tras registrar la solicitud, el cliente obtiene un enlace a WhatsApp con el mensaje preparado y debe pulsar Enviar.

El propietario aún verifica depósitos manualmente. No se ha conectado una pasarela, correo automático, ni panel administrativo propio. Nunca publiques una clave `service_role`.

## SEO

Incluye título y descripción en español, URL canónica, Open Graph, datos estructurados de alojamiento, `robots.txt` y `sitemap.xml`. Estas señales ayudan a los buscadores a entender e indexar el sitio, pero no garantizan aparecer en los primeros resultados. Después de publicar, registra el sitemap en Google Search Console y Bing Webmaster Tools.

El sitio está alojado como frontend estático: las credenciales privadas, decisiones de reservación, correos y pagos no se deben implementar en JavaScript público.
