'use strict';

/**
 * EmailNotificationService — thin wrapper over the existing sendMail()
 * transport (src/utils/email.js), which already handles the SMTP-configured
 * vs. dev jsonTransport fallback. Never throws — sendMail() already swallows
 * its own errors and logs them, matching the "don't block the main
 * transaction if email fails" rule.
 */

const { sendMail } = require('../../utils/email');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

async function sendNotificationEmail(user, notification) {
  if (!user?.email) return;
  const link = `${APP_URL}${notification.actionUrl ?? '/dashboard'}`;
  await sendMail({
    to: user.email,
    subject: notification.title,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px">
        <h2 style="color:#0057B7">${notification.title}</h2>
        <p>${notification.body ?? ''}</p>
        <p style="margin:24px 0">
          <a href="${link}" style="background:#0057B7;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
            View in Bedo SimuLearn
          </a>
        </p>
      </div>
    `,
  });
}

module.exports = { sendNotificationEmail };
