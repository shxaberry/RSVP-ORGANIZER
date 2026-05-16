// ═══════════════════════════════════════════════════════════
//  main.zig — Controller Layer
//  HTTP handlers, routing, sessions, and application entry
//  UPDATED: Admin stats endpoints, last_login tracking, RBAC
// ═══════════════════════════════════════════════════════════

const std = @import("std");
const zap = @import("zap");
const db  = @import("db.zig");

// ─── Globals ──────────────────────────────────────────────
var sessions: std.StringHashMap(u32) = undefined;
var mutex = std.Thread.Mutex{};
var gpa: std.mem.Allocator = undefined;

// ══════════════════════════════════════════════════════════
//  TOKEN GENERATION
// ══════════════════════════════════════════════════════════
fn generate_token(buf: []u8) []u8 {
    var rng  = std.rand.DefaultPrng.init(@as(u64, @bitCast(std.time.timestamp())));
    const rand = rng.random();
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    for (buf) |*b| b.* = chars[rand.intRangeAtMost(u8, 0, @as(u8, chars.len - 1))];
    return buf;
}

// ══════════════════════════════════════════════════════════
//  AUTH HELPERS
// ══════════════════════════════════════════════════════════
fn require_auth(r: zap.Request) ?u32 {
    const cookie_header = r.getHeader("cookie") orelse {
        r.setStatus(.unauthorized);
        send_json(r, "{\"success\":false,\"message\":\"Not authenticated.\"}");
        return null;
    };
    const token = get_cookie(cookie_header, "session") orelse {
        r.setStatus(.unauthorized);
        send_json(r, "{\"success\":false,\"message\":\"Not authenticated.\"}");
        return null;
    };
    mutex.lock();
    defer mutex.unlock();
    const user_id = sessions.get(token) orelse {
        r.setStatus(.unauthorized);
        send_json(r, "{\"success\":false,\"message\":\"Session expired.\"}");
        return null;
    };
    return user_id;
}

// ══════════════════════════════════════════════════════════
//  JSON / COOKIE / QUERY HELPERS
// ══════════════════════════════════════════════════════════
fn send_json(r: zap.Request, body: []const u8) void {
    r.setHeader("Content-Type",                 "application/json") catch return;
    r.setHeader("Access-Control-Allow-Origin",  "*")                catch return;
    r.setHeader("Access-Control-Allow-Headers", "Content-Type")     catch return;
    r.sendBody(body) catch return;
}

fn extract_field(json: []const u8, field: []const u8) ?[]const u8 {
    var key_buf: [128]u8 = undefined;
    const key   = std.fmt.bufPrint(&key_buf, "\"{s}\"", .{field}) catch return null;
    const pos   = std.mem.indexOf(u8, json, key) orelse return null;
    const rest  = json[pos + key.len..];
    const colon = std.mem.indexOf(u8, rest, ":") orelse return null;
    const val   = std.mem.trimLeft(u8, rest[colon + 1..], " \t\r\n");
    if (val.len == 0 or val[0] != '"') return null;
    const end   = std.mem.indexOf(u8, val[1..], "\"") orelse return null;
    return val[1 .. end + 1];
}

fn extract_int_field(json: []const u8, field: []const u8) ?u32 {
    var key_buf: [128]u8 = undefined;
    const key   = std.fmt.bufPrint(&key_buf, "\"{s}\"", .{field}) catch return null;
    const pos   = std.mem.indexOf(u8, json, key) orelse return null;
    const rest  = json[pos + key.len..];
    const colon = std.mem.indexOf(u8, rest, ":") orelse return null;
    const val   = std.mem.trimLeft(u8, rest[colon + 1..], " \t\r\n");
    var end: usize = 0;
    while (end < val.len and val[end] >= '0' and val[end] <= '9') end += 1;
    if (end == 0) return null;
    return std.fmt.parseInt(u32, val[0..end], 10) catch null;
}

fn get_cookie(header: []const u8, name: []const u8) ?[]const u8 {
    var buf: [64]u8 = undefined;
    const key  = std.fmt.bufPrint(&buf, "{s}=", .{name}) catch return null;
    const pos  = std.mem.indexOf(u8, header, key) orelse return null;
    const rest = header[pos + key.len..];
    const end  = std.mem.indexOf(u8, rest, ";") orelse rest.len;
    return std.mem.trim(u8, rest[0..end], " ");
}

fn get_query_param(r: zap.Request, name: []const u8) ?[]const u8 {
    const query = r.query orelse return null;
    var key_buf: [64]u8 = undefined;
    const key  = std.fmt.bufPrint(&key_buf, "{s}=", .{name}) catch return null;
    const pos  = std.mem.indexOf(u8, query, key) orelse return null;
    const rest = query[pos + key.len..];
    const end  = std.mem.indexOf(u8, rest, "&") orelse rest.len;
    return rest[0..end];
}

