'use strict';

const svc         = require('./page-content.service');
const ApiResponse = require('../../utils/apiResponse');

exports.getPageContent = async (req, res, next) => {
  try {
    const data = await svc.getPageContent(req.params.page);
    ApiResponse.ok(res, 'Page content', data);
  } catch (e) { next(e); }
};

exports.getPlatformStats = async (req, res, next) => {
  try {
    const stats = await svc.getPlatformStats();
    ApiResponse.ok(res, 'Platform stats', stats);
  } catch (e) { next(e); }
};

exports.getHomePage = async (req, res, next) => {
  try {
    const data = await svc.getHomePagePayload();
    ApiResponse.ok(res, 'Home page content', data);
  } catch (e) { next(e); }
};

exports.getAllForAdmin = async (req, res, next) => {
  try {
    const data = await svc.getAllForAdmin(req.params.page);
    ApiResponse.ok(res, 'All page content', data);
  } catch (e) { next(e); }
};

exports.createItem = async (req, res, next) => {
  try {
    const item = await svc.createItem(req.body, req.user.id);
    ApiResponse.created(res, 'Content item created', item);
  } catch (e) { next(e); }
};

exports.updateItem = async (req, res, next) => {
  try {
    const item = await svc.updateItem(req.params.id, req.body, req.user.id);
    ApiResponse.ok(res, 'Content item updated', item);
  } catch (e) { next(e); }
};

exports.deleteItem = async (req, res, next) => {
  try {
    await svc.deleteItem(req.params.id);
    ApiResponse.noContent(res);
  } catch (e) { next(e); }
};

exports.updateStats = async (req, res, next) => {
  try {
    const data = await svc.updateStats(req.body, req.user.id);
    ApiResponse.ok(res, 'Stats updated', data);
  } catch (e) { next(e); }
};
