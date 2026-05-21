// ═══════════════════════════════════════════════════════════
//  db.zig — Data Access Layer
//  All SQLite logic: init, users, events, RSVPs, email log,
//  and session persistence (added)
// ═══════════════════════════════════════════════════════════

const std = @import("std");
pub var allocator: std.mem.Allocator = undefined;

pub const c = @cImport({
    @cInclude("sqlite3.h");
});

// ─── Globals ──────────────────────────────────────────────
const gpa = std.heap.page_allocator;
pub var db: ?*c.sqlite3 = null;

// ─── Row Structs ──────────────────────────────────────────
// role: 0 = organizer (default), 1 = admin (developer)
pub const UserRow = struct {
    id:         u32,
    full_name:  []const u8,
    email:      []const u8,
    password:   []const u8,
    role:       u32,
    created_at: i64,
};

pub const RsvpRow = struct {
    id:         u32,
    event_id:   u32,
    guest_name: []const u8,
    email:      []const u8,
    status:     []const u8,
    waitlisted: u32,
    token:      []const u8,
    created_at: i64,
    updated_at: i64,
};

// ══════════════════════════════════════════════════════════
//  DATABASE INIT
// ══════════════════════════════════════════════════════════
pub fn init() !void {
    const rc = c.sqlite3_open("rsvp.db", &db);
    if (rc != c.SQLITE_OK) {
        std.debug.print("Cannot open database: {s}\n", .{c.sqlite3_errmsg(db)});
        return error.DbOpenFailed;
    }

    _ = c.sqlite3_exec(db, "PRAGMA journal_mode=WAL;", null, null, null);
    _ = c.sqlite3_exec(db, "PRAGMA foreign_keys=ON;",  null, null, null);

    // Safe migration: add role column if it doesn't exist yet.
    _ = c.sqlite3_exec(db,
        "ALTER TABLE users ADD COLUMN role INTEGER NOT NULL DEFAULT 0;",
        null, null, null);

    const schema =
        // Users — role INTEGER: 0=organizer, 1=admin
        "CREATE TABLE IF NOT EXISTS users (" ++
        "  id         INTEGER PRIMARY KEY AUTOINCREMENT," ++
        "  full_name  TEXT    NOT NULL," ++
        "  email      TEXT    NOT NULL UNIQUE," ++
        "  password   TEXT    NOT NULL," ++
        "  role       INTEGER NOT NULL DEFAULT 0," ++
        "  created_at INTEGER NOT NULL" ++
        ");" ++
        // Sessions — persists login tokens across restarts
        "CREATE TABLE IF NOT EXISTS sessions (" ++
        "  token      TEXT    PRIMARY KEY," ++
        "  user_id    INTEGER NOT NULL," ++
        "  created_at INTEGER NOT NULL," ++
        "  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE" ++
        ");" ++
        // Events
        "CREATE TABLE IF NOT EXISTS events (" ++
        "  id          INTEGER PRIMARY KEY AUTOINCREMENT," ++
        "  user_id     INTEGER NOT NULL," ++
        "  name        TEXT    NOT NULL," ++
        "  date        TEXT    NOT NULL," ++
        "  location    TEXT    NOT NULL DEFAULT ''," ++
        "  description TEXT    NOT NULL DEFAULT ''," ++
        "  capacity    INTEGER NOT NULL DEFAULT 0," ++
        "  created_at  INTEGER NOT NULL," ++
        "  FOREIGN KEY(user_id) REFERENCES users(id)" ++
        ");" ++
        // RSVPs
        "CREATE TABLE IF NOT EXISTS rsvps (" ++
        "  id          INTEGER PRIMARY KEY AUTOINCREMENT," ++
        "  event_id    INTEGER NOT NULL," ++
        "  guest_name  TEXT    NOT NULL," ++
        "  email       TEXT    NOT NULL," ++
        "  status      TEXT    NOT NULL DEFAULT 'pending'," ++
        "  waitlisted  INTEGER NOT NULL DEFAULT 0," ++
        "  token       TEXT    NOT NULL DEFAULT ''," ++
        "  created_at  INTEGER NOT NULL," ++
        "  updated_at  INTEGER NOT NULL," ++
        "  FOREIGN KEY(event_id) REFERENCES events(id)" ++
        ");" ++
        // Email log
        "CREATE TABLE IF NOT EXISTS email_log (" ++
        "  id         INTEGER PRIMARY KEY AUTOINCREMENT," ++
        "  event_id   INTEGER NOT NULL," ++
        "  recipient  TEXT    NOT NULL," ++
        "  subject    TEXT    NOT NULL," ++
        "  status     TEXT    NOT NULL DEFAULT 'sent'," ++
        "  sent_at    INTEGER NOT NULL" ++
        ");";

    var err_msg: [*c]u8 = null;
    const rc2 = c.sqlite3_exec(db, schema, null, null, &err_msg);
    if (rc2 != c.SQLITE_OK) {
        std.debug.print("SQL error: {s}\n", .{err_msg});
        c.sqlite3_free(err_msg);
        return error.DbInitFailed;
    }
    std.debug.print("  SQLite database ready (rsvp.db) — all tables OK\n", .{});
}

pub fn close() void {
    _ = c.sqlite3_close(db);
}

// ══════════════════════════════════════════════════════════
//  USER HELPERS
// ══════════════════════════════════════════════════════════

