export const ROLES = {
  SUPER_ADMIN: "super_admin",
  MANAGER: "manager",
};

// Super Admin is distinct from Manager. Manager may later share some
// operational work (viewing records, shoots, uploads) but never inherits
// Super Admin system privileges. Items marked Future/To Define stay Super Admin only.
export const CAPABILITIES = {
  view_operations: [ROLES.SUPER_ADMIN, ROLES.MANAGER],
  manage_shoots: [ROLES.SUPER_ADMIN, ROLES.MANAGER],
  manage_customers: [ROLES.SUPER_ADMIN],
  manage_projects: [ROLES.SUPER_ADMIN],
  manage_customer_access: [ROLES.SUPER_ADMIN],
  manage_managers: [ROLES.SUPER_ADMIN],
  system_settings: [ROLES.SUPER_ADMIN],
};

export const normalizeEmail = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

export const publicOperator = (user) => ({
  id: user.id,
  name: user.name,
  role: user.role,
  status: user.status,
});

export const hasCapability = (user, capability) => {
  const allowed = CAPABILITIES[capability];
  if (!user || !allowed) return false;
  if (user.status !== "active") return false;
  return allowed.includes(user.role);
};

export const denyCapability = (capability) => {
  const message =
    capability === "manage_managers" || capability === "system_settings"
      ? "This action requires Super Admin access."
      : capability === "manage_customers" ||
          capability === "manage_projects" ||
          capability === "manage_customer_access"
        ? "This action requires Super Admin access."
        : "You do not have permission to do that.";
  return { error: message, status: 403 };
};
