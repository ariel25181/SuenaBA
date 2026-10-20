# 🎷 SuenaBA - Red de Música en Vivo & Bares de Buenos Aires

Una aplicación web mobile-first optimizada para celulares Android y iPhone, inspirada en la dinámica de **Airbnb** para conectar a la escena musical y gastronómica de la Ciudad Autónoma de Buenos Aires (CABA).

![SuenaBA Banner](https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&auto=format&fit=crop&q=80)

---

## 🚀 Las 3 Funciones Principales

### 1. Convocatorias de Bares y Restaurantes (Open Calls)
- Los bares y restaurantes porteños (Palermo, San Telmo, Colegiales, etc.) publican fechas en las que buscan músicos para tocar en vivo.
- Especificación de horarios de prueba de sonido y show, caché garantizado en pesos argentinos (monto fijo o fijo + consumición/cena), géneros buscados y equipamiento técnico/backline disponible (piano afinado, batería armada, amplificadores, consola y micrófonos).
- Panel de gestión para que el local revise postulaciones recibidas, escuche demos y confirme la fecha en la cartelera.

### 2. Postulaciones & Fechas Disponibles de Músicos
- **Postulaciones directas**: Los músicos exploran convocatorias abiertas con filtros por barrio, estilo y caché mínimo, enviando su propuesta con demo track y mensaje.
- **Tablón de Disponibilidad ("Fechas Libres")**: Los artistas publican qué días tienen libres en Buenos Aires para que los dueños y programadores de bares los contacten y les envíen ofertas directas de fecha.

### 3. Cartelera y Catálogo de Música en Vivo de Buenos Aires
- Cartelera cultural pública con los shows confirmados en locales de CABA.
- Filtros interactivos por barrio (Palermo Soho, San Telmo, Colegiales, Chacarita, Recoleta, etc.) y género musical (Jazz, Tango, Indie, Rock, Acústico, Bossa Nova, Folklore).
- Información de accesos (Entrada libre, consumición mínima, ticket) y simulación de reserva de mesa.

---

## ⭐ Sistema de Reputación Bilateral (Estilo Airbnb)

Solo los bares y músicos que hayan acordado y completado una fecha pueden calificarse mutuamente:
- **Los músicos califican al bar**: Puntualidad en el pago del caché, calidad de sonido y acústica, hospitalidad/cena y trato a los artistas.
- **Los bares califican al músico**: Puntualidad (prueba y show), calidad de sonido en vivo, convocatoria de público y profesionalismo/cuidado de equipos.
- Sistema de puntuación con estrellas (1 a 5), desglose de criterios y etiquetas verificadas (*"Pago en mano al toque"*, *"Sonido impecable"*, *"Puntualidad británica"*, *"Llenaron la sala"*).

---

## 🛠️ Tecnologías Utilizadas

- **React 19** con **TypeScript**
- **Tailwind CSS v4** con tipografía fluida y paleta nocturna porteña
- **Lucide React** (iconografía completa)
- **Node.js 22 test runner** (`node:test`) para pruebas unitarias de lógica pura
- **Playwright CLI** para verificación automatizada en entornos móviles y de escritorio

---

## 📦 Instalación y Ejecución Local

1. Clonar el repositorio:
   ```bash
   git clone https://github.com/TU_USUARIO/suenaba.git
   cd suenaba
   ```

2. Instalar dependencias:
   ```bash
   npm install
   ```

3. Iniciar el servidor de desarrollo:
   ```bash
   npm run dev
   ```

4. Abrir en el navegador:
   ```
   http://localhost:3000
   ```

5. Ejecutar tests unitarios:
   ```bash
   npm test
   # o directamente:
   node --test src/utils/bookingLogic.test.ts
   ```

---

## 📱 Subir este proyecto a un nuevo repositorio de GitHub

Para vincular este proyecto a tu cuenta personal de GitHub:

