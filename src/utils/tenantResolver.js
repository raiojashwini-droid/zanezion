import prisma from '../config/db.js';

let cachedHqTenantId = null;

/**
 * Dynamically resolves the Root / HQ Tenant ID (ZaneZion Global Platform).
 * Avoids fragile hardcoding of tenantId === 1.
 */
export const getHqTenantId = async () => {
  if (cachedHqTenantId) return cachedHqTenantId;
  try {
    const rootTenant = await prisma.tenant.findFirst({
      where: {
        OR: [
          { tenantCode: 'ZNZ-ROOT' },
          { id: 1 }
        ]
      },
      select: { id: true }
    });
    if (rootTenant?.id) {
      cachedHqTenantId = rootTenant.id;
      return cachedHqTenantId;
    }
  } catch (err) {
    console.error('Error resolving dynamic HQ tenant ID:', err?.message || err);
  }
  return 1;
};

/**
 * Centralized Tenant ID Resolver for SaaS Multi-Tenant Isolation.
 *
 * RULE:
 *  - Super Admin (tenantId=1) → sees ONLY their own HQ data (tenantId=1)
 *    UNLESS they explicitly pass ?tenantId=X to drill into a specific tenant.
 *  - Everyone else → always filtered by their own req.user.tenantId.
 */
export const resolveTenantId = (req) => {
  const roleName = String(typeof req.user?.role === 'string' ? req.user.role : (req.user?.role?.name || '')).toUpperCase();
  const isSuperAdmin = roleName === 'SUPER_ADMIN' || roleName === 'SUPERADMIN' || req.user?.roleId === 1;

  if (isSuperAdmin) {
    if (req.query?.tenantId) {
      return Number(req.query.tenantId);
    }
    return req.user?.tenantId || 1;
  }

  // All other roles: strictly their own tenant
  return req.user?.tenantId || 1;
};

/**
 * Special resolver for SaaS management endpoints where Super Admin
 * NEEDS to see all tenants (e.g., SaaS Clients list, Subscriptions, Plans).
 * Returns null ONLY for Super Admin.
 */
export const resolveTenantIdForSaasManagement = (req) => {
  const roleName = String(typeof req.user?.role === 'string' ? req.user.role : (req.user?.role?.name || '')).toUpperCase();
  const isSuperAdmin = roleName === 'SUPER_ADMIN' || roleName === 'SUPERADMIN' || req.user?.roleId === 1;

  if (isSuperAdmin) {
    if (req.query?.tenantId) {
      return Number(req.query.tenantId);
    }
    return null;
  }

  return req.user?.tenantId || 1;
};

/**
 * Special resolver for operational routes (Deliveries, Missions, etc.).
 * ONLY HQ Staff / Super Admin (under tenantId: 1) have cross-tenant operational management.
 * All client accounts (SAAS_CLIENT, BUSINESS_CLIENT, CUSTOMER) and non-HQ tenant accounts
 * are strictly isolated to their own tenantId.
 */
export const resolveTenantIdForOperations = (req) => {
  const roleName = String(typeof req.user?.role === 'string' ? req.user.role : (req.user?.role?.name || '')).toUpperCase();
  const userTenant = req.user?.tenantId ? Number(req.user.tenantId) : 1;
  const isSuperAdmin = ['SUPER_ADMIN', 'SUPERADMIN'].includes(roleName) || req.user?.roleId === 1;

  if (req.query?.tenantId) {
    if (req.query.tenantId === 'all' && isSuperAdmin) return null;
    return Number(req.query.tenantId);
  }

  if (isSuperAdmin && req.query?.allTenants === 'true') {
    return null;
  }

  // Strict tenant isolation: HQ Admin (tenantId=1) sees only Tenant 1, SaaS clients see strictly their own tenant
  return userTenant;
};
