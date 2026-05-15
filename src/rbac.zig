const std = @import("std");

pub const Role = enum {
    admin,
    organizer,
    guest,

    pub fn fromString(s: []const u8) Role {
        if (std.mem.eql(u8, s, "admin")) return .admin;
        if (std.mem.eql(u8, s, "organizer")) return .organizer;
        return .guest;
    }
};

pub const Permission = enum {
    view_events,
    rsvp_event,
    create_event,
    delete_event,
    manage_users,
    view_all_rsvps,
};

pub fn hasPermission(role: Role, permission: Permission) bool {
    return switch (role) {
        .admin => true, 

        .organizer => switch (permission) {
            .view_events,
            .rsvp_event,
            .create_event,
            .view_all_rsvps => true,
            else => false,
        },

        .guest => switch (permission) {
            .view_events,
            .rsvp_event => true,
            else => false,
        },
    };
}