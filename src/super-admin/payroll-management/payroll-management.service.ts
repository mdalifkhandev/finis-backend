import {
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole } from '../../generated/prisma/client';
import {
    UpdatePayrollConfigDto,
    PayrollManagementQueryDto,
} from './dto/payroll-management.dto';

// ─── Default config values ────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
    period: 'biweekly',
    cppEmployeeRate: 0.0595,
    eiEmployeeRate: 0.0166,
    federalTaxRate: 0.15,
    provincialTaxRate: 0.0505,
    cppEmployerRate: 0.0595,
    eiEmployerRate: 0.0232,
    wsibRate: 0.0142,
    vacationPayRate: 0.04,
};

@Injectable()
export class PayrollManagementService {
    constructor(
        private prisma: PrismaService,
    ) { }

    // ─── Config helper ────────────────────────────────────────────────────────
    private async getOrCreateConfig(companyId: string) {
        let config = await this.prisma.payrollConfig.findUnique({
            where: { companyId },
        });

        if (!config) {
            config = await this.prisma.payrollConfig.create({
                data: { companyId, ...DEFAULT_CONFIG } as any,
            });
        }

        return config;
    }

    // ─── Calculate deductions ─────────────────────────────────────────────────
    private calculateDeductions(grossPay: number, config: any) {
        return {
            cppEmployee: 0,
            eiEmployee: 0,
            federalTax: 0,
            provincialTax: 0,
            totalDeductions: 0,
            netPay: Math.round(grossPay * 100) / 100,
        };
    }

    // ─── Calculate employer cost ──────────────────────────────────────────────
    private calculateEmployerCost(grossPay: number, config: any) {
        const cppEmployer = Math.round(grossPay * config.cppEmployerRate * 100) / 100;
        const eiEmployer = Math.round(grossPay * config.eiEmployerRate * 100) / 100;
        const wsib = Math.round(grossPay * config.wsibRate * 100) / 100;
        const vacationPay = Math.round(grossPay * config.vacationPayRate * 100) / 100;
        const totalEmployerCost = grossPay + cppEmployer + eiEmployer + wsib + vacationPay;

        return { cppEmployer, eiEmployer, wsib, vacationPay, totalEmployerCost };
    }

    // ─── Get current period dates ─────────────────────────────────────────────
    private getPeriodDates(period: string, month?: string, year?: string) {
        const now = new Date();
        const m = month ? parseInt(month) - 1 : now.getMonth();
        const y = year ? parseInt(year) : now.getFullYear();

        if (period === 'weekly') {
            const startDate = new Date(y, m, now.getDate() - now.getDay());
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + 6);
            return { startDate, endDate };
        }

        if (period === 'biweekly') {
            const startDate = new Date(y, m, 1);
            const endDate = new Date(y, m, 15);
            return { startDate, endDate };
        }

