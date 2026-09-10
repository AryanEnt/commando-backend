/**
 * Centralized authorization utilities (re-exported for consumers).
 */
export {
  requireAuthentication,
  requirePermission,
  requireRole,
  hasPermission,
  isSuperAdmin,
  type Actor,
} from "./authorization.js";

export {
  requireRecordAccess,
  assertProfileInScope,
  profileScopeWhere,
  teamScopeWhere,
  assignmentScopeWhere,
  getActiveTeamIds,
  type RecordAccessContext,
} from "./scope.js";

export { totalDaysUnderCommando } from "./assignmentDays.js";