// SELECT order: 0=id, 1=full_name, 2=email, 3=password, 4=role, 5=created_at
pub fn db_find_user_by_email(email: []const u8) ?UserRow {
    var stmt: ?*c.sqlite3_stmt = null;
    const sql = "SELECT id,full_name,email,password,role,created_at FROM users WHERE email=? LIMIT 1;";
    if (c.sqlite3_prepare_v2(db, sql, -1, &stmt, null) != c.SQLITE_OK) return null;
    defer _ = c.sqlite3_finalize(stmt);
    const ez = gpa.dupeZ(u8, email) catch return null;
    defer gpa.free(ez);
    _ = c.sqlite3_bind_text(stmt, 1, ez.ptr, -1, c.SQLITE_STATIC);
    if (c.sqlite3_step(stmt) != c.SQLITE_ROW) return null;
    return UserRow{
        .id         = @as(u32, @intCast(c.sqlite3_column_int(stmt, 0))),
        .full_name  = gpa.dupe(u8, std.mem.span(c.sqlite3_column_text(stmt, 1))) catch return null,
        .email      = gpa.dupe(u8, std.mem.span(c.sqlite3_column_text(stmt, 2))) catch return null,
        .password   = gpa.dupe(u8, std.mem.span(c.sqlite3_column_text(stmt, 3))) catch return null,
        .role       = @as(u32, @intCast(c.sqlite3_column_int(stmt, 4))),
        .created_at = c.sqlite3_column_int64(stmt, 5),
    };
}

pub fn db_find_user_by_id(id: u32) ?UserRow {
    var stmt: ?*c.sqlite3_stmt = null;
    const sql = "SELECT id,full_name,email,password,role,created_at FROM users WHERE id=? LIMIT 1;";
    if (c.sqlite3_prepare_v2(db, sql, -1, &stmt, null) != c.SQLITE_OK) return null;
    defer _ = c.sqlite3_finalize(stmt);
    _ = c.sqlite3_bind_int(stmt, 1, @as(i32, @intCast(id)));
    if (c.sqlite3_step(stmt) != c.SQLITE_ROW) return null;
    return UserRow{
        .id         = id,
        .full_name  = gpa.dupe(u8, std.mem.span(c.sqlite3_column_text(stmt, 1))) catch return null,
        .email      = gpa.dupe(u8, std.mem.span(c.sqlite3_column_text(stmt, 2))) catch return null,
        .password   = gpa.dupe(u8, std.mem.span(c.sqlite3_column_text(stmt, 3))) catch return null,
        .role       = @as(u32, @intCast(c.sqlite3_column_int(stmt, 4))),
        .created_at = c.sqlite3_column_int64(stmt, 5),
    };
}

pub fn insert_user(full_name: []const u8, email: []const u8, password: []const u8) bool {
    var stmt: ?*c.sqlite3_stmt = null;
    // New users always start as organizer (role=0)
    const sql = "INSERT INTO users (full_name,email,password,role,created_at) VALUES (?,?,?,0,?);";
    if (c.sqlite3_prepare_v2(db, sql, -1, &stmt, null) != c.SQLITE_OK) return false;
    defer _ = c.sqlite3_finalize(stmt);
    const fnz = gpa.dupeZ(u8, full_name) catch return false; defer gpa.free(fnz);
    const ez  = gpa.dupeZ(u8, email)     catch return false; defer gpa.free(ez);
    const pz  = gpa.dupeZ(u8, password)  catch return false; defer gpa.free(pz);
    _ = c.sqlite3_bind_text(stmt,  1, fnz.ptr, -1, c.SQLITE_STATIC);
    _ = c.sqlite3_bind_text(stmt,  2, ez.ptr,  -1, c.SQLITE_STATIC);
    _ = c.sqlite3_bind_text(stmt,  3, pz.ptr,  -1, c.SQLITE_STATIC);
    _ = c.sqlite3_bind_int64(stmt, 4, std.time.timestamp());
    return c.sqlite3_step(stmt) == c.SQLITE_DONE;
}

// ══════════════════════════════════════════════════════════
//  ADMIN USER MANAGEMENT
// ══════════════════════════════════════════════════════════

// Returns all users as a JSON array. Called by GET /api/admin/users.
pub fn get_all_users(_: std.mem.Allocator, out_json: *std.ArrayList(u8)) void {
    var stmt: ?*c.sqlite3_stmt = null;
    const sql = "SELECT id, full_name, email, role, created_at FROM users ORDER BY id ASC;";
    if (c.sqlite3_prepare_v2(db, sql, -1, &stmt, null) != c.SQLITE_OK) {
        out_json.appendSlice("[]") catch return;
        return;
    }
    defer _ = c.sqlite3_finalize(stmt);
    out_json.append('[') catch return;
    var first = true;
    while (c.sqlite3_step(stmt) == c.SQLITE_ROW) {
        if (!first) out_json.append(',') catch return;
        first = false;
        const id = c.sqlite3_column_int(stmt, 0);
        const name = std.mem.span(c.sqlite3_column_text(stmt, 1));
        const email = std.mem.span(c.sqlite3_column_text(stmt, 2));
        const role = c.sqlite3_column_int(stmt, 3);
        const ts = c.sqlite3_column_int64(stmt, 4);
        std.fmt.format(out_json.writer(),
            "{{\"id\":{d},\"full_name\":\"{s}\",\"email\":\"{s}\",\"role\":{d},\"created_at\":{d}}}",
            .{ id, name, email, role, ts }) catch return;
    }
    out_json.append(']') catch return;
}

