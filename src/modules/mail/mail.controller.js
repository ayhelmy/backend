'use strict';

const svc = require('./mail.service');
const ApiResponse = require('../../utils/apiResponse');

const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };

exports.listInbox    = wrap(async (req, res) => ApiResponse.ok(res, 'Inbox', await svc.list('inbox', req.user, req.query)));
exports.listSent      = wrap(async (req, res) => ApiResponse.ok(res, 'Sent', await svc.list('sent', req.user, req.query)));
exports.listDrafts    = wrap(async (req, res) => ApiResponse.ok(res, 'Drafts', await svc.list('draft', req.user, req.query)));
exports.listArchived  = wrap(async (req, res) => ApiResponse.ok(res, 'Archived', await svc.list('archived', req.user, req.query)));
exports.listTrash     = wrap(async (req, res) => ApiResponse.ok(res, 'Trash', await svc.list('trash', req.user, req.query)));

exports.getMessage    = wrap(async (req, res) => ApiResponse.ok(res, 'Message', await svc.getDetail(req.params.messageId, req.user)));
exports.compose       = wrap(async (req, res) => ApiResponse.created(res, 'Message sent', await svc.compose(req.body, req.user)));

exports.saveDraft     = wrap(async (req, res) => ApiResponse.created(res, 'Draft saved', await svc.saveDraft(req.body, req.user)));
exports.updateDraft   = wrap(async (req, res) => ApiResponse.ok(res, 'Draft updated', await svc.updateDraft(req.params.draftId, req.body, req.user)));
exports.deleteDraft   = wrap(async (req, res) => { await svc.deleteDraft(req.params.draftId, req.user); ApiResponse.noContent(res); });
exports.sendDraft     = wrap(async (req, res) => ApiResponse.ok(res, 'Message sent', await svc.sendDraft(req.params.draftId, req.user)));

exports.reply         = wrap(async (req, res) => ApiResponse.created(res, 'Reply sent', await svc.reply(req.params.messageId, req.body, req.user)));
exports.replyAll      = wrap(async (req, res) => ApiResponse.created(res, 'Reply sent', await svc.replyAll(req.params.messageId, req.body, req.user)));
exports.forward       = wrap(async (req, res) => ApiResponse.created(res, 'Message forwarded', await svc.forward(req.params.messageId, req.body, req.user)));

exports.markRead      = wrap(async (req, res) => ApiResponse.ok(res, 'Marked read', await svc.markRead(req.params.messageId, req.user)));
exports.markUnread    = wrap(async (req, res) => ApiResponse.ok(res, 'Marked unread', await svc.markUnread(req.params.messageId, req.user)));
exports.archive       = wrap(async (req, res) => ApiResponse.ok(res, 'Archived', await svc.archive(req.params.messageId, req.user)));
exports.restore       = wrap(async (req, res) => ApiResponse.ok(res, 'Restored', await svc.restore(req.params.messageId, req.user)));
exports.remove        = wrap(async (req, res) => { await svc.remove(req.params.messageId, req.user); ApiResponse.noContent(res); });

exports.unreadCount   = wrap(async (req, res) => ApiResponse.ok(res, 'Unread count', await svc.unreadCount(req.user)));
exports.folderCounts  = wrap(async (req, res) => ApiResponse.ok(res, 'Folder counts', await svc.folderCounts(req.user)));
exports.listRecipients = wrap(async (req, res) => ApiResponse.ok(res, 'Recipients', await svc.listRecipients(req.user, req.query)));

exports.uploadAttachment = wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ status: 400, title: 'Bad Request', detail: 'No file uploaded.' });
  const serverUrl = `${req.protocol}://${req.get('host')}`;
  ApiResponse.ok(res, 'Attachment uploaded', await svc.uploadAttachment(req.file, serverUrl));
});
