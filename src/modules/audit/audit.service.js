'use strict';

// TODO: implement all — skeleton only (SRS §4.15 AUD-01 to AUD-05)
// Table is insert-only. No UPDATE/DELETE allowed on audit_logs.
exports.list    = async (_q, _actor)      => { throw new Error('Not implemented'); };
exports.getOne  = async (_id, _actor)     => { throw new Error('Not implemented'); };

// Internal helper — called by other services to record events
exports.log = async (_entry) => { throw new Error('Not implemented'); };
