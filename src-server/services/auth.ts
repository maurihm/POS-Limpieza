import type { DatabaseSync } from 'node:sqlite';
import type { AuditLog, Role, RolePermissions, User } from '../../src/types/index.ts';
import { hashPassword, hashPin } from '../db/database.ts';

interface UserRow {
  id: number;
  name: string;
  role_id: number;
  role_name: string;
  permissions_json: string;
  is_active: number;
  created_at: string;
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    role_id: row.role_id,
    role_name: row.role_name,
    permissions: JSON.parse(row.permissions_json) as RolePermissions,
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
  };
}

export function listUsers(db: DatabaseSync): User[] {
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.role_id, r.name as role_name, r.permissions_json, u.is_active, u.created_at
       FROM users u
       JOIN roles r ON r.id = u.role_id
       ORDER BY u.id ASC`
    )
    .all() as unknown as UserRow[];
  return rows.map(mapUser);
}

export function getUserById(db: DatabaseSync, id: number): User | null {
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.role_id, r.name as role_name, r.permissions_json, u.is_active, u.created_at
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?`
    )
    .get(id) as unknown as UserRow | undefined;
  return row ? mapUser(row) : null;
}

export function loginByPin(db: DatabaseSync, pin: string): User | null {
  const pinHash = hashPin(pin.trim());
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.role_id, r.name as role_name, r.permissions_json, u.is_active, u.created_at
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.pin_hash = ? AND u.is_active = 1
       LIMIT 1`
    )
    .get(pinHash) as unknown as UserRow | undefined;
  return row ? mapUser(row) : null;
}

export function verifyAdminPin(db: DatabaseSync, pin: string): User | null {
  const user = loginByPin(db, pin);
  if (!user) return null;
  if (user.role_name === 'ADMIN') return user;
  return null;
}

export function listRoles(db: DatabaseSync): Role[] {
  const rows = db.prepare('SELECT id, name, permissions_json FROM roles ORDER BY id ASC').all() as Array<{
    id: number;
    name: string;
    permissions_json: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    permissions: JSON.parse(r.permissions_json) as RolePermissions,
  }));
}

export function updateRolePermissions(
  db: DatabaseSync,
  roleId: number,
  permissions: RolePermissions
): Role {
  db.prepare('UPDATE roles SET permissions_json = ? WHERE id = ?').run(JSON.stringify(permissions), roleId);
  const row = db.prepare('SELECT id, name, permissions_json FROM roles WHERE id = ?').get(roleId) as {
    id: number;
    name: string;
    permissions_json: string;
  };
  return {
    id: row.id,
    name: row.name,
    permissions: JSON.parse(row.permissions_json) as RolePermissions,
  };
}

export function createUser(
  db: DatabaseSync,
  input: { name: string; pin: string; role_id: number; password?: string }
): User {
  if (!/^\d{4}$/.test(input.pin)) {
    throw new Error('El PIN debe tener exactamente 4 dígitos numéricos.');
  }
  const existingPin = loginByPin(db, input.pin);
  if (existingPin) {
    throw new Error('Ese PIN ya está en uso por otro usuario activo.');
  }
  const res = db
    .prepare(
      'INSERT INTO users (name, pin_hash, password_hash, role_id, is_active) VALUES (?, ?, ?, ?, 1)'
    )
    .run(input.name.trim(), hashPin(input.pin), hashPassword(input.password || input.pin), input.role_id);
  return getUserById(db, Number(res.lastInsertRowid))!;
}

export function updateUser(
  db: DatabaseSync,
  id: number,
  input: { name?: string; pin?: string; role_id?: number; is_active?: boolean }
): User {
  const current = getUserById(db, id);
  if (!current) throw new Error('Usuario no encontrado');

  if (input.pin !== undefined && input.pin !== '') {
    if (!/^\d{4}$/.test(input.pin)) {
      throw new Error('El PIN debe tener exactamente 4 dígitos numéricos.');
    }
    const existingPin = loginByPin(db, input.pin);
    if (existingPin && existingPin.id !== id) {
      throw new Error('Ese PIN ya está en uso por otro usuario activo.');
    }
    db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(hashPin(input.pin), id);
  }
  if (input.name !== undefined) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(input.name.trim(), id);
  }
  if (input.role_id !== undefined) {
    db.prepare('UPDATE users SET role_id = ? WHERE id = ?').run(input.role_id, id);
  }
  if (input.is_active !== undefined) {
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(input.is_active ? 1 : 0, id);
  }
  return getUserById(db, id)!;
}

export function logAudit(
  db: DatabaseSync,
  userId: number,
  action: string,
  details: Record<string, unknown> = {}
): void {
  db.prepare('INSERT INTO audit_logs (user_id, action, details_json) VALUES (?, ?, ?)').run(
    userId,
    action,
    JSON.stringify(details)
  );
}

export function listAuditLogs(db: DatabaseSync, limit = 100): AuditLog[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.user_id, u.name as user_name, a.action, a.details_json, a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.id DESC
       LIMIT ?`
    )
    .all(limit) as Array<{
    id: number;
    user_id: number;
    user_name: string;
    action: string;
    details_json: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    user_name: r.user_name,
    action: r.action,
    details: JSON.parse(r.details_json || '{}'),
    created_at: r.created_at,
  }));
}
