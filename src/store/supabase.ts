import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Cut, Project, ProjectSummary } from '../types';
import type { DataStore } from './types';
import {
  type CutDataJson,
  type MetaJson,
  cutDataOf,
  defaultPhases,
  metaOf,
  toCut,
  toProject,
} from './mapping';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_KEY as string | undefined;

export const HAS_SUPABASE = Boolean(URL_ && KEY);

const BUCKET = 'media';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    if (!URL_ || !KEY) throw new Error('Supabase の設定がない');
    client = createClient(URL_, KEY, {
      auth: {
        // ログイン後の戻り先に ?code= の形で情報が付く方式。
        // 画面の切り替えに # を使っているので、# を使わないこの方式にしている。
        flowType: 'pkce',
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

interface ProjectRow {
  id: string;
  title: string;
  meta: MetaJson | null;
  updated_at: string;
}

interface CutRow {
  id: string;
  position: number;
  duration: number;
  data: CutDataJson | null;
}

function fail(what: string, message: string): never {
  throw new Error(`${what}に失敗した（${message}）`);
}

export const supabaseStore: DataStore = {
  mode: 'supabase',

  async listProjects(): Promise<ProjectSummary[]> {
    const { data, error } = await supabase()
      .from('projects')
      .select('id,title,updated_at')
      .order('updated_at', { ascending: false });
    if (error) fail('一覧の取得', error.message);
    return ((data ?? []) as ProjectRow[]).map((r) => ({
      id: r.id,
      title: r.title,
      updatedAt: r.updated_at,
    }));
  },

  async createProject(title: string): Promise<Project> {
    const meta: MetaJson = { fps: 30, audio: null, phases: defaultPhases() };
    const { data, error } = await supabase()
      .from('projects')
      .insert({ title, meta })
      .select('id,title,meta,updated_at')
      .single();
    if (error || !data) fail('コンテの作成', error?.message ?? '応答なし');
    const r = data as ProjectRow;
    return toProject(r.id, r.title, r.meta, r.updated_at, []);
  },

  async loadProject(id: string): Promise<Project | null> {
    const sb = supabase();
    const { data, error } = await sb
      .from('projects')
      .select('id,title,meta,updated_at')
      .eq('id', id)
      .maybeSingle();
    if (error) fail('コンテの読み込み', error.message);
    if (!data) return null;
    const r = data as ProjectRow;
    const cutsRes = await sb
      .from('cuts')
      .select('id,position,duration,data')
      .eq('project_id', id)
      .order('position', { ascending: true });
    if (cutsRes.error) fail('カットの読み込み', cutsRes.error.message);
    const cuts = ((cutsRes.data ?? []) as CutRow[]).map((c) =>
      toCut(c.id, c.position, c.duration, c.data),
    );
    return toProject(r.id, r.title, r.meta, r.updated_at, cuts);
  },

  async saveMeta(p: Project): Promise<void> {
    const { error } = await supabase()
      .from('projects')
      .update({ title: p.title, meta: metaOf(p), updated_at: new Date().toISOString() })
      .eq('id', p.id);
    if (error) fail('保存', error.message);
  },

  async upsertCuts(projectId: string, cuts: Cut[]): Promise<void> {
    if (cuts.length === 0) return;
    const now = new Date().toISOString();
    const { error } = await supabase()
      .from('cuts')
      .upsert(
        cuts.map((c) => ({
          id: c.id,
          project_id: projectId,
          position: c.pos,
          duration: c.duration,
          data: cutDataOf(c),
          updated_at: now,
        })),
      );
    if (error) fail('カットの保存', error.message);
  },

  async deleteCuts(projectId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await supabase()
      .from('cuts')
      .delete()
      .eq('project_id', projectId)
      .in('id', ids);
    if (error) fail('カットの削除', error.message);
  },

  async deleteProject(id: string): Promise<void> {
    const sb = supabase();
    // 先にファイルを消す（表を消した後だと、権限の確認ができず消せなくなる）
    const list = await sb.storage.from(BUCKET).list(id, { limit: 1000 });
    if (!list.error && list.data && list.data.length > 0) {
      await sb.storage.from(BUCKET).remove(list.data.map((f) => `${id}/${f.name}`));
    }
    const { error } = await sb.from('projects').delete().eq('id', id);
    if (error) fail('コンテの削除', error.message);
  },

  async uploadFile(projectId: string, name: string, blob: Blob): Promise<string> {
    const path = `${projectId}/${name}`;
    const { error } = await supabase()
      .storage.from(BUCKET)
      .upload(path, blob, { contentType: blob.type || undefined, upsert: false });
    if (error) fail('ファイルの保存', error.message);
    return path;
  },

  async downloadFile(path: string): Promise<Blob> {
    const { data, error } = await supabase().storage.from(BUCKET).download(path);
    if (error || !data) fail('ファイルの取得', error?.message ?? '応答なし');
    return data;
  },

  async removeFiles(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await supabase().storage.from(BUCKET).remove(paths);
  },
};
