/**
 * Email sender — nodemailer transport.
 * Production: SMTP_HOST configured (e.g. AWS SES endpoint).
 * Development: falls back to Ethereal (fake SMTP) or console log.
 * SRS §4.1 AUTH-01 (verification), AUTH-05 (password reset).
 */
'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('./logger');

let _transport = null;

async function getTransport() {
  if (_transport) return _transport;

  if (config.email.host) {
    const port = Number(config.email.port);

    _transport = nodemailer.createTransport({
      host: config.email.host,
      port: Number(config.email.port),
      secure: Number(config.email.port) === 465,
      requireTLS: Number(config.email.port) === 587,
      auth: {
        user: config.email.user,
        pass: config.email.pass
      },
      tls: {
        servername: 'smtp.sendgrid.net',
        minVersion: 'TLSv1.2',
        rejectUnauthorized: process.env.NODE_ENV === 'production'
      }
    });
    console.log('Email: using SMTP transport', {
      host: config.email.host,
      port,
      secure: port === 465
    });
  } else {
    _transport = nodemailer.createTransport({ jsonTransport: true });
    logger.info('Email: using console jsonTransport');
  }

  return _transport;
}

/**
 * Send an email.
 * @param {{ to: string, subject: string, html: string }} opts
 */
async function sendMail({ to, subject, html }) {
  try {
    const transport = await getTransport();
    console.log(`Sending email to ${to} with subject "${subject}"...`);
    console.log('Email content (HTML):', transport);
    const info = await transport.sendMail({
      from: config.email.from,
      to,
      subject,
      html,
    });
    console.log('Email sent', info);

    // jsonTransport: extract the action link from HTML and log it clearly
    if (info.envelope) {
      const linkMatch = html.match(/href="(http[^"]+)"/);
      const link = linkMatch ? linkMatch[1] : null;
      logger.info('📧 DEV EMAIL', { to, subject, ...(link ? { link } : {}) });
      if (link) {
        console.log('\n─────────────────────────────────────────');
        console.log(`📧  To:      ${to}`);
        console.log(`    Subject: ${subject}`);
        console.log(`    Link:    ${link}`);
        console.log('─────────────────────────────────────────\n');
      }
    }

    // Ethereal preview URL (only set when using real Ethereal transport)
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) logger.info('Email preview URL', { url: preview });

    return info;
  } catch (err) {
    // Email failure should not crash the request — log and continue
    logger.error('Email send failed', { to, subject, error: err.message });
  }
}

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

async function sendVerificationEmail(to, token) {
  const link = `${APP_URL}/verify-email?token=${token}`;
  return sendMail({
    to,
    subject: 'Verify your Bedo SimuLearn email address',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px">
        <h2 style="color:#0057B7">Welcome to Bedo SimuLearn!</h2>
        <p>Please verify your email address to activate your account.</p>
        <p style="margin:24px 0">
          <a href="${link}" style="background:#0057B7;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
            Verify Email Address
          </a>
        </p>
        <p style="color:#6B7280;font-size:14px">This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
        <p style="color:#6B7280;font-size:12px">Or paste this link in your browser:<br>${link}</p>
      </div>
    `,
  });
}

async function sendPasswordResetEmail(to, token) {
  const link = `${APP_URL}/reset-password?token=${token}`;
  return sendMail({
    to,
    subject: 'Reset your Bedo SimuLearn password',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px">
        <h2 style="color:#0057B7">Password Reset Request</h2>
        <p>We received a request to reset the password for your account. Click the button below to set a new password.</p>
        <p style="margin:24px 0">
          <a href="${link}" style="background:#0057B7;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
            Reset Password
          </a>
        </p>
        <p style="color:#6B7280;font-size:14px">This link expires in 1 hour. If you didn't request this, please ignore this email — your password will not be changed.</p>
        <p style="color:#6B7280;font-size:12px">Or paste this link in your browser:<br>${link}</p>
      </div>
    `,
  });
}

async function sendInviteEmail(to, token) {
  const link = `${APP_URL}/reset-password?token=${token}`;
  return sendMail({
    to,
    subject: 'You have been invited to Bedo SimuLearn — set your password',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px">
        <h2 style="color:#0057B7">Welcome to Bedo SimuLearn!</h2>
        <p>An administrator has created an account for you. Click the button below to set your password and activate your account.</p>
        <p style="margin:24px 0">
          <a href="${link}" style="background:#0057B7;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
            Set My Password
          </a>
        </p>
        <p style="color:#6B7280;font-size:14px">This link expires in 24 hours. If you did not expect this invitation, you can safely ignore this email.</p>
        <p style="color:#6B7280;font-size:12px">Or paste this link in your browser:<br>${link}</p>
      </div>
    `,
  });
}

module.exports = { sendMail, sendVerificationEmail, sendPasswordResetEmail, sendInviteEmail };
