import nodemailer from "nodemailer";

export type Mailer = ReturnType<typeof createMailer>;

export interface CreateMailerOptions {
  /** SMTP host, e.g. smtp.gmail.com or a self-hosted relay. */
  host: string;
  /** SMTP port. 465 implies implicit TLS; 587/25 use STARTTLS. */
  port: number;
  user: string;
  password: string;
  /** Default From header, e.g. `"YouTube Digest <you@example.com>"`. */
  from: string;
}

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export function createMailer(opts: CreateMailerOptions) {
  const transport = nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    secure: opts.port === 465,
    auth: { user: opts.user, pass: opts.password },
  });

  return {
    async send(mail: SendMailOptions): Promise<void> {
      await transport.sendMail({
        from: opts.from,
        to: mail.to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
    },
    async close(): Promise<void> {
      transport.close();
    },
  };
}
