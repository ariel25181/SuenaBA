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
