/* ══════════════════════════════════════════════════
   DEPRECATED - retired in Phase D.

   The original root-level dashboard has been replaced by role-specific
   dashboards. Each role page loads its own app module:

     - /property_owner -> frontend/property_owner/app.js
     - /investor -> frontend/investor/app.js
     - /tenant   -> frontend/tenant/app.js

   Common utilities live in frontend/shared/utils.js.

   This file is NOT loaded by any HTML entrypoint. It is kept as an empty
   stub so existing deployments or caches do not 404. Delete it manually
   once you have verified no consumer references it.
   ══════════════════════════════════════════════════ */