// Sets a user's role. new_role: 0=organizer, 1=admin.
pub fn update_user_role(user_id: u32, new_role: u32) bool {
    var stmt: ?*c.sqlite3_stmt = null;
    if (c.sqlite3_prepare_v2(db, "UPDATE users SET role=? WHERE id=?;", -1, &stmt, null) != c.SQLITE_OK) return false;
    defer _ = c.sqlite3_finalize(stmt);
    _ = c.sqlite3_bind_int(stmt, 1, @as(i32, @intCast(new_role)));
    _ = c.sqlite3_bind_int(stmt, 2, @as(i32, @intCast(user_id)));
    return c.sqlite3_step(stmt) == c.SQLITE_DONE;
}

// Deletes a user and all their events + RSVPs.
// Called by DELETE /api/admin/users/:id
pub fn delete_user_by_id(user_id: u32) bool {
    // Delete RSVPs belonging to the user's events first
    var s1: ?*c.sqlite3_stmt = null;
    if (c.sqlite3_prepare_v2(db,
        "DELETE FROM rsvps WHERE event_id IN (SELECT id FROM events WHERE user_id=?);",
        -1, &s1, null) == c.SQLITE_OK) {
        _ = c.sqlite3_bind_int(s1, 1, @as(i32, @intCast(user_id)));
        _ = c.sqlite3_step(s1);
        _ = c.sqlite3_finalize(s1);
    }
    // Delete events
    var s2: ?*c.sqlite3_stmt = null;
    if (c.sqlite3_prepare_v2(db,
        "DELETE FROM events WHERE user_id=?;",
        -1, &s2, null) == c.SQLITE_OK) {
        _ = c.sqlite3_bind_int(s2, 1, @as(i32, @intCast(user_id)));
        _ = c.sqlite3_step(s2);
        _ = c.sqlite3_finalize(s2);
    }
    // Delete the user
    var s3: ?*c.sqlite3_stmt = null;
    if (c.sqlite3_prepare_v2(db,
        "DELETE FROM users WHERE id=?;",
        -1, &s3, null) != c.SQLITE_OK) return false;
    defer _ = c.sqlite3_finalize(s3);
    _ = c.sqlite3_bind_int(s3, 1, @as(i32, @intCast(user_id)));
    return c.sqlite3_step(s3) == c.SQLITE_DONE and c.sqlite3_changes(db) > 0;
}

// ══════════════════════════════════════════════════════════
//  EVENT HELPERS
// ══════════════════════════════════════════════════════════
pub fn insert_event(user_id: u32, name: []const u8, date: []const u8, location: []const u8, description: []const u8, capacity: u32) bool {
    var stmt: ?*c.sqlite3_stmt = null;
    const sql = "INSERT INTO events (user_id,name,date,location,description,capacity,created_at) VALUES (?,?,?,?,?,?,?);";
    if (c.sqlite3_prepare_v2(db, sql, -1, &stmt, null) != c.SQLITE_OK) return false;
    defer _ = c.sqlite3_finalize(stmt);
    const nz  = gpa.dupeZ(u8, name)        catch return false; defer gpa.free(nz);
    const dz  = gpa.dupeZ(u8, date)        catch return false; defer gpa.free(dz);
    const lz  = gpa.dupeZ(u8, location)    catch return false; defer gpa.free(lz);
    const dsz = gpa.dupeZ(u8, description) catch return false; defer gpa.free(dsz);
    _ = c.sqlite3_bind_int(stmt,   1, @as(i32, @intCast(user_id)));
    _ = c.sqlite3_bind_text(stmt,  2, nz.ptr,  -1, c.SQLITE_STATIC);
    _ = c.sqlite3_bind_text(stmt,  3, dz.ptr,  -1, c.SQLITE_STATIC);
    _ = c.sqlite3_bind_text(stmt,  4, lz.ptr,  -1, c.SQLITE_STATIC);
    _ = c.sqlite3_bind_text(stmt,  5, dsz.ptr, -1, c.SQLITE_STATIC);
    _ = c.sqlite3_bind_int(stmt,   6, @as(i32, @intCast(capacity)));
    _ = c.sqlite3_bind_int64(stmt, 7, std.time.timestamp());
    return c.sqlite3_step(stmt) == c.SQLITE_DONE;
}

