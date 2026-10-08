import { openDB, type IDBPDatabase } from 'idb';
import type { Cut, Project, ProjectSummary } from '../types';
import { newId } from '../lib/id';
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

// Supabase の設定がないときに使う、ブラウザの中だけに保存する実装。
// ログインなしで試すためのもので、他の人や他の端末とは共有されない。

interface ProjectRow {
  id: string;
  title: string;
  meta: MetaJson;
  updatedAt: string;
}

interface CutRow {
  id: string;
  projectId: string;
  position: number;
  duration: number;
  data: CutDataJson;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB('conte-local', 1, {
      upgrade(d) {
        d.createObjectStore('projects', { keyPath: 'id' });
        const cuts = d.createObjectStore('cuts', { keyPath: 'id' });
        cuts.createIndex('project', 'projectId');
        d.createObjectStore('files');
      },
    });
  }
  return dbPromise;
}

export const localStore: DataStore = {
  mode: 'local',

  async listProjects(): Promise<ProjectSummary[]> {
    const rows = (await (await db()).getAll('projects')) as ProjectRow[];
    return rows
      .map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  },

  async createProject(title: string): Promise<Project> {
    const row: ProjectRow = {
      id: newId(),
      title,
      meta: { fps: 30, audio: null, phases: defaultPhases() },
      updatedAt: new Date().toISOString(),
    };
    await (await db()).put('projects', row);
    return toProject(row.id, row.title, row.meta, row.updatedAt, []);
  },

  async loadProject(id: string): Promise<Project | null> {
    const d = await db();
    const row = (await d.get('projects', id)) as ProjectRow | undefined;
    if (!row) return null;
    const cutRows = (await d.getAllFromIndex('cuts', 'project', id)) as CutRow[];
    cutRows.sort((a, b) => a.position - b.position);
    const cuts = cutRows.map((c) => toCut(c.id, c.position, c.duration, c.data));
    return toProject(row.id, row.title, row.meta, row.updatedAt, cuts);
  },

  async saveMeta(p: Project): Promise<void> {
    const row: ProjectRow = {
      id: p.id,
      title: p.title,
      meta: metaOf(p),
      updatedAt: new Date().toISOString(),
    };
    await (await db()).put('projects', row);
  },

  async upsertCuts(projectId: string, cuts: Cut[]): Promise<void> {
    const tx = (await db()).transaction('cuts', 'readwrite');
    for (const c of cuts) {
      const row: CutRow = {
        id: c.id,
        projectId,
        position: c.pos,
        duration: c.duration,
        data: cutDataOf(c),
      };
      void tx.store.put(row);
    }
    await tx.done;
  },

  async deleteCuts(_projectId: string, ids: string[]): Promise<void> {
    const tx = (await db()).transaction('cuts', 'readwrite');
    for (const id of ids) void tx.store.delete(id);
    await tx.done;
  },

  async deleteProject(id: string): Promise<void> {
    const d = await db();
    const cutKeys = await d.getAllKeysFromIndex('cuts', 'project', id);
    const fileKeys = (await d.getAllKeys('files')).filter(
      (k) => typeof k === 'string' && k.startsWith(`${id}/`),
    );
    const tx = d.transaction(['projects', 'cuts', 'files'], 'readwrite');
    void tx.objectStore('projects').delete(id);
    for (const k of cutKeys) void tx.objectStore('cuts').delete(k);
    for (const k of fileKeys) void tx.objectStore('files').delete(k);
    await tx.done;
  },

  async uploadFile(projectId: string, name: string, blob: Blob): Promise<string> {
    const path = `${projectId}/${name}`;
    await (await db()).put('files', blob, path);
    return path;
  },

  async downloadFile(path: string): Promise<Blob> {
    const blob = (await (await db()).get('files', path)) as Blob | undefined;
    if (!blob) throw new Error('ファイルが見つからない');
    return blob;
  },

  async listFiles(projectId: string): Promise<string[]> {
    const keys = await (await db()).getAllKeys('files');
    return keys.filter((k): k is string => typeof k === 'string' && k.startsWith(`${projectId}/`));
  },

  async removeFiles(paths: string[]): Promise<void> {
    const tx = (await db()).transaction('files', 'readwrite');
    for (const p of paths) void tx.store.delete(p);
    await tx.done;
  },
};