fn path_segment(path: []const u8, after_prefix: []const u8) ?[]const u8 {
    if (!std.mem.startsWith(u8, path, after_prefix)) return null;
    const seg = path[after_prefix.len..];
    const end = std.mem.indexOf(u8, seg, "/") orelse seg.len;
    return seg[0..end];
}

// ══════════════════════════════════════════════════════════
//  ROUTE HANDLERS — AUTH
// ══════════════════════════════════════════════════════════
fn on_register(r: zap.Request) void {
    const body = r.body orelse { send_json(r, "{\"success\":false,\"message\":\"No body.\"}"); return; };
    const full_name = extract_field(body, "full_name") orelse {
        send_json(r, "{\"success\":false,\"errors\":[{\"field\":\"full_name\",\"message\":\"Full name is required.\"}]}"); return;
    };
    const email = extract_field(body, "email") orelse {
        send_json(r, "{\"success\":false,\"errors\":[{\"field\":\"email\",\"message\":\"Email is required.\"}]}"); return;
    };
    const password = extract_field(body, "password") orelse {
        send_json(r, "{\"success\":false,\"errors\":[{\"field\":\"password\",\"message\":\"Password is required.\"}]}"); return;
    };
    const confirm_password = extract_field(body, "confirm_password") orelse {
        send_json(r, "{\"success\":false,\"errors\":[{\"field\":\"confirm_password\",\"message\":\"Please confirm your password.\"}]}"); return;
    };
    if (full_name.len < 2) { send_json(r, "{\"success\":false,\"errors\":[{\"field\":\"full_name\",\"message\":\"Full name too short.\"}]}"); return; }
    if (password.len < 6)  { send_json(r, "{\"success\":false,\"errors\":[{\"field\":\"password\",\"message\":\"Password must be at least 6 characters.\"}]}"); return; }
    if (!std.mem.eql(u8, password, confirm_password)) { send_json(r, "{\"success\":false,\"errors\":[{\"field\":\"confirm_password\",\"message\":\"Passwords do not match.\"}]}"); return; }
    mutex.lock(); defer mutex.unlock();
    if (db.db_find_user_by_email(email) != null) { send_json(r, "{\"success\":false,\"errors\":[{\"field\":\"email\",\"message\":\"Email already registered.\"}]}"); return; }
    if (!db.insert_user(full_name, email, password)) { send_json(r, "{\"success\":false,\"message\":\"Failed to create account.\"}"); return; }
    send_json(r, "{\"success\":true,\"message\":\"Account created! Please log in.\"}");
}

fn on_login(r: zap.Request) void {
    const body = r.body orelse { send_json(r, "{\"success\":false,\"message\":\"No body.\"}"); return; };
    const email    = extract_field(body, "email")    orelse { send_json(r, "{\"success\":false,\"message\":\"Email is required.\"}");    return; };
    const password = extract_field(body, "password") orelse { send_json(r, "{\"success\":false,\"message\":\"Password is required.\"}"); return; };
    mutex.lock(); defer mutex.unlock();
    const user = db.db_find_user_by_email(email) orelse {
        send_json(r, "{\"success\":false,\"message\":\"Invalid email or password.\"}"); return;
    };
    if (!std.mem.eql(u8, user.password, password)) {
        send_json(r, "{\"success\":false,\"message\":\"Invalid email or password.\"}"); return;
    }
    // Record last login timestamp
    db.update_last_login(user.id);

    var token_buf: [64]u8 = undefined;
    const token = std.fmt.bufPrint(&token_buf, "sess_{d}_{d}", .{ user.id, std.time.timestamp() }) catch return;
    const token_owned = gpa.dupe(u8, token) catch return;
    sessions.put(token_owned, user.id) catch return;
    var cookie_buf: [128]u8 = undefined;
    const cookie = std.fmt.bufPrint(&cookie_buf, "session={s}; Path=/; HttpOnly", .{token}) catch return;
    r.setHeader("Set-Cookie", cookie) catch return;
    var resp_buf: [512]u8 = undefined;
    const resp = std.fmt.bufPrint(&resp_buf,
        "{{\"success\":true,\"user\":{{\"id\":{d},\"full_name\":\"{s}\",\"email\":\"{s}\",\"role\":{d},\"created_at\":{d}}}}}",
        .{ user.id, user.full_name, user.email, user.role, user.created_at }) catch return;
    send_json(r, resp);
}

fn on_me(r: zap.Request) void {
    const user_id = require_auth(r) orelse return;
    const user = db.db_find_user_by_id(user_id) orelse {
        send_json(r, "{\"success\":false,\"message\":\"User not found.\"}"); return;
    };
    var resp_buf: [512]u8 = undefined;
    const resp = std.fmt.bufPrint(&resp_buf,
        "{{\"success\":true,\"user\":{{\"id\":{d},\"full_name\":\"{s}\",\"email\":\"{s}\",\"role\":{d},\"created_at\":{d}}}}}",
        .{ user.id, user.full_name, user.email, user.role, user.created_at }) catch return;
    send_json(r, resp);
}

fn on_logout(r: zap.Request) void {
    if (r.getHeader("cookie")) |ch| {
        if (get_cookie(ch, "session")) |token| {
            mutex.lock();
            if (sessions.fetchRemove(token)) |kv| {
                gpa.free(kv.key); // ← free the duped token
            }
            mutex.unlock();
        }
    }
    r.setHeader("Set-Cookie", "session=; Path=/; HttpOnly; Max-Age=0") catch return;
    send_json(r, "{\"success\":true}");
}

fn on_rsvp_info(r: zap.Request) void {
    const token = get_query_param(r, "token") orelse {
        send_json(r, "{\"success\":false,\"message\":\"Token required.\"}"); return;
    };
    mutex.lock();
    const rsvp = db.find_rsvp_by_token(token);
    mutex.unlock();
    const row = rsvp orelse {
        send_json(r, "{\"success\":false,\"message\":\"RSVP not found.\"}"); return;
    };
    var stmt: ?*db.c.sqlite3_stmt = null;
    if (db.c.sqlite3_prepare_v2(db.db,
        "SELECT name,date,location,description,capacity FROM events WHERE id=?;",
        -1, &stmt, null) != db.c.SQLITE_OK) {
        send_json(r, "{\"success\":false,\"message\":\"DB error.\"}"); return;
    }
    defer _ = db.c.sqlite3_finalize(stmt);
    _ = db.c.sqlite3_bind_int(stmt, 1, @as(i32, @intCast(row.event_id)));
    if (db.c.sqlite3_step(stmt) != db.c.SQLITE_ROW) {
        send_json(r, "{\"success\":false,\"message\":\"Event not found.\"}"); return;
    }
    const ev_name = std.mem.span(db.c.sqlite3_column_text(stmt, 0));
    const ev_date = std.mem.span(db.c.sqlite3_column_text(stmt, 1));
    const ev_loc  = std.mem.span(db.c.sqlite3_column_text(stmt, 2));
    const ev_desc = std.mem.span(db.c.sqlite3_column_text(stmt, 3));
    const ev_cap  = db.c.sqlite3_column_int(stmt, 4);
    var resp: [1024]u8 = undefined;
    const resp_s = std.fmt.bufPrint(&resp,
        "{{\"success\":true,\"guest_name\":\"{s}\",\"status\":\"{s}\",\"waitlisted\":{d},\"event\":{{\"name\":\"{s}\",\"date\":\"{s}\",\"location\":\"{s}\",\"description\":\"{s}\",\"capacity\":{d}}}}}",
        .{ row.guest_name, row.status, row.waitlisted, ev_name, ev_date, ev_loc, ev_desc, ev_cap }
    ) catch return;
    send_json(r, resp_s);
}

// ══════════════════════════════════════════════════════════
//  ROUTE HANDLERS — EVENTS
// ══════════════════════════════════════════════════════════
fn on_events_list(r: zap.Request, user_id: u32) void {
    var buf = std.ArrayList(u8).init(gpa);
    defer buf.deinit();
    mutex.lock();
    db.get_events_for_user(user_id, &buf);
    mutex.unlock();
    var resp = std.ArrayList(u8).init(gpa);
    defer resp.deinit();
    resp.appendSlice("{\"success\":true,\"events\":") catch return;
    resp.appendSlice(buf.items) catch return;
    resp.appendSlice("}") catch return;
    send_json(r, resp.items);
}

fn on_events_create(r: zap.Request, user_id: u32) void {
    const body     = r.body orelse { send_json(r, "{\"success\":false,\"message\":\"No body.\"}"); return; };
    const name     = extract_field(body, "name")        orelse { send_json(r, "{\"success\":false,\"message\":\"Event name is required.\"}"); return; };
    const date     = extract_field(body, "date")        orelse { send_json(r, "{\"success\":false,\"message\":\"Event date is required.\"}"); return; };
    const location = extract_field(body, "location")    orelse "";
    const desc     = extract_field(body, "description") orelse "";
    const capacity = extract_int_field(body, "capacity") orelse 0;
    mutex.lock(); defer mutex.unlock();
    if (!db.insert_event(user_id, name, date, location, desc, capacity)) {
        send_json(r, "{\"success\":false,\"message\":\"Failed to create event.\"}"); return;
    }
    const new_id = @as(u32, @intCast(db.c.sqlite3_last_insert_rowid(db.db)));
    var resp: [256]u8 = undefined;
    const resp_s = std.fmt.bufPrint(&resp,
        "{{\"success\":true,\"message\":\"Event created.\",\"id\":{d}}}", .{new_id}) catch return;
    send_json(r, resp_s);
}

fn on_events_delete(r: zap.Request, user_id: u32, event_id: u32) void {
    mutex.lock(); defer mutex.unlock();
    if (!db.delete_event(event_id, user_id)) {
        send_json(r, "{\"success\":false,\"message\":\"Event not found or not authorized.\"}"); return;
    }
    send_json(r, "{\"success\":true,\"message\":\"Event deleted.\"}");
}

// ══════════════════════════════════════════════════════════
//  ROUTE HANDLERS — RSVPs
// ══════════════════════════════════════════════════════════
fn on_rsvps_list(r: zap.Request, user_id: u32) void {
    var buf = std.ArrayList(u8).init(gpa);
    defer buf.deinit();
    mutex.lock();
    db.get_all_rsvps_for_user(user_id, &buf);
    mutex.unlock();
    var resp = std.ArrayList(u8).init(gpa);
    defer resp.deinit();
    resp.appendSlice("{\"success\":true,\"rsvps\":") catch return;
    resp.appendSlice(buf.items) catch return;
    resp.appendSlice("}") catch return;
    send_json(r, resp.items);
}

fn on_rsvps_create(r: zap.Request, user_id: u32) void {
    const body       = r.body orelse { send_json(r, "{\"success\":false,\"message\":\"No body.\"}"); return; };
    const guest_name = extract_field(body, "guest_name")   orelse { send_json(r, "{\"success\":false,\"message\":\"Guest name required.\"}");  return; };
    const email      = extract_field(body, "email")        orelse { send_json(r, "{\"success\":false,\"message\":\"Guest email required.\"}"); return; };
    const status     = extract_field(body, "status")       orelse "pending";
    const event_id   = extract_int_field(body, "event_id") orelse { send_json(r, "{\"success\":false,\"message\":\"Event ID required.\"}");     return; };
    mutex.lock(); defer mutex.unlock();
    if (!db.event_belongs_to_user(event_id, user_id)) {
        send_json(r, "{\"success\":false,\"message\":\"Event not found.\"}"); return;
    }
    if (db.rsvp_exists(event_id, email)) {
        send_json(r, "{\"success\":false,\"message\":\"This guest already has an RSVP for this event.\"}"); return;
    }
    var waitlisted: u32 = 0;
    const capacity = db.get_event_capacity(event_id);
    if (capacity > 0 and std.mem.eql(u8, status, "attending")) {
        const attending = db.count_attending(event_id);
        if (attending >= capacity) waitlisted = 1;
    }
    var tok_buf: [16]u8 = undefined;
    const tok = generate_token(&tok_buf);
    if (!db.insert_rsvp(event_id, guest_name, email, status, waitlisted, tok)) {
        send_json(r, "{\"success\":false,\"message\":\"Failed to save RSVP.\"}"); return;
    }
    const new_id     = @as(u32, @intCast(db.c.sqlite3_last_insert_rowid(db.db)));
    const event_name = db.get_event_name(event_id);
    var subj: [128]u8 = undefined;
    const subj_s = if (waitlisted == 1)
        std.fmt.bufPrint(&subj, "You are on the waitlist for {s}", .{event_name}) catch "Waitlist confirmation"
    else
        std.fmt.bufPrint(&subj, "RSVP confirmed for {s}", .{event_name}) catch "RSVP confirmation";
    db.log_email(event_id, email, subj_s, "queued");
    var resp: [256]u8 = undefined;
    const resp_s = std.fmt.bufPrint(&resp,
        "{{\"success\":true,\"id\":{d},\"waitlisted\":{d},\"token\":\"{s}\"}}",
        .{ new_id, waitlisted, tok }) catch return;
    send_json(r, resp_s);
}

fn on_rsvps_update(r: zap.Request, user_id: u32, rsvp_id: u32) void {
    const body   = r.body orelse { send_json(r, "{\"success\":false,\"message\":\"No body.\"}"); return; };
    const status = extract_field(body, "status") orelse { send_json(r, "{\"success\":false,\"message\":\"Status required.\"}"); return; };
    mutex.lock(); defer mutex.unlock();
    var stmt: ?*db.c.sqlite3_stmt = null;
    if (db.c.sqlite3_prepare_v2(db.db,
        "SELECT r.event_id FROM rsvps r JOIN events e ON r.event_id=e.id WHERE r.id=? AND e.user_id=?;",
        -1, &stmt, null) != db.c.SQLITE_OK) {
        send_json(r, "{\"success\":false,\"message\":\"DB error.\"}"); return;
    }
    defer _ = db.c.sqlite3_finalize(stmt);
    _ = db.c.sqlite3_bind_int(stmt, 1, @as(i32, @intCast(rsvp_id)));
    _ = db.c.sqlite3_bind_int(stmt, 2, @as(i32, @intCast(user_id)));
    if (db.c.sqlite3_step(stmt) != db.c.SQLITE_ROW) {
        send_json(r, "{\"success\":false,\"message\":\"RSVP not found or not authorized.\"}"); return;
    }
    const event_id = @as(u32, @intCast(db.c.sqlite3_column_int(stmt, 0)));
    if (!db.update_rsvp_status(rsvp_id, status)) {
        send_json(r, "{\"success\":false,\"message\":\"Failed to update.\"}"); return;
    }
    if (std.mem.eql(u8, status, "declined")) db.promote_waitlist(event_id);
    send_json(r, "{\"success\":true,\"message\":\"RSVP updated.\"}");
}

