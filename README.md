# Casa Oaxtepec

Sitio estático publicado con GitHub Pages. Las 21 fotografías originales se conservan en `pics/`, están en el bucket público `gallery` de Supabase y se muestran desde `public.gallery_photos` en una galería adaptable con filtros, visor y navegación por teclado.

## Preparación local

Abre `index.html` directamente o sirve la carpeta con cualquier servidor estático. No se requieren dependencias para la galería.

## Supabase

`supabase/schema.sql` contiene el esquema y las políticas aplicadas para galería, reservaciones, promociones y cupones. `supabase-config.js` usa el Project URL y la clave publishable, apta para el navegador con RLS habilitada. La página consulta las fotos activas y conserva `pics/` como respaldo.

El sitio aún no envía solicitudes a Supabase. El formulario permanece deshabilitado hasta que se configure un endpoint seguro de reservaciones. Ese endpoint debe validar fechas y capacidad, limitar envíos abusivos, insertar como `pending`, notificar al anfitrión y nunca aceptar del navegador un precio, estado aprobado o referencia de pago. La clave `service_role` debe quedar exclusivamente en secretos del servidor/Edge Function.

## Siguientes pasos para producción

1. Revisar el esquema contra el proyecto Supabase existente y migrar sin borrar datos.
2. Conectar la galería al bucket y tabla; completar las descripciones reales de cada foto.
3. Crear autenticación de administración con MFA y rol asignado solo desde servidor.
4. Implementar Edge Functions para solicitudes, aprobación, avisos por correo y creación/verificación de pagos.
5. Elegir pasarela y configurar sus credenciales de prueba y webhooks firmados antes de habilitar cobros.

El sitio está alojado como frontend estático: las credenciales privadas, decisiones de reservación, correos y pagos no se deben implementar en JavaScript público.
