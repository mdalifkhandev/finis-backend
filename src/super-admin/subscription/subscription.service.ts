import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePlanDto,
  UpdatePlanDto,
  CreateTenantDto,
  UpdateTenantPlanDto,
  UpdateTenantStatusDto,
} from './dto/subscription.dto';
import { UserRole } from '../../generated/prisma/client';
import Stripe from 'stripe';

@Injectable()
export class SubscriptionService {
  private readonly stripe: any;

  constructor(private prisma: PrismaService) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
      apiVersion: '2026-04-22.dahlia' as any,
    });
  }

  private async syncStripePrices(plan: {
    id: string;
    name: string;
    priceMonthly: number;
    priceYearly: number | null;
    stripeProductId: string | null;
    stripePriceMonthlyId: string | null;
    stripePriceYearlyId: string | null;
  }) {
    const product =
      plan.stripeProductId
        ? await this.stripe.products.retrieve(plan.stripeProductId)
        : await this.stripe.products.create({
            name: plan.name,
            metadata: { planId: plan.id },
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
          // recreate below
        }
      }

      const created = await this.stripe.prices.create({
        product: product.id,
        currency: 'usd',
        unit_amount: Math.round(Number(amount) * 100),
        recurring: { interval },
        metadata: { planId: plan.id, interval: label },
      });

      return { id: created.id };
    };

    const monthlyPrice = await resolveRecurringPrice(
      plan.stripePriceMonthlyId,
      'month',
      plan.priceMonthly,
      'monthly',
    );

    let yearlyPriceId: string | null = null;
    if (plan.priceYearly !== null && plan.priceYearly !== undefined) {
      const yearlyPrice = await resolveRecurringPrice(
        plan.stripePriceYearlyId,
        'year',
        plan.priceYearly,
        'yearly',
      );
      yearlyPriceId = yearlyPrice.id;
    }

    return {
      stripeProductId: product.id,
      stripePriceMonthlyId: monthlyPrice.id,
      stripePriceYearlyId: yearlyPriceId,
    };
  }

  private getBilledAmount(
    plan: { priceMonthly: number; priceYearly: number | null },
    interval?: string | null,
  ) {
    if (interval === 'yearly') return plan.priceYearly ?? plan.priceMonthly;
    return plan.priceMonthly;
  }

  // ══════════════════════════════════════════════════════════════
  //  PLAN MANAGEMENT  (super_admin only)
  // ══════════════════════════════════════════════════════════════

  /** সব plan list — stats সহ */
  async getPlans() {
    const plans = await this.prisma.subscriptionPlan.findMany({
      orderBy: { priceMonthly: 'asc' },
      include: {
        _count: { select: { tenants: true } },
      },
    });

    const total = plans.length;
    const activePlans = plans.filter((p) => p.isActive).length;
    const avgPrice =
      total > 0
        ? Math.round(plans.reduce((s, p) => s + p.priceMonthly, 0) / total)
        : 0;

    return {
      stats: { totalPlans: total, activePlans, averagePrice: avgPrice },
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        priceMonthly: p.priceMonthly,
        priceYearly: p.priceYearly,
        maxCompanies: p.maxCompanies,
        maxProjects: p.maxProjects,
        maxUsers: p.maxUsers,
        hasGeofencing: p.hasGeofencing,
        hasAdvancedReporting: p.hasAdvancedReporting,
        hasCustomReporting: p.hasCustomReporting,
        hasWhiteLabel: p.hasWhiteLabel,
        supportLevel: p.supportLevel,
        isActive: p.isActive,
        tenantCount: p._count.tenants,
        createdAt: p.createdAt,
      })),
    };
  }

  /** Single plan */
  async getPlanById(planId: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
      include: { _count: { select: { tenants: true } } },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  /** Plan তৈরি */
  async createPlan(dto: CreatePlanDto) {
    const exists = await this.prisma.subscriptionPlan.findFirst({
      where: { name: { equals: dto.name, mode: 'insensitive' } },
    });
    if (exists) throw new ConflictException('A plan with this name already exists');

    const plan = await this.prisma.subscriptionPlan.create({
      data: {
        name: dto.name,
        priceMonthly: dto.priceMonthly,
        priceYearly: dto.priceYearly,
        maxCompanies: dto.maxCompanies,
        maxProjects: dto.maxProjects,
        maxUsers: dto.maxUsers,
        hasGeofencing: dto.hasGeofencing ?? false,
        hasAdvancedReporting: dto.hasAdvancedReporting ?? false,
        hasCustomReporting: dto.hasCustomReporting ?? false,
        hasWhiteLabel: dto.hasWhiteLabel ?? false,
        supportLevel: dto.supportLevel,
        isActive: true,
      },
    });

    const stripeData = await this.syncStripePrices({
      id: plan.id,
      name: plan.name,
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      stripeProductId: (plan as any).stripeProductId,
      stripePriceMonthlyId: (plan as any).stripePriceMonthlyId,
      stripePriceYearlyId: (plan as any).stripePriceYearlyId,
    });

    return this.prisma.subscriptionPlan.update({
      where: { id: plan.id },
      data: stripeData,
    });
  }

  /** Plan update */
  async updatePlan(planId: string, dto: UpdatePlanDto) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    if (dto.name && dto.name !== plan.name) {
      const duplicate = await this.prisma.subscriptionPlan.findFirst({
        where: {
          name: { equals: dto.name, mode: 'insensitive' },
          id: { not: planId },
        },
      });
      if (duplicate) throw new ConflictException('Another plan with this name already exists');
    }

    const updated = await this.prisma.subscriptionPlan.update({
      where: { id: planId },
      data: { ...dto },
    });

    const shouldResync = dto.name !== undefined || dto.priceMonthly !== undefined || dto.priceYearly !== undefined;
    if (shouldResync) {
      const stripeData = await this.syncStripePrices({
        id: updated.id,
        name: updated.name,
        priceMonthly: updated.priceMonthly,
        priceYearly: updated.priceYearly,
        stripeProductId: (updated as any).stripeProductId,
        stripePriceMonthlyId: (updated as any).stripePriceMonthlyId,
        stripePriceYearlyId: (updated as any).stripePriceYearlyId,
      });

      return this.prisma.subscriptionPlan.update({
        where: { id: planId },
        data: stripeData,
      });
    }

    return updated;
  }

  /** Plan delete — active tenant থাকলে block */
  async deletePlan(planId: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
      include: { _count: { select: { tenants: true } } },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    if (plan._count.tenants > 0) {
      throw new BadRequestException(
        `Cannot delete plan — ${plan._count.tenants} tenant(s) are using it`,
      );
    }

    await this.prisma.subscriptionPlan.delete({ where: { id: planId } });
    return { message: 'Plan deleted successfully' };
  }

  // ══════════════════════════════════════════════════════════════
  //  TENANT MANAGEMENT  (super_admin only)
  // ══════════════════════════════════════════════════════════════

  /** সব tenant list */
  async getTenants(page = 1, limit = 20, search?: string) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { billingEmail: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [tenants, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          plan: {
            select: {
              id: true,
              name: true,
              priceMonthly: true,
              priceYearly: true,
              hasGeofencing: true,
            },
          },
          _count: { select: { users: true, companies: true } },
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return {
      data: tenants.map((t) => ({
        id: t.id,
        name: t.name,
        domain: t.domain,
        billingEmail: t.billingEmail,
        status: t.status,
        trialEndsAt: t.trialEndsAt,
        subscriptionStatus: t.subscriptionStatus ?? null,
        currentPeriodStart: t.currentPeriodStart,
        currentPeriodEnd: t.currentPeriodEnd,
        planInterval: t.planInterval ?? null,
        stripeSubscriptionId: t.stripeSubscriptionId ?? null,
        billedAmount: this.getBilledAmount(
          { priceMonthly: t.plan.priceMonthly, priceYearly: t.plan.priceYearly ?? null },
          t.planInterval,
        ),
        plan: t.plan,
        userCount: t._count.users,
        companyCount: t._count.companies,
        createdAt: t.createdAt,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Subscription purchase history — who bought which plan, how much, how long */
  async getSubscriptionPurchases(page = 1, limit = 20, search?: string) {
    const skip = (page - 1) * limit;

    const where: any = {
      OR: [
        { subscriptionStatus: { not: null } },
        { stripeSubscriptionId: { not: null } },
      ],
    };

    if (search) {
      where.AND = [
        {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { billingEmail: { contains: search, mode: 'insensitive' } },
            { plan: { name: { contains: search, mode: 'insensitive' } } },
          ],
        },
      ];
    }

    const [tenants, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
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
            },
          },
          users: {
            where: { role: UserRole.admin },
            select: {
              id: true,
              fullName: true,
              email: true,
              status: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return {
      data: tenants.map((tenant) => {
        const interval = tenant.planInterval ?? 'monthly';
        const billedAmount = this.getBilledAmount(
          { priceMonthly: tenant.plan.priceMonthly, priceYearly: tenant.plan.priceYearly ?? null },
          interval,
        );
        const periodStart = tenant.currentPeriodStart ?? null;
        const periodEnd = tenant.currentPeriodEnd ?? null;
        const durationDays = periodStart && periodEnd
          ? Math.max(1, Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)))
          : interval === 'yearly'
            ? 365
            : 30;

        return {
          tenant: {
            id: tenant.id,
            name: tenant.name,
            domain: tenant.domain,
            billingEmail: tenant.billingEmail,
            status: tenant.status,
          },
          adminUsers: tenant.users,
          plan: tenant.plan,
          subscription: {
            subscriptionStatus: tenant.subscriptionStatus ?? null,
            stripeSubscriptionId: tenant.stripeSubscriptionId ?? null,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            planInterval: interval,
            billedAmount,
            durationDays,
          },
        };
      }),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Single tenant detail */
  async getTenantById(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        plan: true,
        users: {
          where: { role: UserRole.admin },
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            avatarUrl: true,
            status: true,
            createdAt: true,
          },
        },
        companies: {
          select: {
            id: true,
            name: true,
            logoUrl: true,
            isActive: true,
            _count: { select: { projects: true } },
          },
        },
        _count: { select: { users: true, companies: true } },
      },
    });

    if (!tenant) throw new NotFoundException('Tenant not found');

    // Usage check — plan limit এর বিপরীতে কতটুকু ব্যবহার হয়েছে
    const projectCount = await this.prisma.project.count({
      where: { company: { tenantId } },
    });
    const userCount = tenant._count.users;
    const companyCount = tenant._count.companies;

    return {
      ...tenant,
      subscription: {
        subscriptionStatus: tenant.subscriptionStatus ?? null,
        currentPeriodStart: tenant.currentPeriodStart,
        currentPeriodEnd: tenant.currentPeriodEnd,
        planInterval: tenant.planInterval ?? null,
        stripeSubscriptionId: tenant.stripeSubscriptionId ?? null,
        billedAmount: this.getBilledAmount(
          { priceMonthly: tenant.plan.priceMonthly, priceYearly: tenant.plan.priceYearly ?? null },
          tenant.planInterval,
        ),
      },
      usage: {
        companies: { used: companyCount, max: tenant.plan.maxCompanies ?? 'Unlimited' },
        projects: { used: projectCount, max: tenant.plan.maxProjects ?? 'Unlimited' },
        users: { used: userCount, max: tenant.plan.maxUsers ?? 'Unlimited' },
      },
    };
  }

  /**
   * Admin onboard করা — Tenant তৈরি + Admin User তৈরি একসাথে
   * super_admin এটা করবে
   */
  async createTenant(dto: CreateTenantDto) {
    // Plan exists কিনা check
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
    });
    if (!plan) throw new NotFoundException('Subscription plan not found');
    if (!plan.isActive) throw new BadRequestException('This plan is not active');

    // Email duplicate check
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.adminEmail },
    });
    if (existingUser) throw new ConflictException('An admin with this email already exists');

    // Domain duplicate check
    if (dto.domain) {
      const existingTenant = await this.prisma.tenant.findUnique({
        where: { domain: dto.domain },
      });
      if (existingTenant) throw new ConflictException('Domain already taken');
    }

    // Transaction — Tenant + Admin User একসাথে create
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Tenant তৈরি
      const tenant = await tx.tenant.create({
        data: {
          name: dto.tenantName,
          domain: dto.domain,
          billingEmail: dto.billingEmail ?? dto.adminEmail,
          planId: dto.planId,
          status: 'active',
        },
      });

      // 2. Admin user তৈরি
      const passwordHash = await bcrypt.hash(dto.adminPassword, 10);
      const admin = await tx.user.create({
        data: {
          tenantId: tenant.id,
          fullName: dto.adminFullName,
          email: dto.adminEmail,
          phone: dto.adminPhone,
          passwordHash,
          role: UserRole.admin,
          status: 'active',
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          role: true,
          status: true,
          createdAt: true,
        },
      });

      return { tenant, admin };
    });

    return {
      message: 'Tenant and admin created successfully',
      tenant: {
        id: result.tenant.id,
        name: result.tenant.name,
        domain: result.tenant.domain,
        status: result.tenant.status,
        planId: result.tenant.planId,
      },
      admin: result.admin,
    };
  }

  /** Plan change — upgrade / downgrade */
  async updateTenantPlan(tenantId: string, dto: UpdateTenantPlanDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        plan: true,
        _count: { select: { users: true, companies: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const newPlan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
    });
    if (!newPlan) throw new NotFoundException('Plan not found');
    if (!newPlan.isActive) throw new BadRequestException('This plan is not active');

    // Downgrade safety check — নতুন plan এর limit এর চেয়ে বেশি ব্যবহার হলে block
    const projectCount = await this.prisma.project.count({
      where: { company: { tenantId } },
    });

    if (newPlan.maxCompanies && tenant._count.companies > newPlan.maxCompanies) {
      throw new BadRequestException(
        `Cannot downgrade — tenant has ${tenant._count.companies} companies but new plan allows only ${newPlan.maxCompanies}`,
      );
    }
    if (newPlan.maxProjects && projectCount > newPlan.maxProjects) {
      throw new BadRequestException(
        `Cannot downgrade — tenant has ${projectCount} projects but new plan allows only ${newPlan.maxProjects}`,
      );
    }
    if (newPlan.maxUsers && tenant._count.users > newPlan.maxUsers) {
      throw new BadRequestException(
        `Cannot downgrade — tenant has ${tenant._count.users} users but new plan allows only ${newPlan.maxUsers}`,
      );
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { planId: dto.planId },
      include: { plan: true },
    });

    return {
      message: 'Plan updated successfully',
      tenant: {
        id: updated.id,
        name: updated.name,
        plan: { id: updated.plan.id, name: updated.plan.name },
      },
    };
  }

  /** Tenant status change — suspend / activate / cancel */
  async updateTenantStatus(tenantId: string, dto: UpdateTenantStatusDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: dto.status as any },
    });

    // Tenant suspend হলে সব admin suspend
    if (dto.status === 'suspended' || dto.status === 'cancelled') {
      await this.prisma.user.updateMany({
        where: { tenantId, role: UserRole.admin },
        data: { status: 'suspended' },
      });
    }

    // Tenant reactivate হলে admin active করো
    if (dto.status === 'active') {
      await this.prisma.user.updateMany({
        where: { tenantId, role: UserRole.admin },
        data: { status: 'active' },
      });
    }

    return {
      message: `Tenant status updated to '${dto.status}'`,
      tenantId: updated.id,
      status: updated.status,
    };
  }

  /** Tenant delete */
  async deleteTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    await this.prisma.tenant.delete({ where: { id: tenantId } });
    return { message: 'Tenant deleted successfully' };
  }

  // ══════════════════════════════════════════════════════════════
  //  PLAN LIMIT GUARD  (admin এর company/project create এ ব্যবহার হবে)
  // ══════════════════════════════════════════════════════════════

  /**
   * Admin company তৈরির আগে call করো
   * Throws ForbiddenException if limit exceeded
   */
  async checkCompanyLimit(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        plan: { select: { maxCompanies: true, hasGeofencing: true } },
        _count: { select: { companies: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status === 'suspended')
      throw new ForbiddenException('Your account is suspended');
    if (tenant.status === 'cancelled')
      throw new ForbiddenException('Your subscription has been cancelled');

    const max = tenant.plan.maxCompanies;
    if (max !== null && tenant._count.companies >= max) {
      throw new ForbiddenException(
        `Company limit reached (${max}). Please upgrade your plan.`,
      );
    }
  }

  /**
   * Admin project তৈরির আগে call করো
   */
  async checkProjectLimit(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { plan: { select: { maxProjects: true } } },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status === 'suspended')
      throw new ForbiddenException('Your account is suspended');

    const projectCount = await this.prisma.project.count({
      where: { company: { tenantId } },
    });

    const max = tenant.plan.maxProjects;
    if (max !== null && projectCount >= max) {
      throw new ForbiddenException(
        `Project limit reached (${max}). Please upgrade your plan.`,
      );
    }
  }

  /**
   * Geofencing use করার আগে call করো
   */
  async checkGeofencingAccess(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { plan: { select: { hasGeofencing: true } } },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    if (!tenant.plan.hasGeofencing) {
      throw new ForbiddenException(
        'Geofencing is not available on your current plan. Please upgrade.',
      );
    }
  }

  /**
   * Admin এর current plan + usage দেখার জন্য (admin নিজে দেখবে)
   */
  async getMyPlanUsage(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        plan: true,
        _count: { select: { users: true, companies: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const projectCount = await this.prisma.project.count({
      where: { company: { tenantId } },
    });

    return {
      plan: {
        id: tenant.plan.id,
        name: tenant.plan.name,
        priceMonthly: tenant.plan.priceMonthly,
        hasGeofencing: tenant.plan.hasGeofencing,
        hasAdvancedReporting: tenant.plan.hasAdvancedReporting,
        supportLevel: tenant.plan.supportLevel,
      },
      tenantStatus: tenant.status,
      trialEndsAt: tenant.trialEndsAt,
      usage: {
        companies: {
          used: tenant._count.companies,
          max: tenant.plan.maxCompanies ?? null,
          unlimited: tenant.plan.maxCompanies === null,
        },
        projects: {
          used: projectCount,
          max: tenant.plan.maxProjects ?? null,
          unlimited: tenant.plan.maxProjects === null,
        },
        users: {
          used: tenant._count.users,
          max: tenant.plan.maxUsers ?? null,
          unlimited: tenant.plan.maxUsers === null,
        },
      },
    };
  }
}
