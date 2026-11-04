import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';

export interface SendAuthEmailParams {
  to: string;
  subject: string;
  magicLinkUrl: string;
  otpCode: string;
  contextLabel: string;
}

export interface MailDispatcher {
  sendAuthEmail(params: SendAuthEmailParams): Promise<void>;
  getLastSentEmail(email: string): SendAuthEmailParams | undefined;
}

export class PortalMailer implements MailDispatcher {
  private transporter: nodemailer.Transporter | null = null;
  private sentMails: Map<string, SendAuthEmailParams> = new Map();

  constructor(private readonly db?: Database.Database) {
    if (process.env.SMTP_HOST) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS || '',
            }
          : undefined,
      });
    }
  }

  public async sendAuthEmail(params: SendAuthEmailParams): Promise<void> {
    const normalizedEmail = params.to.trim().toLowerCase();
    this.sentMails.set(normalizedEmail, params);

    const emailBody = `
GitLens-Portal Authentication
=============================
${params.contextLabel}

1-Click Magic Link:
${params.magicLinkUrl}

Or enter your 6-digit verification code:
[ ${params.otpCode} ]

(Valid for 15 minutes. If you did not request this, please ignore this email.)
`;

    let status = 'SENT';
    let errorMessage: string | null = null;

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: process.env.SMTP_FROM || 'noreply@gitlens-portal.local',
          to: params.to,
          subject: params.subject,
          text: emailBody,
        });
      } catch (err: any) {
        status = 'FAILED';
        errorMessage = err.message || 'SMTP transmission failure';
        console.error('Mail delivery failure:', err);
      }
    } else {
      // In dev/test mode without SMTP, log code to stdout for immediate developer visibility
      console.log(`[AUTH EMAIL to ${params.to}]: OTP = ${params.otpCode} | Magic Link = ${params.magicLinkUrl}`);
    }

    if (this.db) {
      try {
        this.db.prepare(`
          INSERT INTO email_delivery_logs (id, recipient_email, purpose, status, error_message, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(randomUUID(), normalizedEmail, params.subject, status, errorMessage, Date.now());
      } catch (err) {
        console.error('Failed to log email delivery:', err);
      }
    }
  }

  public getLastSentEmail(email: string): SendAuthEmailParams | undefined {
    return this.sentMails.get(email.trim().toLowerCase());
  }
}