fn on_rsvps_delete(r: zap.Request, user_id: u32, rsvp_id: u32) void {
    mutex.lock(); defer mutex.unlock();
    var stmt: ?*db.c.sqlite3_stmt = null;
    if (db.c.sqlite3_prepare_v2(db.db,
        "SELECT r.event_id FROM rsvps r JOIN events e ON r.event_id=e.id WHERE r.id=? AND e.user_id=?;",
        -1, &stmt, null) != db.c.SQLITE_OK) {
        send_json(r, "{\"success\":false,\"message\":\"DB error.\"}"); return;
    }
    defer _ = db.c.sqlite3_finalize(stmt);
    _ = db.c.sqlite3_bind_int(stmt, 1, @as(i32, @intCast(rsvp_id)));
    _ = db.c.sqlite3_bind_int(stmt, 2, @as(i32, @intCast(user_id)));
    if (db.c.sqlite3_step(stmt) != db.c.SQLITE_ROW) {
        send_json(r, "{\"success\":false,\"message\":\"RSVP not found or not authorized.\"}"); return;
    }
    const event_id = @as(u32, @intCast(db.c.sqlite3_column_int(stmt, 0)));
    if (!db.delete_rsvp(rsvp_id)) {
        send_json(r, "{\"success\":false,\"message\":\"Failed to delete.\"}"); return;
    }
    db.promote_waitlist(event_id);
    send_json(r, "{\"success\":true,\"message\":\"RSVP deleted.\"}");
}

// ══════════════════════════════════════════════════════════
//  ROUTE HANDLER — EMAIL ALL PENDING
// ══════════════════════════════════════════════════════════
fn on_email_all(r: zap.Request, user_id: u32, event_id: u32) void {
    mutex.lock(); defer mutex.unlock();
    if (!db.event_belongs_to_user(event_id, user_id)) {
        send_json(r, "{\"success\":false,\"message\":\"Event not found.\"}"); return;
    }
    var stmt: ?*db.c.sqlite3_stmt = null;
    if (db.c.sqlite3_prepare_v2(db.db,
        "SELECT email,guest_name FROM rsvps WHERE event_id=? AND status='pending';",
        -1, &stmt, null) != db.c.SQLITE_OK) {
        send_json(r, "{\"success\":false,\"message\":\"DB error.\"}"); return;
    }
    defer _ = db.c.sqlite3_finalize(stmt);
    _ = db.c.sqlite3_bind_int(stmt, 1, @as(i32, @intCast(event_id)));
    const event_name = db.get_event_name(event_id);
    var count: u32 = 0;
    while (db.c.sqlite3_step(stmt) == db.c.SQLITE_ROW) {
        const email = std.mem.span(db.c.sqlite3_column_text(stmt, 0));
        var subj: [128]u8 = undefined;
        const subj_s = std.fmt.bufPrint(&subj, "Reminder: Please respond to {s}", .{event_name}) catch "Reminder";
        db.log_email(event_id, email, subj_s, "queued");
        count += 1;
        std.debug.print("  [EMAIL STUB] To: {s} | Subject: {s}\n", .{ email, subj_s });
    }
    var resp: [128]u8 = undefined;
    const resp_s = std.fmt.bufPrint(&resp,
        "{{\"success\":true,\"message\":\"Email queued for {d} pending guests.\"}}", .{count}) catch return;
    send_json(r, resp_s);
}

// ══════════════════════════════════════════════════════════
//  ROUTE HANDLER — GUEST PUBLIC PORTAL
// ══════════════════════════════════════════════════════════
fn on_guest_portal_get(r: zap.Request) void {
    serve_index(r);
}

