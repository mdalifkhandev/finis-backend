import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private stripe: InstanceType<typeof Stripe>;

  constructor() {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2026-04-22.dahlia',
    });
  }

  // ─── Worker এর Stripe Connected Account তৈরি ─────────────────────────────
  async createConnectedAccount(
    email: string,
  ): Promise<any> {
    return this.stripe.accounts.create({
      type: 'express',
      email,
      capabilities: {
        transfers: { requested: true },
      },
    });
  }

  // ─── Worker কে Onboarding Link পাঠাও ─────────────────────────────────────
async createOnboardingLink(
  accountId: string,
  workerId: string,
): Promise<any> {
  const link = await this.stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${process.env.APP_URL}/admin/payroll/onboarding/refresh?workerId=${workerId}`,
    return_url:  `${process.env.APP_URL}/admin/payroll/public/onboarding/complete?workerId=${workerId}`,
    type: 'account_onboarding',
  });

  return link;
}

  // ─── Account status check ─────────────────────────────────────────────────
  async getAccountStatus(accountId: string) {
    const account = await this.stripe.accounts.retrieve(accountId);
    return {
      isComplete: account.details_submitted,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
    };
  }

  // ─── Worker কে Transfer করো ───────────────────────────────────────────────
  async transferToWorker(
    amountInCents: number,
    workerStripeAccountId: string,
    description: string,
  ): Promise<any> {
    return this.stripe.transfers.create({
      amount: amountInCents,
      currency: 'usd',
      destination: workerStripeAccountId,
      description,
    });
  }
}