1. Creá un repositorio vacío en tu cuenta de GitHub (por ejemplo llamado `suenaba`):
   - Entrá a [https://github.com/new](https://github.com/new)
   - Nombre del repo: `suenaba`
   - No tildes "Add a README" (ya tenemos este listo)
   - Hacé clic en **Create repository**

2. En tu terminal o consola, ejecutá:
   ```bash
   git remote add origin https://github.com/TU_USUARIO/suenaba.git
   git branch -M main
   git push -u origin main
   ```
   *(Reemplazá `TU_USUARIO` por tu usuario de GitHub)*

---

Desarrollado para la comunidad de música en vivo y gastronomía de Buenos Aires.

## Reservas estilo Airbnb (bares = anfitriones, músicos = huéspedes)

Flujo: el bar **publica una fecha** → el músico **solicita** (o reserva al instante) → el bar **acepta** →
el bar **paga** (el dinero queda retenido) → se hace el show → se libera el pago → **reseñas cruzadas**.
Estados: `solicitada → aceptada → confirmada → realizada` (+ `rechazada`, `cancelada`, `expirada`).

- **Comisión configurable** en `app_settings` (`venue_fee_bps`, `musician_fee_bps`, 100 bps = 1%). Por defecto **0**. Se congela al pagar.
- **Cancelación** según política del bar (flexible / moderada / estricta). Si cancela el músico, el bar recibe reembolso total y el músico suma una cancelación tardía si faltaban menos de 24 h.
- **Reseñas**: solo tras un show realizado, una por parte; se publican cuando ambos reseñan o a los 14 días.
- **Disputas**: cualquiera de las partes puede reportar un problema tras empezar el show; el pago queda retenido hasta que el equipo resuelve (`admin_resolve_dispute`).
- Toda escritura pasa por funciones RPC (`supabase/migrations/20261019000000_reservas.sql`); los clientes solo leen, con RLS por participante.
- Cliente: `src/lib/bookingsApi.ts` (RPC + mensajes de error en español) y `src/domain/bookingRules.ts` (reglas de dinero/estados para previsualizar en la UI).

### Funciones tipo Airbnb incluidas
| Función | Cómo funciona |
|---|---|
| **Publicar fechas** con calendario, cachet, backline, política de cancelación y modo (instantánea / con aprobación) | `create_listing`, panel "Mis fechas" |
| **Búsqueda** por fecha, barrio, género, cachet, modo, calificación, texto; orden y paginación; ocultar fechas que se pisan con mis shows | `search_listings`, pestaña "Explorar" |
| **Favoritos** (fechas, bares, músicos) | `toggle_favorite` |
| **Alertas de búsqueda**: guardás filtros y te avisan cuando se publica una fecha que coincide | `save_search` + trigger |
| **Notificaciones** internas por cada evento de la reserva y por mensajes (con cola de entrega para push/email) | tabla `notifications`, `claim_pending_notifications` |
| **Chat** por reserva | `send_message` |
| **Reserva, pago retenido, cancelación con reembolso, disputas, vencimientos** | ver más arriba |
| **Reseñas cruzadas** que se publican cuando ambos reseñan o a los 14 días | `submit_review` |
| **Superanfitrión / Superartista** (shows, calificación, cancelaciones y tasa de respuesta) | `entity_stats` |
| **Verificación de perfiles**: solicitud → aprobación del equipo → perfil verificado (opcionalmente obligatoria) | `request_profile`, `admin_review_profile_request`, `app_settings.require_verification` |
| **Ganancias / pagos** del bar y del músico | `my_earnings`, pestaña "Cuenta" |

**Pantallas**: nueva pestaña **Reservas** en la app (login con Supabase Auth → alta de perfil → Explorar / Mis fechas / Reservas / Favoritos / Avisos / Cuenta). Código en `src/components/reservas/`. Las pantallas viejas (Cartelera, Convocatorias, etc.) siguen funcionando con su estado local.

### Aplicar en Supabase
1. Ejecutar `supabase-schema.sql` (si no está aplicado) y luego, en orden, `supabase/migrations/20261019000000_reservas.sql` y `supabase/migrations/20261020000000_airbnb_extras.sql` en el SQL Editor.
2. Los usuarios nuevos piden su perfil desde la app (`request_profile`); el equipo lo aprueba con `select admin_review_profile_request('<id>', true, 'ok')` (service role), que crea el bar/músico y el perfil verificado.
3. Programar (pg_cron o Edge Function) cada 5–15 min: `select expire_stale_bookings(); select complete_due_bookings();` y a diario `select publish_due_reviews();`.

> **Pagos simulados**: hoy `fund_booking` registra una retención con `provider = 'simulado'`. Falta integrar Mercado Pago (o similar) antes de cobrar dinero real.

### Tests
```bash
bun run build && npm test            # unitarios (reglas, API cliente, bookingLogic)
npm run test:db                       # requiere Postgres: TEST_DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres
npm run test:ui                       # renderiza las pantallas (jsdom) contra un Postgres real, como usuarios con RLS
npm run test:all
```
`test:db` crea una base temporal con el esquema real y corre: ~60 casos borde, una **simulación concurrente de 10 bares × 10 músicos** (4 semillas, con distintas comisiones) que verifica invariantes (sin dobles reservas, dinero que cuadra, reseñas y calificaciones consistentes, auditoría válida) y una prueba de paridad TypeScript ↔ SQL.
**CI**: el workflow `.github/workflows/ci.yml` corre todo en cada PR con un Postgres real.
Para comprobar que las pruebas detectan fallos: `MUTATE=overlap npm run test:db` quita una protección a propósito y debe fallar.
