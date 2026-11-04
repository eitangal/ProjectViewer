import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface SendAuthEmailParams {
  to: string;
  subject: string;
  magicLinkUrl: string;
  otpCode: string;
  contextLabel: string;
  expiryLabel?: string;
}

export interface BrevoApiConfig {
  apiKey: string;
  senderEmail: string;
  senderName: string;
}

// Backwards-compatibility alias
export type SmtpConfig = BrevoApiConfig;

export interface MailDispatcher {
  sendAuthEmail(params: SendAuthEmailParams): Promise<{ sent: boolean; error?: string }>;
  getLastSentEmail(email: string): SendAuthEmailParams | undefined;
  isConfigured(): boolean;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function parseSender(sender: string): { email: string; name: string } {
  const match = sender.match(/^(.*?)\s*<(.+?)>$/);
  if (match) {
    return {
      name: match[1].replace(/["']/g, '').trim() || 'GitLens Portal',
      email: match[2].trim(),
    };
  }
  return {
    name: 'GitLens Portal',
    email: sender.trim(),
  };
}

export function formatBrevoApiError(rawError: string, senderEmail?: string): string {
  const lower = rawError.toLowerCase();
  if (
    lower.includes('sender is not valid') ||
    lower.includes('senders list') ||
    lower.includes('sender address') ||
    lower.includes('not validated') ||
    lower.includes('unverified')
  ) {
    return `${rawError} (Brevo Error: The sender address '${senderEmail || ''}' must be verified under 'Senders & IP' -> 'Senders' in your Brevo account dashboard at app.brevo.com)`;
  }
  if (
    lower.includes('key not found') ||
    lower.includes('unauthorized') ||
    lower.includes('bad credentials') ||
    lower.includes('401')
  ) {
    return `${rawError} (Brevo Error: Unauthorized. Ensure your BREVO_API_KEY is an API Key starting with 'xkeysib-' generated under 'SMTP & API' -> 'API Keys', not an SMTP key or login password)`;
  }
  if (lower.includes('xsmtpsib')) {
    return `${rawError} (Brevo Error: You provided an SMTP key starting with 'xsmtpsib-'. The Brevo REST API requires an API key starting with 'xkeysib-'. Please generate an API Key under Brevo -> 'SMTP & API' -> 'API Keys')`;
  }
  return rawError;
}

// Compatibility wrapper for formatSmtpError
export function formatSmtpError(err: any): string {
  return formatBrevoApiError(err?.message || 'Brevo API transmission failure');
}

export class PortalMailer implements MailDispatcher {
  private sentMails: Map<string, SendAuthEmailParams> = new Map();

  private readonly db?: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db;
  }

  public getBrevoConfig(): BrevoApiConfig | null {
    if (this.db) {
      try {
        const row = this.db
          .prepare(`SELECT value_json FROM system_settings WHERE key = 'brevo_config'`)
          .get() as { value_json: string } | undefined;

        if (row?.value_json) {
          const cfg = JSON.parse(row.value_json) as BrevoApiConfig;
          if (cfg.apiKey && cfg.apiKey.trim()) {
            return {
              apiKey: cfg.apiKey.trim(),
              senderEmail: (cfg.senderEmail || '').trim(),
              senderName: (cfg.senderName || 'GitLens Portal').trim(),
            };
          }
        }
      } catch (err) {
        console.error('Failed to read brevo_config from database:', err);
      }

      // Check legacy smtp_config row in DB if brevo_config not set yet
      try {
        const smtpRow = this.db
          .prepare(`SELECT value_json FROM system_settings WHERE key = 'smtp_config'`)
          .get() as { value_json: string } | undefined;
        if (smtpRow?.value_json) {
          const smtpCfg = JSON.parse(smtpRow.value_json);
          const keyCandidate = smtpCfg.apiKey || smtpCfg.pass;
          if (keyCandidate && keyCandidate.trim()) {
            const parsed = parseSender(smtpCfg.from || '');
            return {
              apiKey: keyCandidate.trim(),
              senderEmail: smtpCfg.senderEmail || parsed.email || '',
              senderName: smtpCfg.senderName || parsed.name || 'GitLens Portal',
            };
          }
        }
      } catch {}
    }

    // Check environment variables
    const apiKey = (process.env.BREVO_API_KEY || '').trim();
    if (apiKey) {
      const senderRaw = (process.env.BREVO_SENDER_EMAIL || process.env.BREVO_FROM || process.env.SMTP_FROM || '').trim();
      const parsed = parseSender(senderRaw);
      const senderName = (process.env.BREVO_SENDER_NAME || parsed.name || 'GitLens Portal').trim();
      const senderEmail = (process.env.BREVO_SENDER_EMAIL || parsed.email || 'noreply@gitlens-portal.local').trim();

      return {
        apiKey,
        senderEmail,
        senderName,
      };
    }

    return null;
  }

  // Backwards-compatibility alias
  public getSmtpConfig(): any {
    const brevo = this.getBrevoConfig();
    if (!brevo) return null;
    return {
      host: 'https://api.brevo.com/v3/smtp/email',
      port: 443,
      secure: true,
      user: brevo.senderName,
      pass: brevo.apiKey,
      from: `${brevo.senderName} <${brevo.senderEmail}>`,
      apiKey: brevo.apiKey,
      senderEmail: brevo.senderEmail,
      senderName: brevo.senderName,
    };
  }

  public reloadTransporter(): void {
    // No-op for Brevo REST API
  }

  public isConfigured(): boolean {
    return this.getBrevoConfig() !== null;
  }

  public async sendAuthEmail(params: SendAuthEmailParams): Promise<{ sent: boolean; error?: string }> {
    const normalizedEmail = params.to.trim().toLowerCase();
    this.sentMails.set(normalizedEmail, params);

    const expiryLabel = params.expiryLabel || '15 minutes';

    const emailBody = `
GitLens-Portal Authentication
=============================
${params.contextLabel}

1-Click Direct Access Link:
${params.magicLinkUrl}

Or enter your 6-digit verification code:
[ ${params.otpCode} ]

(Valid for ${expiryLabel}. If you did not request this, please ignore this email.)
`;

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }
    .card { background-color: #1e293b; border: 1px solid #334155; border-radius: 12px; max-width: 520px; margin: 0 auto; padding: 32px; }
    .brand { font-size: 18px; font-weight: bold; color: #818cf8; margin-bottom: 20px; }
    .badge { display: inline-block; background-color: #312e81; color: #c7d2fe; font-size: 12px; padding: 4px 10px; border-radius: 6px; margin-bottom: 16px; }
    .btn { display: inline-block; background-color: #4f46e5; color: #ffffff !important; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 8px; margin: 18px 0; }
    .otp-box { background-color: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 16px; text-align: center; margin: 18px 0; }
    .otp-code { font-family: monospace; font-size: 26px; font-weight: bold; letter-spacing: 6px; color: #38bdf8; }
    .footer { font-size: 12px; color: #94a3b8; margin-top: 24px; border-top: 1px solid #334155; padding-top: 16px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">GitLens-Portal</div>
    <div class="badge">${escapeHtml(params.contextLabel)}</div>
    <p style="font-size: 14px; line-height: 1.6; color: #e2e8f0;">
      You have been invited to access a secured repository portal. Use the 1-click button below or enter the 6-digit verification code.
    </p>
    <div style="text-align: center;">
      <a href="${escapeHtml(params.magicLinkUrl)}" class="btn">1-Click Direct Access</a>
    </div>
    <div class="otp-box">
      <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin-bottom: 6px;">Verification Code (Valid for ${escapeHtml(expiryLabel)})</div>
      <div class="otp-code">${escapeHtml(params.otpCode)}</div>
    </div>
    <div class="footer">
      If you did not request this invitation, you can safely ignore this email.<br>
      Direct link fallback: <span style="word-break: break-all; color: #818cf8;">${escapeHtml(params.magicLinkUrl)}</span>
    </div>
  </div>
</body>
</html>
`;

    let status = 'SENT';
    let errorMessage: string | null = null;
    let sent = false;

    const config = this.getBrevoConfig();

    if (config?.apiKey) {
      try {
        const parsedSender = parseSender(config.senderEmail || config.senderName || 'noreply@gitlens-portal.local');
        const senderName = config.senderName || parsedSender.name || 'GitLens Portal';
        const senderEmail = config.senderEmail || parsedSender.email || 'noreply@gitlens-portal.local';

        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'api-key': config.apiKey.trim(),
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            sender: { name: senderName, email: senderEmail },
            to: [{ email: params.to }],
            subject: params.subject,
            textContent: emailBody,
            htmlContent: htmlBody,
          }),
        });

        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as any;
          const rawErr = errData?.message || `HTTP ${res.status}: ${res.statusText}`;
          status = 'FAILED';
          errorMessage = formatBrevoApiError(rawErr, senderEmail);
          sent = false;
          console.error('Brevo API email delivery failure:', errorMessage);
        } else {
          sent = true;
        }
      } catch (err: any) {
        status = 'FAILED';
        errorMessage = `Network failure dispatching to Brevo API: ${err.message}`;
        sent = false;
        console.error('Brevo API delivery network failure:', err);
      }
    } else {
      // In dev/test mode without Brevo API key
      status = 'NOT_CONFIGURED';
      errorMessage = 'No Brevo API key configured. Email logged to server console.';
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

  public async testBrevoConnection(
    config: BrevoApiConfig,
    testRecipient?: string
  ): Promise<{ success: boolean; accountEmail?: string; message?: string; error?: string }> {
    if (!config.apiKey || !config.apiKey.trim()) {
      return { success: false, error: 'Brevo API key is required.' };
    }

    if (config.apiKey.trim().startsWith('xsmtpsib-')) {
      return {
        success: false,
        error: "You entered a Brevo SMTP Key (starts with 'xsmtpsib-'). The Brevo REST API requires an API Key (starts with 'xkeysib-'). Please go to Brevo Dashboard -> 'SMTP & API' -> 'API Keys' tab and generate a new API key.",
      };
    }

    // 1. Verify API Key by querying Brevo account details
    let accountEmail: string | undefined;
    try {
      const res = await fetch('https://api.brevo.com/v3/account', {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'api-key': config.apiKey.trim(),
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const rawErr = (data as any)?.message || `HTTP ${res.status}: ${res.statusText}`;
        if (res.status === 401) {
          return {
            success: false,
            error: 'Brevo Error: Invalid API key (401 Unauthorized). Verify your API key at Brevo -> "SMTP & API" -> "API Keys".',
          };
        }
        return { success: false, error: `Brevo API Error: ${rawErr}` };
      }

      const accountData = (await res.json().catch(() => ({}))) as any;
      accountEmail = accountData?.email;
    } catch (err: any) {
      return { success: false, error: `Network error connecting to Brevo API: ${err.message}` };
    }

    // 2. If test recipient provided, send a test email via Brevo REST API
    if (testRecipient && testRecipient.trim()) {
      const parsedSender = parseSender(config.senderEmail || config.senderName || 'noreply@gitlens-portal.local');
      const senderName = config.senderName || parsedSender.name || 'GitLens Portal';
      const senderEmail = config.senderEmail || parsedSender.email || accountEmail || 'noreply@gitlens-portal.local';

      try {
        const sendRes = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'api-key': config.apiKey.trim(),
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            sender: { name: senderName, email: senderEmail },
            to: [{ email: testRecipient.trim() }],
            subject: 'GitLens-Portal Brevo API Test Verification',
            textContent: `GitLens-Portal Brevo REST API Verification\n===========================================\nYour Brevo API configuration is active and working properly!\n\nSender: ${senderName} <${senderEmail}>\nRecipient: ${testRecipient.trim()}\nTimestamp: ${new Date().toISOString()}`,
            htmlContent: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 24px;">
  <div style="background-color: #1e293b; border: 1px solid #334155; border-radius: 12px; max-width: 520px; margin: 0 auto; padding: 24px;">
    <h2 style="color: #818cf8; margin-top: 0;">GitLens-Portal Brevo API Verification</h2>
    <div style="background-color: #064e3b; color: #6ee7b7; padding: 10px 14px; border-radius: 8px; font-size: 13px; font-weight: 500; margin-bottom: 16px;">
      ✅ Brevo REST API Dispatch Confirmed
    </div>
    <p style="font-size: 14px; color: #cbd5e1; line-height: 1.5;">
      Your GitLens-Portal Brevo Transactional Email REST API configuration is working properly!
    </p>
    <ul style="font-size: 13px; color: #94a3b8; font-family: monospace; line-height: 1.8;">
      <li>API Endpoint: <strong>https://api.brevo.com/v3/smtp/email</strong></li>
      <li>Sender: <strong>${escapeHtml(senderName)} &lt;${escapeHtml(senderEmail)}&gt;</strong></li>
      <li>Recipient: <strong>${escapeHtml(testRecipient.trim())}</strong></li>
      ${accountEmail ? `<li>Brevo Account: <strong>${escapeHtml(accountEmail)}</strong></li>` : ''}
    </ul>
  </div>
</body>
</html>`,
          }),
        });

        if (!sendRes.ok) {
          const sendErrData = (await sendRes.json().catch(() => ({}))) as any;
          const errMsg = sendErrData?.message || `HTTP ${sendRes.status}: ${sendRes.statusText}`;
          if (errMsg.toLowerCase().includes('sender is not valid') || errMsg.toLowerCase().includes('senders list')) {
            return {
              success: false,
              error: `Brevo Error: Sender email (${senderEmail}) is not verified. Please verify it under 'Senders & IP' -> 'Senders' in your Brevo account dashboard.`,
            };
          }
          return { success: false, error: `Brevo API Send Error: ${errMsg}` };
        }
      } catch (err: any) {
        return { success: false, error: `Failed to dispatch test email via Brevo API: ${err.message}` };
      }
    }

    return {
      success: true,
      accountEmail,
      message: `Brevo API connection verified successfully!${accountEmail ? ` Connected to account: ${accountEmail}` : ''}`,
    };
  }

  // Backwards-compatibility wrapper
  public async testSmtpConnection(
    config: any,
    testRecipient: string
  ): Promise<{ success: boolean; error?: string }> {
    const apiKey = config.apiKey || config.pass || '';
    const parsed = parseSender(config.from || config.senderEmail || '');
    return this.testBrevoConnection(
      {
        apiKey,
        senderEmail: config.senderEmail || parsed.email,
        senderName: config.senderName || parsed.name,
      },
      testRecipient
    );
  }

  public getLastSentEmail(email: string): SendAuthEmailParams | undefined {
    return this.sentMails.get(email.trim().toLowerCase());
  }
}