pub fn get_events_for_user(user_id: u32, buf: *std.ArrayList(u8)) void {
    var stmt: ?*c.sqlite3_stmt = null;
    const sql = "SELECT id,user_id,name,date,location,description,capacity,created_at FROM events WHERE user_id=? ORDER BY date DESC;";
    if (c.sqlite3_prepare_v2(db, sql, -1, &stmt, null) != c.SQLITE_OK) return;
    defer _ = c.sqlite3_finalize(stmt);
    _ = c.sqlite3_bind_int(stmt, 1, @as(i32, @intCast(user_id)));
    buf.appendSlice("[") catch return;
    var first = true;
    while (c.sqlite3_step(stmt) == c.SQLITE_ROW) {
        if (!first) buf.appendSlice(",") catch return;
        first = false;
        const id   = c.sqlite3_column_int(stmt, 0);
        const uid  = c.sqlite3_column_int(stmt, 1);
        const name = std.mem.span(c.sqlite3_column_text(stmt, 2));
        const date = std.mem.span(c.sqlite3_column_text(stmt, 3));
        const loc  = std.mem.span(c.sqlite3_column_text(stmt, 4));
        const desc = std.mem.span(c.sqlite3_column_text(stmt, 5));
        const cap  = c.sqlite3_column_int(stmt, 6);
        const cat  = c.sqlite3_column_int64(stmt, 7);

        // Count RSVPs by status/waitlist
        var cnt_stmt: ?*c.sqlite3_stmt = null;
        var attending:  i32 = 0;
        var declined:   i32 = 0;
        var pending:    i32 = 0;
        var waitlisted: i32 = 0;
        if (c.sqlite3_prepare_v2(db,
            "SELECT status,waitlisted,COUNT(*) FROM rsvps WHERE event_id=? GROUP BY status,waitlisted;",
            -1, &cnt_stmt, null) == c.SQLITE_OK) {
            _ = c.sqlite3_bind_int(cnt_stmt, 1, id);
            while (c.sqlite3_step(cnt_stmt) == c.SQLITE_ROW) {
                const s   = std.mem.span(c.sqlite3_column_text(cnt_stmt, 0));
                const wl  = c.sqlite3_column_int(cnt_stmt, 1);
                const cnt = c.sqlite3_column_int(cnt_stmt, 2);
                if (wl == 1)                                   { waitlisted += cnt; }
                else if (std.mem.eql(u8, s, "attending"))     { attending  += cnt; }
                else if (std.mem.eql(u8, s, "declined"))      { declined   += cnt; }
                else if (std.mem.eql(u8, s, "pending"))       { pending    += cnt; }
            }
            _ = c.sqlite3_finalize(cnt_stmt);
        }

        // Compute status: upcoming or completed
        const now_ts = std.time.timestamp();
        const status_str = blk: {
            var today_buf: [11]u8 = undefined;
            const days       = @divFloor(now_ts, 86400);
            const total_days = days + 719468;
            const era        = @divFloor(total_days, 146097);
            const doe        = total_days - era * 146097;
            const yoe        = @divFloor(doe - @divFloor(doe, 1460) + @divFloor(doe, 36524) - @divFloor(doe, 146096), 365);
            const y          = yoe + era * 400;
            const doy        = doe - (365 * yoe + @divFloor(yoe, 4) - @divFloor(yoe, 100));
            const mp         = @divFloor(5 * doy + 2, 153);
            const d2         = doy - @divFloor(153 * mp + 2, 5) + 1;
            const m2         = if (mp < 10) mp + 3 else mp - 9;
            const y2         = if (m2 <= 2) y + 1 else y;
            _ = std.fmt.bufPrint(&today_buf, "{d:0>4}-{d:0>2}-{d:0>2}", .{ y2, m2, d2 }) catch break :blk "upcoming";
            if (std.mem.lessThan(u8, date, &today_buf)) break :blk "completed" else break :blk "upcoming";
        };

        var row: [1024]u8 = undefined;
        const row_s = std.fmt.bufPrint(&row,
            "{{\"id\":{d},\"user_id\":{d},\"name\":\"{s}\",\"date\":\"{s}\",\"location\":\"{s}\",\"description\":\"{s}\",\"capacity\":{d},\"created_at\":{d},\"status\":\"{s}\",\"attending\":{d},\"declined\":{d},\"pending\":{d},\"waitlisted\":{d}}}",
            .{ id, uid, name, date, loc, desc, cap, cat, status_str, attending, declined, pending, waitlisted },
        ) catch continue;
        buf.appendSlice(row_s) catch return;
    }
    buf.appendSlice("]") catch return;
}

pub fn delete_event(event_id: u32, user_id: u32) bool {
    var s1: ?*c.sqlite3_stmt = null;
    if (c.sqlite3_prepare_v2(db, "DELETE FROM rsvps WHERE event_id=?;", -1, &s1, null) == c.SQLITE_OK) {
        _ = c.sqlite3_bind_int(s1, 1, @as(i32, @intCast(event_id)));
        _ = c.sqlite3_step(s1);
        _ = c.sqlite3_finalize(s1);
    }
    var stmt: ?*c.sqlite3_stmt = null;
    if (c.sqlite3_prepare_v2(db, "DELETE FROM events WHERE id=? AND user_id=?;", -1, &stmt, null) != c.SQLITE_OK) return false;
    defer _ = c.sqlite3_finalize(stmt);
    _ = c.sqlite3_bind_int(stmt, 1, @as(i32, @intCast(event_id)));
    _ = c.sqlite3_bind_int(stmt, 2, @as(i32, @intCast(user_id)));
    return c.sqlite3_step(stmt) == c.SQLITE_DONE and c.sqlite3_changes(db) > 0;
}

pub fn event_belongs_to_user(event_id: u32, user_id: u32) bool {
    var stmt: ?*c.sqlite3_stmt = null;
    if (c.sqlite3_prepare_v2(db, "SELECT id FROM events WHERE id=? AND user_id=?;", -1, &stmt, null) != c.SQLITE_OK) return false;
    defer _ = c.sqlite3_finalize(stmt);
    _ = c.sqlite3_bind_int(stmt, 1, @as(i32, @intCast(event_id)));
    _ = c.sqlite3_bind_int(stmt, 2, @as(i32, @intCast(user_id)));
    return c.sqlite3_step(stmt) == c.SQLITE_ROW;
}

pub fn get_event_capacity(event_id: u32) i32 {
    var stmt: ?*c.sqlite3_stmt = null;
    if (c.sqlite3_prepare_v2(db, "SELECT capacity FROM events WHERE id=?;", -1, &stmt, null) != c.SQLITE_OK) return 0;
    defer _ = c.sqlite3_finalize(stmt);
    _ = c.sqlite3_bind_int(stmt, 1, @as(i32, @intCast(event_id)));
    if (c.sqlite3_step(stmt) != c.SQLITE_ROW) return 0;
    return c.sqlite3_column_int(stmt, 0);
}

pub fn get_event_name(event_id: u32) []const u8 {
    var stmt: ?*c.sqlite3_stmt = null;
    if (c.sqlite3_prepare_v2(db, "SELECT name FROM events WHERE id=?;", -1, &stmt, null) != c.SQLITE_OK) return "Event";
    defer _ = c.sqlite3_finalize(stmt);
    _ = c.sqlite3_bind_int(stmt, 1, @as(i32, @intCast(event_id)));
    if (c.sqlite3_step(stmt) != c.SQLITE_ROW) return "Event";
    return gpa.dupe(u8, std.mem.span(c.sqlite3_column_text(stmt, 0))) catch "Event";
}

// ══════════════════════════════════════════════════════════
//  RSVP HELPERS
// ══════════════════════════════════════════════════════════
pub fn count_attending(event_id: u32) i32 {
    var stmt: ?*c.sqlite3_stmt = null;
    if (c.sqlite3_prepare_v2(db,
        "SELECT COUNT(*) FROM rsvps WHERE event_id=? AND status='attending' AND waitlisted=0;",
        -1, &stmt, null) != c.SQLITE_OK) return 0;
    defer _ = c.sqlite3_finalize(stmt);
    _ = c.sqlite3_bind_int(stmt, 1, @as(i32, @intCast(event_id)));
    if (c.sqlite3_step(stmt) != c.SQLITE_ROW) return 0;
    return c.sqlite3_column_int(stmt, 0);
}

pub fn rsvp_exists(event_id: u32, email: []const u8) bool {
    var stmt: ?*c.sqlite3_stmt = null;
    if (c.sqlite3_prepare_v2(db, "SELECT id FROM rsvps WHERE event_id=? AND email=?;", -1, &stmt, null) != c.SQLITE_OK) return false;
    defer _ = c.sqlite3_finalize(stmt);
    const ez = gpa.dupeZ(u8, email) catch return false;
    defer gpa.free(ez);
    _ = c.sqlite3_bind_int(stmt,  1, @as(i32, @intCast(event_id)));
    _ = c.sqlite3_bind_text(stmt, 2, ez.ptr, -1, c.SQLITE_STATIC);
    return c.sqlite3_step(stmt) == c.SQLITE_ROW;
}

pub fn insert_rsvp(event_id: u32, guest_name: []const u8, email: []const u8, status: []const u8, waitlisted: u32, token: []const u8) bool {
    var stmt: ?*c.sqlite3_stmt = null;
    const sql = "INSERT INTO rsvps (event_id,guest_name,email,status,waitlisted,token,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?);";
    if (c.sqlite3_prepare_v2(db, sql, -1, &stmt, null) != c.SQLITE_OK) return false;
    defer _ = c.sqlite3_finalize(stmt);
    const gnz = gpa.dupeZ(u8, guest_name) catch return false; defer gpa.free(gnz);
    const ez  = gpa.dupeZ(u8, email)      catch return false; defer gpa.free(ez);
    const sz  = gpa.dupeZ(u8, status)     catch return false; defer gpa.free(sz);
    const tz  = gpa.dupeZ(u8, token)      catch return false; defer gpa.free(tz);
    const now = std.time.timestamp();
    _ = c.sqlite3_bind_int(stmt,   1, @as(i32, @intCast(event_id)));
    _ = c.sqlite3_bind_text(stmt,  2, gnz.ptr, -1, c.SQLITE_STATIC);
    _ = c.sqlite3_bind_text(stmt,  3, ez.ptr,  -1, c.SQLITE_STATIC);
    _ = c.sqlite3_bind_text(stmt,  4, sz.ptr,  -1, c.SQLITE_STATIC);
    _ = c.sqlite3_bind_int(stmt,   5, @as(i32, @intCast(waitlisted)));
    _ = c.sqlite3_bind_text(stmt,  6, tz.ptr,  -1, c.SQLITE_STATIC);
    _ = c.sqlite3_bind_int64(stmt, 7, now);
    _ = c.sqlite3_bind_int64(stmt, 8, now);
    return c.sqlite3_step(stmt) == c.SQLITE_DONE;
}

pub fn update_rsvp_status(rsvp_id: u32, status: []const u8) bool {
    var stmt: ?*c.sqlite3_stmt = null;
    if (c.sqlite3_prepare_v2(db,
        "UPDATE rsvps SET status=?,updated_at=? WHERE id=?;",
        -1, &stmt, null) != c.SQLITE_OK) return false;
    defer _ = c.sqlite3_finalize(stmt);
    const sz = gpa.dupeZ(u8, status) catch return false;
    defer gpa.free(sz);
    _ = c.sqlite3_bind_text(stmt,  1, sz.ptr, -1, c.SQLITE_STATIC);
    _ = c.sqlite3_bind_int64(stmt, 2, std.time.timestamp());
    _ = c.sqlite3_bind_int(stmt,   3, @as(i32, @intCast(rsvp_id)));
    return c.sqlite3_step(stmt) == c.SQLITE_DONE;
}

pub fn delete_rsvp(rsvp_id: u32) bool {
    var stmt: ?*c.sqlite3_stmt = null;
    if (c.sqlite3_prepare_v2(db, "DELETE FROM rsvps WHERE id=?;", -1, &stmt, null) != c.SQLITE_OK) return false;
    defer _ = c.sqlite3_finalize(stmt);
    _ = c.sqlite3_bind_int(stmt, 1, @as(i32, @intCast(rsvp_id)));
    return c.sqlite3_step(stmt) == c.SQLITE_DONE;
}

