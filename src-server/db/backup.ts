import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { DatabaseSync } from 'node:sqlite';
import { getSettings } from './database.ts';

export interface BackupInfo {
  filename: string;
  filepath: string;
  size_bytes: number;
  created_at: string;
}

export function createDatabaseBackup(
  db: DatabaseSync,
  dbPath: string,
  tag = 'auto'
): BackupInfo {
  const settings = getSettings(db);
  const backupDir = path.resolve(settings.backup_dir || path.resolve(process.cwd(), 'backups'));
  fs.mkdirSync(backupDir, { recursive: true });

  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  const tempDbFile = path.join(backupDir, `tmp_${stamp}_${Math.random().toString(36).slice(2, 6)}.db`);
  const gzFilename = `pos_limpieza_${stamp}_${tag}.db.gz`;
  const gzFilepath = path.join(backupDir, gzFilename);

  if (dbPath === ':memory:') {
    // For in-memory test DBs, write a minimal marker
    fs.writeFileSync(gzFilepath, zlib.gzipSync(Buffer.from('IN_MEMORY_DB_BACKUP')));
  } else {
    // Use SQLite VACUUM INTO for consistent hot backup while WAL is active
    const escapedPath = tempDbFile.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escapedPath}'`);
    try {
      const raw = fs.readFileSync(tempDbFile);
      const compressed = zlib.gzipSync(raw, { level: 6 });
      fs.writeFileSync(gzFilepath, compressed);
    } finally {
      if (fs.existsSync(tempDbFile)) {
        fs.unlinkSync(tempDbFile);
      }
    }
  }

  pruneOldBackups(backupDir, settings.backup_retention_days || 30);

  const stat = fs.statSync(gzFilepath);
  return {
    filename: gzFilename,
    filepath: gzFilepath,
    size_bytes: stat.size,
    created_at: now.toISOString(),
  };
}

export function listBackups(db: DatabaseSync): BackupInfo[] {
  const settings = getSettings(db);
  const backupDir = path.resolve(settings.backup_dir || path.resolve(process.cwd(), 'backups'));
  if (!fs.existsSync(backupDir)) return [];

  return fs
    .readdirSync(backupDir)
    .filter((f) => f.endsWith('.db.gz') || f.endsWith('.db'))
    .map((filename) => {
      const filepath = path.join(backupDir, filename);
      const stat = fs.statSync(filepath);
      return {
        filename,
        filepath,
        size_bytes: stat.size,
        created_at: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function pruneOldBackups(backupDir: string, retentionDays: number): void {
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const filename of fs.readdirSync(backupDir)) {
    if (!filename.startsWith('pos_limpieza_') || !filename.endsWith('.db.gz')) continue;
    const full = path.join(backupDir, filename);
    const stat = fs.statSync(full);
    if (stat.mtimeMs < cutoffMs) {
      fs.unlinkSync(full);
    }
  }
}

export function startDailyBackupScheduler(db: DatabaseSync, dbPath: string): NodeJS.Timeout {
  // Check once per hour if today's daily backup exists
  const checkAndRun = () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const existing = listBackups(db);
      const hasToday = existing.some((b) => b.filename.includes(today) && b.filename.includes('_daily'));
      if (!hasToday) {
        createDatabaseBackup(db, dbPath, 'daily');
      }
    } catch (err) {
      console.error('[BackupScheduler] Error:', err);
    }
  };
  const timer = setInterval(checkAndRun, 60 * 60 * 1000);
  timer.unref();
  return timer;
}
