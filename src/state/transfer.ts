import type { AudioMeta, Cut, Project } from '../types';
import { getStore } from '../store';
import { newId } from '../lib/id';
import { PEAKS_PER_SEC, bytesToBase64, computePeaks, decodeAudio } from '../lib/audio';
import {
  archiveFileName,
  buildArchive,
  downloadBlob,
  extOf,
  mimeOf,
  readArchive,
  toCutFields,
} from '../lib/archive';
import { getBlob } from '../lib/files';
import { useEditor } from './editor';
import { fileName, notify } from './actions';
import { pause } from './player';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 開いているコンテを、音源と画像も含めた1つのファイルにして保存させる */
export async function exportCurrentProject(): Promise<void> {
  const s = useEditor.getState();
  const p = s.project;
  if (!p || s.busy) return;
  pause();
  useEditor.setState({ busy: { label: '編集データを書き出し中', ratio: 0 } });
  try {
    const { blob, missing } = await buildArchive(p, getBlob, (ratio) =>
      useEditor.setState({ busy: { label: '編集データを書き出し中', ratio } }),
    );
    downloadBlob(blob, archiveFileName(p.title));
    if (missing > 0) {
      notify(`${missing}個のファイルを取得できず、書き出しに含められなかった。`);
    }
  } catch (e) {
    notify(`書き出せなかった。（${errorText(e)}）`);
  } finally {
    useEditor.setState({ busy: null });
  }
}

const CHUNK = 40;

/**
 * 書き出したファイルを読み込み、新しいコンテとして追加する。
 * 既存のコンテには触れない。戻り値は新しいコンテの ID。
 */
export async function importProjectFile(
  file: Blob,
  onProgress?: (label: string) => void,
): Promise<string> {
  onProgress?.('ファイルを確認中');
  const { data, files } = await readArchive(file);
  const store = getStore();
  const created = await store.createProject(data.title);
  try {
    // 実際に使われているファイルだけを保存先へ送る
    const needed: string[] = [];
    if (data.audio) needed.push(data.audio.path);
    for (const c of data.cuts) {
      for (const it of c.items) {
        if (it.kind === 'image' && !needed.includes(it.path)) needed.push(it.path);
      }
    }
    const placed = new Map<string, string>();
    for (let i = 0; i < needed.length; i++) {
      onProgress?.(`音源と画像を保存中（${i + 1} / ${needed.length}）`);
      const name = needed[i];
      const bytes = files.get(name)!;
      const blob = new Blob([new Uint8Array(bytes)], { type: mimeOf(name) });
      const kind = name.startsWith('audio.') ? 'audio' : 'img';
      placed.set(name, await store.uploadFile(created.id, fileName(kind, extOf(name)), blob));
    }

    let audio: AudioMeta | null = null;
    if (data.audio) {
      audio = { ...data.audio, path: placed.get(data.audio.path)! };
      if (!audio.peaks) {
        // 波形が入っていなければ、音源から作り直す
        onProgress?.('波形を作成中');
        const bytes = files.get(data.audio.path)!;
        const buf = await decodeAudio(new Blob([new Uint8Array(bytes)]));
        audio.peaks = bytesToBase64(computePeaks(buf));
        audio.peaksPerSec = PEAKS_PER_SEC;
      }
    }

    // ID は必ず新しく振る（同じファイルを2回読み込んでも、元のコンテとぶつからないように）
    const cuts: Cut[] = data.cuts.map((c, i) => ({
      ...toCutFields(c),
      id: newId(),
      pos: i + 1,
      items: c.items.map((it) =>
        it.kind === 'image'
          ? { ...it, id: newId(), path: placed.get(it.path)! }
          : { ...it, id: newId() },
      ),
    }));

    const project: Project = {
      ...created,
      title: data.title,
      fps: data.fps,
      phases:
        data.phases.length > 0 ? data.phases.map((ph) => ({ ...ph, id: newId() })) : created.phases,
      audio,
      cuts,
    };

    for (let i = 0; i < cuts.length; i += CHUNK) {
      onProgress?.(`カットを保存中（${Math.min(i + CHUNK, cuts.length)} / ${cuts.length}）`);
      await store.upsertCuts(created.id, cuts.slice(i, i + CHUNK));
    }
    await store.saveMeta(project);
    return created.id;
  } catch (e) {
    // 途中で失敗したら、作りかけのコンテを残さない
    try {
      await store.deleteProject(created.id);
    } catch {
      /* 片付けに失敗しても、元のエラーを伝える */
    }
    throw e;
  }
}