pub fn get_rsvps_for_event(event_id: u32, buf: *std.ArrayList(u8)) void {
    var stmt: ?*c.sqlite3_stmt = null;
    const sql = "SELECT id,event_id,guest_name,email,status,waitlisted,token,created_at,updated_at FROM rsvps WHERE event_id=? ORDER BY created_at DESC;";
    if (c.sqlite3_prepare_v2(db, sql, -1, &stmt, null) != c.SQLITE_OK) return;
    defer _ = c.sqlite3_finalize(stmt);
    _ = c.sqlite3_bind_int(stmt, 1, @as(i32, @intCast(event_id)));
    buf.appendSlice("[") catch return;
    var first = true;
    while (c.sqlite3_step(stmt) == c.SQLITE_ROW) {
        if (!first) buf.appendSlice(",") catch return;
        first = false;
        const id    = c.sqlite3_column_int(stmt, 0);
        const eid   = c.sqlite3_column_int(stmt, 1);
        const gname = std.mem.span(c.sqlite3_column_text(stmt, 2));
        const email = std.mem.span(c.sqlite3_column_text(stmt, 3));
        const stat  = std.mem.span(c.sqlite3_column_text(stmt, 4));
        const wl    = c.sqlite3_column_int(stmt, 5);
        const tok   = std.mem.span(c.sqlite3_column_text(stmt, 6));
        const cat   = c.sqlite3_column_int64(stmt, 7);
        const uat   = c.sqlite3_column_int64(stmt, 8);
        var row: [1024]u8 = undefined;
        const row_s = std.fmt.bufPrint(&row,
            "{{\"id\":{d},\"event_id\":{d},\"guest_name\":\"{s}\",\"email\":\"{s}\",\"status\":\"{s}\",\"waitlisted\":{d},\"token\":\"{s}\",\"created_at\":{d},\"updated_at\":{d}}}",
            .{ id, eid, gname, email, stat, wl, tok, cat, uat },
        ) catch continue;
        buf.appendSlice(row_s) catch return;
    }
    buf.appendSlice("]") catch return;
}

pub fn get_all_rsvps_for_user(user_id: u32, buf: *std.ArrayList(u8)) void {
    var stmt: ?*c.sqlite3_stmt = null;
    const sql =
        "SELECT r.id,r.event_id,r.guest_name,r.email,r.status,r.waitlisted,r.token,r.created_at,r.updated_at,e.name " ++
        "FROM rsvps r JOIN events e ON r.event_id=e.id " ++
        "WHERE e.user_id=? ORDER BY r.created_at DESC;";
    if (c.sqlite3_prepare_v2(db, sql, -1, &stmt, null) != c.SQLITE_OK) return;
    defer _ = c.sqlite3_finalize(stmt);
    _ = c.sqlite3_bind_int(stmt, 1, @as(i32, @intCast(user_id)));
    buf.appendSlice("[") catch return;
    var first = true;
    while (c.sqlite3_step(stmt) == c.SQLITE_ROW) {
        if (!first) buf.appendSlice(",") catch return;
        first = false;
        const id    = c.sqlite3_column_int(stmt, 0);
        const eid   = c.sqlite3_column_int(stmt, 1);
        const gname = std.mem.span(c.sqlite3_column_text(stmt, 2));
        const email = std.mem.span(c.sqlite3_column_text(stmt, 3));
        const stat  = std.mem.span(c.sqlite3_column_text(stmt, 4));
        const wl    = c.sqlite3_column_int(stmt, 5);
        const tok   = std.mem.span(c.sqlite3_column_text(stmt, 6));
        const cat   = c.sqlite3_column_int64(stmt, 7);
        const uat   = c.sqlite3_column_int64(stmt, 8);
        const ename = std.mem.span(c.sqlite3_column_text(stmt, 9));
        var row: [1024]u8 = undefined;
        const row_s = std.fmt.bufPrint(&row,
            "{{\"id\":{d},\"event_id\":{d},\"guest_name\":\"{s}\",\"email\":\"{s}\",\"status\":\"{s}\",\"waitlisted\":{d},\"token\":\"{s}\",\"created_at\":{d},\"updated_at\":{d},\"event_name\":\"{s}\"}}",
            .{ id, eid, gname, email, stat, wl, tok, cat, uat, ename },
        ) catch continue;
        buf.appendSlice(row_s) catch return;
    }
    buf.appendSlice("]") catch return;
}

pub fn find_rsvp_by_token(token: []const u8) ?RsvpRow {
    var stmt: ?*c.sqlite3_stmt = null;
    const sql = "SELECT id,event_id,guest_name,email,status,waitlisted,token,created_at,updated_at FROM rsvps WHERE token=? LIMIT 1;";
    if (c.sqlite3_prepare_v2(db, sql, -1, &stmt, null) != c.SQLITE_OK) return null;
    defer _ = c.sqlite3_finalize(stmt);
    const tz = gpa.dupeZ(u8, token) catch return null;
    defer gpa.free(tz);
    _ = c.sqlite3_bind_text(stmt, 1, tz.ptr, -1, c.SQLITE_STATIC);
    if (c.sqlite3_step(stmt) != c.SQLITE_ROW) return null;
    return RsvpRow{
        .id         = @as(u32, @intCast(c.sqlite3_column_int(stmt, 0))),
        .event_id   = @as(u32, @intCast(c.sqlite3_column_int(stmt, 1))),
        .guest_name = gpa.dupe(u8, std.mem.span(c.sqlite3_column_text(stmt, 2))) catch return null,
        .email      = gpa.dupe(u8, std.mem.span(c.sqlite3_column_text(stmt, 3))) catch return null,
        .status     = gpa.dupe(u8, std.mem.span(c.sqlite3_column_text(stmt, 4))) catch return null,
        .waitlisted = @as(u32, @intCast(c.sqlite3_column_int(stmt, 5))),
        .token      = gpa.dupe(u8, std.mem.span(c.sqlite3_column_text(stmt, 6))) catch return null,
        .created_at = c.sqlite3_column_int64(stmt, 7),
        .updated_at = c.sqlite3_column_int64(stmt, 8),
    };
}

