import type { Cut, Project, ProjectSummary } from '../types';

export interface UserInfo {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

/**
 * 保存先の差を隠すための共通の窓口。
 * Supabase に保存する実装と、ブラウザの中だけに保存する実装（お試し用）の2つがある。
 */
export interface DataStore {
  mode: 'supabase' | 'local';
  listProjects(): Promise<ProjectSummary[]>;
  createProject(title: string): Promise<Project>;
  loadProject(id: string): Promise<Project | null>;
  /** タイトル・音源・工程など、カット以外の情報を保存する */
  saveMeta(p: Project): Promise<void>;
  upsertCuts(projectId: string, cuts: Cut[]): Promise<void>;
  deleteCuts(projectId: string, ids: string[]): Promise<void>;
  deleteProject(id: string): Promise<void>;
  /** ファイルを保存し、取り出すときに使う場所（path）を返す */
  uploadFile(projectId: string, name: string, blob: Blob): Promise<string>;
  downloadFile(path: string): Promise<Blob>;
  /** そのコンテのファイルの場所（path）をすべて返す */
  listFiles(projectId: string): Promise<string[]>;
  removeFiles(paths: string[]): Promise<void>;
}
