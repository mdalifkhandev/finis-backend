import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VerifyCheckoutDto } from './subscription.dto';
import * as bcrypt from 'bcryptjs';
import Stripe from 'stripe';

@Injectable()
export class SubscriptionService {
  private readonly stripe: any;

  constructor(private readonly prisma: PrismaService) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
      apiVersion: '2026-04-22.dahlia' as any,
    });
  }

  private get frontendUrl() {
    return process.env.FRONTEND_URL || 'http://localhost:5173';
  }

  private async ensurePlanStripePrices(plan: any) {
    const planWithStripe = plan as any;

    const product =
      planWithStripe.stripeProductId
        ? await this.stripe.products.retrieve(planWithStripe.stripeProductId)
        : await this.stripe.products.create({
            name: planWithStripe.name,
            metadata: { planId: planWithStripe.id },
          });

    const resolveRecurringPrice = async (
      priceId: string | null | undefined,
      interval: 'month' | 'year',
      amount: number,
      label: 'monthly' | 'yearly',
    ) => {
      if (priceId) {
        try {
          const existing = await this.stripe.prices.retrieve(priceId);
          if (existing?.recurring?.interval === interval && existing?.active !== false) {
            return { id: existing.id };
          }
        } catch {
          // fall through to recreate
        }
      }

      const created = await this.stripe.prices.create({
        product: product.id,
        currency: 'usd',
        unit_amount: Math.round(Number(amount) * 100),
        recurring: { interval },
        metadata: { planId: planWithStripe.id, interval: label },
      });

      return { id: created.id };
    };

    const monthlyPrice = await resolveRecurringPrice(
      planWithStripe.stripePriceMonthlyId,
      'month',
      planWithStripe.priceMonthly,
      'monthly',
    );

    let yearlyPriceId: string | null = planWithStripe.stripePriceYearlyId ?? null;
    if (planWithStripe.priceYearly !== null && planWithStripe.priceYearly !== undefined && !yearlyPriceId) {
      const yearlyPrice = await resolveRecurringPrice(
        null,
        'year',
        planWithStripe.priceYearly,
        'yearly',
      );
      yearlyPriceId = yearlyPrice.id;
    }

    const updated = await this.prisma.subscriptionPlan.update({
      where: { id: planWithStripe.id },
      data: {
        stripeProductId: product.id,
        stripePriceMonthlyId: monthlyPrice.id,
        stripePriceYearlyId: yearlyPriceId,
      },
    });

    return updated as any;
  }

  async verifyAndCheckout(dto: VerifyCheckoutDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: dto.email,
        role: 'admin',
        status: 'active',
      },
    });

    if (!user) throw new NotFoundException('Admin user not found');

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) throw new ForbiddenException('Invalid password');

    const existingTenant = user.tenantId
      ? await this.prisma.tenant.findUnique({
          where: { id: user.tenantId },
          include: { plan: true },
        })
      : null;

    // ⚠️ আগে এখানে 'pending' status-কেও "already active" ধরা হতো।
    // Checkout শুরু করার সাথে সাথেই tenant 'pending' হয়ে যায় — যদি webhook
    // fail করে বা admin checkout abandon করে, tenant চিরতরে 'pending'-এ আটকে
    // থাকতো এবং কোনোদিন নতুন/দ্বিতীয় subscription কেনা যেতো না।
    // এখন শুধুমাত্র সত্যিকারের active + period চলমান subscription block করবে।
    const alreadyActive =
      existingTenant &&
      existingTenant.subscriptionStatus === 'active' &&
      (
        !existingTenant.currentPeriodEnd ||
        new Date(existingTenant.currentPeriodEnd).getTime() > Date.now()
      );

    if (alreadyActive) {
      throw new BadRequestException('Tenant already has an active subscription');
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
    });
    if (!plan) throw new NotFoundException('Subscription plan not found');
    if (!plan.isActive) throw new BadRequestException('This plan is not active');

    const tenant =
      existingTenant ??
      (await this.prisma.tenant.create({
        data: {
          name: user.fullName || user.email.split('@')[0] || 'New Tenant',
          billingEmail: user.email,
          planId: plan.id,
          status: 'trial',
          subscriptionStatus: 'pending',
          planInterval: dto.interval,
        },
        include: { plan: true },
      }));

    const customer =
      tenant.stripeCustomerId
        ? await this.stripe.customers.retrieve(tenant.stripeCustomerId)
        : await this.stripe.customers.create({
            email: tenant.billingEmail || user.email,
            name: tenant.name,
            metadata: {
              tenantId: tenant.id,
            },
          });

    const syncedPlan = await this.ensurePlanStripePrices(plan);
    const priceId =
      dto.interval === 'monthly'
        ? syncedPlan.stripePriceMonthlyId
        : syncedPlan.stripePriceYearlyId || syncedPlan.stripePriceMonthlyId;
    if (!priceId) {
      throw new BadRequestException('Stripe price is not configured for this plan');
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${this.frontendUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.frontendUrl}/subscription/cancel`,
      metadata: {
        tenantId: tenant.id,
        planId: plan.id,
        adminUserId: user.id,
        interval: dto.interval,
        priceId,
      },
    });

      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          stripeCustomerId: customer.id,
          stripePriceId: priceId,
          planInterval: dto.interval,
        },
      });

    return { checkoutUrl: session.url };
  }

  async handleWebhook(rawBody: Buffer | undefined, signature?: string) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new BadRequestException('Stripe webhook secret is missing');
    if (!signature) throw new BadRequestException('Missing Stripe signature');
    if (!rawBody) throw new BadRequestException('Missing raw request body');

    const event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const tenantId = session.metadata?.tenantId;
        if (!tenantId) break;

        const subscriptionId =
          typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        const subscription = subscriptionId
          ? await this.stripe.subscriptions.retrieve(subscriptionId)
          : null;

        await this.prisma.tenant.update({
          where: { id: tenantId },
          data: {
            status: 'active',
            stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
            stripeSubscriptionId: subscriptionId ?? undefined,
            subscriptionStatus: 'active',
            currentPeriodStart: subscription?.current_period_start
              ? new Date(subscription.current_period_start * 1000)
              : undefined,
            currentPeriodEnd: subscription?.current_period_end
              ? new Date(subscription.current_period_end * 1000)
              : undefined,
            planInterval: session.metadata?.interval ?? undefined,
          },
        });

        const plan = await this.prisma.subscriptionPlan.findUnique({
          where: { id: session.metadata?.planId },
        });
        const user = await this.prisma.user.findUnique({
          where: { id: session.metadata?.adminUserId },
          select: { id: true },
        });
        if (plan && user) {
          const existingPurchase = await (this.prisma as any).subscriptionPurchase.findFirst({
            where: {
              stripeSubscriptionId: subscriptionId ?? null,
            },
          });
          if (!existingPurchase) {
          await (this.prisma as any).subscriptionPurchase.create({
            data: {
              tenantId,
              userId: user.id,
              planId: plan.id,
              planName: plan.name,
              stripeSubscriptionId: subscriptionId ?? null,
              stripePriceId: session.metadata?.priceId ?? null,
              interval: session.metadata?.interval ?? 'monthly',
              amount: plan.priceMonthly,
              status: 'active',
              startedAt: new Date(),
            },
          });
          }
        }

        const adminUserId = session.metadata?.adminUserId;
        if (adminUserId) {
          await this.prisma.user.update({
            where: { id: adminUserId },
            data: { tenantId },
          });
        }
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as any;
        const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
        if (!subscriptionId) break;

        const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
        await this.prisma.tenant.updateMany({
          where: { stripeSubscriptionId: subscriptionId },
          data: {
            subscriptionStatus: 'active',
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          },
        });
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as any;
        const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
        if (!subscriptionId) break;

        await this.prisma.tenant.updateMany({
          where: { stripeSubscriptionId: subscriptionId },
          data: {
            status: 'suspended',
            subscriptionStatus: 'past_due',
          },
        });
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as any;
        await this.prisma.tenant.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            status: 'cancelled',
            subscriptionStatus: 'cancelled',
          },
        });
        break;
      }
      default:
        break;
    }

    return { received: true };
  }

  async getAdminSubscriptionStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenant: {
          include: {
            plan: true,
          },
        },
      },
    });

    const tenant =
      user?.tenant ??
      (user?.email
        ? await this.prisma.tenant.findFirst({
            where: { billingEmail: user.email },
            include: { plan: true },
          })
        : null);

    if (!tenant) {
      return {
        tenantId: null,
        tenantName: null,
        plan: null,
        subscriptionStatus: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        planInterval: null,
        isExpired: false,
      };
    }

    if (user && user.tenantId !== tenant.id) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { tenantId: tenant.id },
      });
    }

    const isExpired = Boolean(tenant.currentPeriodEnd && new Date(tenant.currentPeriodEnd).getTime() < Date.now());

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      plan: tenant.plan
        ? {
            id: tenant.plan.id,
            name: tenant.plan.name,
            priceMonthly: tenant.plan.priceMonthly,
            priceYearly: tenant.plan.priceYearly,
          }
        : null,
      subscriptionStatus: tenant.subscriptionStatus ?? null,
      currentPeriodStart: tenant.currentPeriodStart,
      currentPeriodEnd: tenant.currentPeriodEnd,
      planInterval: tenant.planInterval ?? null,
      isExpired,
    };
  }

  async getAdminSubscriptionHistory(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, tenantId: true, email: true },
    });

    const tenant = user?.tenantId
      ? await this.prisma.tenant.findUnique({
          where: { id: user.tenantId },
          include: { plan: true },
        })
      : user?.email
        ? await this.prisma.tenant.findFirst({
            where: { billingEmail: user.email },
            include: { plan: true },
          })
        : null;

    if (!tenant) {
      return {
        tenantId: null,
        current: null,
        history: [],
      };
    }

    if (user && user.tenantId !== tenant.id) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { tenantId: tenant.id },
      });
    }

    const history = await (this.prisma as any).subscriptionPurchase.findMany({
      where: { tenantId: tenant.id, userId: user!.id },
      orderBy: { createdAt: 'desc' },
      include: {
        plan: {
          select: {
            id: true,
            name: true,
            priceMonthly: true,
            priceYearly: true,
            maxCompanies: true,
            maxProjects: true,
            maxUsers: true,
            hasGeofencing: true,
            hasAdvancedReporting: true,
            hasCustomReporting: true,
            hasWhiteLabel: true,
            supportLevel: true,
          },
        },
      },
    });

    return {
      tenantId: tenant.id,
      current: tenant
        ? {
          tenantId: tenant.id,
          tenantName: tenant.name,
          subscriptionStatus: tenant.subscriptionStatus ?? null,
          currentPeriodStart: tenant.currentPeriodStart,
          currentPeriodEnd: tenant.currentPeriodEnd,
          planInterval: tenant.planInterval ?? null,
          plan: tenant.plan
            ? {
                id: tenant.plan.id,
                name: tenant.plan.name,
                priceMonthly: tenant.plan.priceMonthly,
                priceYearly: tenant.plan.priceYearly,
              }
            : null,
          isExpired: Boolean(tenant.currentPeriodEnd && new Date(tenant.currentPeriodEnd).getTime() < Date.now()),
        }
        : null,
      history: history.map((item) => ({
        id: item.id,
        planId: item.planId,
        planName: item.planName,
        interval: item.interval,
        amount: item.amount,
        status: item.status,
        stripeSubscriptionId: item.stripeSubscriptionId,
        stripePriceId: item.stripePriceId,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        plan: item.plan,
      })),
    };
  }
}