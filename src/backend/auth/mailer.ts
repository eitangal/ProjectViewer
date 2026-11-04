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

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface MailDispatcher {
  sendAuthEmail(params: SendAuthEmailParams): Promise<{ sent: boolean; error?: string }>;
  getLastSentEmail(email: string): SendAuthEmailParams | undefined;
  isConfigured(): boolean;
}

export class PortalMailer implements MailDispatcher {
  private transporter: nodemailer.Transporter | null = null;
  private sentMails: Map<string, SendAuthEmailParams> = new Map();

  constructor(private readonly db?: Database.Database) {
    this.reloadTransporter();
  }

  public getSmtpConfig(): SmtpConfig | null {
    if (this.db) {
      try {
        const row = this.db
          .prepare(`SELECT value_json FROM system_settings WHERE key = 'smtp_config'`)
          .get() as { value_json: string } | undefined;

        if (row?.value_json) {
          const cfg = JSON.parse(row.value_json) as SmtpConfig;
          if (cfg.host && cfg.host.trim()) {
            return cfg;
          }
        }
      } catch (err) {
        console.error('Failed to read smtp_config from database:', err);
      }
    }

    if (process.env.SMTP_HOST) {
      return {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
        from: process.env.SMTP_FROM || 'noreply@gitlens-portal.local',
      };
    }

    return null;
  }

  public reloadTransporter(): void {
    const config = this.getSmtpConfig();
    if (config) {
      this.transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user
          ? {
              user: config.user,
              pass: config.pass,
            }
          : undefined,
      });
    } else {
      this.transporter = null;
    }
  }

  public isConfigured(): boolean {
    return this.getSmtpConfig() !== null;
  }

  public async sendAuthEmail(params: SendAuthEmailParams): Promise<{ sent: boolean; error?: string }> {
    const normalizedEmail = params.to.trim().toLowerCase();
    this.sentMails.set(normalizedEmail, params);

    const emailBody = `
GitLens-Portal Authentication
=============================
${params.contextLabel}

1-Click Direct Access Link:
${params.magicLinkUrl}

Or enter your 6-digit verification code:
[ ${params.otpCode} ]

(Valid for 15 minutes. If you did not request this, please ignore this email.)
`;

    // Ensure we use the latest settings
    this.reloadTransporter();

    let status = 'SENT';
    let errorMessage: string | null = null;
    let sent = false;

    if (this.transporter) {
      const config = this.getSmtpConfig();
      try {
        await this.transporter.sendMail({
          from: config?.from || process.env.SMTP_FROM || 'noreply@gitlens-portal.local',
          to: params.to,
          subject: params.subject,
          text: emailBody,
        });
        sent = true;
      } catch (err: any) {
        status = 'FAILED';
        errorMessage = err.message || 'SMTP transmission failure';
        sent = false;
        console.error('Mail delivery failure:', err);
      }
    } else {
      // In dev/test mode without SMTP
      status = 'NOT_CONFIGURED';
      errorMessage = 'No SMTP server configured. Email logged to server console.';
      sent = false;
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

    return { sent, error: errorMessage || undefined };
  }

  public async testSmtpConnection(
    config: SmtpConfig,
    testRecipient: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const tempTransporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user
          ? {
              user: config.user,
              pass: config.pass,
            }
          : undefined,
      });

      await tempTransporter.verify();

      if (testRecipient && testRecipient.trim()) {
        await tempTransporter.sendMail({
          from: config.from || 'noreply@gitlens-portal.local',
          to: testRecipient.trim(),
          subject: 'GitLens-Portal SMTP Test Verification',
          text: 'This is a test email confirming that your GitLens-Portal SMTP configuration is working properly!',
        });
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'SMTP connection failed' };
    }
  }

  public getLastSentEmail(email: string): SendAuthEmailParams | undefined {
    return this.sentMails.get(email.trim().toLowerCase());
  }
}
