# Changelog

## 1.0.0 — 2026-10-23

Primera versión con el flujo completo estilo Airbnb (bares = anfitriones, músicos = huéspedes).

### Nuevo
- **Reservas**: publicar fechas, solicitar o reservar al instante, aceptar, pagar con retención, realizar el show, liberar el pago.
- **Pagos**: comisión configurable (por defecto 0), pago simulado o **Mercado Pago** (Checkout Pro, webhook con firma, reembolsos reales, cobros a músicos por transferencia).
- **Cancelaciones** con política flexible / moderada / estricta, disputas y vencimientos automáticos.
- **Reseñas cruzadas** (se publican cuando ambos reseñan o a los 14 días), chat por reserva, insignias Superanfitrión / Superartista.
- **Descubrimiento**: búsqueda con filtros, favoritos, alertas de búsqueda, cartelera pública sin cuenta.
- **Avisos**: bandeja interna + **email (Resend)** + **push (Web Push)** con reintentos y preferencias.
- **Tour de bienvenida** (anfitrión / músico / público) y sección **Novedades**.
- **Verificación de perfiles** y panel de ganancias / cobros.

### Seguridad
- Se eliminan las políticas de escritura abiertas del esquema inicial; toda escritura pasa por funciones RPC con RLS por participante.
- Webhooks verificados por firma y siempre contrastados con Mercado Pago; endpoints de workers protegidos por secreto.

### Correcciones encontradas por las pruebas
- Deadlocks (FKs vs `FOR UPDATE`; restricciones de exclusión con inserciones simultáneas del mismo bar o aceptaciones del mismo músico).
- Topes (solicitudes pendientes, favoritos, búsquedas, dispositivos) saltables con peticiones en paralelo.
- Búsqueda y reseñas ilegibles para visitantes sin sesión; fecha "reservada" tras una disputa con reembolso total.
- Preferencias de aviso que se pisaban con dos clics rápidos; botón "Probar ahora" hacia pestañas inexistentes.
