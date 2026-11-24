# Casa Oaxtepec

Sitio estático publicado con GitHub Pages. Las 21 fotografías originales se conservan en `pics/`, están en el bucket público `gallery` de Supabase y se muestran desde `public.gallery_photos` en una galería adaptable con filtros, visor y navegación por teclado.

## Preparación local

Abre `index.html` directamente o sirve la carpeta con cualquier servidor estático. No se requieren dependencias para la galería.

## Supabase, tarifas y reservaciones

`supabase/management_pricing.sql` configura precios por noche (lunes a jueves $800 con 25% de descuento; viernes a domingo $1,000 con 15%), periodos sin descuento, cuentas de depósito, administración y detalles de reservación. `supabase/security_hardening.sql` restringe la ejecución de la función de trigger y mantiene los PDF en un bucket privado. `supabase/voucher_document.sql` agrega a la reserva el identificador privado del comprobante PDF. Estas migraciones ya están aplicadas al proyecto conectado. No vuelvas a aplicar el esquema inicial sobre una base existente.

Las excepciones parametrizables cubren puentes y días festivos de 2026 a 2040; el administrador puede agregar, pausar o reactivar rangos. La cotización se calcula noche por noche y cualquier fecha que se cruce con un rango activo conserva su precio base sin descuento. La cotización se guarda junto con la solicitud, pero el propietario debe revisarla antes de autorizar.

El sitio consulta `public.gallery_photos`; `pics/` se mantiene como respaldo. Las solicitudes se registran como `pending`, con contacto, fechas, evento y vehículos. Pendientes y autorizadas no bloquean fechas. El propietario autoriza y envía por correo las instrucciones de depósito; luego verifica el pago manualmente y confirma. Solo `confirmed` aparece ocupado y un trigger evita traslapes. La confirmación genera una autorización PDF privada con datos del huésped y autos.

## Panel administrativo

Abre `/admin.html`. Inicia sesión con una cuenta de Supabase Auth cuyo correo esté activo en `public.authorized_admins`. La cuenta inicial autorizada es `contacto.mgnsoft@gmail.com`; crea/verifica su usuario en Auth si todavía no existe. Las contraseñas las gestiona Supabase Auth con hash; esta app no guarda contraseñas propias. El panel permite revisar solicitudes y calendario, configurar tarifas/excepciones y cuenta de depósito, gestionar fotos, promociones, cupones y correos administrativos.

## Correos y recordatorios

La Edge Function `reservation-notifications` maneja autorización, confirmación, el PDF y recordatorios. Para correo, configura en Supabase Functions Secrets:

* `RESEND_API_KEY`: clave de Resend.
* `EMAIL_FROM`: remitente verificado, por ejemplo `Casa Oaxtepec <reservaciones@tudominio.mx>`.
* `REMINDER_CRON_TOKEN`: token aleatorio largo para la llamada programada.

WhatsApp automatizado es opcional y requiere una cuenta WhatsApp Business, token y plantillas previamente aprobadas por Meta. Configura `WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_GUEST_REMINDER_TEMPLATE`, `WA_OWNER_REMINDER_TEMPLATE` y opcionalmente `WA_API_VERSION`/`WA_TEMPLATE_LANGUAGE` como secretos de la función. Sin estos proveedores, el panel registra la solicitud y genera el PDF, pero no envía correos ni WhatsApp.

GitHub Pages solo sirve archivos estáticos; `.github/workflows/reservation-reminders.yml` usa GitHub Actions para llamar una vez al día la función, a las 15:00 UTC (09:00 en Oaxtepec). Añade los Actions secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `REMINDER_CRON_TOKEN` al repositorio y despliega la Edge Function con `verify_jwt=false`; la función valida el token del cron. Ejecuta el workflow manualmente para comprobarlo. No agregues claves `service_role` o `sb_secret` al sitio ni al repositorio.

## Pagos

El flujo de hoy es transferencia/depósito con verificación manual por el propietario. No se conectó cobro con tarjeta: para eso hace falta elegir y configurar una pasarela y sus credenciales privadas en un backend/Edge Function; nunca deben exponerse en JavaScript de GitHub Pages.

## SEO

Incluye título y descripción en español, URL canónica, Open Graph, datos estructurados de alojamiento, `robots.txt` y `sitemap.xml`. Estas señales ayudan a los buscadores a entender e indexar el sitio, pero no garantizan aparecer en los primeros resultados. Después de publicar, registra el sitemap en Google Search Console y Bing Webmaster Tools.

El sitio está alojado como frontend estático: las credenciales privadas, decisiones de reservación, correos y pagos no se deben implementar en JavaScript público.
