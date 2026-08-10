'use strict';

const svc         = require('./simulations.service');
const ApiResponse = require('../../utils/apiResponse');

function getRequestProtocol(req) {
  const forwarded = req.headers['x-forwarded-proto'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.protocol;
}

function buildSecureLaunchUrl(sim, req) {
  if (sim.launchUrl) {
    return sim.launchUrl;
  }
  if (!sim.publicEntryUrl) {
    return null;
  }
  return `${getRequestProtocol(req)}://${req.get('host')}${sim.publicEntryUrl}`;
}

function ensureLaunchUrls(sim, req) {
  return {
    ...sim,
    launchUrl: buildSecureLaunchUrl(sim, req),
  };
}

exports.list    = async (req, res, next) => { try { const r = await svc.list(req.query, req.user ?? null); const sims = r.simulations.map((sim) => ensureLaunchUrls(sim, req)); ApiResponse.ok(res, 'Simulations', sims, r.meta); } catch (e) { next(e); } };
exports.create  = async (req, res, next) => { try { ApiResponse.created(res, 'Simulation created', await svc.create(req.body, req.user)); } catch (e) { next(e); } };
exports.getOne  = async (req, res, next) => { try { const sim = await svc.getOne(req.params.id, req.user ?? null); ApiResponse.ok(res, 'Simulation', ensureLaunchUrls(sim, req)); } catch (e) { next(e); } };
exports.update  = async (req, res, next) => { try { ApiResponse.ok(res, 'Simulation updated', await svc.update(req.params.id, req.body, req.user)); } catch (e) { next(e); } };
exports.remove  = async (req, res, next) => { try { await svc.remove(req.params.id, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };
exports.preview = async (req, res, next) => { try { ApiResponse.ok(res, 'Preview URL', await svc.getPreviewUrl(req.params.id, req.user ?? null)); } catch (e) { next(e); } };

exports.launch  = async (req, res, next) => { try { ApiResponse.ok(res, 'Simulation launched', await svc.launch(req.params.id, req.user, req)); } catch (e) { next(e); } };

// ── Demo (unauthenticated guests) ─────────────────────────────────────────────

exports.listDemo  = async (req, res, next) => { try { const r = await svc.listDemo(req.query); ApiResponse.ok(res, 'Demo simulations', r.simulations, r.meta); } catch (e) { next(e); } };
exports.demoLaunch= async (req, res, next) => { try { ApiResponse.ok(res, 'Demo launch', await svc.demoLaunch(req.params.id, req)); } catch (e) { next(e); } };

// ── Institution assignment (legacy /simulations/:id/institutions/:instId) ─────

exports.assignToInstitution  = async (req, res, next) => { try { ApiResponse.created(res, 'Simulation assigned to institution', await svc.assignToInstitution(req.params.id, req.params.instId, req.user)); } catch (e) { next(e); } };
exports.revokeFromInstitution= async (req, res, next) => { try { await svc.revokeFromInstitution(req.params.id, req.params.instId, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };
