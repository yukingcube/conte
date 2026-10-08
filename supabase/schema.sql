-- コンテ：Supabase に作る表・権限・ファイル置き場
-- Supabase の SQL Editor に全文を貼り付けて Run する。何度実行しても壊れないように書いてある。

-- ============================================================
-- 表
-- ============================================================

-- コンテ（プロジェクト）。音源や工程などカット以外の情報は meta にまとめて入れる
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '無題のコンテ',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 共有相手（次の版で使う。今は表と権限だけ用意しておく）
create table if not exists public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- カット。絵・歌詞・予定などは data にまとめて入れる
create table if not exists public.cuts (
  id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  position double precision not null,
  duration double precision not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists cuts_project_position on public.cuts (project_id, position);
create index if not exists projects_owner on public.projects (owner_id);
create index if not exists project_members_user on public.project_members (user_id);

-- ============================================================
-- 権限の判定に使う関数
-- 表同士が互いの権限を見に行って堂々巡りにならないよう、関数の中で直接調べる
-- ============================================================

create or replace function public.is_project_owner(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.projects p
    where p.id = pid and p.owner_id = auth.uid()
  );
$$;

create or replace function public.is_project_member(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = pid and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_project_editor(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = pid and m.user_id = auth.uid() and m.role = 'editor'
  );
$$;

create or replace function public.can_read_project(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_project_owner(pid) or public.is_project_member(pid);
$$;

create or replace function public.can_edit_project(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_project_owner(pid) or public.is_project_editor(pid);
$$;

-- ファイルの場所（「コンテのID/ファイル名」）から、コンテのIDを取り出す
create or replace function public.path_project_id(object_name text)
returns uuid
language plpgsql
immutable
as $$
declare
  seg text := split_part(object_name, '/', 1);
begin
  if seg ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return seg::uuid;
  end if;
  return null;
end;
$$;

-- ============================================================
-- 行ごとの権限（ログインした人だけが、自分に関係する行だけを扱える）
-- ============================================================

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.cuts enable row level security;

grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_members to authenticated;
grant select, insert, update, delete on public.cuts to authenticated;

-- projects
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (owner_id = auth.uid() or public.is_project_member(id));

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated
  using (owner_id = auth.uid() or public.is_project_editor(id))
  with check (owner_id = auth.uid() or public.is_project_editor(id));

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete to authenticated
  using (owner_id = auth.uid());

-- project_members（持ち主だけが共有相手を増減できる。本人は自分の行を見られる）
drop policy if exists members_select on public.project_members;
create policy members_select on public.project_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_project_owner(project_id));

drop policy if exists members_insert on public.project_members;
create policy members_insert on public.project_members
  for insert to authenticated
  with check (public.is_project_owner(project_id));

drop policy if exists members_update on public.project_members;
create policy members_update on public.project_members
  for update to authenticated
  using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

drop policy if exists members_delete on public.project_members;
create policy members_delete on public.project_members
  for delete to authenticated
  using (public.is_project_owner(project_id));

-- cuts
drop policy if exists cuts_select on public.cuts;
create policy cuts_select on public.cuts
  for select to authenticated
  using (public.can_read_project(project_id));

drop policy if exists cuts_insert on public.cuts;
create policy cuts_insert on public.cuts
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists cuts_update on public.cuts;
create policy cuts_update on public.cuts
  for update to authenticated
  using (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists cuts_delete on public.cuts;
create policy cuts_delete on public.cuts
  for delete to authenticated
  using (public.can_edit_project(project_id));

-- ============================================================
-- ファイル置き場（音源と画像）。外からは直接見えない非公開の置き場にする
-- 1ファイルの上限は 20MB
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 20971520)
on conflict (id) do nothing;

drop policy if exists media_select on storage.objects;
create policy media_select on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and public.can_read_project(public.path_project_id(name)));

drop policy if exists media_insert on storage.objects;
create policy media_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and public.can_edit_project(public.path_project_id(name)));

drop policy if exists media_update on storage.objects;
create policy media_update on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and public.can_edit_project(public.path_project_id(name)))
  with check (bucket_id = 'media' and public.can_edit_project(public.path_project_id(name)));

drop policy if exists media_delete on storage.objects;
create policy media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and public.can_edit_project(public.path_project_id(name)));
