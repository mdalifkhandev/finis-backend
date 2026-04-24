import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(MailService.name);

  constructor(private config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: config.get('MAIL_HOST'),
      port: config.get<number>('MAIL_PORT'),
      secure: false,
      auth: {
        user: config.get('MAIL_USER'),
        pass: config.get('MAIL_PASS'),
      },
    });
  }

  async sendInviteEmail(email: string, token: string, role: string) {
    const appUrl = this.config.get('APP_URL');
    const inviteLink = `${appUrl}/auth/accept-invite?token=${token}`;

    try {
      await this.transporter.sendMail({
        from: this.config.get('MAIL_FROM'),
        to: email,
        subject: 'You are invited to Finis App',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a3c5e;">Welcome to Finis</h2>
            <p>You have been invited as <strong>${role}</strong>.</p>
            <p>Click the button below to set up your account:</p>
            <a href="${inviteLink}" 
               style="background:#1a3c5e;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;margin:16px 0;">
              Accept Invitation
            </a>
            <p style="color:#666;">This link expires in 7 days.</p>
            <p style="color:#999;font-size:12px;">If you didn't expect this, ignore this email.</p>
          </div>
        `,
      });
      this.logger.log(`Invite email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send invite email to ${email}`, error);
    }
  }

  async sendOtpEmail(email: string, otp: string) {
    try {
      await this.transporter.sendMail({
        from: this.config.get('MAIL_FROM'),
        to: email,
        subject: 'Password Reset OTP - Finis',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a3c5e;">Password Reset</h2>
            <p>Your OTP code is:</p>
            <div style="font-size:36px;font-weight:bold;color:#1a3c5e;letter-spacing:8px;margin:20px 0;">
              ${otp}
            </div>
            <p style="color:#666;">This code expires in <strong>10 minutes</strong>.</p>
            <p style="color:#999;font-size:12px;">If you didn't request this, ignore this email.</p>
          </div>
        `,
      });
      this.logger.log(`OTP email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send OTP to ${email}`, error);
    }
  }
}