-- ==============================================================================
-- SuenaBA - Esquema de Base de Datos para Supabase (Buenos Aires Live Music)
-- Ejecutá este script en tu panel de Supabase:
-- SQL Editor -> New Query -> Pegar todo -> Clic en RUN
-- ==============================================================================

-- 1. Habilitar extensión UUID
create extension if not exists "uuid-ossp";

-- 2. Tabla de Bares y Restaurantes (Venues)
create table if not exists public.venues (
  id text primary key,
  name text not null,
  neighborhood text not null,
  address text not null,
  type text not null,
  rating numeric(3,2) default 5.0,
  review_count integer default 0,
  bio text,
  cover_photo text,
  photos text[] default '{}',
  capacity integer default 100,
  backline text[] default '{}',
  acoustic_characteristics text,
  hospitality text,
  rating_breakdown jsonb default '{"soundQuality": 5.0, "paymentReliability": 5.0, "hospitality": 5.0, "respect": 5.0}'::jsonb,
  reviews jsonb default '[]'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Tabla de Músicos y Bandas (Musicians)
create table if not exists public.musicians (
  id text primary key,
  stage_name text not null,
  format text not null,
  genres text[] default '{}',
  members_count integer default 1,
  rating numeric(3,2) default 5.0,
  review_count integer default 0,
  min_cachet_default numeric(12,2) default 100000,
  bio text,
  avatar_url text,
  photos text[] default '{}',
  spotify_demo_title text,
  instagram_handle text,
  technical_rider text,
  rating_breakdown jsonb default '{"punctuality": 5.0, "liveSound": 5.0, "crowdDrawing": 5.0, "professionalism": 5.0}'::jsonb,
  reviews jsonb default '[]'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Tabla de Convocatorias de Bares (Open Calls - Función 1)
create table if not exists public.open_calls (
  id text primary key default gen_random_uuid()::text,
  venue_id text references public.venues(id) on delete cascade,
  venue_name text not null,
  venue_neighborhood text not null,
  venue_avatar text,
  date text not null,
  soundcheck_time text not null,
  show_time text not null,
  target_genres text[] default '{}',
  target_formats text[] default '{}',
  cachet_type text default 'fijo_mas_consumo',
  cachet_amount_ars numeric(12,2) not null,
  cachet_details text,
  provided_backline text[] default '{}',
  special_notes text,
  status text default 'abierta',
  confirmed_musician_id text,
  confirmed_musician_name text,
  applications jsonb default '[]'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Tabla de Músicos con Fecha Libre (Availabilities - Función 2)
create table if not exists public.musician_availabilities (
  id text primary key default gen_random_uuid()::text,
  musician_id text references public.musicians(id) on delete cascade,
  musician_name text not null,
  musician_avatar text,
  musician_format text not null,
  musician_genres text[] default '{}',
  date text not null,
  time_slot text default 'noche',
  preferred_neighborhoods text[] default '{}',
  expected_cachet_ars numeric(12,2) not null,
  message text,
  status text default 'disponible',
  direct_offers jsonb default '[]'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. Tabla de Shows en Cartelera (Live Shows - Función 3)
create table if not exists public.live_shows (
  id text primary key default gen_random_uuid()::text,
  venue_id text references public.venues(id) on delete cascade,
  venue_name text not null,
  venue_address text not null,
  venue_neighborhood text not null,
  venue_photo text,
  musician_id text references public.musicians(id) on delete cascade,
  musician_name text not null,
  musician_avatar text,
  musician_genres text[] default '{}',
  musician_format text not null,
  date text not null,
  time text not null,
  ticket_type text default 'consumicion_minima',
  ticket_price_ars numeric(12,2) default 0,
  description text,
  is_completed boolean default false,
  venue_reviewed boolean default false,
  musician_reviewed boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 7. Tabla de Reseñas Bilaterales (Estilo Airbnb)
create table if not exists public.reviews (
  id text primary key default gen_random_uuid()::text,
  show_id text,
  author_id text not null,
  author_name text not null,
  author_type text not null,
  author_avatar text,
  target_id text not null,
  target_type text not null,
  show_date text not null,
  rating numeric(3,2) not null,
  criteria_breakdown jsonb not null,
  comment text not null,
  tags text[] default '{}',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Políticas de Seguridad (Row Level Security - RLS)
alter table public.venues enable row level security;
alter table public.musicians enable row level security;
alter table public.open_calls enable row level security;
alter table public.musician_availabilities enable row level security;
alter table public.live_shows enable row level security;
alter table public.reviews enable row level security;

-- Permisos de lectura pública
create policy "Allow public read on venues" on public.venues for select using (true);
create policy "Allow public read on musicians" on public.musicians for select using (true);
create policy "Allow public read on open_calls" on public.open_calls for select using (true);
create policy "Allow public read on musician_availabilities" on public.musician_availabilities for select using (true);
create policy "Allow public read on live_shows" on public.live_shows for select using (true);
create policy "Allow public read on reviews" on public.reviews for select using (true);

-- Permisos de inserción y actualización para usuarios públicos/anónimos
create policy "Allow insert on open_calls" on public.open_calls for insert with check (true);
create policy "Allow update on open_calls" on public.open_calls for update using (true);

create policy "Allow insert on musician_availabilities" on public.musician_availabilities for insert with check (true);
create policy "Allow update on musician_availabilities" on public.musician_availabilities for update using (true);

create policy "Allow insert on live_shows" on public.live_shows for insert with check (true);
create policy "Allow update on live_shows" on public.live_shows for update using (true);

create policy "Allow insert on reviews" on public.reviews for insert with check (true);
create policy "Allow update on venues" on public.venues for update using (true);
create policy "Allow update on musicians" on public.musicians for update using (true);

-- ==============================================================================
-- INSERCIÓN DE DATOS INICIALES (Bares y Músicos Porteños)
-- ==============================================================================

insert into public.venues (id, name, type, address, neighborhood, cover_photo, capacity, bio, backline, acoustic_characteristics, hospitality, rating, review_count)
values
(
  'venue-1',
  'Thelonious Jazz Club',
  'Club de Jazz',
  'Nicaragua 5549',
  'Palermo Hollywood',
  'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&auto=format&fit=crop&q=80',
  95,
  'El templo del jazz y el soul en Buenos Aires. Ambiente tenue con cócteles de autor, mesas de madera y una acústica tratada por ingenieros de sonido.',
  array['Piano de media cola Yamaha C3 afinado', 'Batería Gretsch Catalina Club completa', 'Ampli bajo Ampeg BA-115', 'Ampli guitarra Fender Hot Rod Deluxe', 'Consola Behringer X32 digital'],
  'Tratamiento acústico profesional con difusores de madera y piso entablonado.',
  'Cena a la carta + 2 cócteles o cervezas por músico.',
  4.94,
  38
),
(
  'venue-2',
  'Bebop Subterráneo',
  'Speakeasy & Música en Vivo',
  'Uriarte 1658',
  'Palermo Soho',
  'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=1200&auto=format&fit=crop&q=80',
  120,
  'Subsuelo íntimo inspirado en los jazz clubs de Greenwich Village. Sonido de altísima definición, coctelería clásica y respeto reverencial por la música.',
  array['Piano vertical Kawai afinado', 'Batería Ludwig Neusonic', 'Ampli bajo Markbass Mini CMD', 'Ampli guitarra Roland Jazz Chorus JC-120'],
  'Insonorización total de sótano con paneles absorbentes.',
  'Tabla de tapeo gourmet + bebidas sin cargo para la banda.',
  4.98,
  52
),
(
  'venue-3',
  'Morán Espacio & Taberna',
  'Centro Cultural & Restó Bar',
  'Pedro Ignacio Rivera 4275',
  'Colegiales',
  'https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=1200&auto=format&fit=crop&q=80',
  160,
  'Un faro cultural en Colegiales. Patio cervecero, taberna con platos caseros y una sala de conciertos donde convergen el indie, el jazz y la canción de autor.',
  array['Batería Pearl Export completa', 'Ampli bajo Fender Rumble 100', 'Ampli guitarra Vox AC15', '4 retornos de piso activos'],
  'Sala viva con calidez en frecuencias medias y graves controlados.',
  'Platos principales del menú nocturno + cerveza tirada artesanal.',
  4.85,
  44
),
(
  'venue-4',
  'Café & Bar El Federal',
  'Bar Notable Porteño',
  'Carlos Calvo 599',
  'San Telmo',
  'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1200&auto=format&fit=crop&q=80',
  80,
  'Esquina histórica de 1864 en San Telmo. Boiserie original, vitrales y piso de mosaico. Ciclos íntimos de tango contemporáneo, folklore y música acústica.',
  array['Sistema de PA compacto Yamaha StagePas 600', '2 micrófonos Shure SM58 con pies', 'Cajas directas pasivas'],
  'Acústica natural con resonancia típica de café histórico de techos altos.',
  'Picada federal completa + vermut de la casa o vino.',
  4.91,
  29
)
on conflict (id) do nothing;

insert into public.musicians (id, stage_name, format, genres, members_count, min_cachet_default, bio, avatar_url, spotify_demo_title, instagram_handle, rating, review_count)
values
(
  'mus-1',
  'Julieta Díaz & Trío Nocturno',
  'Trío',
  array['Jazz', 'Bossa & MPB', 'Blues & Soul'],
  3,
  120000,
  'Trío de jazz contemporáneo y bossa nova formado en 2021. Julieta en voz y percusión suave, Nico en contrabajo y Martín en guitarra hollow-body. Repertorio de clásicos de Jobim, Miles Davis y reversiones en español.',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
  'Midnight in Corrientes (Live Demo)',
  '@julietadiaz.trio',
  4.96,
  24
),
(
  'mus-2',
  'Fuerza Maleva (Tango Fusión)',
  'Dúo (Bandoneón + Guitarra)',
  array['Tango & Fusión', 'Acústico'],
  2,
  95000,
  'Dúo formado por egresados del Conservatorio Manuel de Falla. Diálogo potente y moderno entre bandoneón de doble fuelle y guitarra de siete cuerdas. Arreglos de Piazzolla, Troilo y composiciones propias.',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
  'Fuelle Urbano (En vivo en San Telmo)',
  '@fuerzamaleva.tango',
  5.0,
  19
),
(
  'mus-3',
  'Los Pibes del Pasaje',
  'Cuarteto Indie Rock',
  array['Indie', 'Rock'],
  4,
  140000,
  'Banda de guitarras limpias, melodías pegadizas y letras que retratan la juventud porteña. Mucha energía en vivo, público fiel de entre 20 y 35 años que consume barra.',
  'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=400&auto=format&fit=crop&q=80',
  'Veredas de Chacarita (EP)',
  '@lospibesdelpasaje',
  4.88,
  31
),
(
  'mus-4',
  'Martina Ramos Folk',
  'Solista (Voz, Guitarra y Loop Station)',
  array['Acústico', 'Folklore', 'Pop'],
  1,
  75000,
  'Cantautora con raíz folklórica y estética contemporánea. Combina zambas y chacareras con loops vocales y paisajes sonoros en guitarra acústica.',
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&auto=format&fit=crop&q=80',
  'Viento del Valle (Sesión Acústica)',
  '@martinaramosfolk',
  4.92,
  16
)
on conflict (id) do nothing;