fn on_guest_portal_submit(r: zap.Request) void {
    const body   = r.body orelse { send_json(r, "{\"success\":false,\"message\":\"No body.\"}"); return; };
    const token  = extract_field(body, "token")  orelse { send_json(r, "{\"success\":false,\"message\":\"Token required.\"}");  return; };
    const status = extract_field(body, "status") orelse { send_json(r, "{\"success\":false,\"message\":\"Status required.\"}"); return; };
    if (!std.mem.eql(u8, status, "attending") and !std.mem.eql(u8, status, "declined")) {
        send_json(r, "{\"success\":false,\"message\":\"Status must be attending or declined.\"}"); return;
    }
    mutex.lock(); defer mutex.unlock();
    const rsvp = db.find_rsvp_by_token(token) orelse {
        send_json(r, "{\"success\":false,\"message\":\"Invalid RSVP token.\"}"); return;
    };
    if (std.mem.eql(u8, status, "attending") and rsvp.waitlisted == 0) {
        const capacity = db.get_event_capacity(rsvp.event_id);
        if (capacity > 0) {
            const attending = db.count_attending(rsvp.event_id);
            if (attending >= capacity) {
                var u_stmt: ?*db.c.sqlite3_stmt = null;
                if (db.c.sqlite3_prepare_v2(db.db,
                    "UPDATE rsvps SET status='attending',waitlisted=1,updated_at=? WHERE id=?;",
                    -1, &u_stmt, null) == db.c.SQLITE_OK) {
                    _ = db.c.sqlite3_bind_int64(u_stmt, 1, std.time.timestamp());
                    _ = db.c.sqlite3_bind_int(u_stmt,   2, @as(i32, @intCast(rsvp.id)));
                    _ = db.c.sqlite3_step(u_stmt);
                    _ = db.c.sqlite3_finalize(u_stmt);
                }
                send_json(r, "{\"success\":true,\"waitlisted\":true,\"message\":\"Event is full. You have been added to the waitlist.\"}");
                return;
            }
        }
    }
    if (!db.update_rsvp_status(rsvp.id, status)) {
        send_json(r, "{\"success\":false,\"message\":\"Failed to update RSVP.\"}"); return;
    }
    if (std.mem.eql(u8, status, "declined")) db.promote_waitlist(rsvp.event_id);
    var resp: [128]u8 = undefined;
    const resp_s = std.fmt.bufPrint(&resp,
        "{{\"success\":true,\"waitlisted\":false,\"message\":\"Your RSVP has been updated to {s}.\"}}",
        .{status}) catch return;
    send_json(r, resp_s);
}

// ══════════════════════════════════════════════════════════
//  STATIC FILE SERVER
// ══════════════════════════════════════════════════════════
fn serve_static(r: zap.Request, path: []const u8) void {
    var file_path_buf: [256]u8 = undefined;
    const file_path = std.fmt.bufPrint(&file_path_buf, "public{s}", .{path}) catch {
        r.setStatus(.not_found);
        r.sendBody("Not found") catch return;
        return;
    };
    const file = std.fs.cwd().openFile(file_path, .{}) catch {
        r.setStatus(.not_found);
        r.sendBody("Not found") catch return;
        return;
    };
    defer file.close();
    const content = file.readToEndAlloc(gpa, 5_000_000) catch return;
    defer gpa.free(content);
    if (std.mem.endsWith(u8, path, ".css")) {
        r.setHeader("Content-Type", "text/css") catch return;
    } else if (std.mem.endsWith(u8, path, ".js")) {
        r.setHeader("Content-Type", "application/javascript") catch return;
    } else if (std.mem.endsWith(u8, path, ".html")) {
        r.setHeader("Content-Type", "text/html") catch return;
    }
    r.sendBody(content) catch return;
}

fn serve_index(r: zap.Request) void {
    serve_static(r, "/index.html");
}