pub fn promote_waitlist(event_id: u32) void {
    var stmt: ?*c.sqlite3_stmt = null;
    const sql = "SELECT id FROM rsvps WHERE event_id=? AND waitlisted=1 ORDER BY created_at ASC LIMIT 1;";
    if (c.sqlite3_prepare_v2(db, sql, -1, &stmt, null) != c.SQLITE_OK) return;
    defer _ = c.sqlite3_finalize(stmt);
    _ = c.sqlite3_bind_int(stmt, 1, @as(i32, @intCast(event_id)));
    if (c.sqlite3_step(stmt) != c.SQLITE_ROW) return;
    const wl_id = @as(u32, @intCast(c.sqlite3_column_int(stmt, 0)));
    var upd: ?*c.sqlite3_stmt = null;
    if (c.sqlite3_prepare_v2(db,
        "UPDATE rsvps SET status='attending',waitlisted=0,updated_at=? WHERE id=?;",
        -1, &upd, null) == c.SQLITE_OK) {
        _ = c.sqlite3_bind_int64(upd, 1, std.time.timestamp());
        _ = c.sqlite3_bind_int(upd,   2, @as(i32, @intCast(wl_id)));
        _ = c.sqlite3_step(upd);
        _ = c.sqlite3_finalize(upd);
        std.debug.print("  Waitlist: promoted RSVP #{d} to attending for event #{d}\n", .{ wl_id, event_id });
    }
}

// ══════════════════════════════════════════════════════════
//  EMAIL LOG
// ══════════════════════════════════════════════════════════
pub fn log_email(event_id: u32, recipient: []const u8, subject: []const u8, status: []const u8) void {
    var stmt: ?*c.sqlite3_stmt = null;
    const sql = "INSERT INTO email_log (event_id,recipient,subject,status,sent_at) VALUES (?,?,?,?,?);";
    if (c.sqlite3_prepare_v2(db, sql, -1, &stmt, null) != c.SQLITE_OK) return;
    defer _ = c.sqlite3_finalize(stmt);
    const rz   = gpa.dupeZ(u8, recipient) catch return; defer gpa.free(rz);
    const subz = gpa.dupeZ(u8, subject)   catch return; defer gpa.free(subz);
    const sz   = gpa.dupeZ(u8, status)    catch return; defer gpa.free(sz);
    _ = c.sqlite3_bind_int(stmt,   1, @as(i32, @intCast(event_id)));
    _ = c.sqlite3_bind_text(stmt,  2, rz.ptr,   -1, c.SQLITE_STATIC);
    _ = c.sqlite3_bind_text(stmt,  3, subz.ptr, -1, c.SQLITE_STATIC);
    _ = c.sqlite3_bind_text(stmt,  4, sz.ptr,   -1, c.SQLITE_STATIC);
    _ = c.sqlite3_bind_int64(stmt, 5, std.time.timestamp());
    _ = c.sqlite3_step(stmt);
}

// ══════════════════════════════════════════════════════════
//  SESSION PERSISTENCE
// ══════════════════════════════════════════════════════════

pub fn save_session(token: []const u8, user_id: u32) void {
    var stmt: ?*c.sqlite3_stmt = null;
    if (c.sqlite3_prepare_v2(db,
        "INSERT OR REPLACE INTO sessions (token, user_id, created_at) VALUES (?, ?, ?);",
        -1, &stmt, null) != c.SQLITE_OK) return;
    defer _ = c.sqlite3_finalize(stmt);
    _ = c.sqlite3_bind_text(stmt,  1, token.ptr, @as(i32, @intCast(token.len)), c.SQLITE_STATIC);
    _ = c.sqlite3_bind_int(stmt,   2, @as(i32, @intCast(user_id)));
    _ = c.sqlite3_bind_int64(stmt, 3, std.time.timestamp());
    _ = c.sqlite3_step(stmt);
}

/// Delete a session token from SQLite when a user logs out.
pub fn delete_session(token: []const u8) void {
    var stmt: ?*c.sqlite3_stmt = null;
    if (c.sqlite3_prepare_v2(db,
        "DELETE FROM sessions WHERE token = ?;",
        -1, &stmt, null) != c.SQLITE_OK) return;
    defer _ = c.sqlite3_finalize(stmt);
    _ = c.sqlite3_bind_text(stmt, 1, token.ptr, @as(i32, @intCast(token.len)), c.SQLITE_STATIC);
    _ = c.sqlite3_step(stmt);
}

/// Load all saved sessions from SQLite into the in-memory map on startup.
pub fn load_sessions(
    sessions: *std.StringHashMap(u32),
    alloc: std.mem.Allocator,
) void {
    var stmt: ?*c.sqlite3_stmt = null;
    if (c.sqlite3_prepare_v2(db,
        "SELECT token, user_id FROM sessions WHERE logged_out_at IS NULL;",
        -1, &stmt, null) != c.SQLITE_OK) return;
    defer _ = c.sqlite3_finalize(stmt);

    while (c.sqlite3_step(stmt) == c.SQLITE_ROW) {
        const raw_token = std.mem.span(c.sqlite3_column_text(stmt, 0));
        const user_id   = @as(u32, @intCast(c.sqlite3_column_int(stmt, 1)));
        const owned     = alloc.dupe(u8, raw_token) catch continue;
        sessions.put(owned, user_id) catch {
            alloc.free(owned);
        };
    }
    std.debug.print("  Sessions loaded from SQLite into memory map\n", .{});
}

