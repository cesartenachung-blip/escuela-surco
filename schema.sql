-- =============================================================================
-- Escuela de Líderes - Comunidad Cristiana Agua Viva Surco
-- Esquema de base de datos para Supabase (Postgres)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
create table if not exists usuarios (
  dni        text primary key,
  celular    text not null,
  nombre     text not null,
  apellido   text not null,
  rol        text not null check (rol in ('admin','monitor','estudiante')),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists trimestres (
  id         text primary key default ('trim_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10)),
  nombre     text not null,
  created_at timestamptz not null default now()
);

create table if not exists cursos (
  id           text primary key default ('curso_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10)),
  nombre       text not null,
  trimestre_id text references trimestres(id) on delete cascade,
  monitor_dni  text references usuarios(dni) on delete set null,
  bloqueado    boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Migración idempotente: si la tabla "cursos" ya existía de una versión anterior
-- (sin la columna "bloqueado"), esto la agrega sin afectar los datos existentes.
alter table cursos add column if not exists bloqueado boolean not null default false;

create table if not exists inscripciones (
  id            text primary key default ('ins_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10)),
  dni           text not null references usuarios(dni) on delete cascade,
  curso_id      text not null references cursos(id) on delete cascade,
  trabajo_final numeric not null default 0,
  examen_final  numeric not null default 0,
  created_at    timestamptz not null default now(),
  unique (dni, curso_id)
);

-- Migración idempotente para proyectos ya desplegados sin estas columnas.
alter table inscripciones add column if not exists trabajo_final numeric not null default 0;
alter table inscripciones add column if not exists examen_final numeric not null default 0;

create table if not exists asistencia (
  id          text primary key default ('asis_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10)),
  dni         text not null references usuarios(dni) on delete cascade,
  curso_id    text not null references cursos(id) on delete cascade,
  semana      int not null check (semana between 1 and 9),
  asistio     boolean not null default false,
  devocional  boolean not null default false,
  versiculo   boolean not null default false,
  intercesion boolean not null default false,
  fecha       timestamptz,
  updated_at  timestamptz not null default now(),
  unique (dni, curso_id, semana)
);

-- Migración idempotente para proyectos ya desplegados sin esta columna.
alter table asistencia add column if not exists versiculo boolean not null default false;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- La app no usa Supabase Auth (el ingreso es DNI + celular manejado por la
-- propia app), así que no hay un JWT de usuario real que RLS pueda leer con
-- auth.uid(). Estas políticas abren lectura/escritura a quien tenga la
-- "anon key" pública del proyecto, igual que cualquier app cliente-only.
-- Esto es aceptable para una herramienta interna de la iglesia, pero
-- IMPORTANTE: cualquier persona con la anon key (visible en el código del
-- sitio) podría leer o modificar los datos directamente vía API, sin pasar
-- por la interfaz. Ver el README para la opción de reforzar esto con
-- Supabase Auth real si más adelante se necesita.

alter table usuarios       enable row level security;
alter table trimestres     enable row level security;
alter table cursos         enable row level security;
alter table inscripciones  enable row level security;
alter table asistencia     enable row level security;

create policy "usuarios_all"      on usuarios      for all using (true) with check (true);
create policy "trimestres_all"    on trimestres    for all using (true) with check (true);
create policy "cursos_all"        on cursos        for all using (true) with check (true);
create policy "inscripciones_all" on inscripciones for all using (true) with check (true);
create policy "asistencia_all"    on asistencia    for all using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Realtime: publicar cambios para que todos los dispositivos se sincronicen
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table usuarios;
alter publication supabase_realtime add table trimestres;
alter publication supabase_realtime add table cursos;
alter publication supabase_realtime add table inscripciones;
alter publication supabase_realtime add table asistencia;

-- ---------------------------------------------------------------------------
-- Datos de ejemplo (puedes editarlos o borrarlos desde la app como admin)
-- ---------------------------------------------------------------------------
insert into trimestres (id, nombre) values
  ('t_2026_3', '2026 - III Trimestre')
on conflict (id) do nothing;

insert into usuarios (dni, celular, nombre, apellido, rol) values
  ('10000001', '900000001', 'Administrador', 'General',   'admin'),
  ('20000001', '988000001', 'Jorge',         'Ramirez',   'monitor'),
  ('20000002', '988000002', 'Lucia',         'Fernandez', 'monitor'),
  ('30000001', '977000001', 'Ana',           'Torres',    'estudiante'),
  ('30000002', '977000002', 'Luis',          'Quispe',    'estudiante'),
  ('30000003', '977000003', 'Maria',         'Gomez',     'estudiante'),
  ('30000004', '977000004', 'Pedro',         'Salazar',   'estudiante')
on conflict (dni) do nothing;

insert into cursos (id, nombre, trimestre_id, monitor_dni) values
  ('c_liderazgo',   'Fundamentos de Liderazgo', 't_2026_3', '20000001'),
  ('c_discipulado', 'Discipulado Avanzado',     't_2026_3', '20000002')
on conflict (id) do nothing;

insert into inscripciones (dni, curso_id) values
  ('30000001', 'c_liderazgo'),
  ('30000002', 'c_liderazgo'),
  ('30000003', 'c_discipulado'),
  ('30000004', 'c_discipulado')
on conflict (dni, curso_id) do nothing;