// ══════════════════════════════════════════════════════════
//  MAIN ROUTER
// ══════════════════════════════════════════════════════════
fn on_request(r: zap.Request) void {
    const path   = r.path   orelse "/";
    const method = r.method orelse "GET";

    // ── OPTIONS preflight ────────────────────────────────
    if (std.mem.eql(u8, method, "OPTIONS")) {
        r.setHeader("Access-Control-Allow-Origin",  "*")                          catch return;
        r.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE")      catch return;
        r.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization") catch return;
        r.sendBody("") catch return;
        return;
    }

    // ── Static assets ────────────────────────────────────
    if (std.mem.startsWith(u8, path, "/css/")) { serve_static(r, path); return; }
    if (std.mem.startsWith(u8, path, "/js/"))  { serve_static(r, path); return; }

    // ── Root ─────────────────────────────────────────────
    if (std.mem.eql(u8, path, "/") or std.mem.eql(u8, path, "/favicon.ico")) {
        serve_index(r); return;
    }

    // ── Public: auth ─────────────────────────────────────
    if (std.mem.eql(u8, path, "/api/auth/register") and std.mem.eql(u8, method, "POST")) { on_register(r); return; }
    if (std.mem.eql(u8, path, "/api/auth/login")    and std.mem.eql(u8, method, "POST")) { on_login(r);    return; }
    if (std.mem.eql(u8, path, "/api/auth/me")       and std.mem.eql(u8, method, "GET"))  { on_me(r);       return; }
    if (std.mem.eql(u8, path, "/api/auth/logout")   and std.mem.eql(u8, method, "POST")) { on_logout(r);   return; }

    // ── Public: guest portal ─────────────────────────────
    if (std.mem.startsWith(u8, path, "/rsvp")) {
        if (std.mem.eql(u8, method, "GET"))  { on_guest_portal_get(r);    return; }
        if (std.mem.eql(u8, method, "POST")) { on_guest_portal_submit(r); return; }
    }
    if (std.mem.startsWith(u8, path, "/api/rsvp-info") and std.mem.eql(u8, method, "GET")) {
        on_rsvp_info(r); return;
    }

    // ── Protected: require valid session ─────────────────
    const user_id = require_auth(r) orelse return;

    const user = db.db_find_user_by_id(user_id) orelse {
        send_json(r, "{\"success\":false,\"message\":\"User not found.\"}"); return;
    };
    const is_admin = user.role == 1;

    // ── Admin-only endpoints ─────────────────────────────
    if (std.mem.startsWith(u8, path, "/api/admin/")) {
        if (!is_admin) {
            r.setStatus(.forbidden);
            send_json(r, "{\"success\":false,\"message\":\"Admin access required.\"}");
            return;
        }

        // GET /api/admin/stats — platform-wide summary numbers
        if (std.mem.eql(u8, path, "/api/admin/stats") and std.mem.eql(u8, method, "GET")) {
            var buf = std.ArrayList(u8).init(gpa);
            defer buf.deinit();
            mutex.lock();
            db.get_admin_stats(&buf);
            mutex.unlock();
            var resp = std.ArrayList(u8).init(gpa);
            defer resp.deinit();
            resp.appendSlice("{\"success\":true,\"stats\":") catch return;
            resp.appendSlice(buf.items) catch return;
            resp.appendSlice("}") catch return;
            send_json(r, resp.items);
            return;
        }

        // GET /api/admin/organizers — per-organizer breakdown
        if (std.mem.eql(u8, path, "/api/admin/organizers") and std.mem.eql(u8, method, "GET")) {
            var buf = std.ArrayList(u8).init(gpa);
            defer buf.deinit();
            mutex.lock();
            db.get_admin_organizer_breakdown(&buf);
            mutex.unlock();
            var resp = std.ArrayList(u8).init(gpa);
            defer resp.deinit();
            resp.appendSlice("{\"success\":true,\"organizers\":") catch return;
            resp.appendSlice(buf.items) catch return;
            resp.appendSlice("}") catch return;
            send_json(r, resp.items);
            return;
        }

        // GET /api/admin/events — all events across all organizers
        if (std.mem.eql(u8, path, "/api/admin/events") and std.mem.eql(u8, method, "GET")) {
            var buf = std.ArrayList(u8).init(gpa);
            defer buf.deinit();
            mutex.lock();
            db.get_all_events_admin(&buf);
            mutex.unlock();
            var resp = std.ArrayList(u8).init(gpa);
            defer resp.deinit();
            resp.appendSlice("{\"success\":true,\"events\":") catch return;
            resp.appendSlice(buf.items) catch return;
            resp.appendSlice("}") catch return;
            send_json(r, resp.items);
            return;
        }

        // GET /api/admin/users
        if (std.mem.eql(u8, path, "/api/admin/users") and std.mem.eql(u8, method, "GET")) {
            var buf = std.ArrayList(u8).init(gpa);
            defer buf.deinit();
            mutex.lock();
            db.get_all_users(gpa, &buf);
            mutex.unlock();
            var resp = std.ArrayList(u8).init(gpa);
            defer resp.deinit();
            resp.appendSlice("{\"success\":true,\"users\":") catch return;
            resp.appendSlice(buf.items) catch return;
            resp.appendSlice("}") catch return;
            send_json(r, resp.items);
            return;
        }

        // PATCH /api/admin/users/:id/role
        if (std.mem.startsWith(u8, path, "/api/admin/users/") and
            std.mem.endsWith(u8, path, "/role") and
            std.mem.eql(u8, method, "PATCH"))
        {
            const seg       = path_segment(path, "/api/admin/users/") orelse "0";
            const target_id = std.fmt.parseInt(u32, seg, 10) catch 0;
            if (target_id == 0 or target_id == user_id) {
                send_json(r, "{\"success\":false,\"message\":\"Cannot change your own role.\"}");
                return;
            }
            const body     = r.body orelse "";
            const new_role = extract_int_field(body, "role") orelse 0;
            if (db.update_user_role(target_id, new_role)) {
                send_json(r, "{\"success\":true,\"message\":\"Role updated.\"}");
            } else {
                send_json(r, "{\"success\":false,\"message\":\"Failed to update role.\"}");
            }
            return;
        }

        // DELETE /api/admin/users/:id
        if (std.mem.startsWith(u8, path, "/api/admin/users/") and std.mem.eql(u8, method, "DELETE")) {
            const seg       = path_segment(path, "/api/admin/users/") orelse "0";
            const target_id = std.fmt.parseInt(u32, seg, 10) catch 0;
            if (target_id == 0 or target_id == user_id) {
                send_json(r, "{\"success\":false,\"message\":\"Cannot delete your own account.\"}");
                return;
            }
            if (db.delete_user_by_id(target_id)) {
                send_json(r, "{\"success\":true,\"message\":\"User deleted.\"}");
            } else {
                send_json(r, "{\"success\":false,\"message\":\"Deletion failed.\"}");
            }
            return;
        }

        r.setStatus(.not_found);
        send_json(r, "{\"success\":false,\"message\":\"Admin endpoint not found.\"}");
        return;
    }

    // ── Events (organizer only — admin has read-only /api/admin/events) ──
    if (std.mem.eql(u8, path, "/api/events") and std.mem.eql(u8, method, "GET"))  { on_events_list(r, user_id);   return; }
    if (std.mem.eql(u8, path, "/api/events") and std.mem.eql(u8, method, "POST")) {
        if (is_admin) {
            r.setStatus(.forbidden);
            send_json(r, "{\"success\":false,\"message\":\"Admins cannot create events.\"}");
            return;
        }
        on_events_create(r, user_id);
        return;
    }

    if (std.mem.startsWith(u8, path, "/api/events/")) {
        const seg      = path_segment(path, "/api/events/") orelse { serve_index(r); return; };
        const event_id = std.fmt.parseInt(u32, seg, 10)     catch  { serve_index(r); return; };

        if (std.mem.eql(u8, method, "DELETE")) {
            if (is_admin) {
                r.setStatus(.forbidden);
                send_json(r, "{\"success\":false,\"message\":\"Admins cannot delete events.\"}");
                return;
            }
            on_events_delete(r, user_id, event_id);
            return;
        }

        if (std.mem.endsWith(u8, path, "/rsvps")) {
            var buf = std.ArrayList(u8).init(gpa); defer buf.deinit();
            mutex.lock(); db.get_rsvps_for_event(event_id, &buf); mutex.unlock();
            var resp = std.ArrayList(u8).init(gpa); defer resp.deinit();
            resp.appendSlice("{\"success\":true,\"rsvps\":") catch return;
            resp.appendSlice(buf.items) catch return;
            resp.appendSlice("}") catch return;
            send_json(r, resp.items);
            return;
        }

        if (std.mem.endsWith(u8, path, "/email-all") and std.mem.eql(u8, method, "POST")) {
            if (is_admin) {
                r.setStatus(.forbidden);
                send_json(r, "{\"success\":false,\"message\":\"Admins cannot send emails.\"}");
                return;
            }
            on_email_all(r, user_id, event_id);
            return;
        }
    }

    // ── RSVPs ────────────────────────────────────────────
    if (std.mem.eql(u8, path, "/api/rsvps") and std.mem.eql(u8, method, "GET"))  { on_rsvps_list(r, user_id);   return; }
    if (std.mem.eql(u8, path, "/api/rsvps") and std.mem.eql(u8, method, "POST")) {
        if (is_admin) {
            r.setStatus(.forbidden);
            send_json(r, "{\"success\":false,\"message\":\"Admins cannot add guests.\"}");
            return;
        }
        on_rsvps_create(r, user_id);
        return;
    }

    if (std.mem.startsWith(u8, path, "/api/rsvps/")) {
        const seg     = path_segment(path, "/api/rsvps/") orelse { serve_index(r); return; };
        const rsvp_id = std.fmt.parseInt(u32, seg, 10)    catch  { serve_index(r); return; };
        if (std.mem.eql(u8, method, "PATCH"))  {
            if (is_admin) {
                r.setStatus(.forbidden);
                send_json(r, "{\"success\":false,\"message\":\"Admins cannot modify RSVPs.\"}");
                return;
            }
            on_rsvps_update(r, user_id, rsvp_id);
            return;
        }
        if (std.mem.eql(u8, method, "DELETE")) {
            if (is_admin) {
                r.setStatus(.forbidden);
                send_json(r, "{\"success\":false,\"message\":\"Admins cannot delete RSVPs.\"}");
                return;
            }
            on_rsvps_delete(r, user_id, rsvp_id);
            return;
        }
    }

    // ── Fallback ─────────────────────────────────────────
    serve_index(r);
}

// ══════════════════════════════════════════════════════════
//  ENTRY POINT
// ══════════════════════════════════════════════════════════
pub fn main() !void {
    var gpa_inst = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa_inst.deinit();
    gpa = gpa_inst.allocator();

    db.allocator = gpa;

    sessions = std.StringHashMap(u32).init(gpa);
    defer sessions.deinit();

    try db.init();
    defer db.close();

    std.debug.print("\n╔══════════════════════════════════════════╗\n", .{});
    std.debug.print("║   RSVP Manager  — Zig 0.13.0 + Zap       ║\n", .{});
    std.debug.print("║   http://localhost:3000                  ║\n", .{});
    std.debug.print("╚══════════════════════════════════════════╝\n\n", .{});

    var server = zap.HttpListener.init(.{
        .port        = 3000,
        .on_request  = on_request,
        .log         = true,
        .max_clients = 100000,
    });
    try server.listen();
    zap.start(.{ .threads = 2, .workers = 1 });
}