/// Delete all sessions for a user (called when admin deletes a user account).
pub fn delete_sessions_for_user(user_id: u32) void {
    var stmt: ?*c.sqlite3_stmt = null;
    if (c.sqlite3_prepare_v2(db,
        "DELETE FROM sessions WHERE user_id = ?;",
        -1, &stmt, null) != c.SQLITE_OK) return;
    defer _ = c.sqlite3_finalize(stmt);
    _ = c.sqlite3_bind_int(stmt, 1, @as(i32, @intCast(user_id)));
    _ = c.sqlite3_step(stmt);
}

/// Return all sessions (active + logged-out) joined with user info as a JSON array.
/// Each row includes logged_out_at when present (null column → omitted from JSON).
pub fn get_active_sessions(_: std.mem.Allocator, out: *std.ArrayList(u8)) void {
    var stmt: ?*c.sqlite3_stmt = null;
    const sql =
        "SELECT u.id, u.full_name, u.email, u.role, s.created_at, s.logged_out_at " ++
        "FROM sessions s JOIN users u ON s.user_id = u.id " ++
        "ORDER BY s.created_at DESC;";
    if (c.sqlite3_prepare_v2(db, sql, -1, &stmt, null) != c.SQLITE_OK) {
        out.appendSlice("[]") catch {};
        return;
    }
    defer _ = c.sqlite3_finalize(stmt);

    out.appendSlice("[") catch return;
    var first = true;
    while (c.sqlite3_step(stmt) == c.SQLITE_ROW) {
        if (!first) out.appendSlice(",") catch return;
        first = false;

        const id          = c.sqlite3_column_int(stmt, 0);
        const full_name   = std.mem.span(c.sqlite3_column_text(stmt, 1));
        const email       = std.mem.span(c.sqlite3_column_text(stmt, 2));
        const role        = c.sqlite3_column_int(stmt, 3);
        const logged_in   = c.sqlite3_column_int64(stmt, 4);
        // Column 5 is NULL for active sessions; non-zero means logged out.
        const col_type    = c.sqlite3_column_type(stmt, 5);
        const logged_out  = if (col_type == c.SQLITE_NULL) @as(i64, 0)
                            else c.sqlite3_column_int64(stmt, 5);

        if (logged_out != 0) {
            std.fmt.format(out.writer(),
                "{{\"id\":{d},\"full_name\":\"{s}\",\"email\":\"{s}\"," ++
                "\"role\":{d},\"logged_in_at\":{d},\"logged_out_at\":{d}}}",
                .{ id, full_name, email, role, logged_in, logged_out }) catch return;
        } else {
            std.fmt.format(out.writer(),
                "{{\"id\":{d},\"full_name\":\"{s}\",\"email\":\"{s}\"," ++
                "\"role\":{d},\"logged_in_at\":{d}}}",
                .{ id, full_name, email, role, logged_in }) catch return;
        }
    }
    out.appendSlice("]") catch return;
}

/// Per-user activity summary: events created + RSVP counts per status.
pub fn get_user_activity(_: std.mem.Allocator, out: *std.ArrayList(u8)) void {
    var stmt: ?*c.sqlite3_stmt = null;
    const sql = 
        \\ SELECT u.full_name, u.email, 
        \\ (SELECT COUNT(*) FROM events WHERE user_id = u.id) as ev_count,
        \\ (SELECT COUNT(*) FROM rsvps r JOIN events e ON r.event_id = e.id WHERE e.user_id = u.id) as rsvp_count,
        \\ (SELECT COUNT(*) FROM rsvps r JOIN events e ON r.event_id = e.id WHERE e.user_id = u.id AND r.status='attending' AND r.waitlisted=0) as att_count,
        \\ (SELECT COUNT(*) FROM rsvps r JOIN events e ON r.event_id = e.id WHERE e.user_id = u.id AND r.status='declined') as dec_count,
        \\ (SELECT COUNT(*) FROM rsvps r JOIN events e ON r.event_id = e.id WHERE e.user_id = u.id AND r.status='pending') as pen_count,
        \\ (SELECT COUNT(*) FROM rsvps r JOIN events e ON r.event_id = e.id WHERE e.user_id = u.id AND r.waitlisted=1) as wait_count
        \\ FROM users u WHERE u.role = 0 ORDER BY ev_count DESC;
    ;
    if (c.sqlite3_prepare_v2(db, sql, -1, &stmt, null) != c.SQLITE_OK) {
        out.appendSlice("[]") catch {};
        return;
    }
    defer _ = c.sqlite3_finalize(stmt);

    out.appendSlice("[") catch return;
    var first = true;
    while (c.sqlite3_step(stmt) == c.SQLITE_ROW) {
        if (!first) out.appendSlice(",") catch return;
        first = false;
        std.fmt.format(out.writer(),
            "{{\"full_name\":\"{s}\",\"email\":\"{s}\",\"events_created\":{d},\"total_rsvps\":{d},\"attending_count\":{d},\"declined_count\":{d},\"pending_count\":{d},\"waitlisted_count\":{d}}}",
            .{ std.mem.span(c.sqlite3_column_text(stmt, 0)), std.mem.span(c.sqlite3_column_text(stmt, 1)),
               c.sqlite3_column_int(stmt, 2), c.sqlite3_column_int(stmt, 3), c.sqlite3_column_int(stmt, 4),
               c.sqlite3_column_int(stmt, 5), c.sqlite3_column_int(stmt, 6), c.sqlite3_column_int(stmt, 7) }) catch return;
    }
    out.appendSlice("]") catch return;
}