        // monthly
        const startDate = new Date(y, m, 1);
        const endDate = new Date(y, m + 1, 0);
        return { startDate, endDate };
    }

    // ─── IMAGE 1: Dashboard ───────────────────────────────────────────────────
    async getDashboard(
        userId: string,
        userRole: string,
        query: PayrollManagementQueryDto,
    ) {
        const { month, year } = query;

        const now = new Date();
        const m = month ? parseInt(month) - 1 : now.getMonth();
        const y = year ? parseInt(year) : now.getFullYear();

        const startDate = new Date(y, m, 1);
        const endDate = new Date(y, m + 1, 0);

        // super_admin সব company দেখবে, admin শুধু নিজের
        const companies = await this.prisma.company.findMany({
            where: userRole === UserRole.super_admin ? {} : { ownerId: userId },
            select: { id: true, name: true },
        });

        const companyIds = companies.map((c) => c.id);

        if (companyIds.length === 0) {
            return {
                summary: {
                    totalGrossPay: 0,
                    totalNetPay: 0,
                    totalEmployerCost: 0,
                    payrollPeriod: 'biweekly',
                },
                currentPeriod: {
                    period: `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
                    workers: 0,
                    pending: 0,
                    status: 'No Data',
                },
                recentRecords: [],
            };
        }

        // সব company র payroll আনো
        const payrolls = await this.prisma.payroll.findMany({
            where: {
                companyId: { in: companyIds },
                payPeriodStart: { gte: startDate },
                payPeriodEnd: { lte: endDate },
            },
            include: {
                worker: {
                    select: {
                        id: true,
                        fullName: true,
                        avatarUrl: true,
                        department: true,
                    },
                },
                company: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        // Config — first company এর config থেকে rates দেখাবো
        const config = await this.getOrCreateConfig(companyIds[0]);

        const totalGrossPay = payrolls.reduce((s, p) => s + p.grossPay, 0);
        const totalNetPay = payrolls.reduce((s, p) => s + p.netPay, 0);
        const totalEmployerCost = payrolls.reduce((s, p) => s + (p.employerCost ?? 0), 0);
        const pendingCount = payrolls.filter((p) => p.status === 'draft').length;
        const workersCount = new Set(payrolls.map((p) => p.workerId)).size;

        return {
            summary: {
                totalGrossPay: Math.round(totalGrossPay * 100) / 100,
                totalNetPay: Math.round(totalNetPay * 100) / 100,
                totalEmployerCost: Math.round(totalEmployerCost * 100) / 100,
                payrollPeriod: config.period,
            },
            currentPeriod: {
                period: `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
                workers: workersCount,
                pending: pendingCount,
                status: pendingCount > 0 ? 'In Progress' : 'Completed',
            },
            deductionRates: {
                cppEmployee: `${(config.cppEmployeeRate * 100).toFixed(2)}%`,
                eiEmployee: `${(config.eiEmployeeRate * 100).toFixed(2)}%`,
                federalTax: `${(config.federalTaxRate * 100).toFixed(0)}%`,
                provincialTax: `${(config.provincialTaxRate * 100).toFixed(2)}%`,
            },
            employerRates: {
                cppEmployer: `${(config.cppEmployerRate * 100).toFixed(2)}%`,
                eiEmployer: `${(config.eiEmployerRate * 100).toFixed(2)}%`,
                wsib: `${(config.wsibRate * 100).toFixed(2)}%`,
                vacationPay: `${(config.vacationPayRate * 100).toFixed(0)}%`,
            },
            recentRecords: payrolls.slice(0, 10).map((p) => ({
                payrollId: p.id,
                company: p.company,
                worker: p.worker,
                period: `${p.payPeriodStart.toLocaleDateString()} - ${p.payPeriodEnd.toLocaleDateString()}`,
                hours: p.regularHours + p.overtimeHours,
                grossPay: p.grossPay,
                deductions: p.deductions,
                netPay: p.netPay,
                status: p.status,
            })),
        };
    }
    // ─── Get All Payroll Records ──────────────────────────────────────────────
    async getPayrollRecords(
        userId: string,
        userRole: string,
        query: PayrollManagementQueryDto,
    ) {
        const { companyId, month, year } = query;

        const now = new Date();
        const m = month ? parseInt(month) - 1 : now.getMonth();
        const y = year ? parseInt(year) : now.getFullYear();

        const startDate = new Date(y, m, 1);
        const endDate = new Date(y, m + 1, 0);

        const payrolls = await this.prisma.payroll.findMany({
            where: {
                ...(companyId && { companyId }),
                payPeriodStart: { gte: startDate },
                payPeriodEnd: { lte: endDate },
            },
            include: {
                worker: {
                    select: {
                        id: true,
                        fullName: true,
                        avatarUrl: true,
                        department: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        return {
            total: payrolls.length,
            records: payrolls.map((p) => ({
                payrollId: p.id,
                worker: p.worker,
                period: `${p.payPeriodStart.toLocaleDateString()} - ${p.payPeriodEnd.toLocaleDateString()}`,
                hours: p.regularHours + p.overtimeHours,
                grossPay: p.grossPay,
                deductions: p.deductions,
                netPay: p.netPay,
                status: p.status,
            })),
        };
    }

    // ─── Process Current Period ───────────────────────────────────────────────
    async processCurrentPeriod(
        userId: string,
        userRole: string,
        query: PayrollManagementQueryDto,
    ) {
        const companyId = query.companyId;
        if (!companyId) throw new NotFoundException('companyId is required');

        const config = await this.getOrCreateConfig(companyId);
        const { startDate, endDate } = this.getPeriodDates(
            config.period,
            query.month,
            query.year,
        );

        const payrolls = await this.prisma.payroll.findMany({
            where: {
                companyId,
                status: 'approved',
                payPeriodStart: { gte: startDate },
                payPeriodEnd: { lte: endDate },
            },
            include: {
                worker: {
                    select: {
                        id: true,
                        fullName: true,
                    },
                },
            },
        });

        if (payrolls.length === 0) {
            return { message: 'No approved payrolls found for current period', results: [] };
        }

        const results: Array<{
            payrollId: string;
            workerName: string;
            grossPay: number;
            deductions: number;
            netPay: number;
            status: 'calculated';
        }> = [];

        for (const payroll of payrolls) {
            results.push({
                payrollId: payroll.id,
                workerName: payroll.worker.fullName,
                grossPay: payroll.grossPay,
                deductions: payroll.deductions,
                netPay: payroll.netPay,
                status: 'calculated',
            });
        }

        const totalGrossPay = results.reduce((sum, item) => sum + item.grossPay, 0);
        const totalDeductions = results.reduce((sum, item) => sum + item.deductions, 0);
        const totalNetPay = results.reduce((sum, item) => sum + item.netPay, 0);

        return {
            message: `Calculated: ${results.length} payroll record(s)`,
            summary: {
                totalPayrolls: results.length,
                totalGrossPay: Math.round(totalGrossPay * 100) / 100,
                totalDeductions: Math.round(totalDeductions * 100) / 100,
                totalNetPay: Math.round(totalNetPay * 100) / 100,
            },
            results,
        };
    }

    // ─── Generate Report ──────────────────────────────────────────────────────
    async generateReport(
        userId: string,
        userRole: string,
        query: PayrollManagementQueryDto,
    ) {
        const companyId = query.companyId;
        if (!companyId) throw new NotFoundException('companyId is required');

        const config = await this.getOrCreateConfig(companyId);
        const { startDate, endDate } = this.getPeriodDates(
            config.period,
            query.month,
            query.year,
        );

        const payrolls = await this.prisma.payroll.findMany({
            where: {
                companyId,
                payPeriodStart: { gte: startDate },
                payPeriodEnd: { lte: endDate },
            },
            include: {
                worker: {
                    select: {
                        id: true,
                        fullName: true,
                        department: true,
                        hourlyRate: true,
                    },
                },
            },
        });

        const totalGrossPay = payrolls.reduce((s, p) => s + p.grossPay, 0);
        const totalDeductions = payrolls.reduce((s, p) => s + p.deductions, 0);
        const totalNetPay = payrolls.reduce((s, p) => s + p.netPay, 0);
        const totalEmployerCost = payrolls.reduce(
            (s, p) => s + (p.employerCost ?? 0), 0,
        );

        return {
            reportGeneratedAt: new Date(),
            period: {
                start: startDate,
                end: endDate,
                type: config.period,
            },
            summary: {
                totalWorkers: payrolls.length,
                totalGrossPay: Math.round(totalGrossPay * 100) / 100,
                totalDeductions: Math.round(totalDeductions * 100) / 100,
                totalNetPay: Math.round(totalNetPay * 100) / 100,
                totalEmployerCost: Math.round(totalEmployerCost * 100) / 100,
            },
            deductionRates: {
                cppEmployee: `${(config.cppEmployeeRate * 100).toFixed(2)}%`,
                eiEmployee: `${(config.eiEmployeeRate * 100).toFixed(2)}%`,
                federalTax: `${(config.federalTaxRate * 100).toFixed(0)}%`,
                provincialTax: `${(config.provincialTaxRate * 100).toFixed(2)}%`,
            },
            employerRates: {
                cppEmployer: `${(config.cppEmployerRate * 100).toFixed(2)}%`,
                eiEmployer: `${(config.eiEmployerRate * 100).toFixed(2)}%`,
                wsib: `${(config.wsibRate * 100).toFixed(2)}%`,
                vacationPay: `${(config.vacationPayRate * 100).toFixed(0)}%`,
            },
            records: payrolls.map((p) => ({
                worker: p.worker,
                grossPay: p.grossPay,
                deductions: p.deductions,
                netPay: p.netPay,
                employerCost: p.employerCost,
                status: p.status,
            })),
        };
    }

    // ─── Get Config ───────────────────────────────────────────────────────────
    async getConfig(userId: string, userRole: string) {
        const companies = await this.prisma.company.findMany({
            where: userRole === UserRole.super_admin ? {} : { ownerId: userId },
            select: { id: true, name: true },
            take: 1,
        });

        if (!companies.length) throw new NotFoundException('No company found');

        const config = await this.getOrCreateConfig(companies[0].id);

        return {
            companyId: companies[0].id,
            companyName: companies[0].name,
            period: config.period,
            employeeDeductions: {
                cppEmployeeRate: config.cppEmployeeRate * 100,
                eiEmployeeRate: config.eiEmployeeRate * 100,
                federalTaxRate: config.federalTaxRate * 100,
                provincialTaxRate: config.provincialTaxRate * 100,
            },
            employerContributions: {
                cppEmployerRate: config.cppEmployerRate * 100,
                eiEmployerRate: config.eiEmployerRate * 100,
                wsibRate: config.wsibRate * 100,
                vacationPayRate: config.vacationPayRate * 100,
            },
        };
    }

    // ─── Update Config ────────────────────────────────────────────────────────
    async updateConfig(
        dto: UpdatePayrollConfigDto,
        userId: string,
        userRole: string,
    ) {
        const companies = await this.prisma.company.findMany({
            where: userRole === UserRole.super_admin ? {} : { ownerId: userId },
            select: { id: true },
            take: 1,
        });

        if (!companies.length) throw new NotFoundException('No company found');

        const companyId = companies[0].id;

        const updated = await this.prisma.payrollConfig.upsert({
            where: { companyId },
            create: {
                companyId,
                ...DEFAULT_CONFIG,
                ...(dto.period && { period: dto.period }),
                ...(dto.cppEmployeeRate && { cppEmployeeRate: dto.cppEmployeeRate / 100 }),
                ...(dto.eiEmployeeRate && { eiEmployeeRate: dto.eiEmployeeRate / 100 }),
                ...(dto.federalTaxRate && { federalTaxRate: dto.federalTaxRate / 100 }),
                ...(dto.provincialTaxRate && { provincialTaxRate: dto.provincialTaxRate / 100 }),
                ...(dto.cppEmployerRate && { cppEmployerRate: dto.cppEmployerRate / 100 }),
                ...(dto.eiEmployerRate && { eiEmployerRate: dto.eiEmployerRate / 100 }),
                ...(dto.wsibRate && { wsibRate: dto.wsibRate / 100 }),
                ...(dto.vacationPayRate && { vacationPayRate: dto.vacationPayRate / 100 }),
            } as any,
            update: {
                ...(dto.period && { period: dto.period }),
                ...(dto.cppEmployeeRate !== undefined && { cppEmployeeRate: dto.cppEmployeeRate / 100 }),
                ...(dto.eiEmployeeRate !== undefined && { eiEmployeeRate: dto.eiEmployeeRate / 100 }),
                ...(dto.federalTaxRate !== undefined && { federalTaxRate: dto.federalTaxRate / 100 }),
                ...(dto.provincialTaxRate !== undefined && { provincialTaxRate: dto.provincialTaxRate / 100 }),
                ...(dto.cppEmployerRate !== undefined && { cppEmployerRate: dto.cppEmployerRate / 100 }),
                ...(dto.eiEmployerRate !== undefined && { eiEmployerRate: dto.eiEmployerRate / 100 }),
                ...(dto.wsibRate !== undefined && { wsibRate: dto.wsibRate / 100 }),
                ...(dto.vacationPayRate !== undefined && { vacationPayRate: dto.vacationPayRate / 100 }),
            },
        });

        return { message: 'Config updated successfully', config: updated };
    }

    // ─── Reset Config ─────────────────────────────────────────────────────────
    async resetConfig(userId: string, userRole: string) {
        const companies = await this.prisma.company.findMany({
            where: userRole === UserRole.super_admin ? {} : { ownerId: userId },
            select: { id: true },
            take: 1,
        });

        if (!companies.length) throw new NotFoundException('No company found');

        const companyId = companies[0].id;

        const reset = await this.prisma.payrollConfig.upsert({
            where: { companyId },
            create: { companyId, ...DEFAULT_CONFIG } as any,
            update: { ...DEFAULT_CONFIG } as any,
        });

        return { message: 'Config reset to defaults', config: reset };
    }

    // ─── IMAGE 3: Sample Calculation ─────────────────────────────────────────
    async calculateSample(
        hours: number,
        ratePerHour: number,
        userId: string,
        userRole: string,
    ) {
        const companies = await this.prisma.company.findMany({
            where: userRole === UserRole.super_admin ? {} : { ownerId: userId },
            select: { id: true },
            take: 1,
        });

        if (!companies.length) throw new NotFoundException('No company found');

        const config = await this.getOrCreateConfig(companies[0].id);
        const grossPay = Math.round(hours * ratePerHour * 100) / 100;

        const deductions = this.calculateDeductions(grossPay, config);
        const employerCosts = this.calculateEmployerCost(grossPay, config);

        return {
            input: { hours, ratePerHour },
            grossPay,
            employeeDeductions: {
                cppEmployee: { rate: `${(config.cppEmployeeRate * 100).toFixed(2)}%`, amount: -deductions.cppEmployee },
                eiEmployee: { rate: `${(config.eiEmployeeRate * 100).toFixed(2)}%`, amount: -deductions.eiEmployee },
                federalTax: { rate: `${(config.federalTaxRate * 100).toFixed(0)}%`, amount: -deductions.federalTax },
                provincialTax: { rate: `${(config.provincialTaxRate * 100).toFixed(2)}%`, amount: -deductions.provincialTax },
                total: -deductions.totalDeductions,
            },
            netPay: deductions.netPay,
            employerCosts: {
                cppEmployer: { rate: `${(config.cppEmployerRate * 100).toFixed(2)}%`, amount: employerCosts.cppEmployer },
                eiEmployer: { rate: `${(config.eiEmployerRate * 100).toFixed(2)}%`, amount: employerCosts.eiEmployer },
                wsib: { rate: `${(config.wsibRate * 100).toFixed(2)}%`, amount: employerCosts.wsib },
                totalEmployerCost: employerCosts.totalEmployerCost,
            },
        };
    }
}
